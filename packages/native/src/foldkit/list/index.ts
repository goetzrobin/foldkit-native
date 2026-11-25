/**
 * A long list that only draws the rows near the screen.
 *
 *   list(h, {
 *     id: 'people',
 *     items: model.people,
 *     key: person => person.id,
 *     estimatedRowHeight: 56,
 *     row: person => view([h.OnClick(Message.PressedPerson({ id: person.id }))], [
 *       text([], [person.name]),
 *     ]),
 *     onEndReached: () => Message.ReachedEnd(),
 *     attributes: [style({ flex: 1 })],
 *   })
 *
 * The Model holds `items`. The view calls `list` on every draw, which is
 * cheap: `row` is only run for the rows that will exist as views. Scrolling
 * does not send Messages and does not run the view. See `module.ts` for how.
 *
 * `row` must be a plain function of its item: a row has no state of its own,
 * and its view is thrown away when it scrolls off and built again when it
 * comes back. Anything a row shows must come from the Model.
 *
 * Handlers inside rows (`h.OnClick` and the rest) send Messages as they do
 * anywhere else. Rows are built later than the view call, while scrolling, so
 * `list` needs a way to build elements "as if inside the view". Foldkit has
 * one for its Submodels: a function passed to a Submodel is run in the
 * calling view's context whenever it is called. `list` embeds itself as a
 * Submodel whose Messages pass through unchanged, and keeps that function.
 *
 * A chat lives at the end of its list, not the start. These options are for
 * that, and are modelled on Legend List's:
 *
 *   alignItemsAtEnd       a few rows sit at the bottom, not the top
 *   initialScrollAtEnd    opens at the last row
 *   maintainScrollAtEnd   stays at the end as rows arrive or grow, and when
 *                         the keyboard makes the list shorter
 *   anchoredEndSpace      blank space under the last row, so a new message can
 *                         sit at the top while the reply streams in below it
 *   onAtEndChanged        a Message when the user leaves the end or returns
 *   keyboardInset         the list keeps its full height under the composer
 *                         and the keyboard, and scrolls clear of them with a
 *                         bottom inset. See `../chat/chatScroll.ts`.
 *
 * A list that is not at its end always keeps what the user is reading in
 * place when rows above it change.
 *
 * Not built yet: horizontal lists, headers and footers inside the list,
 * sticky rows, and several columns.
 */
import { Effect, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, Prop, type VNode, element } from 'foldkit/renderTarget'

import { chatInsetAvailable } from '../../host/chat/chatScroll.js'
import type { KeyboardLiftBehavior } from '../../host/chat/vendor/kbc/types.js'
import type { AnchoredEndSpace } from '../../host/list/end.js'
import {
  AT_END_CHANGED,
  FOLLOW_CHANGED,
  KEYBOARD_MOVED,
  CONTENT_DATA,
  END_REACHED,
  LABEL_DATA,
  LIST_DATA,
  type ListSpec,
  type ListNumbers,
  type ListStats,
  type RowKey,
  scrollToEnd,
  scrollToRow,
} from '../../host/list/controller.js'
import { foldkitPainter } from './module.js'
import { type Refresh, scrollWithRefresh } from './refresh.js'

export type { ListKeyboardEvent, ListNumbers, ListStats, RowKey } from '../../host/list/controller.js'
export { listNumbers, tellListKeyboard } from '../../host/list/controller.js'
export type { KeyboardLiftBehavior } from '../../host/chat/vendor/kbc/types.js'
export { refreshScrollView } from './refresh.js'
export type { Refresh } from './refresh.js'
export { Heights, chooseWindow, rowsBetween } from '../../host/list/window.js'
export { endOffset, endSpaceFor, isAtEnd } from '../../host/list/end.js'
export type { AnchoredEndSpace } from '../../host/list/end.js'
export type { Range } from '../../host/list/window.js'

const el = element<any>()

