/**
 * The part of the list that runs on the phone's side of Foldkit.
 *
 * Foldkit draws the scroll view and one empty content view, and never looks
 * inside. This module owns what is inside: a "canvas" view as tall as the
 * whole list, a spacer standing in for the rows above the ones drawn, and the
 * rows near the screen.
 *
 *   scroll-view                 drawn by Foldkit
 *     view (content)            drawn by Foldkit, left empty
 *       view (canvas)           drawn here, as tall as every row together
 *         view (spacer)         as tall as the rows above the first one drawn
 *         view (row) ...        the rows near the screen, one after another
 *
 * The rows sit in normal flow after the spacer, as in ng-native's virtual
 * list, so the phone places a row correctly the first time it appears, before
 * anyone knows its real height. Each row then reports its height, which is
 * remembered by the row's key and used for the spacer and the canvas.
 *
 * Scrolling does not go through Foldkit. The scroll view's scroll events are
 * heard here, straight from the engine. When the rows drawn no longer cover
 * the screen plus a margin, the caller's `row` function is run for the new
 * rows, the result is patched into the canvas with a second updater that has
 * the same modules as Foldkit's own, and the engine commits. No Message is
 * sent and the program's view function does not run.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import type { Html } from 'foldkit/html'
import { type VNode, h, init, onUnmountModule } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend.js'
import { type Handler, customEvent, handlersByNode, makeModules, nodeOf } from '../modules.js'
import { makeNodeApi } from '../nodeApi.js'
import { type Box, type ChatKeyboard, createChatKeyboard } from '../chat/vendor/kbc/chatKeyboard.js'
import type { KeyboardLiftBehavior } from '../chat/vendor/kbc/types.js'
import { type AnchoredEndSpace, endOffset, endSpaceFor, isAtEnd } from './end.js'
import { EMPTY_RANGE, Heights, type Range, chooseWindow, rowsBetween } from './window.js'

export type RowKey = string | number

/** What `list(...)` leaves on its scroll view for this module to read. */
export type ListSpec = Readonly<{
  id: string
  items: ReadonlyArray<unknown>
  key: (item: any, index: number) => RowKey
  row: (item: any, index: number) => Html
  estimatedRowHeight: number
  rowHeight: number | undefined
  /** How far past the screen rows are drawn, in screen heights. */
  drawAhead: number
  /** How close to the end counts as reaching it, in screen heights. */
  endReachedThreshold: number
  /** Open at the last row. See `ListConfig` in `index.ts` for these five. */
  initialScrollAtEnd: boolean
  maintainScrollAtEnd: boolean
  /** Whether following a new row glides or jumps. */
  maintainScrollAtEndAnimated: boolean
  /** Follow the end only when the list itself changes height (the keyboard). */
  maintainScrollAtEndOnlyWhenResized: boolean
  /**
   * With `maintainScrollAtEndOnlyWhenResized`: follow rows that grow or
   * arrive too, while the follow state is on. See `Following` below.
   */
  maintainScrollAtEndFollowOnReturn: boolean
  /** How close to the end counts as being at it, in screen heights. */
  atEndThreshold: number
  anchoredEndSpace: AnchoredEndSpace | undefined
  /** Rows shorter than the list sit at its bottom. */
  alignItemsAtEnd: boolean
  /**
   * Set when the list keeps clear of the composer and the keyboard with a
   * bottom inset, not by being made shorter: what the messages do as the
   * keyboard opens. See `../chat/chatScroll.ts`.
   */
  insetLift: KeyboardLiftBehavior | undefined
  /**
   * Runs a function that builds Foldkit elements as if it were called inside
   * the program's view, so the handlers in those elements send their Messages
   * to the program. Captured during each view call. See `list` in `index.ts`.
   */
  inFrame: (build: () => Html) => Html
}>

/** What a row-count label is told. */
export type ListStats = Readonly<{
  /** How many row views exist right now. */
  rowViews: number
  /** The first row drawn, counting from 0. */
  first: number
  /** One past the last row drawn. */
  end: number
  /** How many items the list has. */
  count: number
  /** The list's own numbers, or undefined when there is no list. */
  numbers: ListNumbers | undefined
}>

/** What a list knows about itself, for showing on a real phone. In points. */
export type ListNumbers = Readonly<{
  /** The scroll view's own height. 0 before the phone has said. */
  viewport: number
  /** Every row together. */
  rows: number
  /** The blank space kept under the last row for `anchoredEndSpace`. */
  blankSpace: number
  /** The scroll view's bottom inset, or undefined for a list without one. */
  inset: number | undefined
  /** How much of the list's bottom the keyboard covers, as the list was told. */
  keyboard: number
  /** The composer's height, as the list was told. */
  bar: number
  /** Where the list is scrolled to, as last heard from the phone or asked of it. */
  offset: number
  /** The furthest it can scroll. */
  furthest: number
  /** The last place the phone was asked to scroll to. */
  lastScroll:
    | Readonly<{
        target: number
        animated: boolean
        /** How often in a row the phone was asked for this same place. */
        sends: number
        /** Whether the phone has since reported being there. */
        arrived: boolean
      }>
    | undefined
  isAtEnd: boolean | undefined
  /** On its way to the end and meant to arrive exactly. */
  isHolding: boolean
  /** Keeping up with the end as rows grow or arrive. See `Following`. */
  isFollowing: boolean
  /**
   * Where the anchored row (the question after Send) is, while there is
   * one: its top from the list's top edge, as the list works it out from
   * where the phone last said it is (`top`), and in the window as the phone
   * measured it (`windowY`, once the phone has answered). `step` is how far
   * it moved in the last draw, `drift` how far since the list last moved on
   * purpose (a scroll it asked for, or a finger). Both should stay at 0.
   */
  anchor:
    | Readonly<{
        top: number
        step: number
        drift: number
        windowY: number | undefined
        windowStep: number | undefined
        windowDrift: number | undefined
      }>
    | undefined
}>

/** What a `composerDock` in `'inset'` mode tells a list. */
export type ListKeyboardEvent =
  /** The keyboard starts to move, and will stop at `height`. */
  | Readonly<{ type: 'start'; height: number }>
  /** The keyboard has stopped at `height`. */
  | Readonly<{ type: 'end'; height: number }>
  /** A finger is dragging the keyboard down. */
  | Readonly<{ type: 'interactive' }>
  /**
   * The composer is `height` tall, the strip under it that the keyboard
   * covers anyway (the home indicator's) included, and that strip is `rest`.
   */
  | Readonly<{ type: 'bar'; height: number; rest: number }>

/** What a list with a bottom inset keeps for it. */
type Inset = {
  keyboard: ChatKeyboard
  /** Read by `keyboard` on every event. */
  options: { keyboardLiftBehavior: KeyboardLiftBehavior; offset: number }
  scroll: Box<number>
  layout: Box<{ width: number; height: number }>
  size: Box<{ width: number; height: number }>
  blankSpace: Box<number>
  bar: Box<number>
  /** What the phone's scroll view was last given, or undefined before the first time. */
  sent: number | undefined
  /** How tall the rows were when it was given. */
  sentRows: number
  sentIndicator: number | undefined
  /**
   * How tall the rows' view was in the commits the phone may not have taken
   * in yet, oldest first, and in the last one it surely has. See `writeInset`.
   */
  drawnRows: Array<{ rows: number; at: number }>
  /** A draw that hands the phone an inset that was held back for one commit. */
  settleTimer: ReturnType<typeof setTimeout> | undefined
  /** Between the keyboard's start and its end. */
  isKeyboardMoving: boolean
}

