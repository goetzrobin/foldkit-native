/**
 * A long list in Effect UI's own terms ("way A").
 *
 * The list is ordinary state and an ordinary view:
 *
 * - The scroll view sends a `scroll` event, at most one per frame. The
 *   component that owns the list turns it into a Message.
 * - The Model holds the window: which rows are drawn now. `scrolled` works
 *   out the window from the offset. Most scroll events leave it as it is,
 *   and then `scrolled` returns the same Model and nothing is drawn.
 * - The view draws a spacer, the rows of the window, and a spacer. Each row
 *   is whatever the owner gives for an index: a child component keyed by
 *   the row's id.
 * - A row reports its height when the phone has laid it out. Heights start
 *   as an estimate and are corrected as rows are measured.
 *
 * The arithmetic (heights with fast sums, the window with a draw-ahead
 * margin) is the host layer's, `packages/native/src/host/list/window.ts`.
 *
 * Recycling: with `recycle`, a row's key is its slot (`index % pool`), not
 * its id. A row that scrolls in then reuses the instance and the native
 * views of a row that scrolled out, and only its props change. Use it for
 * rows that keep no state of their own.
 *
 *   const ListModel = Schema.Struct({ list: VirtualList.Model, ... })
 *   update: {
 *     ScrolledList: ($, { at }) => $.evolve({ list: l => VirtualList.scrolled(l, at, rows.length) }),
 *     MeasuredRow: ($, { index, height }) => $.evolve({ list: l => VirtualList.measured(l, index, height, rows.length) }),
 *   }
 *   view: (h, model) => VirtualList.view(h, {
 *     model: model.list, count: rows.length,
 *     onScroll: at => Message.ScrolledList({ at }),
 *     onRowLayout: (index, height) => Message.MeasuredRow({ index, height }),
 *     row: (index, key) => Row(h, { key, props: { text: rows[index] } }),
 *   })
 */
import type * as Renderer from '@effect/ui/Renderer'
import type * as View from '@effect/ui/View'
import * as Schema from 'effect/Schema'

import { Heights, type Range, chooseWindow } from '../../native/src/host/list/window.js'
import type * as Native from './Native.js'

/** What a list keeps in its owner's Model. */
export const Model = Schema.Struct({
  /** The rows drawn now: `first` up to but not including `end`. */
  first: Schema.Number,
  end: Schema.Number,
  /** The scroll view's height, once the phone has said. */
  viewport: Schema.Number,
  /** How tall a row is taken to be until it is measured. */
  estimate: Schema.Number,
  /** How far beyond the screen rows are drawn, in points. */
  margin: Schema.Number,
  /** Heights the phone reported, by row index. */
  measured: Schema.Record(Schema.String, Schema.Number),
  /** Recycling: how many slots there are. Only grows. */
  pool: Schema.Number,
})
export type Model = typeof Model.Type

/** The part of a scroll event the list reads. */
export const ScrollAt = Schema.Struct({ y: Schema.Number, height: Schema.Number })
export type ScrollAt = typeof ScrollAt.Type

export const init = (
  options: Readonly<{ count: number; estimate: number; viewport?: number; margin?: number }>,
): Model => {
  const base: Model = {
    first: 0,
    end: 0,
    viewport: options.viewport ?? 800,
    estimate: options.estimate,
    margin: options.margin ?? 600,
    measured: {},
    pool: 0,
  }
  return windowed(base, 0, options.count)
}

// One sum tree per set of measured heights. A Model is plain data, so the
// tree is kept beside it and made again only when the heights change.
const trees = new WeakMap<object, { count: number; estimate: number; heights: Heights }>()

export const heightsOf = (model: Model, count: number): Heights => {
  const cached = trees.get(model.measured)
  if (cached !== undefined && cached.count === count && cached.estimate === model.estimate) return cached.heights
  const values = new Array<number>(count)
  for (let index = 0; index < count; index++) values[index] = model.measured[index] ?? model.estimate
  const heights = new Heights(values)
  trees.set(model.measured, { count, estimate: model.estimate, heights })
  return heights
}