export type ListConfig<Item, Message> = Readonly<{
  /** Names this list. Two lists on screen at once need different ids. */
  id: string
  items: ReadonlyArray<Item>
  /** What stays the same for an item when the list changes around it. */
  key: (item: Item, index: number) => RowKey
  /** Draws one row. A plain function of its item. */
  row: (item: Item, index: number) => Html
  /** A guess at a row's height, used until the phone has measured the row. */
  estimatedRowHeight: number
  /**
   * Give this when every row has exactly this height. Rows are then not
   * measured and the scroll position never needs correcting.
   */
  rowHeight?: number
  /** How far past the screen rows are drawn, in screen heights. Default 1. */
  drawAhead?: number
  /** Sent once each time the user comes near the end of the list. */
  onEndReached?: () => Message
  /** How near, in screen heights. Default 1. */
  endReachedThreshold?: number
  /**
   * When the rows are shorter than the list, put them at the bottom, as a
   * chat with two messages does.
   */
  alignItemsAtEnd?: boolean
  /**
   * Open at the last row. The list is not shown until it is there, so the
   * user does not see it arrive.
   */
  initialScrollAtEnd?: boolean
  /**
   * While the user is at the end, stay there: when rows are added, when a
   * row grows (text streaming in), and when the list itself gets shorter
   * (the keyboard opens). A user who has scrolled away is left alone.
   * `animated` glides to a new row. Growth and the keyboard never glide.
   *
   * `onlyWhenResized` keeps the last of those three and drops the first two:
   * the list stays at its end when the keyboard opens or closes, and does
   * not chase rows that arrive or grow. An AI chat wants that, because its
   * answer is meant to run off the bottom of the screen.
   *
   * `followOnReturn`, with `onlyWhenResized`: once the user asks for the
   * end, the list does chase rows that grow or arrive, as Claude's app
   * follows a reply being written. Asking is `scrollListToEnd` (the round
   * button) or scrolling to the end by hand. A drag away from the end stops
   * it, and so does a new `anchoredEndSpace` row (the question after Send,
   * whose reply runs off the bottom as before). See `Following` in
   * `module.ts`; `ListNumbers.isFollowing` says which it is.
   */
  maintainScrollAtEnd?:
    | boolean
    | Readonly<{ animated?: boolean; onlyWhenResized?: boolean; followOnReturn?: boolean }>
  /** How near the end counts as at the end, in screen heights. Default 0.1. */
  atEndThreshold?: number
  /**
   * Blank space under the last row so that row `anchorIndex` can sit at the
   * top of the screen. When `anchorIndex` changes to a new row the list
   * scrolls there by itself. See `end.ts`.
   */
  anchoredEndSpace?: AnchoredEndSpace
  /**
   * Sent when the user leaves the end of the list (`false`) or comes back to
   * it (`true`). Never sent twice in a row with the same answer, however
   * many scroll events there are. Start the Model with `true` if the list
   * has `initialScrollAtEnd`, otherwise with `false`.
   */
  onAtEndChanged?: (isAtEnd: boolean) => Message
  /**
   * Sent when the list starts following its end as rows grow or arrive
   * (`true`) or stops (`false`): see `Following` in the host list. Only for
   * a log of what the list did; the list follows by itself either way.
   */
  onFollowChanged?: (isFollowing: boolean) => Message
  /**
   * With `keyboardInset`: sent when the keyboard starts to move (with the
   * height it is going to), stops (with its height), or is dragged by a
   * finger (no height). Only for a log of what happened on screen.
   */
  onKeyboardMoved?: (phase: 'start' | 'end' | 'interactive', height: number | undefined) => Message
  /**
   * For a chat whose composer is a `composerDock` in `'inset'` mode with this
   * list's id as `listId`. The list then runs the full height of the screen
   * area, under the composer, and is never made shorter by the keyboard.
   * Instead its scroll view gets a bottom inset: the composer's height plus
   * the keyboard's, or the blank space of `anchoredEndSpace` if that is
   * larger. So a question held at the top of the screen does not move when
   * the keyboard opens or closes.
   *
   * `lift` says what the messages do as the keyboard opens:
   *
   *   'always'      they rise with it and come back down with it
   *   'whenAtEnd'   the same, but only when the newest message is in view
   *   'persistent'  they rise with it and stay up when it closes
   *   'never'       they stay, and the keyboard covers them
   *
   * Default `'always'`. On a phone that cannot do this (see
   * `chatInsetFallbackReason`), the option is ignored and the list behaves
   * as it does without it.
   */
  keyboardInset?: Readonly<{ lift?: KeyboardLiftBehavior }>
  /** Pull to refresh. See `refresh.ts`. */
  refresh?: Refresh<Message>
  /** Attributes for the scroll view, such as `style({ flex: 1 })`. */
  attributes?: ReadonlyArray<unknown>
}>

type Inputs = Readonly<{ inFrame: (build: () => Html) => Html }>

/** Leaves something on an element for one of the adapter's modules to read. */
const tag = (vnode: VNode | null, name: string, value: unknown): void => {
  if (vnode !== null) (vnode.data ??= {})[name] = value
}