export const LIST_DATA = 'foldkitList'
/** On the list's content view: the same spec, so the module can find the
 *  content view. The updater creates a parent before its children, so the
 *  scroll view cannot look for its content view when it is created. */
export const CONTENT_DATA = 'foldkitListContent'
export const LABEL_DATA = 'foldkitListLabel'
export const END_REACHED = 'listEndReached'
export const AT_END_CHANGED = 'listAtEndChanged'

/** How long a list that opens at its end may stay unseen while it waits for
 *  the phone to measure its rows. After this it is shown as it is. */
const REVEAL_AFTER_MS = 400

/** How long a gliding scroll is trusted to still be on its way. */
const GLIDE_MS = 700

/** How near counts as there, in points. */
const ARRIVED_WITHIN = 2

/**
 * How long after a finger lets go to wait for the phone to say a fling has
 * started. Without one the user's scroll is over. The phone says it at once.
 */
const FLING_WAIT_MS = 80

/** How long an inset held back for one commit waits before it is handed over. */
const INSET_SETTLE_MS = 48

/** What a label shows when no list with its id is on screen. */
const NO_LIST: ListStats = { rowViews: 0, first: 0, end: 0, count: 0, numbers: undefined }

/** Used until the scroll view has reported its own height. */
const ASSUMED_VIEWPORT = 800

const SPACER_KEY = '\u0000spacer'

type Anchor = Readonly<{ key: RowKey; within: number }>

type ListState = {
  spec: ListSpec
  readonly engine: Engine
  readonly scroll: EngineNode
  /** Set for a list with a bottom inset. */
  readonly inset: Inset | undefined
  /** The last place the phone was asked to scroll to, for `ListNumbers`. */
  lastScroll: { target: number; animated: boolean; sends: number; arrived: boolean } | undefined
  keys: Array<RowKey>
  indexByKey: Map<RowKey, number>
  heights: Heights
  /** Real heights the phone has reported, by row key. */
  readonly measured: Map<RowKey, number>
  /** Where the scroll view is, as last heard or last asked for. */
  offset: number
  /** The scroll view's own height, or 0 before the phone has said. */
  viewport: number
  range: Range
  /** The row at the top of the screen, and how far it is scrolled past. Kept
   *  so the same row can be put back there when rows above it change. */
  anchor: Anchor | undefined
  /** A scroll position to send to the phone after the next commit. */
  pendingScroll: number | undefined
  /** Whether that scroll should glide. */
  pendingAnimated: boolean
  /** Where the phone's scroll view is, as last heard from it or sent to it. */
  native: number
  /** Where the phone last said it is, since it was last asked to scroll. */
  reported: number | undefined
  /** Blank space under the last row. See `AnchoredEndSpace`. */
  endSpace: number
  /** Whether the end of the list is on screen. Not known before the phone
   *  has said how tall the list is. */
  isAtEnd: boolean | undefined
  /** What the program was last told about `isAtEnd`. */
  toldAtEnd: boolean
  /**
   * The list is on its way to its end and must arrive there exactly: on
   * opening, after `scrollToEnd`, and after a new row is anchored. Row
   * heights are guesses until the phone measures them, so the end moves a
   * little while this is set, and the list moves with it. It ends when the
   * rows at the end are measured, or when the user takes hold of the list.
   */
  holdEnd: boolean
  /** How often the phone has been told again during this hold. */
  holdRepeats: number
  /** See `Following`. */
  isFollowing: boolean
  /** A finger is on the list, or a fling it started is still running. */
  isUserScrolling: boolean
  /** Waits, after a finger lets go, for the phone to say a fling started. */
  flingTimer: ReturnType<typeof setTimeout> | undefined
  /** Where the anchored row was at the last draw, for `ListNumbers.anchor`. */
  anchorSeen:
    | {
        key: RowKey
        top: number
        step: number
        baseline: number | undefined
        windowY: number | undefined
        windowStep: number | undefined
        windowBaseline: number | undefined
      }
    | undefined
  /** A gliding scroll this module started that has not arrived yet. */
  glide: { target: number; timer: ReturnType<typeof setTimeout> } | undefined
  /** Not shown yet: a list that opens at its end, before it is there. */
  isHidden: boolean
  revealTimer: ReturnType<typeof setTimeout> | undefined
  /** The row the list last scrolled to for `anchoredEndSpace`. */
  anchoredKey: RowKey | undefined
  /** The row vnodes drawn now, kept so an unchanged row is not built again. */
  rows: Map<RowKey, VNode>
  canvas: VNode
  /** The item count `onEndReached` last fired for. */
  endReachedFor: number
  isMeasureQueued: boolean
  isAlive: boolean
  draw: (during: 'foldkit' | 'own') => void
  stops: Array<() => void>
}

type Label = Readonly<{
  id: string
  format: (stats: ListStats) => string
  engine: Engine
  textNode: EngineNode
  shown: { text: string }
}>

// Lists and labels find each other by id, across the two updaters.
const listsById = new Map<string, Set<ListState>>()
const labelsById = new Map<string, Set<Label>>()

const viewportOf = (state: ListState): number =>
  state.viewport > 0 ? state.viewport : ASSUMED_VIEWPORT

const statsOf = (state: ListState): ListStats => ({
  rowViews: state.range.end - state.range.first,
  first: state.range.first,
  end: state.range.end,
  count: state.keys.length,
  numbers: numbersOf(state),
})

const writeLabel = (label: Label, stats: ListStats): boolean => {
  const text = label.format(stats)
  if (text === label.shown.text) return false
  label.shown.text = text
  label.engine.setText(label.textNode, text)
  return true
}

const announce = (state: ListState): void => {
  const labels = labelsById.get(state.spec.id)
  if (labels === undefined || labels.size === 0) return
  noteAnchor(state)
  for (const label of labels) writeLabel(label, statsOf(state))
}

/** Reads the items again: their keys, and a height for each. */
const index = (state: ListState): void => {
  const { items, key, estimatedRowHeight, rowHeight } = state.spec
  state.keys = items.map((item, at) => key(item, at))
  state.indexByKey = new Map(state.keys.map((rowKey, at) => [rowKey, at]))
  state.heights = new Heights(
    state.keys.map(rowKey => rowHeight ?? state.measured.get(rowKey) ?? estimatedRowHeight),
  )
  // Heights of rows that are gone are dropped once they outnumber the rows.
  if (state.measured.size > state.keys.length * 2 + 64) {
    for (const rowKey of [...state.measured.keys()]) {
      if (!state.indexByKey.has(rowKey)) state.measured.delete(rowKey)
    }
  }
}

