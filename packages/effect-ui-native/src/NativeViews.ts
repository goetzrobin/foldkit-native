/**
 * The other native views the host layer drives, as thin wrappers: sheets,
 * Liquid Glass, native Markdown and a Skia canvas.
 *
 * Each is an element or a Mount in Effect UI's own style. The native half
 * (view names, detection, styles, the Skia painter) is the host layer's, in
 * `packages/native/src/host`. Where a build lacks the native view, each
 * falls back to plain views and says so through its `...Status()` function.
 *
 * Not wrapped yet: the keyboard dock, menus and Expo UI controls. See the
 * plan in docs/EFFECT_UI_NATIVE.md.
 */
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
import { platformName } from '../../native/src/host/platform.js'
import { type Painter, type Pen, type Size, makeSkiaPainter, makeViewPainter } from '../../native/src/host/skia/draw.js'
import { isSkiaAvailable, skiaHost, skiaUnavailableReason } from '../../native/src/host/skia/host.js'
import { SKIA_TAG, registerSkia } from '../../native/src/host/skia/views.js'
import * as Native from './Native.js'

export { configureGlass } from '../../native/src/host/glass/detect.js'
export { configureMarkdown } from '../../native/src/host/markdown/detect.js'
export { configureSkia } from '../../native/src/host/skia/host.js'
export { registerNavigation } from '../../native/src/host/navigation/views.js'
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
    ...(options.isDismissable === undefined ? {} : { gestureEnabled: options.isDismissable }),
  }
}

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
  paint: (pen: Pen, size: Size, args: Schema.Struct<Fields>['Type']) => void,
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
          const draw = (): void => {
            const current = latest
            if (current === undefined) return
            painter.draw(size, (pen, given) => paint(pen, given, current))
            engine.commit()
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
                stopLayout()
                painter.stop()
              }),
            ),
          )
        }),
      ),
    ),
  )
