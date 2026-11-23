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

import { type ModuleFactory, registerModule } from '../extend'
import { type Handler, customEvent, handlersByNode, makeModules, nodeOf } from '../modules'
import { makeNodeApi } from '../nodeApi'
import { EMPTY_RANGE, Heights, type Range, chooseWindow } from './window'

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
}>

export const LIST_DATA = 'foldkitList'
/** On the list's content view: the same spec, so the module can find the
 *  content view. The updater creates a parent before its children, so the
 *  scroll view cannot look for its content view when it is created. */
export const CONTENT_DATA = 'foldkitListContent'
export const LABEL_DATA = 'foldkitListLabel'
export const END_REACHED = 'listEndReached'

/** What a label shows when no list with its id is on screen. */
const NO_LIST: ListStats = { rowViews: 0, first: 0, end: 0, count: 0 }

/** Used until the scroll view has reported its own height. */
const ASSUMED_VIEWPORT = 800

const SPACER_KEY = '\u0000spacer'

type Anchor = Readonly<{ key: RowKey; within: number }>

type ListState = {
  spec: ListSpec
  readonly engine: Engine
  readonly scroll: EngineNode
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
})

const writeLabel = (label: Label, stats: ListStats): boolean => {
  const text = label.format(stats)
  if (text === label.shown.text) return false
  label.shown.text = text
  label.engine.setText(label.textNode, text)
  return true
}

const announce = (state: ListState): void => {
  for (const label of labelsById.get(state.spec.id) ?? []) writeLabel(label, statsOf(state))
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

const furthestOffset = (state: ListState): number =>
  Math.max(0, state.heights.total() - viewportOf(state))

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

const sendPendingScroll = (state: ListState): void => {
  const wanted = state.pendingScroll
  if (wanted === undefined || !state.isAlive) return
  state.pendingScroll = undefined
  state.engine.dispatchCommand(state.scroll, 'scrollTo', [0, wanted, false])
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
      holdAnchor(state)
      chooseRows(state)
      state.draw('own')
      checkEnd(state)
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
      { props: { collapsable: false, style: { height: state.heights.total() } } },
      [
        h('view', {
          key: SPACER_KEY,
          props: { style: { height: state.heights.offsetOf(first) } },
        }),
        ...rows.values(),
      ],
    )
  }

  const makeDraw =
    (state: ListState) =>
    (during: 'foldkit' | 'own'): void => {
      state.canvas = patchRows(state.canvas, canvasVNode(state))
      announce(state)
      if (during === 'foldkit') {
        // Foldkit is in the middle of its own draw and commits when done.
        afterCommit(() => {
          runRowJobs()
          sendPendingScroll(state)
        })
        return
      }
      engine.commit()
      runRowJobs()
      sendPendingScroll(state)
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
    const viewport = native?.layoutMeasurement?.height
    if (typeof viewport === 'number' && viewport > 0) state.viewport = viewport
    takeAnchor(state)
    if (chooseRows(state)) state.draw('own')
    checkEnd(state)
  }

  const laidOut = (state: ListState, event: unknown): void => {
    const height = (event as { nativeEvent?: { layout?: { height?: number } } })?.nativeEvent
      ?.layout?.height
    if (typeof height !== 'number' || height <= 0 || height === state.viewport) return
    state.viewport = height
    if (chooseRows(state)) state.draw('own')
    checkEnd(state)
  }

  // Scroll views created in this draw whose content view has not been yet.
  const scrollBySpec = new Map<ListSpec, EngineNode>()

  const createList = (scroll: EngineNode, content: EngineNode, spec: ListSpec): void => {
    // The row updater replaces the node it is given, so it gets a placeholder
    // inside the content view to replace with the canvas.
    const placeholder = engine.createAnchor()
    engine.appendChild(content, placeholder)
    const state: ListState = {
      spec,
      engine,
      scroll,
      keys: [],
      indexByKey: new Map(),
      heights: new Heights([]),
      measured: new Map(),
      offset: 0,
      viewport: 0,
      range: EMPTY_RANGE,
      anchor: undefined,
      pendingScroll: undefined,
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
    ]
    lists.set(scroll, state)
    let sameId = listsById.get(spec.id)
    if (sameId === undefined) listsById.set(spec.id, (sameId = new Set()))
    sameId.add(state)
    index(state)
    chooseRows(state)
    state.draw('foldkit')
  }

  const updateList = (state: ListState, spec: ListSpec): void => {
    const before = state.spec
    state.spec = spec
    // The new `row` function may read newer parts of the Model, so every
    // row drawn is built again. Rows are few.
    state.rows = new Map()
    if (
      spec.items !== before.items ||
      spec.estimatedRowHeight !== before.estimatedRowHeight ||
      spec.rowHeight !== before.rowHeight
    ) {
      index(state)
      holdAnchor(state)
    }
    chooseRows(state)
    state.draw('foldkit')
    afterCommit(() => checkEnd(state))
  }

  const destroyList = (state: ListState): void => {
    state.isAlive = false
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
    state.offset = wanted
    takeAnchor(state)
    chooseRows(state)
    state.draw('own')
    state.engine.dispatchCommand(state.scroll, 'scrollTo', [0, wanted, options.animated ?? false])
  }
}
