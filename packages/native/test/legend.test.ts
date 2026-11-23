/**
 * The list element built on Legend List's own core, on the simulated phone.
 *
 * These tests ask one thing in several ways: does Legend's arithmetic, run
 * with no React, give the rows a person would expect to see. The pretend
 * phone in `support/legendPhone.ts` plays the native scroll view.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { style, text, view as box } from '../src/index.js'
import { Heights, chooseWindow } from '../src/list/index.js'
import {
  legendContainers,
  legendHandles,
  legendList,
  legendVisibleRange,
  scrollLegendListToEnd,
} from '../src/legend/index.js'
import {
  type FakeScroll,
  containerViews,
  contentHeight,
  dragTo,
  drawnRows,
  furthest,
  layOutList,
  makeFakeScroll,
  partsOf,
  pump,
  rowsOnScreen,
  screenTopOf,
} from './support/legendPhone.js'
import { type Phone, byTestId, press, settle, startPhone, textOf } from './support/phone.js'

const Item = Schema.Struct({ id: Schema.Number, label: Schema.String })
type Item = typeof Item.Type

const Model = Schema.Struct({
  items: Schema.Array(Item),
  pressed: Schema.Array(Schema.Number),
  ends: Schema.Number,
  nextId: Schema.Number,
  anchorIndex: Schema.Number,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedRow: { id: Schema.Number },
  ReachedEnd: {},
  PressedAppend: {},
  PressedPrepend: {},
  PressedRename: {},
  PressedSend: {},
  PressedToEnd: {},
  CompletedScroll: {},
})
type Message = typeof Message.Type

const ToEnd = Command.define('ToEnd', {
  args: { animated: Schema.Boolean },
  messages: [Message.CompletedScroll],
  execute: ({ animated }) =>
    scrollLegendListToEnd('rows', { animated }).pipe(Effect.as(Message.CompletedScroll())),
})

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedRow: ({ id }) => ({ model: modifyFields(model, { pressed: was => [...was, id] }) }),
    ReachedEnd: () => ({ model: modifyFields(model, { ends: count => count + 1 }) }),
    PressedAppend: () => ({
      model: modifyFields(model, {
        items: items => [...items, { id: model.nextId, label: `New ${model.nextId}` }],
        nextId: id => id + 1,
      }),
    }),
    PressedPrepend: () => ({
      model: modifyFields(model, {
        items: items => [{ id: model.nextId, label: `New ${model.nextId}` }, ...items],
        nextId: id => id + 1,
      }),
    }),
    PressedRename: () => ({
      model: modifyFields(model, {
        items: items => items.map(item => (item.id === 999 ? { ...item, label: 'Renamed' } : item)),
      }),
    }),
    // What a chat does on send: two new rows, the first of them anchored, then scroll to the end.
    PressedSend: () => ({
      model: modifyFields(model, {
        anchorIndex: () => model.items.length,
        items: items => [
          ...items,
          { id: model.nextId, label: 'Question' },
          { id: model.nextId + 1, label: 'Answer' },
        ],
        nextId: id => id + 2,
      }),
      commands: [ToEnd({ animated: false })],
    }),
    PressedToEnd: () => ({ model, commands: [ToEnd({ animated: false })] }),
    CompletedScroll: () => ({ model }),
  })

const ESTIMATE = 50
const VIEWPORT = 600
const COUNT = 1000

type Options = Readonly<{
  count?: number
  initialScrollAtEnd?: boolean
  maintainScrollAtEnd?: boolean
  alignItemsAtEnd?: boolean
  recycleItems?: boolean
}>

let viewRuns = 0
let rowRuns = 0

const button = (h: HtmlBuilder<Message>, id: string, message: Message): Html =>
  box([h.Attribute('testID', id), h.OnClick(message)], [text([], [id])])

const makeProgram = (phone: Phone, platform: string, options: Options) =>
  Runtime.makeElement({
    Model,
    init: () => ({
      model: {
        items: Array.from({ length: options.count ?? COUNT }, (_unused, id) => ({
          id,
          label: `Row ${id}`,
        })),
        pressed: [],
        ends: 0,
        nextId: 100000,
        anchorIndex: -1,
      },
    }),
    update,
    view: (model: Model, h: HtmlBuilder<Message>): Html => {
      viewRuns += 1
      return box(
        [style({ flex: 1 })],
        [
          text([h.Attribute('testID', 'status')], [
            `pressed:${model.pressed.join(',')} ends:${model.ends}`,
          ]),
          button(h, 'append', Message.PressedAppend()),
          button(h, 'prepend', Message.PressedPrepend()),
          button(h, 'rename', Message.PressedRename()),
          button(h, 'send', Message.PressedSend()),
          button(h, 'to-end', Message.PressedToEnd()),
          legendList(h, {
            id: 'rows',
            platform,
            items: model.items,
            key: item => item.id,
            estimatedItemSize: ESTIMATE,
            maintainVisibleContentPosition: true,
            initialScrollAtEnd: options.initialScrollAtEnd ?? false,
            maintainScrollAtEnd: options.maintainScrollAtEnd ?? false,
            alignItemsAtEnd: options.alignItemsAtEnd ?? false,
            recycleItems: options.recycleItems ?? true,
            ...(model.anchorIndex >= 0
              ? { anchoredEndSpace: { anchorIndex: model.anchorIndex, anchorMaxSize: 72, anchorOffset: 16 } }
              : {}),
            onEndReached: () => Message.ReachedEnd(),
            row: item => {
              rowRuns += 1
              return box(
                [h.Attribute('testID', `row-${item.id}`), h.OnClick(Message.PressedRow({ id: item.id }))],
                [text([], [item.label])],
              )
            },
            attributes: [h.Attribute('testID', 'list'), style({ flex: 1 })],
          }),
        ],
      )
    },
    container: phone.surface.container,
  })

/** The height the pretend phone gives a row: rows differ, and none is the estimate. */
const baseHeight = (rowId: string): number => 40 + (Number(rowId.slice(4)) % 3) * 20

