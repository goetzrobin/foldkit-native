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
 * Not built yet: horizontal lists, headers and footers inside the list,
 * sticky rows, and several columns.
 */
import { Effect, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, Prop, type VNode, element } from 'foldkit/renderTarget'

import {
  CONTENT_DATA,
  END_REACHED,
  LABEL_DATA,
  LIST_DATA,
  type ListSpec,
  type ListStats,
  type RowKey,
  scrollToRow,
} from './module.js'
import { type Refresh, scrollWithRefresh } from './refresh.js'

export type { ListStats, RowKey } from './module.js'
export { refreshScrollView } from './refresh.js'
export type { Refresh } from './refresh.js'
export { Heights, chooseWindow, rowsBetween } from './window.js'
export type { Range } from './window.js'

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
  const spec: ListSpec = {
    id: config.id,
    items: config.items,
    key: config.key,
    row: config.row,
    estimatedRowHeight: config.estimatedRowHeight,
    rowHeight: config.rowHeight,
    drawAhead: config.drawAhead ?? 1,
    endReachedThreshold: config.endReachedThreshold ?? 1,
    inFrame: inputs.inFrame,
  }
  const onEndReached = config.onEndReached
  // The one content view a scroll view needs. The list module fills it.
  const content = el('view')([Prop({ key: 'collapsable', value: false })] as never, [])
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
    ],
    content,
  )
  tag(scroll, LIST_DATA, spec)
  tag(content, CONTENT_DATA, spec)
  // A key of its own, unless the caller gave one. Without a key the updater
  // may reuse this scroll view for a plain one next to it, or the other way
  // round, and the rows would be left behind in the wrong view.
  for (const each of [root, scroll]) {
    if (each !== null && each.key === undefined) {
      each.key = `foldkit-native-list:${config.id}`
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
