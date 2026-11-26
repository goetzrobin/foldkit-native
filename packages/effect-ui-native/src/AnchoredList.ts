/**
 * A chat's list: the long list of the host layer, with Effect UI drawing
 * its rows.
 *
 * `VirtualList` is a list whose scroll position is a Message. A chat needs
 * more than that: the question that goes to the top after Send, room under
 * it for the reply, an end that is followed while a reply grows, a bottom
 * inset that matches what the composer and the keyboard cover, and opening
 * at the end with nothing seen to move. The host layer has all of it, as it
 * was put right on a real iPhone (`packages/native/src/host/list/controller.ts`).
 * This file runs that controller for an Effect UI program. Nothing in the
 * controller was written again here.
 *
 * Who does what:
 *
 * - The controller owns where the list is: the scroll position, the end,
 *   the blank space under an anchored row, the bottom inset, following. It
 *   hears the scroll view straight from the engine. Scrolling sends no
 *   Message.
 * - The controller also decides which rows are drawn (the window). It asks
 *   a "painter" to draw them. The painter here does not draw. It tells the
 *   component the window as one Message (`onWindow`), and the component's
 *   view draws those rows as ordinary child components.
 * - Each row's holder tells the controller its height when the phone has
 *   laid it out. That does not go through a Message.
 * - The canvas view's own style (how tall the content is, and unseen until
 *   the list is at its end) is written by the painter, in the same commit
 *   as the inset. The view gives the canvas no style.
 *
 *   const Model = Schema.Struct({ window: AnchoredList.Window, ... })
 *   update: { PlannedWindow: ($, { window }) => $.evolve({ window }) }
 *   view: (h, model) => AnchoredList.view(h, {
 *     id: 'transcript',
 *     window: model.window,
 *     keys: rows.map(row => row.key),
 *     estimate: 120,
 *     row: (index, key) => Row(h, { key, props: rows[index] }),
 *     onWindow: window => Message.PlannedWindow({ window }),
 *   })
 *
 * The rows of a window come one draw after the controller chose them. The
 * inset and the canvas height do not wait, and the controller already
 * holds an inset back when the rows it has are not the newest.
 */
import * as Command from '@effect/ui/Command'
import * as Component from '@effect/ui/Component'
import type * as View from '@effect/ui/View'
import type { Engine, EngineNode } from '@ng-native/fabric'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { chatInsetAvailable } from '../../native/src/host/chat/chatScroll.js'
import type { KeyboardLiftBehavior } from '../../native/src/host/chat/vendor/kbc/types.js'
import { type Handler, customEvent, handlersByNode } from '../../native/src/host/fabric/nodes.js'
import { type NodeHooksFactory, registerNodeHooks } from '../../native/src/host/fabric/registry.js'
import {
  AT_END_CHANGED,
  CONTENT_DATA,
  type CanvasPlan,
  FOLLOW_CHANGED,
  LABEL_DATA,
  LIST_DATA,
  type ListNumbers,
  type ListSpec,
  type RowPainter,
  listNumbers,
  scrollToEnd as hostScrollToEnd,
  touchList,
} from '../../native/src/host/list/controller.js'
import * as Native from './Native.js'
import { CONTENT_NODE_DATA, NODE_DATA } from './NativeHost.js'

export type { ListNumbers }

/** Which rows are drawn now, as the controller last chose. Kept in the owner's Model. */
export const Window = Schema.Struct({
  /** The rows drawn: `first` up to but not including `end`. */
  first: Schema.Number,
  end: Schema.Number,
  /** How tall the rows above `first` are together. */
  before: Schema.Number,
})
export type Window = typeof Window.Type

/** No rows yet. The controller says which, right after the first draw. */
export const init = (): Window => ({ first: 0, end: 0, before: 0 })

const WINDOW_CHANGED = 'listWindowChanged'
const SPACER_KEY = 'list-spacer'

type Painter = RowPainter & { rowLaidOut: (key: string, height: number) => void; rows: Map<string, EngineNode> }

/** The painter of each list on screen, by the list's id. A row's holder finds its list here. */
const painters = new Map<string, Painter>()

