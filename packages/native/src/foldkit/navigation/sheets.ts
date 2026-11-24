/**
 * Bottom sheets: the phone's own sheet, driven from a Foldkit view.
 *
 *   modalScreen(
 *     [
 *       h.Key(sheetKey('places', model.places)),
 *       onDismissed(() => ClosedPlaces()),
 *       ...sheet({
 *         device,
 *         detents: [0.25, 0.5, 1],
 *         initialDetent: model.places.openedAt,
 *         undimmedUpTo: 1,
 *         hasGrabber: true,
 *         onDetentChanged: index => MovedPlaces({ index }),
 *       }),
 *     ],
 *     [sheetContent({}, [...])],
 *   )
 *
 * A sheet is a `modalScreen` in a `stack`, like any presented screen. The
 * Model opens it by adding the screen and closes it by taking it away. The
 * sheet itself is react-native-screens' (4.30): a `UISheetPresentationController`
 * on iOS and Material's bottom sheet on Android. Nothing here draws a sheet
 * in JavaScript.
 *
 * WHAT GOES INSIDE
 *
 *   sheetContent   wraps the sheet's content. Needed for `detents: 'fit'`,
 *                  where the phone reads this view's height.
 *   sheetFooter    a bar that stays at the bottom edge of the sheet.
 *   sheetHandle    the small "drag me" bar, for Android, which has none.
 *   sheetComposer  a text field and Send button that stay above the keyboard.
 *   sheetScrolls   for a scroll view or list inside a sheet on Android.
 *   a `stack`      a sheet may hold a stack of its own, with a title bar.
 *
 * THE DETENT IN THE MODEL
 *
 * `onDetentChanged` reports the height the sheet came to rest at, as an index
 * into `detents`. Keep it in the Model with `SheetPlace`.
 *
 * Moving a sheet from the Model is the weak spot. react-native-screens 4.30
 * reads the starting detent once, as the sheet opens, on both phones. It has
 * no prop and no command that moves a sheet that is already open. So a move
 * from the Model presents the sheet again at the new height: `moveSheet`
 * raises a counter, `sheetKey` puts the counter in the screen's key, and the
 * phone slides the old sheet away and the new one in. The content is drawn
 * from the Model, so nothing in it is lost. A user dragging the sheet is
 * never presented again: that goes through `sheetMovedByPhone`.
 *
 * CLOSING
 *
 * iOS can refuse a swipe-down (`isDismissable: false`) or ask the Model first
 * (`backBlocked`, which reports each attempt). Android's sheet cannot refuse:
 * a drag to the bottom always hides it and then reports `onDismissed`. To
 * keep such a sheet, present it again from `update` with `presentAgain`.
 *
 * The platform differences are listed at each option below.
 */
import { Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, element } from 'foldkit/renderTarget'

import type { EngineNode } from '@ng-native/fabric'
import type { VNode } from 'foldkit/renderTarget'

import { SHEET_CONTENT, SHEET_FOOTER } from '../../host/navigation/tags.js'
import { prop } from '../attributes.js'
import { type ModuleFactory, registerModule } from '../extend.js'
import { keyboardDock } from '../keyboard/dock.js'
import { bagOf, nodeOf } from '../modules.js'

const el = element<any>()

/** The part of `Device` this file reads. */
type OnPlatform = Readonly<{ platform: string }>

const isAndroid = (device: OnPlatform | undefined): boolean => device?.platform === 'android'

/** react-native-screens' own value for "as tall as the content". */
const FIT_TO_CONTENTS = [-1] as const

/** Material's bottom sheet has three resting states and no more. */
const ANDROID_MAX_DETENTS = 3

