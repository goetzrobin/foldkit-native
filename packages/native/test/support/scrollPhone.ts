/**
 * The part of a real iPhone that the simulated phone leaves out, for one
 * list: a scroll view that keeps its own position and puts itself back
 * inside its range, and rows that the phone lays out and measures.
 *
 * The simulated phone records what the program asks for and does nothing
 * by itself. That hides the bugs that come from what UIKit does by itself.
 * This file plays that part, as React Native 0.88 and UIKit do it:
 *
 * - A commit reaches the scroll view as its props first (`contentInset`),
 *   then its state (the content size, which is the height of its one
 *   content view): `RCTMountingManager.mm` calls `updateProps` before
 *   `updateState`. After each, UIKit puts an offset that is now past the
 *   end of the range back at the end, and says so with a scroll event.
 * - A `scrollTo` command moves it there at once and says so; a gliding one
 *   also says when it has come to rest. With `glideSteps`, a gliding one
 *   takes that many frames of 16 ms, saying where it is on each; a new
 *   `scrollTo` during a glide stops it where it is, and the phone says the
 *   stopped glide has come to rest (UIKit ends the interrupted animation and
 *   React Native reports that as the end of a scroll), at once or, with
 *   `lateEnds`, after the new glide's first frame. Which of the two a real
 *   iPhone does is not known here; a list must be right with both.
 * - After a commit, each row reports its height when it has changed. How
 *   tall a row is comes from `rowHeight`, which a test writes from the
 *   row's text, as a phone would lay the text out.
 * - Every scroll event says whether a finger did it, as React Native 0.88
 *   says it: `responderIgnoreScroll` is true unless the user is dragging
 *   (`RCTScrollViewComponentView.mm`, `_scrollViewMetrics`). React's own
 *   responder ignores such a scroll; the engine's does not (see
 *   `test/flagship/hold.test.ts`).
 * - With `insetScrolls`, a new `contentInset` is a scroll as well: UIKit
 *   calls `scrollViewDidScroll` when the inset is set, and React Native
 *   sends that on as `onScroll`, even where the offset stays where it was.
 *
 * `topOf(id)` is where a view with that testID is in the window, worked out
 * the way the phone would draw it, so a test can say whether something on
 * screen moved.
 */
import type { FakeFabric, FakeFabricNode } from '@ng-native/testing/fake'

// Kept free of the Foldkit test phone, so the Effect UI suite uses this same file.
const flatten = (nodes: ReadonlyArray<FakeFabricNode>): Array<FakeFabricNode> =>
  nodes.flatMap(node => [node, ...flatten(node.children)])

const byTestId = (fabric: FakeFabric, id: string): FakeFabricNode => {
  const found = flatten(fabric.committed).find(node => node.props['testID'] === id)
  if (found === undefined) throw new Error(`No view with testID ${id}`)
  return found
}

export type ScrollPhoneOptions = Readonly<{
  /** The testID of the list's scroll view. */
  listId: string
  /** The scroll view's height. */
  viewport: number
  /** How tall the phone lays a row out. Rows it does not know are left as they are. */
  rowHeight: (row: FakeFabricNode) => number | undefined
  /** Where the list's top edge is in the window. */
  listTop?: number
  /** Frames a gliding scroll takes. Default 0: it arrives at once. */
  glideSteps?: number
  /** A glide stopped by a new one says it came to rest a frame late. */
  lateEnds?: boolean
  /** A new bottom inset is reported as a scroll, as UIKit does. Default false. */
  insetScrolls?: boolean
  /**
   * How long after a commit a row reports a new height, in milliseconds of
   * real time: 0 or undefined for at once. A text view that measures itself
   * late (native Markdown) reports later than the rest of its commit.
   */
  measureDelay?: (row: FakeFabricNode) => number | undefined
}>

