/**
 * The other native views the host layer drives, as thin wrappers: sheets,
 * Liquid Glass, native Markdown and a Skia canvas.
 *
 * Each is an element or a Mount in Effect UI's own style. The native half
 * (view names, detection, styles, the Skia painter) is the host layer's, in
 * `packages/native/src/host`. Where a build lacks the native view, each
 * falls back to plain views and says so through its `...Status()` function.
 *
 * Also here: what goes inside a sheet (`sheetParts`), the title bar's
 * buttons and their menus (`barButtons`), the search field under a large
 * title (`searchBar`), the phone's own spinner (`spinner`) and a row that
 * swipes sideways to show actions (`swipeRow`).
 *
 * Not wrapped yet: Expo UI controls. See the plan in
 * docs/EFFECT_UI_NATIVE.md.
 */
import * as Command from '@effect/ui/Command'
import * as Renderer from '@effect/ui/Renderer'
import * as Option from 'effect/Option'
import * as Mount from '@effect/ui/Mount'
import type * as View from '@effect/ui/View'
import { type EngineNode, registerViewName } from '@ng-native/fabric'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  GLASS_CONTAINER_VIEW,
  GLASS_MODULE,
  GLASS_VIEW,
  expoGlobal,
  isLiquidGlassAvailable,
  liquidGlassStatus,
  noteRegistered,
} from '../../native/src/host/glass/detect.js'
import { isNativeMarkdownAvailable, nativeMarkdownUnavailableReason, remendOf } from '../../native/src/host/markdown/detect.js'
import {
  ACCESSIBILITY_LABELS,
  LINK_RECOGNITION,
  MD4C_FLAGS,
  SELECTION_MENU,
  STREAMING_CONFIG,
  nativeMarkdownStyle,
} from '../../native/src/host/markdown/nativeStyle.js'
import { type MarkdownColorScheme, markdownTheme } from '../../native/src/host/markdown/theme.js'
import { NATIVE_MARKDOWN_TAG } from '../../native/src/host/markdown/views.js'
import { type MenuItem, barMenuData } from '../../native/src/host/menus/items.js'
import { onNextFrame } from '../../native/src/host/motion/clock.js'
import { SHEET_FOOTER } from '../../native/src/host/navigation/tags.js'
import { SEARCH_BAR } from '../../native/src/host/navigation/views.js'
import { platformName } from '../../native/src/host/platform.js'
import { type Painter, type Pen, type Size, makeSkiaPainter, makeViewPainter } from '../../native/src/host/skia/draw.js'
import { isSkiaAvailable, skiaHost, skiaUnavailableReason } from '../../native/src/host/skia/host.js'
import { SKIA_TAG, registerSkia } from '../../native/src/host/skia/views.js'
import {
  SWIPE_MODULE,
  SWIPE_VIEW,
  isNativeSwipeAvailable,
  nativeSwipeUnavailableReason,
  noteNativeSwipeRegistered,
  resetNativeSwipeDetection,
  swipeExpoGlobal,
  swipeModule,
} from '../../native/src/host/swipeNative/detect.js'
import * as Native from './Native.js'

export { configureGlass } from '../../native/src/host/glass/detect.js'
export { configureMarkdown } from '../../native/src/host/markdown/detect.js'
export { configureSkia } from '../../native/src/host/skia/host.js'
export { configureNativeSwipe as configureSwipe } from '../../native/src/host/swipeNative/detect.js'
export { registerNavigation, registerSearchBar } from '../../native/src/host/navigation/views.js'
export { isLiquidGlassAvailable } from '../../native/src/host/glass/detect.js'
export { isNativeMarkdownAvailable } from '../../native/src/host/markdown/detect.js'
export { isSkiaAvailable } from '../../native/src/host/skia/host.js'
export { isNativeSwipeAvailable as isSwipeAvailable } from '../../native/src/host/swipeNative/detect.js'
export type { Pen, Size }

// SHEETS