/**
 * How tall the rows' own view is. With a bottom inset and `alignItemsAtEnd`
 * it is at least as tall as the list above the composer, so that a few rows
 * sit on top of the composer and can still be lifted by the keyboard.
 */
const rowsHeight = (state: ListState): number => {
  const total = state.heights.total()
  if (state.inset === undefined || !state.spec.alignItemsAtEnd || state.viewport <= 0) return total
  return Math.max(total, state.viewport - state.inset.bar.value)
}

/** Gives the keyboard arithmetic the list as it is now. */
const syncInset = (state: ListState, inset: Inset): void => {
  inset.scroll.value = state.offset
  inset.layout.value = { width: 0, height: viewportOf(state) }
  inset.size.value = { width: 0, height: rowsHeight(state) }
  inset.blankSpace.value = state.endSpace
}

/**
 * The bottom inset a list with one should have: the composer and the
 * keyboard, or the blank space if that is larger. The keyboard is taken in
 * by the blank space, not added to it.
 */
const insetOf = (state: ListState, inset: Inset): number => {
  syncInset(state, inset)
  return inset.keyboard.totalPadding()
}

/**
 * The least bottom inset that keeps the phone where it is, whichever of the
 * recent rows' heights it still has when it takes this inset (see
 * `writeInset`). A position already outside the range (a finger pulling
 * past the end) is not kept.
 */
const insetKeepingPlace = (state: ListState, inset: Inset, rows: number): number => {
  const newest = inset.drawnRows.at(-1)
  // Only while the phone may still have other rows than these. Otherwise
  // the inset is taken whole, and a smaller range is a real one.
  if (inset.sent === undefined || newest === undefined || inset.drawnRows.length < 2 || state.viewport <= 0) return 0
  const furthestNow = newest.rows + inset.sent - state.viewport
  const place = Math.min(state.native, furthestNow)
  const lowest = Math.min(rows, ...inset.drawnRows.map(each => each.rows))
  return place + state.viewport - lowest
}

/** Notes the rows' height this commit gives the phone, and forgets what it surely has taken in. */
const noteDrawnRows = (inset: Inset, rows: number, now: number): void => {
  const history = inset.drawnRows
  if (history.at(-1)?.rows !== rows) history.push({ rows, at: now })
  // Keep the newest commit old enough to be on the phone, and every one after it.
  let surely = -1
  for (let at = 0; at < history.length; at++) {
    if (now - (history[at] as { at: number }).at >= INSET_SETTLE_MS) surely = at
  }
  if (surely > 0) history.splice(0, surely)
}

/**
 * How far the list reaches: every row and what comes under the last one.
 * That is blank space inside the content, or, for a list with a bottom
 * inset, the inset, which is outside the content.
 */
const contentHeight = (state: ListState): number =>
  state.inset === undefined
    ? state.heights.total() + state.endSpace
    : rowsHeight(state) + insetOf(state, state.inset)

/** How tall the view that holds the rows is. */
const canvasHeight = (state: ListState): number =>
  state.inset === undefined ? contentHeight(state) : rowsHeight(state)

const furthestOffset = (state: ListState): number =>
  endOffset(contentHeight(state), viewportOf(state))

const numbersOf = (state: ListState): ListNumbers => ({
  viewport: state.viewport,
  rows: state.heights.total(),
  blankSpace: state.endSpace,
  inset: state.inset === undefined ? undefined : insetOf(state, state.inset),
  keyboard: state.inset?.keyboard.padding.value ?? 0,
  bar: state.inset?.bar.value ?? 0,
  offset: state.offset,
  furthest: furthestOffset(state),
  lastScroll: state.lastScroll === undefined ? undefined : { ...state.lastScroll },
  isAtEnd: state.isAtEnd,
  isHolding: state.holdEnd,
  isFollowing: state.spec.maintainScrollAtEndFollowOnReturn && state.isFollowing,
  anchor: anchorNumbersOf(state),
})

const anchorNumbersOf = (state: ListState): ListNumbers['anchor'] => {
  const seen = state.anchorSeen
  if (seen === undefined || seen.key !== state.anchoredKey) return undefined
  return {
    top: seen.top,
    step: seen.step,
    drift: seen.baseline === undefined ? 0 : seen.top - seen.baseline,
    windowY: seen.windowY,
    windowStep: seen.windowStep,
    windowDrift:
      seen.windowY === undefined || seen.windowBaseline === undefined
        ? undefined
        : seen.windowY - seen.windowBaseline,
  }
}

/** Nothing is moving the list on purpose: no glide, no hold, no finger, no scroll waiting to go. */
const isSettled = (state: ListState): boolean =>
  !state.holdEnd && state.glide === undefined && !state.isUserScrolling && state.pendingScroll === undefined

/**
 * Notes where the anchored row is now, for the numbers on screen: from the
 * list's own heights and the place the phone last reported or was sent to.
 */
const noteAnchor = (state: ListState): void => {
  const key = state.anchoredKey
  const at = key === undefined ? undefined : state.indexByKey.get(key)
  if (key === undefined || at === undefined) {
    state.anchorSeen = undefined
    return
  }
  const top = state.heights.offsetOf(at) - state.native
  let seen = state.anchorSeen
  if (seen === undefined || seen.key !== key) {
    seen = { key, top, step: 0, baseline: undefined, windowY: undefined, windowStep: undefined, windowBaseline: undefined }
    state.anchorSeen = seen
  } else {
    seen.step = top - seen.top
    seen.top = top
  }
  if (seen.baseline === undefined && isSettled(state)) seen.baseline = top
}

/** The list moves on purpose: drift is counted again from where it comes to rest. */
const restartDrift = (state: ListState): void => {
  if (state.anchorSeen === undefined) return
  state.anchorSeen.baseline = undefined
  state.anchorSeen.windowBaseline = undefined
}

/** The key of the row `anchoredEndSpace` names, if there is such a row. */
const anchoredKeyOf = (state: ListState): RowKey | undefined => {
  const at = state.spec.anchoredEndSpace?.anchorIndex
  return at === undefined ? undefined : state.keys[at]
}

const takeAnchor = (state: ListState): void => {
  if (state.keys.length === 0 || state.offset <= 0) {
    state.anchor = undefined
    return
  }
  const at = state.heights.indexAt(state.offset)
  const key = state.keys[at]
  state.anchor =
    key === undefined ? undefined : { key, within: state.offset - state.heights.offsetOf(at) }
}

/**
 * Rows above the screen changed height, or rows were added or removed above
 * it. Everything on screen has moved by the difference. This works out the
 * scroll position that puts the anchored row back where it was.
 */
const holdAnchor = (state: ListState): void => {
  const anchor = state.anchor
  if (anchor === undefined) return
  const at = state.indexByKey.get(anchor.key)
  if (at === undefined) return
  const wanted = Math.min(state.heights.offsetOf(at) + anchor.within, furthestOffset(state))
  if (Math.abs(wanted - state.offset) < 1) return
  state.offset = wanted
  state.pendingScroll = wanted
}