const listView = (config: ListConfig<any, any>, inputs: Inputs): Html => {
  const insetLift =
    config.keyboardInset !== undefined && chatInsetAvailable()
      ? (config.keyboardInset.lift ?? 'always')
      : undefined
  const spec: ListSpec = {
    id: config.id,
    items: config.items,
    key: config.key,
    row: config.row,
    estimatedRowHeight: config.estimatedRowHeight,
    rowHeight: config.rowHeight,
    drawAhead: config.drawAhead ?? 1,
    endReachedThreshold: config.endReachedThreshold ?? 1,
    initialScrollAtEnd: config.initialScrollAtEnd ?? false,
    maintainScrollAtEnd: config.maintainScrollAtEnd !== undefined && config.maintainScrollAtEnd !== false,
    maintainScrollAtEndAnimated:
      typeof config.maintainScrollAtEnd === 'object' && (config.maintainScrollAtEnd.animated ?? false),
    maintainScrollAtEndOnlyWhenResized:
      typeof config.maintainScrollAtEnd === 'object' &&
      (config.maintainScrollAtEnd.onlyWhenResized ?? false),
    maintainScrollAtEndFollowOnReturn:
      typeof config.maintainScrollAtEnd === 'object' &&
      (config.maintainScrollAtEnd.onlyWhenResized ?? false) &&
      (config.maintainScrollAtEnd.followOnReturn ?? false),
    atEndThreshold: config.atEndThreshold ?? 0.1,
    anchoredEndSpace: config.anchoredEndSpace,
    alignItemsAtEnd: config.alignItemsAtEnd ?? false,
    insetLift,
    inFrame: inputs.inFrame,
    painter: foldkitPainter,
  }
  const onEndReached = config.onEndReached
  const onAtEndChanged = config.onAtEndChanged
  const onFollowChanged = config.onFollowChanged
  const onKeyboardMoved = config.onKeyboardMoved
  // The one content view a scroll view needs. The list module fills it.
  const content = el('view')(
    [
      Prop({ key: 'collapsable', value: false }),
      // At least as tall as the list, with the rows pushed to its bottom:
      // what React Native apps do with `contentContainerStyle`.
      // With `keyboardInset` the list module does this itself, because
      // "as tall as the list" must then leave out the composer.
      ...(config.alignItemsAtEnd === true && insetLift === undefined
        ? [Prop({ key: 'style', value: { flexGrow: 1, justifyContent: 'flex-end' } })]
        : []),
    ] as never,
    [],
  )
  const { root, scroll } = scrollWithRefresh(
    config.refresh,
    [
      // How often the phone reports the scroll position, in milliseconds.
      // Without it iOS reports once per drag.
      Prop({ key: 'scrollEventThrottle', value: 16 }),
      ...(config.attributes ?? []),
      // Never sent by the phone. The list module calls this handler itself
      // when the end comes near, which sends the Message.
      ...(onEndReached === undefined
        ? []
        : [OnCustomEvent({ name: END_REACHED, f: () => Option.some(onEndReached()) })]),
      // Also called by the list module, only when the answer changes.
      ...(onAtEndChanged === undefined
        ? []
        : [
            OnCustomEvent({
              name: AT_END_CHANGED,
              f: (event: unknown) =>
                Option.some(
                  onAtEndChanged(
                    (event as { detail?: { isAtEnd?: boolean } }).detail?.isAtEnd === true,
                  ),
                ),
            }),
          ]),
      ...(onFollowChanged === undefined
        ? []
        : [
            OnCustomEvent({
              name: FOLLOW_CHANGED,
              f: (event: unknown) =>
                Option.some(
                  onFollowChanged(
                    (event as { detail?: { isFollowing?: boolean } }).detail?.isFollowing === true,
                  ),
                ),
            }),
          ]),
      ...(onKeyboardMoved === undefined
        ? []
        : [
            OnCustomEvent({
              name: KEYBOARD_MOVED,
              f: (event: unknown) => {
                const detail = (event as { detail?: { phase?: unknown; height?: unknown } }).detail
                const phase = detail?.phase
                return phase === 'start' || phase === 'end' || phase === 'interactive'
                  ? Option.some(onKeyboardMoved(phase, typeof detail?.height === 'number' ? detail.height : undefined))
                  : Option.none()
              },
            }),
          ]),
    ],
    content,
  )
  tag(scroll, LIST_DATA, spec)
  tag(content, CONTENT_DATA, spec)
  // A key of its own, unless the caller gave one. Without a key the updater
  // may reuse this scroll view for a plain one next to it, or the other way
  // round, and the rows would be left behind in the wrong view. A list with
  // an inset is another kind of list: switching makes it again.
  for (const each of [root, scroll]) {
    if (each !== null && each.key === undefined) {
      each.key = `foldkit-native-list:${config.id}${insetLift === undefined ? '' : ':inset'}`
      ;(each.data ??= {}).key = each.key
    }
  }
  return root
}