export type SheetOptions = Readonly<{
  /** Heights as fractions of the screen, smallest first: `[0.4, 1]`. Left out, it fits its content. */
  detents?: ReadonlyArray<number>
  /** Which height it opens at. */
  initialDetent?: number
  /** The largest height at which the screen behind stays usable. Left out, it is always dimmed. */
  undimmedUpTo?: number
  hasGrabber?: boolean
  cornerRadius?: number
  isDismissable?: boolean
}>

/**
 * The props of a `modalScreen` that is the phone's own bottom sheet:
 *
 *   h.modalScreen.key('sheet').set(NativeViews.sheet({ detents: [0.4, 1], hasGrabber: true }))
 *     .on('dismissed', ...).children(h.sheetContent.children(...))
 */
export const sheet = (options: SheetOptions = {}): Native.ScreenProps => {
  const detents = options.detents ?? [-1]
  return {
    stackPresentation: 'formSheet',
    sheetAllowedDetents: [...detents],
    sheetInitialDetent: Math.max(0, Math.min(detents.length - 1, options.initialDetent ?? 0)),
    sheetLargestUndimmedDetent: options.undimmedUpTo ?? -1,
    sheetGrabberVisible: options.hasGrabber ?? false,
    sheetCornerRadius: options.cornerRadius ?? -1,
    sheetExpandsWhenScrolledToEdge: true,
    ...(options.isDismissable === undefined ? {} : { gestureEnabled: options.isDismissable }),
  }
}

const BOTTOM_EDGE = { top: false, right: false, bottom: true, left: false } as const
const FILL: Native.ViewStyle = { flex: 1 }
/** A sheet that fits its content: the phone reads this view's own height. */
const FIT: Native.ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0 }

export type SheetPartsOptions<Msg, R> = Readonly<{
  /** `ios` or `android`. */
  platform: string
  /** The sheet's main content. In a sheet with heights, give it one child with `flex: 1` (a scroll view). */
  body: Native.NoTextInput<Msg, R>
  /** A bar that stays at the sheet's bottom edge, clear of the home indicator. */
  footer?: Native.NoTextInput<Msg, R>
  /** The sheet is as tall as its content (`NativeViews.sheet()` with no `detents`). */
  fit?: boolean
  testId?: string
  style?: Native.ViewStyle
  /** Android: the colour of the small "drag me" bar. iOS draws its own (`hasGrabber`). */
  handleColor?: string
}>

/**
 * What goes inside a sheet, as the children of its `modalScreen`:
 *
 *   h.modalScreen.set(NativeViews.sheet({ detents: [0.5, 1], hasGrabber: true })).children(
 *     ...NativeViews.sheetParts(h, { platform, body: h.scrollView.style({ flex: 1 }).children(...), footer: doneButton }),
 *   )
 *
 * The phone looks for one content view inside a sheet. That view must fill
 * the sheet (`flex: 1`), and the style has to be on the view itself: with
 * none, the content had no height on an iPhone and a footer under it was
 * drawn at the top of the sheet. A fitted sheet's content is the other way
 * round: placed at the top with its own height, which the phone reads.
 *
 * The footer is the last thing in the sheet. iOS: inside the content view,
 * after the body, with the home indicator's strip kept clear. Android: the
 * sheet's own footer view, after the content view.
 */
export const sheetParts = <Msg, R = never>(
  h: Native.H<Msg>,
  options: SheetPartsOptions<Msg, R>,
): ReadonlyArray<Native.NoTextContent<Msg, R>> => {
  const isAndroid = options.platform === 'android'
  const footer = options.footer
  const content = (children: ReadonlyArray<Native.NoTextInput<Msg, R>>) => {
    const made = h.sheetContent
      .key('sheet-content')
      // Never left out of the native tree: the phone looks for this very view.
      .set({ collapsable: false })
      .style({ ...(options.fit === true ? FIT : FILL), ...options.style })
    return (options.testId === undefined ? made : made.testId(options.testId)).children(...(children as never[]))
  }
  if (isAndroid) {
    const handle = h.view
      .key('sheet-handle')
      .style({ alignItems: 'center', paddingTop: 8, paddingBottom: 4 })
      .children(h.view.style({ width: 36, height: 5, borderRadius: 3, backgroundColor: options.handleColor ?? '#C4C4C4' }))
    return [
      content([handle, options.body]) as Native.NoTextContent<Msg, R>,
      ...(footer === undefined
        ? []
        : [h.el(SHEET_FOOTER).key('sheet-footer').prop('collapsable', false).children(footer as never) as Native.NoTextContent<Msg, R>]),
    ]
  }
  return [
    content([
      options.body,
      footer === undefined
        ? null
        : h.view
            .key('sheet-footer')
            .set({ collapsable: false })
            .children(h.safeArea.set({ edges: BOTTOM_EDGE }).style({ flex: 0 }).children(footer as never)),
    ]) as Native.NoTextContent<Msg, R>,
  ]
}

