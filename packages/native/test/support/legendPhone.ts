/**
 * The parts of a real phone that Legend List leans on and the fake Fabric
 * does not have: a scroll view that keeps a position, obeys `scrollTo`, cannot
 * scroll past its content, and holds its first child still when that child is
 * moved (`maintainVisibleContentPosition`). And layout: every container view
 * is given a height and reports it.
 *
 * A test says how tall each row is. Everything else follows what a phone does.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'

import { type Phone, byTestId, flatten, settle } from './phone.js'

export type FakeScroll = {
  readonly phone: Phone
  readonly listId: string
  readonly viewport: number
  /** A row's height by the testID of the element `row` drew. */
  heightOf: (rowId: string) => number
  offset: number
  /** The adjust view's `top` when last seen, to tell how far it has moved since. */
  adjustTop: number | undefined
  /** How many of the fake's recorded commands have been obeyed. */
  commandsSeen: number
  /** Heights already reported, by container view. */
  reported: Map<number, string>
  /** Every scroll event sent, for tests that count them. */
  events: number
}

export const makeFakeScroll = (
  phone: Phone,
  listId: string,
  viewport: number,
  heightOf: (rowId: string) => number,
): FakeScroll => ({
  phone,
  listId,
  viewport,
  heightOf,
  offset: 0,
  adjustTop: undefined,
  commandsSeen: phone.fabric.commands.length,
  reported: new Map(),
  events: 0,
})

const scrollNode = (scroll: FakeScroll): FakeFabricNode => byTestId(scroll.phone.fabric, scroll.listId)

/** The content view's children: adjust view, start spacer, layer, end spacer. */
export const partsOf = (scroll: FakeScroll) => {
  const content = scrollNode(scroll).children.at(-1)
  if (content === undefined) throw new Error('The list has no content view')
  const [adjust, start, layer, end] = content.children
  if (adjust === undefined || start === undefined || layer === undefined || end === undefined) {
    throw new Error('The list has not drawn its four parts')
  }
  return { content, adjust, start, layer, end }
}

const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

export const contentHeight = (scroll: FakeScroll): number => {
  const { content, start, layer, end } = partsOf(scroll)
  return (
    num(content.props['paddingTop']) +
    num(start.props['height']) +
    num(layer.props['height']) +
    num(end.props['height']) +
    num(content.props['paddingBottom'])
  )
}

export const furthest = (scroll: FakeScroll): number =>
  Math.max(0, contentHeight(scroll) - scroll.viewport)

const rowIdIn = (container: FakeFabricNode): string | undefined =>
  flatten(container.children)
    .map(node => node.props['testID'])
    .find((id): id is string => typeof id === 'string')

export type DrawnRow = Readonly<{ rowId: string; top: number; height: number }>

/** The rows drawn now, top to bottom, with where the phone would put them. */
export const drawnRows = (scroll: FakeScroll): DrawnRow[] =>
  partsOf(scroll)
    .layer.children.map(container => {
      const rowId = rowIdIn(container)
      return rowId === undefined
        ? undefined
        : { rowId, top: num(container.props['top']), height: scroll.heightOf(rowId) }
    })
    .filter((row): row is DrawnRow => row !== undefined)
    .sort((a, b) => a.top - b.top)

/** The rows any part of which is on screen, by where the list's own views are. */
export const rowsOnScreen = (scroll: FakeScroll): DrawnRow[] => {
  const { start, content } = partsOf(scroll)
  const before = num(content.props['paddingTop']) + num(start.props['height'])
  return drawnRows(scroll).filter(
    row =>
      before + row.top + row.height > scroll.offset &&
      before + row.top < scroll.offset + scroll.viewport,
  )
}

/** Where a row's top edge is on the screen: 0 is the top of the list. */
export const screenTopOf = (scroll: FakeScroll, rowId: string): number | undefined => {
  const { start, content } = partsOf(scroll)
  const row = drawnRows(scroll).find(each => each.rowId === rowId)
  return row === undefined
    ? undefined
    : num(content.props['paddingTop']) + num(start.props['height']) + row.top - scroll.offset
}