export type SheetOptions<Message = never> = Readonly<{
  /**
   * Heights the sheet rests at, as parts of the screen, smallest first:
   * `[0.25, 0.5, 1]`. Or `'fit'`: as tall as its content, which must then be
   * in a `sheetContent({ fit: true }, ...)`.
   *
   * Android takes at most three heights and stops the app when given more.
   * With `device` given, a longer list is cut to its first three there.
   */
  detents?: ReadonlyArray<number> | 'fit'
  /** Which of `detents` it opens at. The first, unless said. Read once, as it opens. */
  initialDetent?: number
  /**
   * The small bar at the top that says "drag me". iOS only: Android's sheet
   * has none, so draw a `sheetHandle` there.
   */
  hasGrabber?: boolean
  /**
   * Corner radius in points. The phone's own on iOS, unless said. Android
   * has square corners unless said.
   */
  cornerRadius?: number
  /**
   * The phone the app runs on. Lets the options that differ by phone be
   * sent in the form each one takes.
   */
  device?: OnPlatform
  /**
   * How far up the sheet may go while the screen behind stays bright and
   * usable, as Maps does: an index into `detents`, `'all'` for every height,
   * or `'none'` (the default) to dim the screen behind at every height.
   * Above that height the screen behind is dimmed and does not take touches.
   */
  undimmedUpTo?: number | 'all' | 'none'
  /**
   * The sheet came to rest at another height, by a drag. The index is into
   * `detents`. Android may report the same height twice in a row.
   */
  onDetentChanged?: (index: number) => Message
  /**
   * `false`: a swipe down and a tap beside the sheet do not close it.
   * iOS only. Android's sheet always closes on a drag to the bottom and
   * reports `onDismissed`: see CLOSING at the top of this file.
   */
  isDismissable?: boolean
  /**
   * iOS: whether scrolling a list inside the sheet past its top edge drags
   * the sheet (on, unless said). Android always hands the drag over, for a
   * scroll view marked with `sheetScrolls`.
   */
  expandsWhenScrolledToEdge?: boolean
  /**
   * The sheet's background colour, or `'clear'` for none, so that a `glass`
   * panel can be the background. Android's sheet is clear unless given a
   * colour. This is sent as the screen's `style`: a `style(...)` of your own
   * on the same screen replaces it, so put the colour there in that case.
   */
  background?: string | 'clear'
  /** Android: how strong the shadow at the sheet's top edge is. 24 unless said. Read once. */
  elevation?: number
}>

const detentsOf = (options: SheetOptions<unknown>): ReadonlyArray<number> => {
  if (options.detents === 'fit') return FIT_TO_CONTENTS
  const detents = options.detents ?? [1]
  return isAndroid(options.device) ? detents.slice(0, ANDROID_MAX_DETENTS) : detents
}

/** The index react-native-screens wants: -1 dims at every height. */
const undimmedIndex = (options: SheetOptions<unknown>, count: number): number => {
  const upTo = options.undimmedUpTo ?? 'none'
  if (upTo === 'none') return -1
  if (upTo === 'all') return count - 1
  return Math.max(-1, Math.min(count - 1, Math.trunc(upTo)))
}

/**
 * The sheet came to rest at another height. `sheet({ onDetentChanged })` adds
 * this for you. Reports while the sheet is still moving are left out.
 */
export const onDetentChanged = <Message>(toMessage: (index: number) => Message) =>
  OnCustomEvent<Message>({
    name: 'sheetDetentChanged',
    f: event => {
      const detail = event.detail as { index?: unknown; isStable?: unknown } | undefined
      return typeof detail?.index === 'number' && detail.isStable !== false
        ? Option.some(toMessage(detail.index))
        : Option.none()
    },
  })

/**
 * A sheet that slides up from the bottom: `modalScreen([...sheet({ detents:
 * [0.5, 1] }), ...], [...])`. Spread it into the screen's attributes.
 *
 * The first seven values are sent every time, as react-native-screens' own
 * wrapper sends them: two of its defaults differ from the native ones. The
 * rest are only sent when asked for.
 */