const chooseRows = (state: ListState): boolean => {
  const viewport = viewportOf(state)
  const offset = Math.min(Math.max(0, state.offset), furthestOffset(state))
  const next = chooseWindow(
    state.heights,
    offset,
    viewport,
    state.spec.drawAhead * viewport,
    state.range,
  )
  if (next === state.range) return false
  state.range = next
  return true
}

const endGlide = (state: ListState): void => {
  if (state.glide === undefined) return
  clearTimeout(state.glide.timer)
  state.glide = undefined
}

/** Sends a scroll position to the phone, and remembers a glide is under way. */
const sendScroll = (state: ListState, wanted: number, animated: boolean): void => {
  endGlide(state)
  restartDrift(state)
  const last = state.lastScroll
  const isAgain = last !== undefined && Math.abs(last.target - wanted) < 1
  state.lastScroll = {
    target: wanted,
    animated,
    sends: isAgain ? last.sends + 1 : 1,
    arrived: false,
  }
  state.reported = undefined
  state.native = wanted
  state.engine.dispatchCommand(state.scroll, 'scrollTo', [0, wanted, animated])
  if (!animated) return
  // While the list glides the phone reports positions on the way. Those must
  // not be read as "the user left the end". The timer is for a glide whose
  // last report never comes.
  const glide = {
    target: wanted,
    timer: setTimeout(() => {
      if (state.glide !== glide || !state.isAlive) return
      state.glide = undefined
      // The phone was asked to glide and, as far as it has said, is not
      // there: it reported other places, or nothing at all. A list must not
      // be left short of where it was sent, so it is put there at once.
      // Asked once only: this scroll does not glide and so has no timer.
      const isShort =
        state.reported === undefined || Math.abs(state.reported - wanted) >= ARRIVED_WITHIN
      if (isShort) {
        state.offset = wanted
        takeAnchor(state)
        if (chooseRows(state)) state.draw('own')
        sendScroll(state, wanted, false)
      }
      afterGlide(state)
    }, GLIDE_MS),
  }
  state.glide = glide
}

/** A glide has ended, by arriving or by running out of time. */
const afterGlide = (state: ListState): void => {
  catchUp(state)
  refreshAtEnd(state)
  tellAtEnd(state)
  // An inset that was waiting for the glide to end is given to the phone
  // now, and the numbers on screen are brought up to date.
  state.draw('own')
}

const sendPendingScroll = (state: ListState): void => {
  const wanted = state.pendingScroll
  if (wanted === undefined || !state.isAlive) return
  state.pendingScroll = undefined
  sendScroll(state, wanted, state.pendingAnimated)
  state.pendingAnimated = false
}

/** Works out again whether the end is on screen. Left alone while the list
 *  is on its way to the end, when the answer is already "yes". */
const refreshAtEnd = (state: ListState): void => {
  if (state.viewport <= 0 || state.holdEnd || state.glide !== undefined) return
  state.isAtEnd = isAtEnd(
    contentHeight(state),
    state.offset,
    state.viewport,
    state.spec.atEndThreshold * state.viewport,
  )
}

/** Sends the at-end Message, only when the answer is not the one last sent. */
const tellAtEnd = (state: ListState): void => {
  if (!state.isAlive || state.isAtEnd === undefined || state.isAtEnd === state.toldAtEnd) return
  state.toldAtEnd = state.isAtEnd
  const handler = handlersByNode.get(state.scroll)?.[AT_END_CHANGED] as Handler | undefined
  handler?.(customEvent(AT_END_CHANGED, { isAtEnd: state.isAtEnd }))
}

/**
 * Whether the list should move to its end now that the end has moved.
 * `isResize` says the list itself got taller or shorter, which is all that
 * a list with `onlyWhenResized` follows.
 */
const followsEnd = (state: ListState, isResize: boolean): boolean =>
  state.holdEnd ||
  (state.spec.maintainScrollAtEnd &&
    state.isAtEnd === true &&
    (isResize || !state.spec.maintainScrollAtEndOnlyWhenResized)) ||
  isFollowingNow(state)

/**
 * FOLLOWING. For an AI chat (`onlyWhenResized` with `followOnReturn`), a
 * list is either following the end or not. While following, a row that
 * grows or arrives moves the list to the new end, as Claude's app follows
 * a reply being written.
 *
 * - On: `scrollToEnd` (the round button), or the user's own scroll coming
 *   to rest at the end. A list that opens at its end starts on.
 * - Off: the user's own scroll leaving the end (a drag up), a new anchored
 *   row (the question after Send, which is held at the top while its reply
 *   runs on below it: the list does not chase that reply), `scrollToRow`.
 * - While a finger is on the list it is never moved, following or not.
 * - A glide on its way to the end is not started over as the end moves:
 *   the list catches up when it arrives.
 */
const isFollowingNow = (state: ListState): boolean =>
  state.spec.maintainScrollAtEndFollowOnReturn && state.isFollowing && !state.isUserScrolling

/** A list following the end goes to where the end is now, at once. */
const catchUp = (state: ListState): void => {
  if (!isFollowingNow(state) || state.holdEnd || state.viewport <= 0) return
  goToEnd(state, false)
}

/** Aims the list at its end. The phone is told after the next commit. */
const goToEnd = (state: ListState, animated: boolean): void => {
  const wanted = furthestOffset(state)
  state.offset = wanted
  takeAnchor(state)
  // Before the phone has said how tall the list is, `wanted` is a guess.
  // It still picks the rows to draw, but is not worth sending.
  if (state.viewport <= 0 || Math.abs(wanted - state.native) < 1) return
  // Already gliding there. Asking again would start the glide over from
  // where it is now, slowly, and a list asked every few frames (rows being
  // measured, the keyboard moving) would hardly get anywhere.
  if (state.glide !== undefined && Math.abs(state.glide.target - wanted) < 1) return
  state.pendingScroll = wanted
  // A correction to a glide that is still under way glides as well.
  state.pendingAnimated = animated || state.glide !== undefined
}

/** Whether the phone has measured every row that the end of the list shows. */
const isEndMeasured = (state: ListState): boolean => {
  if (state.viewport <= 0) return false
  if (state.spec.rowHeight !== undefined) return true
  const from = furthestOffset(state)
  const { first, end } = rowsBetween(state.heights, from, from + state.viewport - 1)
  for (let at = first; at < end; at++) {
    if (!state.measured.has(state.keys[at] as RowKey)) return false
  }
  return true
}

const reveal = (state: ListState): void => {
  clearTimeout(state.revealTimer)
  state.revealTimer = undefined
  state.isHidden = false
}

/**
 * Run after anything that changes where things are: rows added or removed,
 * a row measured, the list itself made taller or shorter (the keyboard).
 * Sizes the blank space, then either follows the end or keeps the row at the
 * top of the screen where it was.
 */
const resettle = (state: ListState, animated = false, isResize = false): void => {
  state.endSpace = endSpaceFor(state.heights, state.viewport, state.spec.anchoredEndSpace)
  if (followsEnd(state, isResize)) {
    // Following a reply while a glide is under way: the glide is left to
    // arrive, and the list catches up then (`afterGlide`).
    const waitsForGlide = state.glide !== undefined && !state.holdEnd && !isResize && isFollowingNow(state)
    if (!waitsForGlide) goToEnd(state, animated)
  } else holdAnchor(state)
  if (state.holdEnd && isEndMeasured(state)) {
    state.holdEnd = false
    reveal(state)
  }
  refreshAtEnd(state)
}