// THE TITLE BAR

/** One button in the title bar. */
export type BarButton = Readonly<{
  id: string
  /** What a screen reader says, and the word Android shows. */
  label: string
  /** iOS: the name of an SF Symbol, the phone's own icon set. */
  symbol?: string
  /** A press opens this menu, and the button's own press is not reported. */
  menu?: ReadonlyArray<MenuItem>
}>

const barData = (buttons: ReadonlyArray<BarButton>): ReadonlyArray<Record<string, unknown>> =>
  buttons.map((button, index) => ({
    // A button with a menu gets no id: with both, the menu would open only on a hold.
    ...(button.menu === undefined ? { buttonId: button.id, index } : { index, menu: barMenuData({ items: button.menu }) }),
    title: button.label,
    ...(button.symbol === undefined ? {} : { sfSymbolName: button.symbol }),
  }))

export type BarButtonsOptions<Msg> = Readonly<{
  left?: ReadonlyArray<BarButton>
  right?: ReadonlyArray<BarButton>
  /** A button was pressed. */
  onPress: (id: string) => Msg
  /** An entry of a button's menu was chosen. */
  onMenu?: (key: string) => Msg
}>

/**
 * The iPhone's own bar buttons on a `header`, made from data, with SF
 * Symbols and the phone's own menus:
 *
 *   NativeViews.barButtons(h.header.set({ title: 'Chats' }), {
 *     right: [{ id: 'new', label: 'New', symbol: 'square.and.pencil' }],
 *     onPress: id => Message.PressedBarButton({ id }),
 *   })
 *
 * iOS only. Android has no such buttons: put a `headerItem` in the bar.
 */
export const barButtons = <Msg, B extends { prop: (name: string, value: unknown) => B; on: (name: never, handler: never) => B }>(
  header: B,
  options: BarButtonsOptions<Msg>,
): B => {
  let bar = header
  if (options.left !== undefined) bar = bar.prop('headerLeftBarButtonItems', barData(options.left))
  if (options.right !== undefined) bar = bar.prop('headerRightBarButtonItems', barData(options.right))
  // The bar's own events. They are not in the vocabulary, so the names are cast here, once.
  bar = bar.on(
    'pressHeaderBarButtonItem' as never,
    ((event: { buttonId?: unknown }) => options.onPress(typeof event.buttonId === 'string' ? event.buttonId : '')) as never,
  )
  const onMenu = options.onMenu
  if (onMenu !== undefined) {
    bar = bar.on(
      'pressHeaderBarButtonMenuItem' as never,
      ((event: { menuId?: unknown }) => onMenu(typeof event.menuId === 'string' ? event.menuId : '')) as never,
    )
  }
  return bar
}

/**
 * The phone's own search field under a large title (iOS), as a child of a
 * `header`. Every change of the text is a Message, typed or cleared. Call
 * `NativeViews.registerSearchBar()` once at startup.
 */
export const searchBar = <Msg>(
  h: Native.H<Msg>,
  options: Readonly<{ placeholder?: string; onChange: (text: string) => Msg; testId?: string }>,
) =>
  h.headerItem
    .key('search')
    .set({ type: 'searchBar' })
    .children(
      h
        .el(SEARCH_BAR)
        .prop('testID', options.testId)
        .prop('placeholder', options.placeholder)
        .prop('hideWhenScrolling', true)
        // Under the large title. `automatic` lets iOS 26 move the field into a toolbar, which a stack screen has not.
        .prop('placement', 'stacked')
        .prop('allowToolbarIntegration', false)
        .prop('autoCapitalize', 'none')
        .on('changeText' as never, ((event: { text?: unknown }) => options.onChange(typeof event.text === 'string' ? event.text : '')) as never) as never,
    )