export const sheet = <Message = never>(options: SheetOptions<Message> = {}) => {
  const detents = detentsOf(options)
  const last = detents.length - 1
  const attributes = [
    prop('stackPresentation', 'formSheet'),
    prop('sheetAllowedDetents', [...detents]),
    prop('sheetInitialDetent', Math.max(0, Math.min(last, options.initialDetent ?? 0))),
    prop('sheetLargestUndimmedDetent', undimmedIndex(options, detents.length)),
    prop('sheetGrabberVisible', options.hasGrabber ?? false),
    prop('sheetCornerRadius', options.cornerRadius ?? -1),
    prop('sheetExpandsWhenScrolledToEdge', options.expandsWhenScrolledToEdge ?? true),
  ]
  if (options.isDismissable !== undefined) {
    // On iOS this is the sheet's `isModalInPresentation`, the other way round.
    attributes.push(prop('gestureEnabled', options.isDismissable))
  }
  if (options.elevation !== undefined) attributes.push(prop('sheetElevation', options.elevation))
  if (options.background !== undefined) {
    attributes.push(
      prop('style', {
        backgroundColor: options.background === 'clear' ? 'transparent' : options.background,
      }),
    )
  }
  if (options.onDetentChanged !== undefined) {
    attributes.push(onDetentChanged<Message>(options.onDetentChanged) as never)
  }
  return attributes
}

// ---- What goes inside ------------------------------------------------

/** The names `registerNavigation` gives the native views of this file. */
export { SHEET_CONTENT, SHEET_FOOTER } from '../../host/navigation/tags.js'

/** Fills the sheet's screen, above a footer if there is one. */
const CONTENT_STYLE = { flex: 1 } as const

/**
 * Pinned to the top with no bottom edge, so the view is as tall as what is
 * in it. That height is what the phone makes the sheet. These are the styles
 * react-native-screens' own wrapper gives a sheet that fits its content.
 */
const CONTENT_FIT_STYLE = { position: 'absolute', top: 0, left: 0, right: 0 } as const

type PropAttribute = Readonly<{ _tag: 'Prop'; key: string; value: unknown }>

const isStyle = (attribute: unknown): attribute is PropAttribute =>
  typeof attribute === 'object' &&
  attribute !== null &&
  (attribute as { _tag?: unknown })._tag === 'Prop' &&
  (attribute as { key?: unknown }).key === 'style'

/**
 * One `style` from the view's own styles and the caller's, the caller's on
 * top. Two `style` attributes on one element do not add up: the later one
 * replaces the earlier.
 *
 * The two kinds of content view once had their styles as defaults of two
 * element names. Both names were the same native view, and the engine keeps
 * one default per native view, so every sheet's content got the styles meant
 * for `fit`: out of the layout, with no height of its own. A footer after it
 * then sat at the top of the sheet. The styles are sent with the view now.
 */