export const containerViews = (scroll: FakeScroll): FakeFabricNode[] => partsOf(scroll).layer.children

const sendScroll = (scroll: FakeScroll, type = 'topScroll'): void => {
  scroll.events += 1
  scroll.phone.fabric.emit(scrollNode(scroll), type, {
    contentOffset: { x: 0, y: scroll.offset },
    layoutMeasurement: { width: 320, height: scroll.viewport },
    contentSize: { width: 320, height: contentHeight(scroll) },
    contentInset: { top: 0, left: 0, bottom: 0, right: 0 },
    zoomScale: 1,
  })
}

/** One round of what the phone does after a commit. True if it did anything. */
const react = (scroll: FakeScroll): boolean => {
  let did = false
  const { fabric } = scroll.phone
  const { adjust, layer } = partsOf(scroll)
  const before = scroll.offset

  // The scroll view keeps its first child where it was on screen.
  const top = num(adjust.props['top'])
  if (scroll.adjustTop !== undefined && top !== scroll.adjustTop) {
    if (scrollNode(scroll).props['maintainVisibleContentPosition'] !== undefined) {
      scroll.offset += top - scroll.adjustTop
    }
  }
  scroll.adjustTop = top

  // Commands, in the order they were sent.
  for (const command of fabric.commands.slice(scroll.commandsSeen)) {
    if (command.name !== 'scrollTo' || command.viewName !== 'ScrollView') continue
    scroll.offset = Number(command.args[1])
  }
  scroll.commandsSeen = fabric.commands.length

  // A scroll view does not rest past its content.
  scroll.offset = Math.min(Math.max(0, scroll.offset), furthest(scroll))
  if (scroll.offset !== before) {
    sendScroll(scroll)
    did = true
  }

  // Layout: each container reports its height when it is new or has changed.
  for (const container of layer.children) {
    const rowId = rowIdIn(container)
    if (rowId === undefined) continue
    const said = `${rowId}:${scroll.heightOf(rowId)}`
    if (scroll.reported.get(container.reactTag) === said) continue
    scroll.reported.set(container.reactTag, said)
    fabric.emit(container, 'topLayout', {
      layout: { x: 0, y: num(container.props['top']), width: 320, height: scroll.heightOf(rowId) },
    })
    did = true
  }
  return did
}

/** Lets the list and the pretend phone answer each other until both are quiet. */
export const pump = async (scroll: FakeScroll, rounds = 30): Promise<void> => {
  let quiet = 0
  for (let round = 0; round < rounds && quiet < 2; round++) {
    await settle()
    quiet = react(scroll) ? 0 : quiet + 1
  }
}

/** The phone lays out the scroll view itself. */
export const layOutList = async (scroll: FakeScroll): Promise<void> => {
  scroll.phone.fabric.emit(scrollNode(scroll), 'topLayout', {
    layout: { x: 0, y: 0, width: 320, height: scroll.viewport },
  })
  // A scroll view starts where its `contentOffset` says, if its content reaches.
  const initial = scrollNode(scroll).props['contentOffset'] as { y?: number } | undefined
  if (typeof initial?.y === 'number') scroll.offset = initial.y
  await pump(scroll)
}

/** A finger drags the list to a position and lets go, with no fling. */
export const dragTo = async (scroll: FakeScroll, y: number): Promise<void> => {
  sendScroll(scroll, 'topScrollBeginDrag')
  // A finger moves the list by a distance. Whatever the list corrects under
  // the finger in the meantime is added to that, not replaced by it.
  const distance = Math.min(Math.max(0, y), furthest(scroll)) - scroll.offset
  for (let step = 1; step <= 4; step++) {
    scroll.offset = Math.min(Math.max(0, scroll.offset + distance / 4), furthest(scroll))
    sendScroll(scroll)
    await settle()
    // Rows that came into view are laid out while the finger is still down.
    react(scroll)
  }
  sendScroll(scroll, 'topScrollEndDrag')
  await pump(scroll)
}