/** How often a hold tells the phone again after the phone stopped short. */
const MAX_HOLD_REPEATS = 3

const beginHold = (state: ListState): void => {
  state.holdEnd = true
  state.holdRepeats = 0
  state.isAtEnd = true
  // The list places itself now. Closing the keyboard must not undo that.
  state.inset?.keyboard.forgetLift()
}

/**
 * The phone has reported a position while the list is meant to be at its
 * end, and it is not the end. The phone can stop short when it is told to
 * scroll before it has taken in how long the content now is. It is told
 * again, a few times at most, so the two can never chase each other.
 */
const repeatHold = (state: ListState): void => {
  if (!state.holdEnd || state.glide !== undefined || state.viewport <= 0) return
  if (state.holdRepeats >= MAX_HOLD_REPEATS) return
  const wanted = furthestOffset(state)
  if (Math.abs(wanted - state.offset) < 1) return
  state.holdRepeats += 1
  state.offset = wanted
  sendScroll(state, wanted, false)
}

/** The user has taken hold of the list: it is theirs to place now. */
const letGo = (state: ListState): void => {
  state.holdEnd = false
  state.pendingScroll = undefined
  endGlide(state)
}

/** Sends the `onEndReached` Message once each time the end comes near. */
const checkEnd = (state: ListState): void => {
  const count = state.keys.length
  if (!state.isAlive || count === 0 || state.viewport <= 0) return
  const distanceFromEnd = state.heights.total() - (Math.max(0, state.offset) + state.viewport)
  if (distanceFromEnd > state.spec.endReachedThreshold * state.viewport) {
    // Away from the end again: the next approach counts as a new one.
    state.endReachedFor = -1
    return
  }
  if (state.endReachedFor === count) return
  state.endReachedFor = count
  const handler = handlersByNode.get(state.scroll)?.[END_REACHED] as Handler | undefined
  handler?.(customEvent(END_REACHED, { distanceFromEnd }))
}

const heightIn = (event: unknown): number | undefined => {
  const height = (event as { detail?: { layout?: { height?: unknown } } })?.detail?.layout?.height
  return typeof height === 'number' ? height : undefined
}