const withStyle = (
  base: Readonly<Record<string, unknown>>,
  attributes: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> => {
  let style: Record<string, unknown> = { ...base }
  const rest: Array<unknown> = []
  for (const attribute of attributes) {
    if (isStyle(attribute)) style = { ...style, ...(attribute.value as object) }
    else rest.push(attribute)
  }
  return [prop('style', style), ...rest]
}

export type SheetContentOptions = Readonly<{
  /** For `sheet({ detents: 'fit' })`: the sheet is as tall as this view. */
  fit?: boolean
  /**
   * iOS finds a scroll view placed straight in this view, alone or after one
   * title row, and makes it fill the sheet, whatever the layout says. That
   * is right for a sheet that is one long list. `true` here stops it, for a
   * sheet that lays out a list together with other things, such as a bar
   * under it. The children are then put in a view of their own, behind an
   * empty first view, which is where iOS stops looking.
   */
  keepsOwnLayout?: boolean
  /** Anything for the view: a `testID`, a `style`. */
  attributes?: ReadonlyArray<unknown>
}>

/**
 * The view around a sheet's content, a direct child of the sheet's screen.
 * The phone reads its height for `detents: 'fit'`, and on iOS finds the
 * sheet's scroll view through it.
 *
 * For a sheet that is a list under a title, give exactly two children: the
 * title row, with `prop('collapsable', false)`, and the list.
 */
export const sheetContent = (options: SheetContentOptions, children: ReadonlyArray<Html>): Html =>
  el(SHEET_CONTENT)(
    [
      // Never left out of the native tree: the phone looks for this very view.
      prop('collapsable', false),
      ...withStyle(
        options.fit === true ? CONTENT_FIT_STYLE : CONTENT_STYLE,
        options.attributes ?? [],
      ),
    ] as never,
    (options.keepsOwnLayout === true
      ? [
          el('view')(
            [
              prop('collapsable', false),
              prop('style', options.fit === true ? {} : { flex: 1 }),
            ] as never,
            [
              el('view')([prop('collapsable', false), prop('style', { height: 0 })] as never, []),
              ...children,
            ] as never,
          ),
        ]
      : children) as never,
  )

const BOTTOM_EDGE = { top: false, right: false, bottom: true, left: false } as const

/**
 * A bar at the bottom edge of the sheet, for buttons. Put it last among the
 * children of the sheet's screen, after the `sheetContent`.
 *
 * Android: react-native-screens' footer view. The phone keeps it at the
 * bottom of the part of the sheet that shows, at every height and while the
 * sheet is dragged, and lifts it above the keyboard.
 *
 * iOS: react-native-screens has no footer there, and none is needed, because
 * the sheet's view is only as tall as the part that shows. It is a plain
 * view under the content, kept clear of the home indicator. It does not rise
 * with the keyboard: see `sheetComposer` for a bar that does.
 */
export const sheetFooter = (
  device: OnPlatform,
  attributes: ReadonlyArray<unknown>,
  children: ReadonlyArray<Html>,
): Html =>
  isAndroid(device)
    ? el(SHEET_FOOTER)([prop('collapsable', false), ...attributes] as never, children as never)
    : el('view')([prop('collapsable', false), ...attributes] as never, [
        el('screen-safe-area')(
          [prop('edges', BOTTOM_EDGE), prop('style', { flex: 0 })] as never,
          children as never,
        ),
      ])

/**
 * The small bar that says "drag me", drawn as a plain view. iOS draws its
 * own with `hasGrabber`. Android's sheet has none, so this draws one there
 * and nothing on iOS.
 */
export const sheetHandle = (device: OnPlatform, color = '#c4c4c4'): Html =>
  isAndroid(device)
    ? el('view')(
        [prop('style', { alignItems: 'center', paddingTop: 8, paddingBottom: 4 })] as never,
        [
          el('view')(
            [
              prop('style', { width: 36, height: 5, borderRadius: 3, backgroundColor: color }),
            ] as never,
            [],
          ),
        ],
      )
    : el('view')([], [])

/**
 * For a scroll view or a list inside a sheet: `attributes: [...sheetScrolls(),
 * style({ flex: 1 })]`.
 *
 * Android's sheet takes over a drag at the scroll view's top edge only from
 * a scroll view with nested scrolling switched on, which React Native leaves
 * off. iOS needs nothing: there the sheet's own
 * `sheetExpandsWhenScrolledToEdge` does it.
 */
export const sheetScrolls = () => [prop('nestedScrollEnabled', true)]

export type SheetComposer = Readonly<{
  /**
   * How much of the window the keyboard covers, 0 while it is hidden: keep
   * `covers` from `Phone.Keyboard` in the Model. Read on iOS only.
   */
  keyboardHeight: number
  /** The bar: a text field, a Send button. */
  bar: ReadonlyArray<Html>
  /** What is above the bar: the messages. Give a scroll view `style({ flex: 1 })`. */
  above: ReadonlyArray<Html>
  /** The bar's colour. */
  backgroundColor?: string
  /** Anything for the `sheetContent`: a `testID`, a `style`. */
  attributes?: ReadonlyArray<unknown>
}>

/**
 * A sheet's children, for a sheet with a text field at the bottom that must
 * stay above the keyboard: `modalScreen([...sheet(...)], sheetComposer(h,
 * device, {...}))`.
 *
 * The two phones need different things, and this picks:
 *
 * iOS: the sheet runs down behind the keyboard, so the bar is a
 * `keyboardDock` (`../keyboard`), which raises it by the keyboard's height.
 *
 * Android: the bar goes in the sheet's native footer, which the phone itself
 * keeps above the keyboard. The dock is not used there: the sheet also moves
 * for the keyboard by itself, and the two together would raise the bar twice.
 */
export const sheetComposer = <Message>(
  h: HtmlBuilder<Message>,
  device: OnPlatform,
  config: SheetComposer,
): ReadonlyArray<Html> => {
  const background =
    config.backgroundColor === undefined
      ? []
      : [prop('style', { backgroundColor: config.backgroundColor })]
  if (isAndroid(device)) {
    return [
      sheetContent(config.attributes === undefined ? {} : { attributes: config.attributes }, [
        ...config.above,
      ]),
      sheetFooter(device, background, config.bar),
    ]
  }
  return [
    sheetContent(
      {
        // The dock lays the messages out above the bar. iOS must not resize them.
        keepsOwnLayout: true,
        ...(config.attributes === undefined ? {} : { attributes: config.attributes }),
      },
      [
        keyboardDock(h, {
          keyboardHeight: config.keyboardHeight,
          above: config.above,
          children: config.bar,
          ...(config.backgroundColor === undefined
            ? {}
            : { backgroundColor: config.backgroundColor }),
        }),
      ],
    ),
  ]
}

// ---- The detent in the Model -----------------------------------------

/**
 * Where a sheet rests, for the Model.
 *
 *   detent        the height it rests at now, as an index into `detents`
 *   openedAt      the height it was last presented at: `sheet({ initialDetent })`
 *   presentation  counts how often it was presented: part of `sheetKey`
 */
export const SheetPlace = Schema.Struct({
  detent: Schema.Number,
  openedAt: Schema.Number,
  presentation: Schema.Number,
})
export type SheetPlace = typeof SheetPlace.Type

/** A sheet that opens at `detent`. */
export const sheetAt = (detent = 0): SheetPlace => ({ detent, openedAt: detent, presentation: 0 })

/** The user dragged the sheet to another height: from `onDetentChanged`. */
export const sheetMovedByPhone = (place: SheetPlace, detent: number): SheetPlace =>
  detent === place.detent ? place : { ...place, detent }

/**
 * The Model moves the sheet to another height. The phone cannot move an open
 * sheet, so it is presented again there. See the top of this file.
 */
export const moveSheet = (place: SheetPlace, detent: number): SheetPlace =>
  detent === place.detent
    ? place
    : { detent, openedAt: detent, presentation: place.presentation + 1 }

/**
 * Presents the sheet again where it was. For Android, after `onDismissed`
 * reports a sheet the Model wants to keep.
 */
export const presentAgain = (place: SheetPlace): SheetPlace => ({
  detent: place.detent,
  openedAt: place.detent,
  presentation: place.presentation + 1,
})

/** The key for the sheet's screen. It changes when the sheet is presented again. */
export const sheetKey = (name: string, place: SheetPlace): string =>
  `${name}#${place.presentation}`

// ---- Numbers, for finding out on a real phone why a sheet is laid out wrong ----

const PROBE = 'foldkit-sheet-probe:'

/**
 * Marks a view so that `readSheetNumbers` reports its size under `name`:
 * the sheet's screen, its content, a scroll view, a footer. One of the
 * view's attributes. It uses the view's `nativeID`.
 */
export const sheetProbe = (name: string) => prop('nativeID', `${PROBE}${name}`)

export type SheetFrame = Readonly<{ x: number; y: number; width: number; height: number }>

/** What is known about one marked view. A part the phone has not said is null. */
export type SheetNumbers = Readonly<{
  name: string
  /** From the view's layout report: its place in its parent. */
  layout: SheetFrame | null
  /** Measured now: its place in the window. */
  inWindow: SheetFrame | null
  /**
   * A scroll view only, after it was scrolled: the size the native scroll
   * view really has, and the size of what is in it. The two frames above
   * come from the layout the app worked out. This one comes from the view.
   */
  scrolled: Readonly<{ viewport: SheetFrame; content: SheetFrame }> | null
  /** A sheet's screen only: the last height the phone reported, as an index. */
  detent: number | null
}>

type Probe = {
  node: EngineNode
  layout: SheetFrame | null
  scrolled: SheetNumbers['scrolled']
  detent: number | null
  stops: Array<() => void>
}

type Read = () => ReadonlyArray<SheetNumbers>

/** The surface now on screen. An app has one. */
let read: Read | undefined

const probeName = (vnode: VNode): string | undefined => {
  const id = bagOf(vnode, 'props')['nativeID']
  return typeof id === 'string' && id.startsWith(PROBE) ? id.slice(PROBE.length) : undefined
}

const frameOf = (value: unknown): SheetFrame | null => {
  const frame = value as Partial<SheetFrame> | undefined
  return typeof frame?.width === 'number' && typeof frame.height === 'number'
    ? { x: frame.x ?? 0, y: frame.y ?? 0, width: frame.width, height: frame.height }
    : null
}

type Reported = Readonly<{
  nativeEvent?: {
    layout?: unknown
    layoutMeasurement?: unknown
    contentSize?: unknown
    index?: unknown
    isStable?: unknown
  }
}>

const probeModule: ModuleFactory = engine => {
  const probes = new Map<string, Probe>()

  read = () =>
    [...probes.entries()].map(([name, probe]) => {
      let inWindow: SheetFrame | null = null
      try {
        // On a phone the answer comes before `measure` returns.
        engine.measure(probe.node, frame => {
          inWindow = frame
        })
      } catch {
        // No answer is reported as none.
      }
      return { name, layout: probe.layout, inWindow, scrolled: probe.scrolled, detent: probe.detent }
    })

  const create = (_empty: VNode, vnode: VNode): void => {
    const name = probeName(vnode)
    const node = nodeOf(vnode)
    if (name === undefined || node === undefined) return
    for (const stop of probes.get(name)?.stops ?? []) stop()
    const probe: Probe = { node, layout: null, scrolled: null, detent: null, stops: [] }
    probes.set(name, probe)
    probe.stops.push(
      engine.setEventListener(node, 'topLayout', event => {
        probe.layout = frameOf((event as Reported | undefined)?.nativeEvent?.layout) ?? probe.layout
      }),
      engine.setEventListener(node, 'topSheetDetentChanged', event => {
        const native = (event as Reported | undefined)?.nativeEvent
        if (typeof native?.index === 'number' && native.isStable !== false) {
          probe.detent = native.index
        }
      }),
    )
    if (node.tag === 'scroll-view') {
      probe.stops.push(
        engine.setEventListener(node, 'topScroll', event => {
          const native = (event as Reported | undefined)?.nativeEvent
          const viewport = frameOf(native?.layoutMeasurement)
          const content = frameOf(native?.contentSize)
          if (viewport !== null && content !== null) probe.scrolled = { viewport, content }
        }),
      )
    }
  }
  const destroy = (vnode: VNode): void => {
    const name = probeName(vnode)
    if (name === undefined) return
    const probe = probes.get(name)
    // A newer view may have taken the name already.
    if (probe === undefined || probe.node !== nodeOf(vnode)) return
    for (const stop of probe.stops) stop()
    probes.delete(name)
  }
  return { create, destroy }
}

registerModule(probeModule)

/**
 * The sizes of every view marked with `sheetProbe` that is on screen now.
 * For a Command: `Effect.sync(() => readSheetNumbers())`.
 */
export const readSheetNumbers = (): ReadonlyArray<SheetNumbers> => read?.() ?? []

const whole = (frame: SheetFrame | null): string =>
  frame === null
    ? 'not reported'
    : `${Math.round(frame.width)}x${Math.round(frame.height)} at ${Math.round(frame.x)},${Math.round(frame.y)}`

/** One line per marked view, for showing on screen. */
export const formatSheetNumbers = (numbers: ReadonlyArray<SheetNumbers>): ReadonlyArray<string> =>
  numbers.length === 0
    ? ['No marked view on screen.']
    : numbers.map(
        each =>
          `${each.name}: layout ${whole(each.layout)}, in window ${whole(each.inWindow)}` +
          (each.detent === null ? '' : `, detent ${each.detent}`) +
          (each.scrolled === null
            ? ''
            : `, native viewport ${Math.round(each.scrolled.viewport.width)}x` +
              `${Math.round(each.scrolled.viewport.height)}, content height ` +
              `${Math.round(each.scrolled.content.height)}`),
      )
