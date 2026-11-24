/**
 * A list element built on Legend List's own core, with no React.
 *
 *   legendList(h, {
 *     id: 'chat',
 *     platform: env.device.platform,
 *     items: model.messages,
 *     key: message => message.id,
 *     row: message => view([], [text([], [message.text])]),
 *     estimatedItemSize: 120,
 *     initialScrollAtEnd: true,
 *     maintainVisibleContentPosition: true,
 *     recycleItems: true,
 *     anchoredEndSpace: { anchorIndex: 12, anchorMaxSize: 72, anchorOffset: 16 },
 *     attributes: [style({ flex: 1 })],
 *   })
 *
 * The option names and what they do are Legend List's
 * (https://legendapp.com/open-source/list). The arithmetic behind them is
 * Legend's code, copied into `vendor/`. What is ours is the part that was
 * React: `driver.ts` calls Legend's functions in the order its component does,
 * and `module.ts` draws the result with native views.
 *
 * As with `list` (in `../list`), the Model holds `items`, `row` is a plain
 * function of its item, and handlers inside rows send Messages as anywhere
 * else. Scrolling sends no Message and does not run the program's view.
 *
 * Offered now: the options below. Not offered yet, though Legend's core here
 * could do them: headers and footers, sticky rows, columns, horizontal lists,
 * snapping, fixed item sizes, viewability callbacks.
 */
import { Effect, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, Prop, type VNode, element } from 'foldkit/renderTarget'

import { customEvent, handlersByNode, type Handler } from '../../host/fabric/nodes.js'
import {
  LEGEND_CONTENT_DATA,
  LEGEND_DATA,
  type LegendSpec,
  legendHandles,
} from './module.js'
import type { LegendPlatform } from '../../host/legend/platform/Platform.js'
import type { MaintainScrollAtEndOptions } from '../../host/legend/vendor/types.base.js'

export { legendContainers, legendHandles, legendNumbers } from './module.js'
export type { LegendContainerInfo } from './module.js'
export { setPixelRatio } from '../../host/legend/platform/PixelRatio.js'
export { setScreenReaderEnabled } from '../../host/legend/platform/screenReader.js'
export type { LegendPlatform } from '../../host/legend/platform/Platform.js'
export type { MaintainScrollAtEndOptions } from '../../host/legend/vendor/types.base.js'

const el = element<any>()

/** The room Legend keeps below the last row so that one row can sit at the top. */
export type AnchoredEndSpace = Readonly<{
  /** The row to bring to the top, counting from 0. */
  anchorIndex: number
  /** If the row is taller than this, only this much of it is kept on screen. */
  anchorMaxSize?: number
  /** How far below the top of the list the row sits, in points. */
  anchorOffset?: number
}>

export type LegendListConfig<Item, Message> = Readonly<{
  /** Names this list. Two lists on screen at once need different ids. */
  id: string
  /** Which phone this is. Legend behaves differently on the two. Default 'ios'. */
  platform?: LegendPlatform | (string & {})
  items: ReadonlyArray<Item>
  /** What stays the same for an item when the list changes around it. */
  key: (item: Item, index: number) => string | number
  /** Draws one row. A plain function of its item. */
  row: (item: Item, index: number) => Html
  /** A guess at a row's height, used until the phone has measured the row. Default 100. */
  estimatedItemSize?: number
  /** How far past the screen rows are drawn, in points. Default 250. */
  drawDistance?: number
  /** Start scrolled to the last row. */
  initialScrollAtEnd?: boolean
  /** Keep what is on screen where it is when rows above change size or are added. */
  maintainVisibleContentPosition?: boolean | Readonly<{ data?: boolean; size?: boolean }>
  /**
   * While the list is at its end, stay there. `true` means on every cause:
   * rows added, a row growing, the list itself changing height. Or name the
   * causes: `{ on: { layout: true } }` only follows the list's own height,
   * which is what an opening keyboard changes.
   */
  maintainScrollAtEnd?: boolean | MaintainScrollAtEndOptions
  /** How near the end counts as "at its end", as a share of the list's height. Default 0.1. */
  maintainScrollAtEndThreshold?: number
  /** A list shorter than the screen sits at the bottom, as in a chat. */
  alignItemsAtEnd?: boolean
  /** Keep a row's native views when it scrolls off, and reuse them for another row. */
  recycleItems?: boolean
  anchoredEndSpace?: AnchoredEndSpace
  /** Padding above the first row and below the last, in points. */
  paddingTop?: number
  paddingBottom?: number
  /** Sent once each time the user comes near the end of the list. */
  onEndReached?: () => Message
  /** How near, as a share of the list's height. Default 0.5. */
  onEndReachedThreshold?: number
  /** Sent once each time the user comes near the start of the list. */
  onStartReached?: () => Message
  onStartReachedThreshold?: number
  /** Attributes for the scroll view, such as `style({ flex: 1 })`. */
  attributes?: ReadonlyArray<unknown>
}>

type Inputs = Readonly<{ inFrame: (build: () => Html) => Html }>

const END_REACHED = 'legendEndReached'
const START_REACHED = 'legendStartReached'

/** Leaves something on an element for one of the adapter's modules to read. */
const tag = (vnode: VNode | null, name: string, value: unknown): void => {
  if (vnode !== null) (vnode.data ??= {})[name] = value
}