const listModule: ModuleFactory = (engine, afterCommit) => {
  const lists = new Map<EngineNode, ListState>()
  const labels = new Map<EngineNode, Label>()

  // The second updater, for the rows. Made on first use: it holds a copy of
  // every registered module, this one included, so a row may hold a list.
  const rowJobs: Array<() => void> = []
  let rowPatch: ((before: VNode, after: VNode) => VNode) | undefined
  const patchRows = (before: VNode, after: VNode): VNode => {
    rowPatch ??= init(
      [...makeModules(engine, job => rowJobs.push(job)), onUnmountModule],
      makeNodeApi(engine),
    )
    return rowPatch(before, after)
  }
  const runRowJobs = (): void => {
    for (const job of rowJobs.splice(0)) job()
  }

  const rowMeasured = (state: ListState, key: RowKey, event: unknown): void => {
    const height = heightIn(event)
    if (height === undefined || !state.isAlive || state.measured.get(key) === height) return
    state.measured.set(key, height)
    const at = state.indexByKey.get(key)
    if (at !== undefined) state.heights.set(at, height)
    // Rows report one by one after a commit. They are answered together.
    if (state.isMeasureQueued) return
    state.isMeasureQueued = true
    queueMicrotask(() => {
      state.isMeasureQueued = false
      if (!state.isAlive) return
      resettle(state)
      chooseRows(state)
      state.draw('own')
      checkEnd(state)
      tellAtEnd(state)
    })
  }

  const rowVNode = (state: ListState, at: number): VNode => {
    const key = state.keys[at] as RowKey
    const kept = state.rows.get(key)
    if (kept !== undefined) return kept
    const { spec } = state
    const built = spec.inFrame(() => spec.row(spec.items[at], at))
    return h(
      'view',
      spec.rowHeight === undefined
        ? { key, on: { layout: (event: unknown) => rowMeasured(state, key, event) } }
        : { key, props: { style: { height: spec.rowHeight, overflow: 'hidden' } } },
      built === null ? [] : [built],
    )
  }

  const canvasVNode = (state: ListState): VNode => {
    const { first, end } = state.range
    const rows = new Map<RowKey, VNode>()
    for (let at = first; at < end; at++) rows.set(state.keys[at] as RowKey, rowVNode(state, at))
    state.rows = rows
    return h(
      'view',
      // Never collapsed: with only a height it would be optimised away, and
      // a drag that starts between rows would not scroll.
      {
        props: {
          collapsable: false,
          style: {
            height: canvasHeight(state),
            ...(state.spec.initialScrollAtEnd ? { opacity: state.isHidden ? 0 : 1 } : {}),
            // See `rowsHeight`: a few rows sit at the bottom of a taller view.
            ...(state.inset !== undefined && state.spec.alignItemsAtEnd
              ? { justifyContent: 'flex-end' }
              : {}),
          },
        },
      },
      [
        h('view', {
          key: SPACER_KEY,
          props: { style: { height: state.heights.offsetOf(first) } },
        }),
        ...rows.values(),
      ],
    )
  }

  /**
   * Gives the phone's scroll view its bottom inset, when that has changed.
   * It goes in the same commit as the rows, so the blank space under a
   * growing answer shrinks as the answer grows.
   *
   * A smaller inset waits while the keyboard is moving or the list is
   * gliding. The list is then on its way to a place inside the smaller
   * range, and UIKit puts a scroll view that is outside its range back in
   * at once, with a jump, the moment the range shrinks.
   *
   * And a smaller inset never goes in the same commit as taller rows when
   * together they would leave the phone outside its range for a moment.
   * React Native hands a commit to the scroll view as its props first (the
   * inset), then its state (the content size, the rows' height):
   * `RCTMountingManager.mm` calls `updateProps` before `updateState`. In
   * between, the range is the old rows with the new inset. While a reply
   * grows under a question held at the top, the list rests at the very end
   * of its range, and the rows grow by as much as the inset shrinks: in
   * between, the range is short by the growth, and UIKit pulls the list
   * back by that much. The question then moved down by every line the
   * reply grew (and by a row's estimated height when the reply first
   * appeared). Now the inset that commit carries is the larger of the two,
   * and the smaller one follows in a commit of its own (`settleInset`).
   */
  const writeInset = (state: ListState): void => {
    const inset = state.inset
    if (inset === undefined) return
    const wanted = insetOf(state, inset)
    const rows = rowsHeight(state)
    noteDrawnRows(inset, rows, Date.now())
    const toSend = Math.max(wanted, insetKeepingPlace(state, inset, rows))
    // The blank space under an answer shrinks as the answer grows by as
    // much. The range does not get smaller then, so nothing has to wait.
    const isWaiting =
      inset.sent !== undefined &&
      rows + toSend < inset.sentRows + inset.sent - 0.5 &&
      (inset.isKeyboardMoving || state.glide !== undefined)
    if (toSend !== inset.sent && !isWaiting) {
      inset.sent = toSend
      inset.sentRows = rows
      engine.setProp(state.scroll, 'contentInset', { top: 0, left: 0, bottom: toSend, right: 0 })
    }
    if (toSend > wanted) settleInset(state, inset)
    // The scroll bar ends at the composer. The blank space is not in its way.
    const indicator = inset.keyboard.indicatorPadding()
    if (indicator !== inset.sentIndicator) {
      inset.sentIndicator = indicator
      engine.setProp(state.scroll, 'scrollIndicatorInsets', {
        top: 0,
        left: 0,
        bottom: indicator,
        right: 0,
      })
    }
  }

  /**
   * An inset held back for one commit (see `writeInset`) is handed over a
   * moment later, in a commit that leaves the rows as they are, unless a
   * draw in between has done it already.
   */
  const settleInset = (state: ListState, inset: Inset): void => {
    if (inset.settleTimer !== undefined) return
    inset.settleTimer = setTimeout(() => {
      inset.settleTimer = undefined
      if (state.isAlive) state.draw('own')
    }, INSET_SETTLE_MS)
  }

  const makeDraw =
    (state: ListState) =>
    (during: 'foldkit' | 'own'): void => {
      if (!state.isAlive) return
      state.canvas = patchRows(state.canvas, canvasVNode(state))
      writeInset(state)
      announce(state)
      if (during === 'foldkit') {
        // Foldkit is in the middle of its own draw and commits when done.
        afterCommit(() => {
          runRowJobs()
          sendPendingScroll(state)
          measureAnchor(state)
        })
        return
      }
      engine.commit()
      runRowJobs()
      sendPendingScroll(state)
      measureAnchor(state)
    }

  /**
   * Asks the phone where the anchored row is in the window, for the numbers
   * on screen. Only while a label shows them.
   */
  const measureAnchor = (state: ListState): void => {
    const seen = state.anchorSeen
    if (seen === undefined || (labelsById.get(state.spec.id)?.size ?? 0) === 0) return
    const vnode = state.rows.get(seen.key)
    const node = vnode === undefined ? undefined : nodeOf(vnode)
    if (node === undefined) return
    engine.measure(node, frame => {
      if (!state.isAlive || state.anchorSeen !== seen) return
      seen.windowStep = seen.windowY === undefined ? 0 : frame.y - seen.windowY
      seen.windowY = frame.y
      if (seen.windowBaseline === undefined && isSettled(state)) seen.windowBaseline = frame.y
      showNumbers(state)
    })
  }

  const scrolled = (state: ListState, event: unknown): void => {
    const native = (
      event as {
        nativeEvent?: {
          contentOffset?: { y?: number }
          layoutMeasurement?: { height?: number }
        }
      }
    )?.nativeEvent
    state.offset = native?.contentOffset?.y ?? 0
    state.native = state.offset
    state.reported = state.offset
    const last = state.lastScroll
    if (last !== undefined && Math.abs(state.offset - last.target) < ARRIVED_WITHIN) {
      last.arrived = true
    }
    let hasGlideEnded = false
    if (
      state.glide !== undefined &&
      Math.abs(state.offset - state.glide.target) < ARRIVED_WITHIN
    ) {
      endGlide(state)
      hasGlideEnded = true
    }
    repeatHold(state)
    takeAnchor(state)
    const viewport = native?.layoutMeasurement?.height
    if (typeof viewport === 'number' && viewport > 0 && viewport !== state.viewport) {
      resized(state, viewport)
      return
    }
    refreshAtEnd(state)
    // A finger that takes the list away from the end stops it following.
    if (state.isUserScrolling && state.isAtEnd === false) state.isFollowing = false
    // A glide that has arrived: a list following a reply catches up with
    // what came in meanwhile, and a waiting inset is handed over.
    if (hasGlideEnded) {
      catchUp(state)
      refreshAtEnd(state)
    }
    if (chooseRows(state) || hasGlideEnded) state.draw('own')
    checkEnd(state)
    tellAtEnd(state)
  }

  /** The list itself is taller or shorter: first layout, rotation, keyboard. */
  const resized = (state: ListState, viewport: number): void => {
    state.viewport = viewport
    const before = { space: state.endSpace, hidden: state.isHidden }
    resettle(state, false, true)
    const isChanged =
      state.endSpace !== before.space ||
      state.isHidden !== before.hidden ||
      state.pendingScroll !== undefined
    if (chooseRows(state) || isChanged) state.draw('own')
    checkEnd(state)
    tellAtEnd(state)
  }

  const dragBegan = (state: ListState): void => {
    letGo(state)
    state.isUserScrolling = true
    clearTimeout(state.flingTimer)
    state.flingTimer = undefined
    restartDrift(state)
    if (!state.isHidden) return
    reveal(state)
    state.draw('own')
  }

  /** The finger has let go. A fling may follow; the phone says so at once if it does. */
  const dragEnded = (state: ListState): void => {
    showNumbers(state)
    if (!state.isUserScrolling) return
    clearTimeout(state.flingTimer)
    state.flingTimer = setTimeout(() => userScrollEnded(state), FLING_WAIT_MS)
  }

  const flingBegan = (state: ListState): void => {
    clearTimeout(state.flingTimer)
    state.flingTimer = undefined
  }

  /**
   * The user's own scroll is over. Ending at the end turns following on,
   * anywhere else off (see `Following`).
   */
  const userScrollEnded = (state: ListState): void => {
    clearTimeout(state.flingTimer)
    state.flingTimer = undefined
    if (!state.isAlive || !state.isUserScrolling) return
    state.isUserScrolling = false
    refreshAtEnd(state)
    if (state.spec.maintainScrollAtEndFollowOnReturn) state.isFollowing = state.isAtEnd === true
    catchUp(state)
    refreshAtEnd(state)
    state.draw('own')
    tellAtEnd(state)
  }

  /** The phone says a glide or a fling has come to rest. */
  const cameToRest = (state: ListState): void => {
    if (state.isUserScrolling) {
      userScrollEnded(state)
      return
    }
    if (state.glide === undefined) {
      showNumbers(state)
      return
    }
    endGlide(state)
    afterGlide(state)
  }

  /** Brings the numbers on screen up to date, when a label shows them. */
  const showNumbers = (state: ListState): void => {
    let isChanged = false
    for (const label of labelsById.get(state.spec.id) ?? []) {
      if (writeLabel(label, statsOf(state))) isChanged = true
    }
    if (isChanged) engine.commit()
  }

  const laidOut = (state: ListState, event: unknown): void => {
    const height = (event as { nativeEvent?: { layout?: { height?: number } } })?.nativeEvent
      ?.layout?.height
    if (typeof height !== 'number' || height <= 0 || height === state.viewport) return
    resized(state, height)
  }

  // Scroll views created in this draw whose content view has not been yet.
  const scrollBySpec = new Map<ListSpec, EngineNode>()

  const makeInset = (lift: KeyboardLiftBehavior): Inset => {
    const options = { keyboardLiftBehavior: lift, offset: 0 }
    const boxes = {
      scroll: { value: 0 },
      layout: { value: { width: 0, height: 0 } },
      size: { value: { width: 0, height: 0 } },
      blankSpace: { value: 0 },
      bar: { value: 0 },
    }
    // The library's options, with the two that may change read through.
    const keyboard = createChatKeyboard({
      inverted: false,
      get keyboardLiftBehavior() {
        return options.keyboardLiftBehavior
      },
      get offset() {
        return options.offset
      },
      freeze: { value: false },
      blankSpace: boxes.blankSpace,
      extraContentPadding: boxes.bar,
      scroll: boxes.scroll,
      layout: boxes.layout,
      size: boxes.size,
    })
    return {
      keyboard,
      options,
      ...boxes,
      sent: undefined,
      sentRows: 0,
      sentIndicator: undefined,
      drawnRows: [],
      settleTimer: undefined,
      isKeyboardMoving: false,
    }
  }

  const createList = (scroll: EngineNode, content: EngineNode, spec: ListSpec): void => {
    // The row updater replaces the node it is given, so it gets a placeholder
    // inside the content view to replace with the canvas.
    const placeholder = engine.createAnchor()
    engine.appendChild(content, placeholder)
    const state: ListState = {
      spec,
      engine,
      scroll,
      inset: spec.insetLift === undefined ? undefined : makeInset(spec.insetLift),
      lastScroll: undefined,
      reported: undefined,
      keys: [],
      indexByKey: new Map(),
      heights: new Heights([]),
      measured: new Map(),
      offset: 0,
      viewport: 0,
      range: EMPTY_RANGE,
      anchor: undefined,
      pendingScroll: undefined,
      pendingAnimated: false,
      native: 0,
      endSpace: 0,
      isAtEnd: spec.initialScrollAtEnd ? true : undefined,
      toldAtEnd: spec.initialScrollAtEnd,
      holdEnd: spec.initialScrollAtEnd,
      holdRepeats: 0,
      // A list that opens at its end follows it (see `Following`).
      isFollowing: spec.initialScrollAtEnd,
      isUserScrolling: false,
      flingTimer: undefined,
      anchorSeen: undefined,
      glide: undefined,
      isHidden: spec.initialScrollAtEnd,
      revealTimer: undefined,
      anchoredKey: undefined,
      rows: new Map(),
      canvas: {
        sel: '!',
        data: {},
        children: undefined,
        text: '',
        elm: placeholder as unknown as Element,
        key: undefined,
      },
      endReachedFor: -1,
      isMeasureQueued: false,
      isAlive: true,
      draw: () => {},
      stops: [],
    }
    state.draw = makeDraw(state)
    state.stops = [
      engine.setEventListener(scroll, 'topScroll', event => scrolled(state, event)),
      engine.setEventListener(scroll, 'topLayout', event => laidOut(state, event)),
      engine.setEventListener(scroll, 'topScrollBeginDrag', () => dragBegan(state)),
      engine.setEventListener(scroll, 'topMomentumScrollBegin', () => flingBegan(state)),
      engine.setEventListener(scroll, 'topMomentumScrollEnd', () => cameToRest(state)),
      // A finger let go without a fling: the list is at rest as well.
      engine.setEventListener(scroll, 'topScrollEndDrag', () => dragEnded(state)),
    ]
    lists.set(scroll, state)
    let sameId = listsById.get(spec.id)
    if (sameId === undefined) listsById.set(spec.id, (sameId = new Set()))
    sameId.add(state)
    index(state)
    state.anchoredKey = anchoredKeyOf(state)
    if (spec.initialScrollAtEnd) {
      // The rows at the end are drawn first, unseen. Once the phone has
      // measured them the list is put at its end and shown, so the user
      // never sees it arrive. The timer is only for a phone that does not
      // report: the list must not stay unseen.
      state.offset = furthestOffset(state)
      state.revealTimer = setTimeout(() => {
        if (!state.isAlive || !state.isHidden) return
        reveal(state)
        state.draw('own')
      }, REVEAL_AFTER_MS)
    }
    chooseRows(state)
    state.draw('foldkit')
  }

  const updateList = (state: ListState, spec: ListSpec): void => {
    const before = state.spec
    state.spec = spec
    if (state.inset !== undefined && spec.insetLift !== undefined) {
      state.inset.options.keyboardLiftBehavior = spec.insetLift
    }
    // The new `row` function may read newer parts of the Model, so every
    // row drawn is built again. Rows are few.
    state.rows = new Map()
    const isReindexed =
      spec.items !== before.items ||
      spec.estimatedRowHeight !== before.estimatedRowHeight ||
      spec.rowHeight !== before.rowHeight
    if (isReindexed) index(state)
    // A row newly named as the anchor: go to the end, which the blank space
    // makes the place where that row is at the top of the screen.
    const anchoredKey = anchoredKeyOf(state)
    const isNewAnchor = anchoredKey !== undefined && anchoredKey !== state.anchoredKey
    state.anchoredKey = anchoredKey
    if (isNewAnchor) {
      // The new question is held at the top while its reply runs on below.
      state.isFollowing = false
      beginHold(state)
    }
    if (isReindexed || isNewAnchor || spec.anchoredEndSpace !== before.anchoredEndSpace) {
      const isLonger = spec.items.length > before.items.length
      resettle(
        state,
        isNewAnchor
          ? (spec.anchoredEndSpace?.animated ?? true)
          : isLonger && spec.maintainScrollAtEndAnimated,
      )
    }
    chooseRows(state)
    state.draw('foldkit')
    afterCommit(() => {
      checkEnd(state)
      tellAtEnd(state)
    })
  }

  const destroyList = (state: ListState): void => {
    state.isAlive = false
    clearTimeout(state.revealTimer)
    clearTimeout(state.flingTimer)
    clearTimeout(state.inset?.settleTimer)
    endGlide(state)
    for (const stop of state.stops) stop()
    // An empty canvas, so every row's own clean-up runs.
    state.range = EMPTY_RANGE
    state.rows = new Map()
    state.canvas = patchRows(state.canvas, h('view', { props: { collapsable: false } }, []))
    lists.delete(state.scroll)
    listsById.get(state.spec.id)?.delete(state)
    for (const label of labelsById.get(state.spec.id) ?? []) writeLabel(label, NO_LIST)
  }

  const createLabel = (vnode: VNode, spec: Pick<Label, 'id' | 'format'>): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const textNode = engine.createText('')
    engine.appendChild(node, textNode)
    const label: Label = { ...spec, engine, textNode, shown: { text: '' } }
    labels.set(node, label)
    let sameId = labelsById.get(spec.id)
    if (sameId === undefined) labelsById.set(spec.id, (sameId = new Set()))
    sameId.add(label)
    // The newest list with this id, if two are on screen.
    const list = [...(listsById.get(spec.id) ?? [])].at(-1)
    writeLabel(label, list === undefined ? NO_LIST : statsOf(list))
  }

  return {
    create: (_empty, vnode) => {
      const node = nodeOf(vnode)
      const listSpec = vnode.data?.[LIST_DATA] as ListSpec | undefined
      if (listSpec !== undefined && node !== undefined) scrollBySpec.set(listSpec, node)
      const contentSpec = vnode.data?.[CONTENT_DATA] as ListSpec | undefined
      const scroll = contentSpec === undefined ? undefined : scrollBySpec.get(contentSpec)
      if (contentSpec !== undefined && scroll !== undefined && node !== undefined) {
        scrollBySpec.delete(contentSpec)
        createList(scroll, node, contentSpec)
      }
      const labelSpec = vnode.data?.[LABEL_DATA] as Pick<Label, 'id' | 'format'> | undefined
      if (labelSpec !== undefined) createLabel(vnode, labelSpec)
    },
    update: (_old, vnode) => {
      const spec = vnode.data?.[LIST_DATA] as ListSpec | undefined
      const node = nodeOf(vnode)
      const state = node === undefined ? undefined : lists.get(node)
      if (state === undefined) return
      if (spec !== undefined) {
        updateList(state, spec)
        return
      }
      // The updater reused this scroll view for one that is not a list.
      destroyList(state)
      const canvas = state.canvas.elm as unknown as EngineNode | undefined
      const content = canvas === undefined ? null : engine.parentNode(canvas)
      if (canvas !== undefined && content !== null) {
        engine.removeChild(content, canvas)
        engine.destroyNode(canvas)
      }
    },
    destroy: vnode => {
      const node = nodeOf(vnode)
      if (node === undefined) return
      const state = lists.get(node)
      if (state !== undefined) destroyList(state)
      const label = labels.get(node)
      if (label !== undefined) {
        labels.delete(node)
        labelsById.get(label.id)?.delete(label)
      }
    },
  }
}