/** The phone's own spinner. It has no size of its own, so it is given one. */
export const spinner = <Msg>(
  h: Native.H<Msg>,
  platform: string,
  color: string,
  size = 20,
): View.ElementBuilder<Msg, never, any, any> => {
  const made = h
    .el('activity-indicator')
    .prop('size', 'small')
    .prop('animating', true)
    .prop('color', color)
    .prop('style', { width: size, height: size })
  // Android's progress bar stops the app without these two.
  return platform === 'android' ? made.prop('styleAttr', 'Normal').prop('indeterminate', true) : made
}

// SWIPE ROWS

const SWIPE_TAG = 'swipe-row'

let swipeName: { name: string; undo: unknown } | undefined

/** The name the phone knows the swipe row by. Expo Go adds the running project's name. */
const swipeViewName = (): string => {
  let identifier = ''
  try {
    identifier = swipeExpoGlobal()?.__expo_app_identifier__ ?? ''
  } catch {
    identifier = ''
  }
  return `ViewManagerAdapter_${SWIPE_MODULE}_${SWIPE_VIEW}${identifier === '' ? '' : `_${identifier}`}`
}

/**
 * Names the native swipe row (`modules/foldkit-swipe`). `swipeRow` calls it
 * by itself the first time a row is drawn, so an app does not have to. It
 * does not need the native view to exist: a build without it draws plain
 * rows.
 */
export const registerSwipe = (): void => {
  try {
    const wanted = swipeViewName()
    if (swipeName?.name === wanted) return
    if (typeof swipeName?.undo === 'function') swipeName.undo()
    swipeName = { name: wanted, undo: registerViewName(SWIPE_TAG, { ios: wanted, android: wanted }) }
    noteNativeSwipeRegistered()
  } catch {
    // Not registered means every row is drawn plainly.
  }
}

/** Forgets the name and what `configureSwipe` was told. For tests. */
export const resetSwipe = (): void => {
  if (typeof swipeName?.undo === 'function') swipeName.undo()
  swipeName = undefined
  resetNativeSwipeDetection()
}

/** Whether this build has the native swipe row, and why not, as one line. */
export const swipeStatus = (): string => {
  registerSwipe()
  return isNativeSwipeAvailable() ? 'native swipe row' : `no swipe (${nativeSwipeUnavailableReason()})`
}

/** One action behind a row. */
export type SwipeAction = Readonly<{
  /** Names the action in `onAction`. Unique within one row. */
  key: string
  /** The word on the tile, and what a screen reader says. */
  label: string
  /** iOS: the name of an SF Symbol, such as `trash`. Android shows the word only. */
  symbol?: string
  /** Drawn in red. When it is triggered the row slides away, and comes back after a moment if it is still there. */
  isDestructive?: boolean
  /** The tile's colour, as `#rrggbb`. Left out, blue, or red for a destructive action. */
  color?: string
}>

/** Which side of a row opened. Leading is the left, in a language read from left to right. */
export type SwipeSide = 'leading' | 'trailing'