const sameStyle = (before: Readonly<Record<string, unknown>> | undefined, after: Readonly<Record<string, unknown>>): boolean =>
  before !== undefined &&
  Object.keys(after).length === Object.keys(before).length &&
  Object.keys(after).every(name => before[name] === after[name])

/**
 * The painter the controller asks to draw. It writes the canvas's style and
 * reports the window. The rows are the component's.
 */
const makePainter = (id: string, engine: Engine, content: EngineNode): Painter => {
  let plan: CanvasPlan | undefined
  let told: Window | undefined
  let style: Readonly<Record<string, unknown>> | undefined
  const canvas = (): EngineNode | undefined => content.childList[0] as EngineNode | undefined

  const painter: Painter = {
    rows: new Map(),
    paint: next => {
      plan = next
      const node = canvas()
      if (node !== undefined && !sameStyle(style, next.style)) {
        style = next.style
        engine.setProp(node, 'style', next.style)
      }
    },
    forget: () => {},
    clear: () => {
      plan = undefined
      if (painters.get(id) === painter) painters.delete(id)
    },
    nodeOf: key => painter.rows.get(String(key)),
    canvas,
    // The window goes to the component once the draw that planned it is on
    // its way to the phone, so a Message is never sent in the middle of a draw.
    afterCommit: () => {
      if (plan === undefined) return
      const first = plan.rows[0]?.index ?? 0
      const window: Window = { first, end: first + plan.rows.length, before: plan.spacerHeight }
      if (told !== undefined && told.first === window.first && told.end === window.end && told.before === window.before) return
      const scroll = engine.parentNode(content)
      const handler = scroll === null ? undefined : (handlersByNode.get(scroll)?.[WINDOW_CHANGED] as Handler | undefined)
      if (handler === undefined) return
      told = window
      handler(customEvent(WINDOW_CHANGED, window))
    },
    rowLaidOut: (key, height) => plan?.onRowLayout(key, { detail: { layout: { height } } }),
  }
  painters.set(id, painter)
  return painter
}

/** On a row's holder: which list it belongs to, and the row's key. */
const ROW_DATA = 'anchoredListRow'
type RowMark = Readonly<{ listId: string; key: string }>

/**
 * Tells a list's controller a row's height each time the phone lays the row
 * out. The listener is on the row's holder from before the commit that
 * shows it, so the first layout is never missed. No Message is sent.
 */
const rowHooks: NodeHooksFactory = engine => {
  const stops = new Map<EngineNode, () => void>()
  return {
    create: (node, data) => {
      const mark = data[ROW_DATA] as RowMark | undefined
      if (mark === undefined) return
      painters.get(mark.listId)?.rows.set(mark.key, node)
      const stop = engine.setEventListener(node, 'topLayout', event => {
        const height = (event as { nativeEvent?: { layout?: { height?: number } } })?.nativeEvent?.layout?.height
        if (typeof height === 'number') painters.get(mark.listId)?.rowLaidOut(mark.key, height)
      })
      stops.set(node, () => {
        stop()
        const rows = painters.get(mark.listId)?.rows
        if (rows?.get(mark.key) === node) rows.delete(mark.key)
      })
    },
    destroy: node => {
      stops.get(node)?.()
      stops.delete(node)
    },
  }
}

registerNodeHooks(rowHooks)

// One mark per row, so a draw that changes nothing gives the holder the same data.
const marks = new Map<string, RowMark>()
const markOf = (listId: string, key: string): RowMark => {
  const name = `${listId}\u0000${key}`
  let mark = marks.get(name)
  if (mark === undefined) {
    if (marks.size > 4000) marks.clear()
    marks.set(name, (mark = { listId, key }))
  }
  return mark
}

/** The row held near the top of the screen, with room for a reply under it. */
export type Anchor = Readonly<{
  /** Which row. */
  index: number
  /** A row taller than this shows only its last part. */
  maxSize?: number
  /** How far below the list's top edge the row sits. */
  offset?: number
}>