registerModule(listModule)

/**
 * Scrolls every list with this id so that row `index` is at the top of the
 * screen, less `offset` points. The rows there are drawn first, so the list
 * does not arrive at a blank area.
 */
export const scrollToRow = (
  id: string,
  index: number,
  options: Readonly<{ animated?: boolean; offset?: number }> = {},
): void => {
  for (const state of listsById.get(id) ?? []) {
    const key = state.keys[Math.min(Math.max(0, index), state.keys.length - 1)]
    const at = key === undefined ? undefined : state.indexByKey.get(key)
    if (key === undefined || at === undefined) continue
    const wanted = Math.min(
      Math.max(0, state.heights.offsetOf(at) - (options.offset ?? 0)),
      furthestOffset(state),
    )
    letGo(state)
    state.isFollowing = false
    reveal(state)
    state.offset = wanted
    takeAnchor(state)
    chooseRows(state)
    state.draw('own')
    sendScroll(state, wanted, options.animated ?? false)
    refreshAtEnd(state)
    tellAtEnd(state)
  }
}

/**
 * Scrolls every list with this id to its end: the last row, or the blank
 * space under it if the list keeps one. The rows there are drawn first. If
 * their heights are still guesses, the list stays at the end while the phone
 * measures them.
 */
export const scrollToEnd = (id: string, options: Readonly<{ animated?: boolean }> = {}): void => {
  for (const state of listsById.get(id) ?? []) {
    letGo(state)
    // Asked for the end: the list follows it from now on (see `Following`).
    // A fling still running is over: the glide there takes its place.
    state.isFollowing = true
    state.isUserScrolling = false
    clearTimeout(state.flingTimer)
    state.flingTimer = undefined
    reveal(state)
    beginHold(state)
    resettle(state, options.animated ?? false)
    chooseRows(state)
    state.draw('own')
    tellAtEnd(state)
  }
}