type Running = { phone: Phone; scroll: FakeScroll; grown: Map<string, number>; stop: () => Promise<void> }

const start = async (platform: 'ios' | 'android', options: Options = {}): Promise<Running> => {
  viewRuns = 0
  rowRuns = 0
  const phone = startPhone(platform)
  const grown = new Map<string, number>()
  const handle = Runtime.embed(makeProgram(phone, platform, options))
  await settle()
  const scroll = makeFakeScroll(phone, 'list', VIEWPORT, rowId => grown.get(rowId) ?? baseHeight(rowId))
  await layOutList(scroll)
  return {
    phone,
    scroll,
    grown,
    stop: async () => {
      handle.dispose()
      await settle()
      phone.surface.dispose()
    },
  }
}

const ids = (rows: ReadonlyArray<{ rowId: string }>): number[] => rows.map(row => Number(row.rowId.slice(4)))

/** Where every row would start if each were as tall as the phone says. */
const realOffsetOf = (id: number): number => {
  let offset = 0
  for (let at = 0; at < id; at++) offset += baseHeight(`row-${at}`)
  return offset
}

describe.each(['ios', 'android'] as const)('Legend core, 1,000 rows (%s)', platform => {
  let running: Running

  beforeEach(async () => {
    running = await start(platform)
  })
  afterEach(() => running.stop())

  it('draws the four parts Legend lays out, with the layer as tall as the list', () => {
    const { scroll } = running
    const { adjust, layer } = partsOf(scroll)
    const list = byTestId(running.phone.fabric, 'list')
    expect(list.viewName).toBe('ScrollView')
    expect(list.props['maintainVisibleContentPosition']).toEqual({ minIndexForVisible: 0 })
    expect(adjust.props['collapsable']).toBe(false)
    expect(adjust.props['top']).toBe(10_000_000)
    expect(layer.props['opacity']).toBe(1)
    // 14 rows are measured; the rest count as the average of those, which is Legend's way.
    expect(Number(layer.props['height'])).toBeGreaterThan(COUNT * 40)
    expect(Number(layer.props['height'])).toBeLessThan(COUNT * 80)
  })

  it('starts at the top, with the first rows where their real heights put them', () => {
    const { scroll } = running
    const rows = drawnRows(scroll)
    expect(ids(rows).slice(0, 5)).toEqual([0, 1, 2, 3, 4])
    for (const row of rows.slice(0, 10)) {
      expect(row.top).toBe(realOffsetOf(Number(row.rowId.slice(4))))
    }
    // Every row on screen is drawn, and far fewer than 1,000 are.
    expect(ids(rowsOnScreen(scroll))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(rows.length).toBeLessThan(40)
  })

  it('agrees with our own list about which rows cover the screen', async () => {
    const { scroll } = running
    // Our list's arithmetic, given the same heights, for three scroll positions.
    // Positions where no row edge sits exactly on the screen's edge. There the two differ by
    // definition: Legend counts a row whose top touches the bottom edge, with nothing of it showing.
    for (const target of [0, 3010, 20005]) {
      await dragTo(scroll, target)
      const shown = rowsOnScreen(scroll)
      const first = Number(shown[0]!.rowId.slice(4))
      const last = Number(shown.at(-1)!.rowId.slice(4))
      // Legend's own report of the same thing.
      expect(legendVisibleRange('rows')).toEqual({ start: first, end: last })
      // Our list, told the tops Legend chose for the rows it drew.
      const heights = new Heights(shown.map(row => row.height))
      const within = scroll.offset - (shown[0]!.top)
      const ours = chooseWindow(heights, Math.max(0, within), VIEWPORT, 0, { first: 0, end: 0 })
      expect(ours.first).toBe(0)
      expect(ours.end).toBe(shown.length)
      // No gap and no overlap between neighbours.
      for (let at = 1; at < shown.length; at++) {
        expect(shown[at]!.top).toBe(shown[at - 1]!.top + shown[at - 1]!.height)
      }
      // The screen is covered from top to bottom.
      expect(shown[0]!.top).toBeLessThanOrEqual(scroll.offset)
      expect(shown.at(-1)!.top + shown.at(-1)!.height).toBeGreaterThanOrEqual(scroll.offset + VIEWPORT)
    }
  })

  it('scrolls without a Message and without running the view', async () => {
    const { scroll } = running
    const runsBefore = viewRuns
    await dragTo(scroll, 5000)
    await dragTo(scroll, 12000)
    expect(viewRuns).toBe(runsBefore)
    expect(rowsOnScreen(scroll).length).toBeGreaterThan(5)
  })

  it('recycles containers: far down the list the same native views are used', async () => {
    const { scroll } = running
    await dragTo(scroll, 2000)
    const viewsBefore = new Set(containerViews(scroll).map(view => view.reactTag))
    const countBefore = legendContainers('rows')[0]!.length
    await dragTo(scroll, 9000)
    await dragTo(scroll, 16000)
    const viewsAfter = containerViews(scroll).map(view => view.reactTag)
    // The rows are different ones ...
    expect(Math.min(...ids(drawnRows(scroll)))).toBeGreaterThan(200)
    // ... in native views that were already there.
    const reused = viewsAfter.filter(tag => viewsBefore.has(tag)).length
    expect(reused).toBeGreaterThanOrEqual(Math.min(viewsBefore.size, viewsAfter.length) - 2)
    expect(viewsAfter.length).toBeLessThan(40)
    expect(legendContainers('rows')[0]!.length).toBeLessThanOrEqual(countBefore + 6)
  })

  it('keeps the rows on screen where they are when rows above turn out taller', async () => {
    const { scroll } = running
    // Jump far down: everything above is an estimate. Then come back up a little,
    // so rows that were never measured are laid out above the screen.
    await dragTo(scroll, 20000)
    const watched = rowsOnScreen(scroll)[2]!.rowId
    const before = screenTopOf(scroll, watched)!
    const adjustBefore = Number(partsOf(scroll).adjust.props['top'])
    await dragTo(scroll, scroll.offset - 300)
    const moved = screenTopOf(scroll, watched)!
    // The row moved down the screen by the 300 points dragged, and no more:
    // the rows measured above it did not push it.
    expect(Math.abs(moved - (before + 300))).toBeLessThanOrEqual(1)
    // Legend did have to correct: the adjust view moved.
    expect(Number(partsOf(scroll).adjust.props['top'])).not.toBe(adjustBefore)
  })

  it('keeps position when a row is added at the top', async () => {
    const { scroll, phone } = running
    await dragTo(scroll, 3000)
    const watched = rowsOnScreen(scroll)[1]!.rowId
    const before = screenTopOf(scroll, watched)!
    await press(phone.fabric, 'prepend')
    await pump(scroll)
    expect(Math.abs(screenTopOf(scroll, watched)! - before)).toBeLessThanOrEqual(1)
  })

  it('sends the row Message for a press, and redraws a row whose item changed', async () => {
    const { scroll, phone } = running
    await press(phone.fabric, 'row-3')
    expect(textOf(byTestId(phone.fabric, 'status'))).toContain('pressed:3')
    await pump(scroll)
    expect(textOf(byTestId(phone.fabric, 'row-3'))).toBe('Row 3')
  })
})

describe.each(['ios', 'android'] as const)('Legend core, a list that starts at its end (%s)', platform => {
  let running: Running

  beforeEach(async () => {
    running = await start(platform, { initialScrollAtEnd: true, maintainScrollAtEnd: true })
  })
  afterEach(() => running.stop())

  it('starts with the last row at the bottom of the screen', () => {
    const { scroll } = running
    const shown = rowsOnScreen(scroll)
    expect(Number(shown.at(-1)!.rowId.slice(4))).toBe(COUNT - 1)
    expect(scroll.offset).toBe(furthest(scroll))
    const last = shown.at(-1)!
    expect(Math.abs(screenTopOf(scroll, last.rowId)! + last.height - VIEWPORT)).toBeLessThanOrEqual(1)
    expect(partsOf(scroll).layer.props['opacity']).toBe(1)
  })

  it('stays at the end as the last row grows, as a streamed reply does', async () => {
    const { scroll, grown } = running
    for (const height of [120, 260, 480]) {
      grown.set(`row-${COUNT - 1}`, height)
      await pump(scroll)
      const last = drawnRows(scroll).at(-1)!
      expect(last.rowId).toBe(`row-${COUNT - 1}`)
      expect(scroll.offset).toBe(furthest(scroll))
      expect(Math.abs(screenTopOf(scroll, last.rowId)! + height - VIEWPORT)).toBeLessThanOrEqual(1)
    }
  })

  it('stays at the end when a row is added', async () => {
    const { scroll, phone } = running
    await press(phone.fabric, 'append')
    await pump(scroll)
    expect(rowsOnScreen(scroll).at(-1)!.rowId).toBe('row-100000')
    expect(scroll.offset).toBe(furthest(scroll))
  })

  it('does not pull back to the end once the user has scrolled up', async () => {
    const { scroll, grown, phone } = running
    await dragTo(scroll, scroll.offset - 2000)
    const watched = rowsOnScreen(scroll)[1]!.rowId
    const before = screenTopOf(scroll, watched)!
    grown.set(`row-${COUNT - 1}`, 400)
    await press(phone.fabric, 'append')
    await pump(scroll)
    expect(Math.abs(screenTopOf(scroll, watched)! - before)).toBeLessThanOrEqual(1)
    expect(scroll.offset).toBeLessThan(furthest(scroll) - 1000)
  })

  it('goes back to the end on command', async () => {
    const { scroll, phone } = running
    await dragTo(scroll, scroll.offset - 2000)
    await press(phone.fabric, 'to-end')
    await pump(scroll)
    expect(scroll.offset).toBe(furthest(scroll))
    expect(rowsOnScreen(scroll).at(-1)!.rowId).toBe(`row-${COUNT - 1}`)
  })
})

describe('Legend core, the chat behaviours', () => {
  it('puts a short list at the bottom of the screen', async () => {
    const running = await start('ios', { count: 3, alignItemsAtEnd: true })
    const { scroll } = running
    const rows = drawnRows(scroll)
    expect(ids(rows)).toEqual([0, 1, 2])
    const last = rows.at(-1)!
    expect(screenTopOf(scroll, last.rowId)! + last.height).toBe(VIEWPORT)
    expect(Number(partsOf(scroll).start.props['height'])).toBe(VIEWPORT - (40 + 60 + 80))
    await running.stop()
  })

  it('on send, brings the new message to the top and leaves room below for the reply', async () => {
    const running = await start('ios', { count: 30, initialScrollAtEnd: true })
    const { scroll, phone, grown } = running
    await press(phone.fabric, 'send')
    await pump(scroll)
    // The question sits 16 points below the top of the list.
    expect(Math.abs(screenTopOf(scroll, 'row-100000')! - 16)).toBeLessThanOrEqual(1)
    // Room was added below the answer so the list can scroll that far.
    const endSpace = Number(partsOf(scroll).end.props['height'])
    expect(endSpace).toBeGreaterThan(300)
    expect(contentHeight(scroll) - VIEWPORT).toBe(scroll.offset)
    // As the answer grows, the question stays put and the room shrinks by as much.
    grown.set('row-100001', baseHeight('row-100001') + 200)
    await pump(scroll)
    expect(Math.abs(screenTopOf(scroll, 'row-100000')! - 16)).toBeLessThanOrEqual(1)
    expect(Number(partsOf(scroll).end.props['height'])).toBe(endSpace - 200)
    await running.stop()
  })

  it('cleans up: nothing is drawn or heard after the list is gone', async () => {
    const running = await start('ios', { count: 50 })
    expect(legendHandles('rows')).toHaveLength(1)
    await running.stop()
    expect(legendHandles('rows')).toHaveLength(0)
  })
})