export type SwipeRowOptions<Msg> = Readonly<{
  /** Shown when the row is dragged away from its leading edge (to the right, in English). */
  leading?: ReadonlyArray<SwipeAction>
  /** Shown when the row is dragged away from its trailing edge (to the left, in English). */
  trailing?: ReadonlyArray<SwipeAction>
  /**
   * Whether swiping all the way triggers an action. The native view decides
   * this for the whole row, and the action it triggers is always the first
   * one of that side, the one at the screen's edge. Default true.
   */
  fullSwipe?: boolean
  /** Rows with the same group close each other: opening or dragging one closes the rest. */
  group?: string
  /** `tiles`: rounded tiles with gaps. `strip`: square blocks, edge to edge. Default `tiles`. */
  look?: 'tiles' | 'strip'
  /** Rounds the row's and the tiles' corners, in points. */
  cornerRadius?: number
  /** `false` stops the row from swiping, and closes it. Default true. */
  isEnabled?: boolean
  /** A tile was pressed (`isFullSwipe: false`), or the row was swiped all the way. */
  onAction: (event: Readonly<{ key: string; isFullSwipe: boolean }>) => Msg
  /** The row came to rest open. */
  onOpened?: (side: SwipeSide) => Msg
  /** The row came to rest closed, after being open. */
  onClosed?: () => Msg
  /** The row's own style. Give its content a background colour, or the tiles show through. */
  style?: Native.ViewStyle
  testId?: string
}>

/** What `swipeRow` gives: a box for the row's content, which takes a `key` and a `ref`. */
export type SwipeRow<Msg> = View.ContainerBuilder<Msg, never, Record<string, unknown>, Native.Node>

type NativeSwipeAction = Readonly<{ key: string; label: string; role: string; symbol?: string; tint?: string }>

const swipeActions = (actions: ReadonlyArray<SwipeAction> | undefined): ReadonlyArray<NativeSwipeAction> =>
  (actions ?? []).map(action => ({
    key: action.key,
    label: action.label,
    role: action.isDestructive === true ? 'destructive' : 'normal',
    // Left out, not null: the native code then uses its own "nothing".
    ...(action.symbol === undefined ? {} : { symbol: action.symbol }),
    ...(action.color === undefined ? {} : { tint: action.color }),
  }))

/**
 * A row that slides sideways under the finger to show actions, drawn and
 * moved by the phone (`modules/foldkit-swipe`: UIKit on iOS, Android's own
 * views on Android). The row's content is its children:
 *
 *   NativeViews.swipeRow(h, {
 *     trailing: [
 *       { key: 'delete', label: 'Delete', symbol: 'trash', isDestructive: true },
 *       { key: 'rename', label: 'Rename', symbol: 'pencil' },
 *     ],
 *     group: 'chats',
 *     onAction: ({ key, isFullSwipe }) => Message.ChoseSwipeAction({ id, key, isFullSwipe }),
 *     onOpened: () => Message.OpenedRow({ id }),
 *     onClosed: () => Message.ClosedRow({ id }),
 *   }).children(h.view.style({ backgroundColor: '#FFFFFF', padding: 16 }).children(h.text('Bread recipe')))
 *
 * The finger never reaches JavaScript while it drags. The program hears
 * three things: an action was triggered, the row opened, the row closed.
 *
 * One row open at a time. The native view closes the other rows of a group
 * when one is opened or dragged, and a tap on an open row closes it. It does
 * not know about the list around it. So a program closes the rows itself
 * when the list is scrolled or something else is tapped, with
 * `NativeViews.closeSwipeRows(group)`.
 *
 * Where the native view is not in the build (Expo Go, or an app built
 * before the module was added) the row is a plain view with the same
 * children. Nothing swipes and nothing crashes. `NativeViews.swipeStatus()`
 * says which.
 */
export const swipeRow = <Msg>(h: Native.H<Msg>, options: SwipeRowOptions<Msg>): SwipeRow<Msg> => {
  registerSwipe()
  if (!isNativeSwipeAvailable()) {
    return h.el('view').prop('style', options.style).prop('testID', options.testId) as SwipeRow<Msg>
  }
  const { onOpened, onClosed } = options
  let row = h
    .el(SWIPE_TAG)
    .prop('testID', options.testId)
    // Every prop is sent every time, so one that is left out later goes back to its usual value.
    .prop('actionsLeading', swipeActions(options.leading))
    .prop('actionsTrailing', swipeActions(options.trailing))
    .prop('allowsFullSwipe', options.fullSwipe ?? true)
    .prop('mode', options.look ?? 'tiles')
    .prop('group', options.group ?? '')
    .prop('cornerRadius', options.cornerRadius ?? 0)
    .prop('isEnabled', options.isEnabled ?? true)
    // Never folded into its parent: the native code is this view.
    .prop('collapsable', false)
    // The content slides out past the row's edge, and is cut off there.
    .prop('style', { overflow: 'hidden', ...options.style })
    // The row's own events. They are not in the vocabulary, so the names are cast here, once.
    .on(
      'actionTriggered' as never,
      ((event: { key?: unknown; viaFullSwipe?: unknown }) =>
        options.onAction({ key: typeof event.key === 'string' ? event.key : '', isFullSwipe: event.viaFullSwipe === true })) as never,
    )
  if (onOpened !== undefined) {
    row = row.on(
      'swipeOpened' as never,
      ((event: { side?: unknown }) => onOpened(event.side === 'leading' ? 'leading' : 'trailing')) as never,
    )
  }
  if (onClosed !== undefined) row = row.on('swipeClosed' as never, (() => onClosed()) as never)
  return row as SwipeRow<Msg>
}