export type ViewOptions<Msg, R> = Readonly<{
  /** Names the list, for the Commands and the numbers. One list on screen per id. */
  id: string
  window: Window
  /** Every row's key, in order. A key stays with its row for the row's whole life. */
  keys: ReadonlyArray<string>
  /** The row for an index. `key` is what its child component must be keyed by. */
  row: (index: number, key: string) => Native.NoTextContent<Msg, R>
  /** A guess at a row's height, until the phone has measured the row. */
  estimate: number
  onWindow: (window: Window) => Msg
  /** The question after Send. A new index makes the list go there by itself. */
  anchor?: Anchor | undefined
  /**
   * The list keeps its full height under a `KeyboardBar` and makes room with
   * a bottom inset: what the rows do as the keyboard opens. Left out, the
   * list has no inset. Ignored on a phone that cannot do it (Android).
   */
  inset?: KeyboardLiftBehavior | undefined
  /** The end of the list came into view (`true`) or went out of it. Never the same answer twice. */
  onAtEnd?: ((isAtEnd: boolean) => Msg) | undefined
  /** The list started to follow its end as rows grow (`true`), or stopped. */
  onFollow?: ((isFollowing: boolean) => Msg) | undefined
  /** A short touch on the list that no row or button took. A drag is not one. */
  onTap?: Msg | undefined
  /** A finger started to drag the list. */
  onDragStart?: Msg | undefined
  testId?: string | undefined
  style?: Native.ViewStyle | undefined
  props?: Native.ScrollViewProps | undefined
}>

const noRow = (): null => null
const sameKey = (key: string): string => key
const inFrame = <A>(build: () => A): A => build()

/** Draws the list: a scroll view, the canvas, a spacer and the rows of the window. */
export const view = <Msg, R = never>(
  h: Native.H<Msg>,
  options: ViewOptions<Msg, R>,
): View.ElementBuilder<Msg, R, any, any> => {
  const { id, keys, window } = options
  const anchor = options.anchor
  const spec: ListSpec = {
    id,
    items: keys,
    key: sameKey,
    row: noRow,
    estimatedRowHeight: options.estimate,
    rowHeight: undefined,
    drawAhead: 1,
    endReachedThreshold: 1,
    // A chat opens at its end, unseen until it is there.
    initialScrollAtEnd: true,
    // It stays at the end when the keyboard moves. It follows a growing
    // reply only once the reader has asked for the end. See `Following` in
    // the controller.
    maintainScrollAtEnd: true,
    maintainScrollAtEndAnimated: false,
    maintainScrollAtEndOnlyWhenResized: true,
    maintainScrollAtEndFollowOnReturn: true,
    // About 8 points on a phone: less than a line.
    atEndThreshold: 0.01,
    anchoredEndSpace:
      anchor === undefined || anchor.index < 0 || anchor.index >= keys.length
        ? undefined
        : {
            anchorIndex: anchor.index,
            ...(anchor.maxSize === undefined ? {} : { anchorMaxSize: anchor.maxSize }),
            ...(anchor.offset === undefined ? {} : { anchorOffset: anchor.offset }),
          },
    alignItemsAtEnd: false,
    insetLift: options.inset !== undefined && chatInsetAvailable() ? options.inset : undefined,
    inFrame,
    painter: (engine, content) => makePainter(id, engine, content),
  }
  const end = Math.min(window.end, keys.length)
  const rows: Array<Native.NoTextContent<Msg, R>> = []
  for (let index = Math.min(window.first, end); index < end; index++) {
    const key = keys[index] as string
    rows.push(
      h.view
        .key(key)
        .set({ collapsable: false })
        .prop(NODE_DATA, { [ROW_DATA]: markOf(id, key) })
        .children(options.row(index, key)) as Native.NoTextContent<Msg, R>,
    )
  }
  const { onAtEnd, onFollow, onWindow } = options
  let list = h.scrollView
    .style({ flex: 1, ...options.style })
    .set({ scrollEventThrottle: 16, ...options.props })
    .prop(NODE_DATA, { [LIST_DATA]: spec })
    .prop(CONTENT_NODE_DATA, { [CONTENT_DATA]: spec })
    .on(WINDOW_CHANGED as never, ((next: Window) => onWindow({ first: next.first, end: next.end, before: next.before })) as never)
  if (onAtEnd !== undefined) {
    list = list.on(AT_END_CHANGED as never, ((at: { isAtEnd?: boolean }) => onAtEnd(at.isAtEnd === true)) as never) as typeof list
  }
  if (onFollow !== undefined) {
    list = list.on(FOLLOW_CHANGED as never, ((at: { isFollowing?: boolean }) => onFollow(at.isFollowing === true)) as never) as typeof list
  }
  if (options.onTap !== undefined) list = list.on('press', options.onTap) as typeof list
  if (options.onDragStart !== undefined) list = list.on('scrollBeginDrag', options.onDragStart) as typeof list
  if (options.testId !== undefined) list = list.testId(options.testId)
  return list.children(
    // Never collapsed: with only a height it would be optimised away, and a
    // drag that starts between rows would not scroll. Its style is the painter's.
    h.view.key('list-canvas').set({ collapsable: false }).children(h.view.key(SPACER_KEY).style({ height: window.before }), rows),
  ) as View.ElementBuilder<Msg, R, any, any>
}