/** A list that draws only the rows near the screen. See the top of this file. */
export const list = <Item, Message>(
  h: HtmlBuilder<Message>,
  config: ListConfig<Item, Message>,
): Html =>
  // The casts: Foldkit asks for a view made with `defineView`, which only
  // changes its type, and types the Submodel's Messages apart from the
  // caller's. Here they are the same Messages.
  h.submodel({
    slotId: `foldkit-native-list:${config.id}`,
    model: config,
    view: listView as never,
    viewInputs: { inFrame: (build: () => Html) => build() } as never,
    toParentMessage: (message: unknown) => message as Message,
  } as never)

/**
 * A text element that says how many row views a list has right now, for
 * example "31 row views". The adapter rewrites it as the list scrolls, with
 * no Message and no draw by the program.
 */
export const listRowCount = (
  id: string,
  attributes: ReadonlyArray<unknown> = [],
  format: (stats: ListStats) => string = stats =>
    `${stats.rowViews} row views (rows ${stats.first + 1} to ${stats.end} of ${stats.count})`,
): Html => {
  const label = el('text')(attributes as never, [])
  tag(label, LABEL_DATA, { id, format })
  return label
}

/**
 * A text element with the list's own numbers, for finding out on a real
 * phone why a list is not where it should be: how tall the list and its rows
 * are, the blank space and bottom inset, where it is scrolled to, the last
 * place it asked the phone to scroll to and how often, and whether it thinks
 * it is at its end. Rewritten when the list draws and when a scroll comes to
 * rest, not on every frame.
 */
export const listNumbersLabel = (id: string, attributes: ReadonlyArray<unknown> = []): Html =>
  listRowCount(id, attributes, stats => formatListNumbers(stats.numbers))

const round = (value: number): number => Math.round(value)

export const formatListNumbers = (numbers: ListNumbers | undefined): string => {
  if (numbers === undefined) return 'No list on screen.'
  const { lastScroll } = numbers
  const asked =
    lastScroll === undefined
      ? 'none'
      : `${round(lastScroll.target)} ${lastScroll.animated ? 'gliding' : 'at once'}, ` +
        `sent ${lastScroll.sends}x, ${lastScroll.arrived ? 'arrived' : 'not arrived'}`
  return (
    `list ${round(numbers.viewport)} rows ${round(numbers.rows)} blank ${round(numbers.blankSpace)} ` +
    `inset ${numbers.inset === undefined ? 'off' : round(numbers.inset)} ` +
    `keyboard ${round(numbers.keyboard)} bar ${round(numbers.bar)}\n` +
    `at ${round(numbers.offset)} of ${round(numbers.furthest)}, asked: ${asked}, ` +
    `at end: ${numbers.isAtEnd === undefined ? 'unknown' : numbers.isAtEnd ? 'yes' : 'no'}` +
    `${numbers.isHolding ? ', holding' : ''}${numbers.isFollowing ? ', following' : ''}` +
    anchorLine(numbers.anchor)
  )
}

const tenth = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
const signed = (value: number): string => `${value >= 0 ? '+' : ''}${tenth(value)}`

/**
 * The question held at the top after Send: where it is, how far it moved in
 * the last draw and how far since it was put there. While a reply streams
 * under it all should stay at 0.0. "window" is the phone's own measurement.
 */
const anchorLine = (anchor: ListNumbers['anchor']): string => {
  if (anchor === undefined) return ''
  const window =
    anchor.windowY === undefined
      ? ''
      : `, window y ${tenth(anchor.windowY)} (step ${signed(anchor.windowStep ?? 0)}, ` +
        `drift ${anchor.windowDrift === undefined ? '-' : signed(anchor.windowDrift)})`
  const drift = anchor.drift === undefined ? '-' : signed(anchor.drift)
  return `\nquestion y ${tenth(anchor.top)} (step ${signed(anchor.step)}, drift ${drift})${window}`
}

/**
 * Scrolls the list so row `index` is at the top. An Effect, for a Command:
 *
 *   execute: ({ index }) =>
 *     scrollListToIndex('people', index).pipe(Effect.as(Message.CompletedScroll()))
 */
export const scrollListToIndex = (
  id: string,
  index: number,
  options: Readonly<{ animated?: boolean; offset?: number }> = {},
): Effect.Effect<void> => Effect.sync(() => scrollToRow(id, index, options))

/**
 * Scrolls the list to its end. An Effect, for a Command:
 *
 *   execute: scrollListToEnd('messages', { animated: true }).pipe(
 *     Effect.as(Message.CompletedScrollToEnd()),
 *   )
 */
export const scrollListToEnd = (
  id: string,
  options: Readonly<{ animated?: boolean }> = {},
): Effect.Effect<void> => Effect.sync(() => scrollToEnd(id, options))