/** How many rows a close reached. 0 where the native view is not in the build. */
export interface ClosedSwipes {
  readonly closed: number
}

const closeCounts = new WeakMap<Native.Node, number>()

export const CloseSwipeRows = Command.make('NativeViews.closeSwipeRows', { args: { group: Schema.String } }, ({ group }) =>
  Effect.sync((): ClosedSwipes => {
    try {
      const module = swipeModule()
      if (module?.closeAll === undefined) return { closed: 0 }
      const answer = module.closeAll(group)
      // The native function answers with a promise. A failure there leaves the rows as they are.
      if (answer !== null && typeof answer === 'object' && 'catch' in answer) (answer as Promise<unknown>).catch(() => {})
      return { closed: 1 }
    } catch {
      return { closed: 0 }
    }
  }),
)

export const CloseSwipeRow = Command.make('NativeViews.closeSwipeRow', { args: { ref: Renderer.Ref } }, ({ ref }) =>
  Renderer.Refs.use(refs =>
    Effect.flatMap(refs.lookup(ref as Renderer.Ref<Native.Node>), found =>
      Option.isNone(found) || !isNativeSwipeAvailable()
        ? Effect.succeed<ClosedSwipes>({ closed: 0 })
        : Native.Host.use(host =>
            Effect.sync((): ClosedSwipes => {
              // The native row closes when this number changes.
              const count = (closeCounts.get(found.value) ?? 0) + 1
              closeCounts.set(found.value, count)
              host.engine.setProp(found.value, 'closeSignal', count)
              host.engine.commit()
              return { closed: 1 }
            }),
          ),
    ),
  ),
)

/**
 * Closes every open row of a group:
 *
 *   ScrolledList: $ => $.run(NativeViews.closeSwipeRows('chats').pipe(Command.asNoop))
 */
export const closeSwipeRows = (group: string) => CloseSwipeRows.make({ group })

/** Closes one row, named by a ref on the `swipeRow`. */
export const closeSwipeRow = (ref: Renderer.Ref<Native.Node>) => CloseSwipeRow.make({ ref })

// GLASS

const GLASS_TAG = 'glass'
const GLASS_CONTAINER_TAG = 'glass-container'

const expoViewName = (viewName: string): string => {
  let identifier = ''
  try {
    identifier = expoGlobal()?.__expo_app_identifier__ ?? ''
  } catch {
    identifier = ''
  }
  return `ViewManagerAdapter_${GLASS_MODULE}_${viewName}${identifier === '' ? '' : `_${identifier}`}`
}

/** Names expo-glass-effect's native views. Call once at startup, after `import 'expo'`. */
export const registerGlass = (): void => {
  try {
    registerViewName(GLASS_TAG, { ios: expoViewName(GLASS_VIEW), android: 'View' })
    registerViewName(GLASS_CONTAINER_TAG, { ios: expoViewName(GLASS_CONTAINER_VIEW), android: 'View' })
    noteRegistered()
  } catch {
    // Not registered means every glass view is its fallback.
  }
}

/** Whether this phone draws real Liquid Glass, and why not, as one line. */
export const glassStatus = (): string => liquidGlassStatus()