/**
 * Scrolls the list to its end. From then on the list follows the end as
 * rows grow, until a finger drags it away.
 */
export const ScrollToEnd = Command.make(
  'AnchoredList.scrollToEnd',
  { args: { id: Schema.String, animated: Schema.Boolean } },
  ({ id, animated }) =>
    Effect.sync(() => {
      hostScrollToEnd(id, { animated })
      return Component.noop
    }),
)

/**
 * A finger came to rest on a row (`true`) or left it. A list that follows
 * its end waits under a resting finger and catches up when it lifts.
 */
export const Touch = Command.make(
  'AnchoredList.touch',
  { args: { id: Schema.String, isTouched: Schema.Boolean } },
  ({ id, isTouched }) =>
    Effect.sync(() => {
      touchList(id, isTouched)
      return Component.noop
    }),
)

export const scrollToEnd = (id: string, animated = true) => ScrollToEnd.make({ id, animated })

export const touch = (id: string, isTouched: boolean) => Touch.make({ id, isTouched })

/** The list's own numbers, for a test or a readout. Undefined when no list has this id. */
export const numbers = (id: string): ListNumbers | undefined => listNumbers(id)

const round = (value: number): number => Math.round(value)
const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
const signed = (value: number): string => `${value >= 0 ? '+' : ''}${tenth(value)}`

/**
 * The numbers as two or three short lines a person can read out from a
 * phone: where the list is and how far it can go, the bottom inset and what
 * the composer covers, whether it follows, and where the question held at
 * the top is.
 */
export const formatNumbers = (list: ListNumbers | undefined): string => {
  if (list === undefined) return 'no list'
  const composer = list.composer
  const follow = list.isFollowing ? 'following' : 'not following'
  const end = list.isAtEnd === undefined ? 'end unknown' : list.isAtEnd ? 'at end' : 'not at end'
  const covers =
    composer === undefined
      ? ''
      : `, bar covers ${round(composer.covered)}, gap ${round(composer.gap)}, keyboard ${round(composer.keyboard)}`
  const anchor = list.anchor
  const question =
    anchor === undefined
      ? ''
      : `\nquestion y ${tenth(anchor.top)}, drift ${anchor.drift === undefined ? '-' : signed(anchor.drift)}`
  return (
    `offset ${round(list.offset)} of ${round(list.furthest)}, ${end}, ${follow}\n` +
    `inset ${list.inset === undefined ? 'off' : round(list.inset)}, blank ${round(list.blankSpace)}${covers}` +
    question
  )
}

/**
 * A line of text with the list's numbers. The controller rewrites it as the
 * list moves, with no Message and no draw by the program.
 */
export const numbersLabel = <Msg>(h: Native.H<Msg>, id: string, style: Native.TextStyle, testId?: string) => {
  const label = h.text.style(style).prop(NODE_DATA, {
    [LABEL_DATA]: FORMATS.get(id) ?? FORMATS.set(id, { id, format: (stats: { numbers: ListNumbers | undefined }) => formatNumbers(stats.numbers) }).get(id),
  })
  return testId === undefined ? label : label.testId(testId)
}

// One format object per list id, so a draw that changes nothing gives the label the same data.
const FORMATS = new Map<string, { id: string; format: (stats: { numbers: ListNumbers | undefined }) => string }>()