export const startScrollPhone = (fabric: FakeFabric, options: ScrollPhoneOptions) => {
  const { listId, viewport } = options
  const listTop = options.listTop ?? 0
  const phone = { offset: 0, inset: 0, size: 0 }
  /** Every place the phone put itself back inside its range, by how far it moved. */
  const clamps: Array<number> = []
  const reported = new Map<number, number>()
  let commandsSeen = fabric.commands.length
  let isQueued = false
  let isOn = true
  /** The glide under way, when glides take frames. */
  let glide: ReturnType<typeof setTimeout> | undefined
  const glideSteps = options.glideSteps ?? 0

  const list = (): FakeFabricNode | undefined => {
    try {
      return byTestId(fabric, listId)
    } catch {
      return undefined
    }
  }
  const canvasOf = (scroll: FakeFabricNode): FakeFabricNode | undefined => scroll.children.at(-1)?.children[0]
  const rowsOf = (scroll: FakeFabricNode): Array<FakeFabricNode> => canvasOf(scroll)?.children.slice(1) ?? []

  const furthest = (): number => Math.max(0, phone.size + phone.inset - viewport)

  /** Whether a finger is dragging the list now. */
  let isDragging = false
  /** Every scroll event the phone sent, with whether a finger did it. */
  const told: Array<Readonly<{ offset: number; byFinger: boolean }>> = []

  const tell = (scroll: FakeFabricNode): void => {
    told.push({ offset: phone.offset, byFinger: isDragging })
    fabric.emit(scroll, 'topScroll', {
      contentOffset: { x: 0, y: phone.offset },
      layoutMeasurement: { width: 390, height: viewport },
      contentSize: { width: 390, height: phone.size },
      contentInset: { top: 0, left: 0, bottom: phone.inset, right: 0 },
      responderIgnoreScroll: !isDragging,
    })
  }

  /** UIKit's own rule: a position past the end of the range is put back at the end. */
  const clamp = (scroll: FakeFabricNode): void => {
    const end = furthest()
    if (phone.offset <= end + 1e-9) return
    clamps.push(phone.offset - end)
    phone.offset = end
    tell(scroll)
  }

  const mount = (): void => {
    isQueued = false
    if (!isOn) return
    const scroll = list()
    if (scroll === undefined) return
    // Props first: the inset.
    const inset = (scroll.props['contentInset'] as { bottom?: number } | undefined)?.bottom ?? 0
    if (inset !== phone.inset) {
      phone.inset = inset
      const clamped = clamps.length
      clamp(scroll)
      if (options.insetScrolls === true && clamps.length === clamped) tell(scroll)
    }
    // Then the state: the content view's height.
    const size = Number(canvasOf(scroll)?.props['height'] ?? 0)
    if (size !== phone.size) {
      phone.size = size
      clamp(scroll)
    }
    // Then the scroll commands sent with this commit, in order.
    for (const command of fabric.commands.slice(commandsSeen)) {
      if (command.name !== 'scrollTo' || command.node?.reactTag !== scroll.reactTag) continue
      const target = Math.min(Math.max(0, Number(command.args[1])), furthest())
      const isGliding = command.args[2] === true
      if (glide !== undefined) {
        clearTimeout(glide)
        glide = undefined
        if (options.lateEnds === true) setTimeout(() => isOn && fabric.emit(scroll, 'topMomentumScrollEnd', {}), 24)
        else fabric.emit(scroll, 'topMomentumScrollEnd', {})
      }
      if (isGliding && glideSteps > 0) {
        const from = phone.offset
        let step = 0
        const next = (): void => {
          step += 1
          phone.offset = from + ((target - from) * step) / glideSteps
          tell(scroll)
          if (step < glideSteps) {
            glide = setTimeout(next, 16)
            return
          }
          glide = undefined
          fabric.emit(scroll, 'topMomentumScrollEnd', {})
        }
        glide = setTimeout(next, 16)
        continue
      }
      phone.offset = target
      tell(scroll)
      if (isGliding) fabric.emit(scroll, 'topMomentumScrollEnd', {})
    }
    commandsSeen = fabric.commands.length
    // Then the rows report their heights: at once, or a moment later.
    for (const row of rowsOf(scroll)) {
      const delay = options.measureDelay?.(row) ?? 0
      if (delay <= 0) report(row)
      else setTimeout(() => isOn && report(row), delay)
    }
  }

  /** A row says how tall it is, if that has changed and it is still drawn. */
  const report = (drawn: FakeFabricNode): void => {
    const scroll = list()
    // The row as the newest commit has it, if it is still drawn.
    const row = scroll === undefined ? undefined : rowsOf(scroll).find(each => each.reactTag === drawn.reactTag)
    if (row === undefined) return
    const height = options.rowHeight(row)
    if (height === undefined || reported.get(row.reactTag) === height) return
    reported.set(row.reactTag, height)
    fabric.emit(row, 'topLayout', { layout: { x: 0, y: 0, width: 390, height } })
  }

  /** Every row drawn lays itself out again now, as text that measured itself late does. */
  const remeasure = (): void => {
    const scroll = list()
    if (scroll === undefined || !isOn) return
    for (const row of rowsOf(scroll)) report(row)
  }

  // Each commit is mounted a moment later, as on a phone.
  const completeRoot = fabric.completeRoot.bind(fabric)
  fabric.completeRoot = ((...args: Parameters<FakeFabric['completeRoot']>) => {
    completeRoot(...args)
    if (isQueued) return
    isQueued = true
    setTimeout(mount, 0)
  }) as FakeFabric['completeRoot']

  const scroll = list()
  if (scroll !== undefined) {
    fabric.emit(scroll, 'topLayout', { layout: { x: 0, y: 0, width: 390, height: viewport } })
  }

  /** Where the top of a view with this testID is in the window. */
  const topOf = (id: string): number => {
    const scrollNode = list()
    if (scrollNode === undefined) throw new Error('No list on screen')
    const canvas = canvasOf(scrollNode)
    if (canvas === undefined) throw new Error('The list has no rows')
    let y = Number(canvas.children[0]?.props['height'] ?? 0)
    for (const row of canvas.children.slice(1)) {
      if (flatten([row]).some(node => node.props['testID'] === id)) return listTop + y - phone.offset
      y += reported.get(row.reactTag) ?? 0
    }
    throw new Error(`No row holds ${id}`)
  }

  /** How tall the row holding a view with this testID last said it is, or undefined. */
  const heightOf = (id: string): number | undefined => {
    const scrollNode = list()
    const canvas = scrollNode === undefined ? undefined : canvasOf(scrollNode)
    const row = canvas?.children.slice(1).find(each => flatten([each]).some(node => node.props['testID'] === id))
    return row === undefined ? undefined : reported.get(row.reactTag)
  }

  /** A finger drags the list to `to`, in a few moves, and lets go there. */
  const drag = (to: number): void => {
    const scrollNode = list()
    if (scrollNode === undefined) return
    fabric.emit(scrollNode, 'topScrollBeginDrag', {
      contentOffset: { x: 0, y: phone.offset },
      layoutMeasurement: { width: 390, height: viewport },
    })
    isDragging = true
    const from = phone.offset
    for (const part of [0.25, 0.5, 0.75, 1]) {
      phone.offset = Math.min(Math.max(0, from + (to - from) * part), furthest())
      tell(scrollNode)
    }
    isDragging = false
    fabric.emit(scrollNode, 'topScrollEndDrag', {
      contentOffset: { x: 0, y: phone.offset },
      layoutMeasurement: { width: 390, height: viewport },
    })
  }

  return {
    phone,
    clamps,
    told,
    furthest,
    topOf,
    drag,
    remeasure,
    heightOf,
    /** Scroll commands sent since the phone started, as [y, animated]. */
    scrolls: (): Array<readonly [number, boolean]> =>
      fabric.commands
        .filter(each => each.name === 'scrollTo')
        .map(each => [Number(each.args[1]), each.args[2] === true] as const),
    stop: (): void => {
      isOn = false
      clearTimeout(glide)
      fabric.completeRoot = completeRoot
    },
  }
}

export type ScrollPhone = ReturnType<typeof startScrollPhone>