export type GlassOptions = Readonly<{
  glassStyle?: 'regular' | 'clear'
  tintColor?: string
  isInteractive?: boolean
  style?: Native.ViewStyle
  /** Laid over `style` where Liquid Glass is not available. */
  fallbackStyle?: Native.ViewStyle
}>

const FALLBACK_LOOK: Native.ViewStyle = {
  backgroundColor: 'rgba(246, 246, 246, 0.82)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.7)',
}

/**
 * A piece of Liquid Glass (iOS 26 and later), or a pale plain view where the
 * phone has none: `NativeViews.glass(h, { style: { borderRadius: 20 } }).children(...)`.
 */
export const glass = <Msg>(h: Native.H<Msg>, options: GlassOptions = {}): View.ContainerBuilder<Msg> =>
  isLiquidGlassAvailable()
    ? h
        .el(GLASS_TAG)
        .prop('glassEffectStyle', options.glassStyle ?? 'regular')
        .prop('tintColor', options.tintColor ?? null)
        .prop('isInteractive', options.isInteractive ?? false)
        .prop('style', options.style)
    : h.el('view').prop('style', { ...FALLBACK_LOOK, ...options.style, ...options.fallbackStyle })

// MARKDOWN

/** Whether this build draws Markdown with the native view, and why not. */
export const markdownStatus = (): string =>
  isNativeMarkdownAvailable() ? 'native Markdown view' : `plain text (${nativeMarkdownUnavailableReason()})`

const MARKDOWN_FIXED: ReadonlyArray<readonly [string, unknown]> = [
  ['isGFM', true],
  ['md4cFlags', MD4C_FLAGS],
  ['streamingConfig', STREAMING_CONFIG],
  ['selectionMenuConfig', SELECTION_MENU],
  ['accessibilityLabels', ACCESSIBILITY_LABELS],
  ['linkRecognition', LINK_RECOGNITION],
  ['allowFontScaling', true],
  ['allowTrailingMargin', false],
]

const Scheme = Schema.Literals(['light', 'dark'])

/**
 * Keeps a native Markdown view in step with its text. The text goes to the
 * view from here, outside the element's props, so a streamed reply costs one
 * prop per change and no diff of a big string. While `isStreaming`, half
 * written Markdown is finished first, if the app gave `remend`.
 */
export const ShowMarkdown = Mount.makeStream(
  'ShowMarkdown',
  { args: { text: Schema.String, scheme: Scheme, isStreaming: Schema.Boolean } },
  (node: Native.Node, _args, changes) =>
    Stream.unwrap(
      Native.Host.use(host =>
        Effect.sync(() => {
          const engine = host.engine
          for (const [key, value] of MARKDOWN_FIXED) engine.setProp(node, key, value)
          let scheme: MarkdownColorScheme | undefined
          let sent: string | undefined
          // `changes` starts with the current args.
          return changes.pipe(
            Stream.tap(args =>
              Effect.sync(() => {
                if (args.scheme !== scheme) {
                  scheme = args.scheme
                  const theme = markdownTheme(args.scheme)
                  engine.setProp(
                    node,
                    'markdownStyle',
                    nativeMarkdownStyle(theme, platformName(), color => (engine as { color?: (c: string) => unknown }).color?.(color) ?? color),
                  )
                }
                const remend = remendOf()
                const ready = args.isStreaming && remend !== null ? remend(args.text) : args.text
                if (ready !== sent) {
                  sent = ready
                  engine.setProp(node, 'markdown', ready)
                }
                engine.commit()
              }),
            ),
            Stream.filter((): boolean => false),
            Stream.map((): never => undefined as never),
          )
        }),
      ),
    ),
)

/**
 * Markdown as rich text, drawn by the native view where the build has it
 * (react-native-enriched-markdown), and as plain text elsewhere.
 */