const legendListView = (config: LegendListConfig<any, any>, inputs: Inputs): Html => {
  const { onEndReached, onStartReached } = config
  const paddingTop = config.paddingTop ?? 0
  const paddingBottom = config.paddingBottom ?? 0
  // The one content view a scroll view needs. The Legend module fills it.
  const content = el('view')(
    [
      Prop({ key: 'collapsable', value: false }),
      ...(paddingTop > 0 || paddingBottom > 0
        ? [Prop({ key: 'style', value: { paddingTop, paddingBottom } })]
        : []),
    ] as never,
    [],
  )
  const scroll = el('scroll-view')(
    [
      // How often the phone reports the scroll position, in milliseconds.
      // Without it iOS reports once per drag.
      Prop({ key: 'scrollEventThrottle', value: 16 }),
      Prop({ key: 'alwaysBounceVertical', value: true }),
      ...(config.attributes ?? []),
      // Never sent by the phone. The handlers are called from `fire` below
      // when Legend says an edge was reached, which sends the Message.
      ...(onEndReached === undefined
        ? []
        : [OnCustomEvent({ name: END_REACHED, f: () => Option.some(onEndReached()) })]),
      ...(onStartReached === undefined
        ? []
        : [OnCustomEvent({ name: START_REACHED, f: () => Option.some(onStartReached()) })]),
    ] as never,
    [content],
  )
  // Filled in by the Legend module once the scroll view exists as a native view.
  const target: LegendSpec['target'] = { scroll: undefined }
  /** Calls the handler Foldkit put on the scroll view for one of the two names above. */
  const fire = (name: string, detail: unknown): void => {
    if (target.scroll === undefined) return
    const handler = handlersByNode.get(target.scroll)?.[name] as Handler | undefined
    handler?.(customEvent(name, detail))
  }
  const spec: LegendSpec = {
    id: config.id,
    platform: config.platform === 'android' ? 'android' : 'ios',
    items: config.items,
    key: (item, index) => String(config.key(item, index)),
    row: config.row,
    options: {
      estimatedItemSize: config.estimatedItemSize,
      drawDistance: config.drawDistance,
      initialScrollAtEnd: config.initialScrollAtEnd,
      maintainVisibleContentPosition: config.maintainVisibleContentPosition,
      maintainScrollAtEnd: config.maintainScrollAtEnd,
      maintainScrollAtEndThreshold: config.maintainScrollAtEndThreshold,
      alignItemsAtEnd: config.alignItemsAtEnd,
      recycleItems: config.recycleItems,
      anchoredEndSpace: config.anchoredEndSpace,
      paddingTop,
      paddingBottom,
      onEndReached: onEndReached === undefined ? undefined : info => fire(END_REACHED, info),
      onEndReachedThreshold: config.onEndReachedThreshold,
      onStartReached: onStartReached === undefined ? undefined : info => fire(START_REACHED, info),
      onStartReachedThreshold: config.onStartReachedThreshold,
    },
    inFrame: inputs.inFrame,
    target,
  }
  tag(scroll, LEGEND_DATA, spec)
  tag(content, LEGEND_CONTENT_DATA, spec)
  // A key of its own, unless the caller gave one, so the updater never reuses
  // this scroll view for a plain one next to it.
  if (scroll !== null && scroll.key === undefined) {
    scroll.key = `foldkit-native-legend-list:${config.id}`
    ;(scroll.data ??= {}).key = scroll.key
  }
  return scroll
}

/** A list run by Legend List's core. See the top of this file. */
export const legendList = <Item, Message>(
  h: HtmlBuilder<Message>,
  config: LegendListConfig<Item, Message>,
): Html =>
  // The casts are the ones `list` needs: see `../list/index.ts`.
  h.submodel({
    slotId: `foldkit-native-legend-list:${config.id}`,
    model: config,
    view: legendListView as never,
    viewInputs: { inFrame: (build: () => Html) => build() } as never,
    toParentMessage: (message: unknown) => message as Message,
  } as never)

/**
 * Scrolls the list to its end. An Effect, for a Command:
 *
 *   execute: () =>
 *     scrollLegendListToEnd('chat', { animated: true }).pipe(Effect.as(Message.CompletedScroll()))
 *
 * It finishes when Legend says the scroll is done. With an anchored row the
 * end of the list is the place where that row sits at the top.
 */
export const scrollLegendListToEnd = (
  id: string,
  options: Readonly<{ animated?: boolean }> = {},
): Effect.Effect<void> =>
  Effect.promise(() =>
    Promise.all(legendHandles(id).map(handle => handle.scrollToEnd(options))).then(() => undefined),
  )

/** Scrolls the list so row `index` is at the top. An Effect, for a Command. */
export const scrollLegendListToIndex = (
  id: string,
  index: number,
  options: Readonly<{ animated?: boolean; viewOffset?: number; viewPosition?: number }> = {},
): Effect.Effect<void> =>
  Effect.promise(() =>
    Promise.all(legendHandles(id).map(handle => handle.scrollToIndex({ index, ...options }))).then(
      () => undefined,
    ),
  )

/** The first and last rows on screen right now, counting from 0, or undefined with no such list. */
export const legendVisibleRange = (id: string): Readonly<{ start: number; end: number }> | undefined => {
  const state = legendHandles(id)[0]?.getState()
  return state === undefined ? undefined : { start: state.start, end: state.end }
}