/**
 * Moves a list with a bottom inset for the keyboard. Called once as the
 * keyboard starts to move and once when it has stopped, never in between.
 */
const keyboardMoved = (state: ListState, inset: Inset, event: ListKeyboardEvent): void => {
  if (event.type === 'interactive') {
    inset.keyboard.handlers.onInteractive()
    return
  }
  syncInset(state, inset)
  // A list that is gliding somewhere for its own reasons is reckoned to be where
  // it is going, not where the glide happens to be at this moment.
  const from = state.glide?.target ?? state.offset
  inset.scroll.value = from
  if (event.type === 'end') {
    inset.isKeyboardMoving = false
    inset.keyboard.handlers.onEnd({ height: event.height })
    // A list left beyond its end by a keyboard that went away under a finger
    // is brought back with a glide. The inset waits for the glide (see
    // `writeInset`), so the list does not jump there first.
    const furthest = furthestOffset(state)
    if (state.glide === undefined && !state.holdEnd && state.offset > furthest + 1) {
      state.offset = furthest
      takeAnchor(state)
      chooseRows(state)
      // The glide first: the draw then sees it and leaves the inset alone.
      sendScroll(state, furthest, true)
      state.draw('own')
      return
    }
    state.draw('own')
    refreshAtEnd(state)
    tellAtEnd(state)
    return
  }
  let target: number | undefined
  if (event.type === 'start') {
    inset.isKeyboardMoving = true
    inset.keyboard.contentOffsetY.value = from
    inset.keyboard.handlers.onStart({ height: event.height })
    target = inset.keyboard.contentOffsetY.value
  } else {
    const before = inset.bar.value
    const isRestChanged = event.rest !== inset.options.offset
    if (before === event.height && !isRestChanged) return
    // The strip the keyboard covers anyway is only measured with the
    // keyboard down, when changing it changes nothing on screen.
    if (inset.keyboard.padding.value === 0) inset.options.offset = event.rest
    inset.bar.value = event.height
    target = inset.keyboard.onExtraContentPadding(event.height, before)
  }
  // A list that is on its way to its end stays in charge of where it goes.
  // The end has moved with the inset, and the list follows it.
  if (state.holdEnd) {
    resettle(state, true)
    chooseRows(state)
    state.draw('own')
    return
  }
  if (target === undefined || Math.abs(target - from) < 1) {
    state.draw('own')
    refreshAtEnd(state)
    tellAtEnd(state)
    return
  }
  state.offset = target
  takeAnchor(state)
  chooseRows(state)
  // The commit carries the larger inset. The phone is told where to go
  // after it, because it will not scroll past the range it knows.
  state.draw('own')
  // With the keyboard, the phone glides. A composer that grew by a line of
  // text moves the list at once, as the composer itself did.
  sendScroll(state, target, event.type === 'start')
}

/**
 * Tells every list with this id that has a bottom inset what the keyboard or
 * the composer did. `composerDock` in `'inset'` mode calls it. Returns
 * whether any list heard.
 */
export const tellListKeyboard = (id: string, event: ListKeyboardEvent): boolean => {
  let isHeard = false
  for (const state of listsById.get(id) ?? []) {
    if (state.inset === undefined || !state.isAlive) continue
    isHeard = true
    keyboardMoved(state, state.inset, event)
  }
  return isHeard
}

/** The numbers of the newest list with this id, or undefined if there is none. */
export const listNumbers = (id: string): ListNumbers | undefined => {
  const state = [...(listsById.get(id) ?? [])].at(-1)
  return state === undefined ? undefined : numbersOf(state)
}