export const markdown = <Msg>(
  h: Native.H<Msg>,
  options: Readonly<{ text: string; scheme?: 'light' | 'dark'; isStreaming?: boolean; style?: Native.ViewStyle }>,
): View.ElementBuilder<Msg, never, any, any> =>
  isNativeMarkdownAvailable()
    ? (h
        .el(NATIVE_MARKDOWN_TAG)
        .prop('style', options.style)
        .onMount(
          ShowMarkdown({
            text: options.text,
            scheme: options.scheme ?? 'light',
            isStreaming: options.isStreaming ?? false,
          }) as never,
        ) as View.ElementBuilder<Msg, never, any, any>)
    : h.text.style({ fontSize: 16, lineHeight: 23, ...options.style }).children(options.text)

// CANVAS

/** Whether this build draws canvases with Skia, and why not. */
export const canvasStatus = (): string => (isSkiaAvailable() ? 'Skia' : `plain views (${skiaUnavailableReason()})`)

let nextCanvasId = 9_100

/**
 * A Mount that draws on an element: with Skia where the build has it, with
 * plain views elsewhere. `paint` runs once, and again each time the args
 * change. It gets a pen (circle, rect, line, text) and the element's size.
 *
 *   const DrawChart = NativeViews.makeCanvas('DrawChart', { values: Schema.Array(Schema.Number) },
 *     (pen, size, { values }) => values.forEach((v, i) => pen.rect(i * 12, size.height - v, 10, v, { color: '#0A60FF' })))
 *   h.view.style({ height: 120 }).onMount(DrawChart({ values: model.values }))
 */
export const makeCanvas = <const Name extends string, Fields extends Schema.Struct.Fields>(
  name: Name,
  args: Fields,
  paint: (pen: Pen, size: Size, args: Schema.Struct<Fields>['Type'], nowMs: number) => void,
  options: Readonly<{
    /**
     * Paint again on every frame, for something that moves by itself.
     * `paint` gets the time as its fourth argument. Only where the build has
     * Skia: with plain views it is painted once per change, as without this.
     */
    everyFrame?: boolean
  }> = {},
) =>
  Mount.makeStream(name, { args }, (node: Native.Node, _args, changes) =>
    Stream.unwrap(
      Native.Host.use(host =>
        Effect.sync(() => {
          const engine = host.engine
          let painter: Painter
          let skiaNode: EngineNode | undefined
          const skia = skiaHost()
          if (skia === null) painter = makeViewPainter(engine, node)
          else {
            registerSkia()
            const nativeId = nextCanvasId++
            skiaNode = engine.createElement(SKIA_TAG)
            engine.setProp(skiaNode, 'nativeID', String(nativeId))
            engine.setProp(skiaNode, 'collapsable', false)
            engine.setProp(skiaNode, 'pointerEvents', 'none')
            engine.setProp(skiaNode, 'style', { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 })
            engine.appendChild(node, skiaNode)
            painter = makeSkiaPainter(skia, nativeId)
          }
          let size: Size = { width: 0, height: 0 }
          let latest: Schema.Struct<Fields>['Type'] | undefined
          let isStopped = false
          let isLooping = false
          const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
          const loop = (): void => {
            if (isStopped) return
            draw()
            onNextFrame(engine, loop)
          }
          const draw = (): void => {
            const current = latest
            if (current === undefined) return
            painter.draw(size, (pen, given) => paint(pen, given, current, clock()))
            engine.commit()
            if (options.everyFrame === true && skia !== null && !isLooping && size.width > 0) {
              isLooping = true
              onNextFrame(engine, loop)
            }
          }
          const stopLayout = engine.setEventListener(node, 'topLayout', event => {
            const layout = (event as { nativeEvent?: { layout?: Partial<Size> } })?.nativeEvent?.layout
            size = { width: layout?.width ?? 0, height: layout?.height ?? 0 }
            draw()
          })
          return changes.pipe(
            Stream.tap(next =>
              Effect.sync(() => {
                latest = next as Schema.Struct<Fields>['Type']
                draw()
              }),
            ),
            Stream.filter((): boolean => false),
            Stream.map((): never => undefined as never),
            Stream.ensuring(
              Effect.sync(() => {
                isStopped = true
                stopLayout()
                painter.stop()
              }),
            ),
          )
        }),
      ),
    ),
  )