const windowed = (model: Model, offset: number, count: number): Model => {
  const drawn: Range = { first: model.first, end: Math.min(model.end, count) }
  const next = chooseWindow(heightsOf(model, count), offset, model.viewport, model.margin, drawn)
  if (next.first === model.first && next.end === model.end) return model
  // The pool only grows, and in steps of 8, so slots are seldom renumbered.
  const pool = Math.max(model.pool, Math.ceil((next.end - next.first) / 8) * 8)
  return { ...model, first: next.first, end: next.end, pool }
}

/**
 * The scroll view moved. Returns the SAME Model when the rows drawn still
 * cover the screen, so the owner's view is not run.
 */
export const scrolled = (model: Model, at: ScrollAt, count: number): Model => {
  const sized = at.height > 0 && at.height !== model.viewport ? { ...model, viewport: at.height } : model
  return windowed(sized, at.y, count)
}

/** The phone laid a row out. Returns the same Model when the height is the one known. */
export const measured = (model: Model, index: number, height: number, count: number): Model => {
  const known = model.measured[index] ?? model.estimate
  if (Math.abs(known - height) < 0.5) return model
  // The window is left as it is: the next scroll event chooses again with the new heights.
  void count
  return { ...model, measured: { ...model.measured, [index]: height } }
}

/** The number of rows changed (one was added or taken away). Keeps the window inside the list. */
export const resized = (model: Model, offset: number, count: number): Model => windowed(model, offset, count)

/** How far down the list ends, by what is known now. */
export const totalHeight = (model: Model, count: number): number => heightsOf(model, count).total()

export type ViewOptions<Msg, R> = Readonly<{
  model: Model
  count: number
  /** The row for an index. `key` is what its child component and element must be keyed by. */
  row: (index: number, key: string) => Native.NoTextContent<Msg, R>
  /** A row's own id. Left out, the index. Not used when recycling. */
  idOf?: (index: number) => string
  onScroll: (at: ScrollAt) => Msg
  onRowLayout?: (index: number, height: number) => Msg
  /** Rows reuse instances and native views by slot. See the top of this file. */
  recycle?: boolean
  ref?: Renderer.Ref<Native.Node>
  testId?: string
  style?: Native.ViewStyle
  /** Drawn after the last row, inside the scroll view. */
  footer?: Native.NoTextContent<Msg, R>
}>

/** The key a row is drawn under. */
export const keyOf = <Msg, R>(options: ViewOptions<Msg, R>, index: number): string =>
  options.recycle === true
    ? `slot-${index % Math.max(1, options.model.pool)}`
    : (options.idOf?.(index) ?? String(index))

/** Draws the list: a scroll view, a spacer, the rows of the window, a spacer. */
export const view = <Msg, R = never>(
  h: Native.H<Msg>,
  options: ViewOptions<Msg, R>,
): View.ElementBuilder<Msg, R, any, any> => {
  const { model, count } = options
  const heights = heightsOf(model, count)
  // Recycling draws a full pool of rows every time, a few more than the
  // window asks for, so every slot is always in use and no view is made or
  // thrown away as the window moves.
  const end = Math.min(count, options.recycle === true ? Math.max(model.end, model.first + model.pool) : model.end)
  const rows: Array<Native.NoTextContent<Msg, R>> = []
  for (let index = model.first; index < end; index++) {
    const key = keyOf(options, index)
    const onRowLayout = options.onRowLayout
    const holder = h.view.key(key).set({ collapsable: false })
    rows.push(
      (onRowLayout === undefined
        ? holder
        : holder.on('layout', layout => onRowLayout(index, layout.height))
      ).children(options.row(index, key)) as Native.NoTextContent<Msg, R>,
    )
  }
  const before = heights.offsetOf(model.first)
  const after = Math.max(0, heights.total() - heights.offsetOf(end))
  let list = h.scrollView
    .style({ flex: 1, ...options.style })
    .set({ scrollEventThrottle: 16 })
    .on('scroll', at => options.onScroll({ y: at.y, height: at.height }))
  if (options.ref !== undefined) list = list.ref(options.ref)
  if (options.testId !== undefined) list = list.testId(options.testId)
  return list.children(
    h.view.key('before').style({ height: before }),
    rows,
    h.view.key('after').style({ height: after }),
    options.footer,
  ) as View.ElementBuilder<Msg, R, any, any>
}
