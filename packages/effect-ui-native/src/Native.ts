/**
 * The native element vocabulary for Effect UI: the phone's views on `h`,
 * with typed styles, typed props and typed event payloads.
 *
 *   const Counter = Native.component({ name: 'Counter', model, message }).make({
 *     init: () => ({ count: 0 }),
 *     update: { PressedAdd: $ => $.evolve({ count: n => n + 1 }) },
 *     view: (h, model) =>
 *       h.view.style({ padding: 16 }).children(
 *         h.text(String(model.count)),
 *         h.pressable.pressedStyle({ opacity: 0.6 }).on('press', Message.PressedAdd()).children(h.text('Add')),
 *       ),
 *   })
 *
 * Words must sit inside `h.text(...)`. A box (`h.view`, `h.pressable`,
 * `h.scrollView`, a screen) refuses a bare string, when the code is checked
 * and again when it runs.
 *
 * The core six: `view`, `text`, `pressable`, `scrollView`, `textInput`,
 * `image`. Navigation: `stack`, `screen`, `modalScreen`, `header`,
 * `headerItem`, `safeArea`, `sheetContent`. More native views are in
 * `NativeViews.ts`. Any other native view an app registered with
 * `registerViewName` is `h.el('its-tag')`.
 */
import * as Component from '@effect/ui/Component'
import type * as Mount from '@effect/ui/Mount'
import * as Renderer from '@effect/ui/Renderer'
import * as View from '@effect/ui/View'
import type { Engine, EngineNode } from '@ng-native/fabric'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as Scope from 'effect/Scope'

import type { LayoutStyle, LookStyle, NativeStyle, TextStyle as HostTextStyle } from '../../native/src/host/style.js'
import { PRESSED_STYLE } from '../../native/src/host/style.js'
import type { LayoutPayload, ScrollPayload, TextPayload } from './internal/events.js'
import type { PressPayload } from './internal/touch.js'

export type { LayoutPayload, PressPayload, ScrollPayload, TextPayload }

/** The node behind an element: an ng-native engine node. A Mount and a ref get one. */
export type Node = EngineNode

/** Where a view is in the window, in points. */
export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Where to scroll a scroll view to. */
export interface ScrollTarget {
  readonly x?: number
  readonly y?: number
  readonly animated?: boolean
}

/**
 * The native host's marker, and what Commands and Mounts do with a node.
 * Provided by `NativeHost.mount`. A Command or a Mount that uses it adds no
 * requirement to its component.
 */
export class Host extends Context.Service<
  Host,
  {
    readonly engine: Engine
    /** Queues work for after the next draw has reached the phone. */
    readonly afterCommit: (job: () => void) => void
    /** Where the view is in the window, or undefined if the phone has not laid it out. */
    readonly measure: (node: Node) => Effect.Effect<Rect | undefined>
    readonly focus: (node: Node) => void
    /** Puts the keyboard away. */
    readonly blur: () => void
    readonly scrollTo: (node: Node, to: ScrollTarget) => void
    readonly scrollToEnd: (node: Node, animated?: boolean) => void
    /** The view's number on the phone, for native gesture and animation modules. */
    readonly tagOf: (node: Node) => number | null
    /** Counters: commits, elements, listeners, presses. */
    readonly stats: Readonly<Record<string, number>>
    /**
     * EXPERIMENT (way B, see `experimental/SlotList.ts`). Mounts a second,
     * separate component tree inside a node of this host.
     */
    readonly mountRoot: (
      component: Component.Any,
      props: unknown,
      container: Node,
    ) => Effect.Effect<Renderer.Root<unknown, unknown>, never, Scope.Scope>
    /**
     * EXPERIMENT. Holds engine commits back until the returned function is
     * called, which then commits once. For several trees that draw in one turn.
     */
    readonly holdCommits: () => () => void
  }
>()('effect-ui-native/Native/Host') {}

declare module '@effect/ui/Command' {
  interface FrameworkServices {
    readonly NativeHost: Host
  }
}

// STYLES AND PROPS

export type ViewStyle = LayoutStyle & LookStyle
export type TextStyle = NativeStyle
export type { HostTextStyle as FontStyle }

/** Props every view takes. */
export interface ViewProps {
  /** A name tests and accessibility tools can find the view by. */
  readonly testID?: string | undefined
  readonly nativeID?: string | undefined
  /** What a screen reader says for the view. */
  readonly accessibilityLabel?: string | undefined
  readonly accessibilityRole?: string | undefined
  readonly accessible?: boolean | undefined
  /** `none`: touches pass through. `box-none`: only its children take touches. */
  readonly pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only' | undefined
  /** `false` keeps a native view for a box that has nothing to draw. */
  readonly collapsable?: boolean | undefined
  readonly hitSlop?: number | Readonly<{ top?: number; right?: number; bottom?: number; left?: number }> | undefined
}

export interface TextProps extends ViewProps {
  readonly numberOfLines?: number | undefined
  readonly ellipsizeMode?: 'head' | 'middle' | 'tail' | 'clip' | undefined
  readonly selectable?: boolean | undefined
  readonly allowFontScaling?: boolean | undefined
}

export interface ScrollViewProps extends ViewProps {
  readonly horizontal?: boolean | undefined
  readonly scrollEnabled?: boolean | undefined
  readonly bounces?: boolean | undefined
  readonly alwaysBounceVertical?: boolean | undefined
  readonly showsVerticalScrollIndicator?: boolean | undefined
  readonly showsHorizontalScrollIndicator?: boolean | undefined
  /** At most one scroll event per this many milliseconds. 16 is one per frame at 60 a second. */
  readonly scrollEventThrottle?: number | undefined
  readonly keyboardDismissMode?: 'none' | 'on-drag' | 'interactive' | undefined
  readonly keyboardShouldPersistTaps?: 'always' | 'never' | 'handled' | undefined
  readonly contentInset?: Readonly<{ top?: number; right?: number; bottom?: number; left?: number }> | undefined
  readonly contentInsetAdjustmentBehavior?: 'automatic' | 'scrollableAxes' | 'never' | 'always' | undefined
  readonly automaticallyAdjustKeyboardInsets?: boolean | undefined
  /** Styles for the content view the scroll view scrolls. */
  readonly contentStyle?: ViewStyle | undefined
}

export interface TextInputProps extends ViewProps {
  readonly placeholder?: string | undefined
  readonly placeholderTextColor?: string | undefined
  readonly multiline?: boolean | undefined
  readonly editable?: boolean | undefined
  readonly autoFocus?: boolean | undefined
  readonly autoCorrect?: boolean | undefined
  readonly autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters' | undefined
  readonly keyboardType?: 'default' | 'number-pad' | 'decimal-pad' | 'numeric' | 'email-address' | 'phone-pad' | 'url' | undefined
  readonly returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send' | 'default' | undefined
  readonly secureTextEntry?: boolean | undefined
  readonly submitBehavior?: 'submit' | 'blurAndSubmit' | 'newline' | undefined
  readonly selectionColor?: string | undefined
}

export interface ImageProps extends ViewProps {
  /** `{ uri }`, or what `require('./picture.png')` gives. */
  readonly source?: Readonly<{ uri: string; width?: number; height?: number }> | number | undefined
  readonly resizeMode?: 'cover' | 'contain' | 'stretch' | 'center' | undefined
}

/** How a screen arrives. The names are react-native-screens' own. */
export type Presentation = 'push' | 'modal' | 'fullScreenModal' | 'transparentModal' | 'pageSheet' | 'formSheet'

export interface ScreenProps extends ViewProps {
  /** Set it when the screen is made and leave it. Only on `modalScreen`. */
  readonly stackPresentation?: Presentation | undefined
  readonly stackAnimation?: 'default' | 'fade' | 'none' | 'slide_from_bottom' | 'slide_from_right' | undefined
  readonly gestureEnabled?: boolean | undefined
  /** With `nativeBackButtonDismissalEnabled: false`, the phone asks instead of closing. */
  readonly preventNativeDismiss?: boolean | undefined
  readonly nativeBackButtonDismissalEnabled?: boolean | undefined
  /** A sheet's heights, as fractions of the screen: `[0.4, 1]`. `[-1]` fits the content. */
  readonly sheetAllowedDetents?: ReadonlyArray<number> | undefined
  readonly sheetGrabberVisible?: boolean | undefined
  readonly sheetCornerRadius?: number | undefined
  readonly sheetLargestUndimmedDetent?: number | undefined
  readonly sheetExpandsWhenScrolledToEdge?: boolean | undefined
  readonly sheetInitialDetent?: number | undefined
  readonly sheetElevation?: number | undefined
}

export interface HeaderProps extends ViewProps {
  readonly title?: string | undefined
  /** A large title under the bar, as in the iPhone's Settings. iOS only. */
  readonly largeTitle?: boolean | undefined
  /** Hides the whole bar. The screen keeps its swipe-back. */
  readonly hidden?: boolean | undefined
  readonly backTitle?: string | undefined
  readonly hideBackButton?: boolean | undefined
  readonly translucent?: boolean | undefined
  readonly color?: string | undefined
  readonly backgroundColor?: string | undefined
}

export interface HeaderItemProps extends ViewProps {
  /** Which of the bar's slots the view goes in. */
  readonly type?: 'left' | 'center' | 'right' | 'back' | 'searchBar' | undefined
}

export interface SafeAreaProps extends ViewProps {
  /** Which edges are kept clear of the notch, the bars and the home indicator. */
  readonly edges?: Readonly<{ top: boolean; right: boolean; bottom: boolean; left: boolean }> | undefined
}

/** What each tag's `.style(...)` and `.set(...)` take. */
export interface TagOptions {
  readonly view: { readonly style: ViewStyle; readonly props: ViewProps }
  readonly pressable: { readonly style: ViewStyle; readonly props: ViewProps }
  readonly text: { readonly style: TextStyle; readonly props: TextProps }
  readonly scrollView: { readonly style: ViewStyle; readonly props: ScrollViewProps }
  readonly textInput: { readonly style: TextStyle; readonly props: TextInputProps }
  readonly image: { readonly style: ViewStyle; readonly props: ImageProps }
  readonly stack: { readonly style: ViewStyle; readonly props: ViewProps }
  readonly screen: { readonly style: ViewStyle; readonly props: ScreenProps }
  readonly modalScreen: { readonly style: ViewStyle; readonly props: ScreenProps }
  readonly header: { readonly style: ViewStyle; readonly props: HeaderProps }
  readonly headerItem: { readonly style: ViewStyle; readonly props: HeaderItemProps }
  readonly safeArea: { readonly style: ViewStyle; readonly props: SafeAreaProps }
  readonly sheetContent: { readonly style: ViewStyle; readonly props: ViewProps }
}

// EVENTS

/** Events every view has. */
export interface Events {
  /** A touch that started on the view and ended there without drifting away. */
  readonly press: PressPayload
  /** A finger rested on the view for half a second. The lift after it is not a press. */
  readonly longPress: PressPayload
  /** The phone laid the view out, or its size or place changed. */
  readonly layout: LayoutPayload
}

export interface ScrollEvents extends Events {
  /** The scroll view moved. At most one per frame. */
  readonly scroll: ScrollPayload
  readonly scrollBeginDrag: ScrollPayload
  readonly scrollEndDrag: ScrollPayload
  readonly momentumScrollEnd: ScrollPayload
  /** It came to rest: the glide ended, or the finger lifted with no glide. */
  readonly scrollEnd: ScrollPayload
}

export interface TextInputEvents {
  readonly changeText: TextPayload
  /** Return was pressed. */
  readonly submit: TextPayload
  readonly focus: {}
  readonly blur: {}
  readonly layout: LayoutPayload
}

export interface ScreenEvents extends Events {
  /** The phone closed screens by itself (a swipe back, the back button): drop the same from the Model. */
  readonly dismissed: { readonly dismissCount?: number }
  readonly appear: {}
  readonly disappear: {}
  readonly willAppear: {}
  readonly willDisappear: {}
  /** The phone tried to close the screen and `preventNativeDismiss` refused. */
  readonly nativeDismissCancelled: { readonly dismissCount?: number }
  readonly headerBackButtonClicked: {}
  /** A sheet came to rest at one of its heights. */
  readonly sheetDetentChanged: { readonly index: number; readonly isStable: boolean }
}

export type EventsOf<K extends string> = K extends 'scrollView'
  ? ScrollEvents
  : K extends 'textInput'
    ? TextInputEvents
    : K extends 'screen' | 'modalScreen'
      ? ScreenEvents
      : Events

// BUILDERS

type AnyOptions = { readonly style: object; readonly props: object }

const mergeProps = <B extends View.ElementBuilder<any, any, any, any>>(
  builder: B,
  options: Readonly<Record<string, unknown>>,
): B => {
  let next: Record<string, unknown> | undefined
  for (const key in options) {
    if (!Object.hasOwn(options, key)) continue
    const value = options[key]
    next ??= { ...builder.props }
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next === undefined ? builder : View.withFields(builder, { props: next })
}

/** A native element that takes no children: `textInput`, `image`. */
export class VoidElement<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  out Tag extends string = string,
  in O extends AnyOptions = AnyOptions,
> extends View.ElementBuilder<Msg, R, E, Node, Tag> {
  override onMount<R2>(mount: Mount.Issued<Msg | Component.Noop, R2, Node, never>): VoidElement<Msg, R | R2, E, Tag, O>
  override onMount(mount: Mount.Issued<Msg | Component.Noop | View.MountHint, any, Node, never>): never
  override onMount(mount: View.Mount<Msg>): any {
    return (super.onMount as any)(mount)
  }

  /** React Native's style names and values. A later call adds to an earlier one. */
  style(style: O['style']): this {
    return this.prop('style', { ...(this.props['style'] as object | undefined), ...style })
  }

  /** Styles laid over `style` while a finger is down. For a view that listens for `press`. No Message is sent. */
  pressedStyle(style: O['style']): this {
    return this.prop(PRESSED_STYLE, style)
  }

  /** Native props, by their React Native names. `undefined` takes one away. */
  set(props: O['props']): this {
    return mergeProps(this, props as Readonly<Record<string, unknown>>)
  }

  /** A name tests and accessibility tools can find the view by. */
  testId(id: string): this {
    return this.prop('testID', id)
  }

  /** A text field's text, from the Model. The phone owns it while the user types. */
  value(this: VoidElement<Msg, R, E, 'textInput', O>, text: string): this {
    return this.prop('value', text) as any
  }

  /** The grey hint in an empty text field. */
  placeholder(this: VoidElement<Msg, R, E, 'textInput', O>, text: string): this {
    return this.prop('placeholder', text) as any
  }
}

/** Content a box may hold: elements and child components, never bare text. */
export type NoTextContent<Msg, R = never> =
  | View.Element<Msg, R>
  | View.Child<Msg, R>
  | View.Outlet
  | View.ElementBuilder<Msg, R, any, any>

export type NoTextChildren<Msg, R = any> = ReadonlyArray<NoTextContent<Msg, R> | false | null | undefined>

export type NoTextInput<Msg, R = never> = NoTextContent<Msg, R> | false | null | undefined | NoTextChildren<Msg, R>

/** A box: `view`, `pressable`, `scrollView`, a screen. Refuses bare text. */
export class LayoutElement<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  out Tag extends string = string,
  in O extends AnyOptions = AnyOptions,
> extends VoidElement<Msg, R, E, Tag, O> {
  override onMount<R2>(mount: Mount.Issued<Msg | Component.Noop, R2, Node, never>): LayoutElement<Msg, R | R2, E, Tag, O>
  override onMount(mount: Mount.Issued<Msg | Component.Noop | View.MountHint, any, Node, never>): never
  override onMount(mount: View.Mount<Msg>): any {
    return (super.onMount as any)(mount)
  }

  children<const C extends ReadonlyArray<NoTextInput<Msg, any>>>(
    ...inputs: C
  ): LayoutElement<Msg, R | View.Requirements<C[number]>, E, Tag, O> {
    return View.withNoTextContent(this, inputs as ReadonlyArray<View.Input<Msg, any>>, vocabulary) as any
  }
}

/** Text. Holds words and other `text` elements (for bold or coloured runs). */
export class TextElement<
  out Msg,
  out R = never,
  in out E = Record<string, unknown>,
  out Tag extends string = string,
  in O extends AnyOptions = AnyOptions,
> extends VoidElement<Msg, R, E, Tag, O> {
  override onMount<R2>(mount: Mount.Issued<Msg | Component.Noop, R2, Node, never>): TextElement<Msg, R | R2, E, Tag, O>
  override onMount(mount: Mount.Issued<Msg | Component.Noop | View.MountHint, any, Node, never>): never
  override onMount(mount: View.Mount<Msg>): any {
    return (super.onMount as any)(mount)
  }

  children<const C extends ReadonlyArray<View.Input<Msg, any>>>(
    ...inputs: C
  ): TextElement<Msg, R | View.Requirements<C[number]>, E, Tag, O> {
    return View.withContent(this, inputs) as any
  }
}

// THE VOCABULARY

export const layoutTags = [
  'view',
  'pressable',
  'scrollView',
  'stack',
  'screen',
  'modalScreen',
  'header',
  'headerItem',
  'safeArea',
  'sheetContent',
] as const
export const textParents = ['text'] as const
export const voidTags = ['textInput', 'image'] as const

export type LayoutTag = (typeof layoutTags)[number]
export type TextParentTag = (typeof textParents)[number]
export type VoidTag = (typeof voidTags)[number]
export type TagName = LayoutTag | TextParentTag | VoidTag

/** The element builders the native vocabulary adds to `h`. */
export type Tags<Msg> = {
  readonly [K in LayoutTag]: View.Shorthand<LayoutElement<Msg, never, EventsOf<K>, K, TagOptions[K]>>
} & {
  readonly [K in TextParentTag]: View.Shorthand<TextElement<Msg, never, EventsOf<K>, K, TagOptions[K]>>
} & {
  readonly [K in VoidTag]: VoidElement<Msg, never, EventsOf<K>, K, TagOptions[K]>
}

/** The type-level native vocabulary. */
export interface Elements extends View.Elements {
  readonly Tags: Tags<this['Msg']>
  readonly Host: Host
}

/** `h` for a view function that is not a component: `(h: Native.H<Msg>) => ...`. */
export type H<Msg> = View.WithTags<Msg, unknown, Elements>

export const Elements: Elements | undefined = undefined

/** The vocabulary's name, which a host lists in `elements`. */
export const name = 'native'

const makeTags = (): Readonly<Record<string, VoidElement<any, any, any, any, any>>> => {
  const out: Record<string, VoidElement<any, any, any, any, any>> = {}
  for (const tag of layoutTags) out[tag] = View.shorthand(new LayoutElement(tag))
  for (const tag of textParents) out[tag] = View.shorthand(new TextElement(tag))
  for (const tag of voidTags) out[tag] = new VoidElement(tag)
  return out
}

export const tags: Readonly<Record<string, VoidElement<any, any, any, any, any>>> = makeTags()

export const vocabulary: View.Vocabulary<Elements> = { name, tags, textParents }

/** Defines a component that draws native elements. */
export const component: Component.Define<Elements> = options =>
  Component.define({ ...options, elements: vocabulary }) as any

/** Declares a ref to a native element, for `NativeCommand` (focus, scroll, measure). */
export const ref = (refName: string): Renderer.Ref<Node> => Renderer.ref<Node>(refName)

/**
 * Which edges a screen's content keeps clear. On iOS a screen runs under its
 * navigation bar, so the top is inset there. On Android a screen with a bar
 * already starts below it.
 */
export const safeAreaEdges = (
  platform: string,
  options: Readonly<{ hasHeader: boolean }>,
): Readonly<{ top: boolean; right: boolean; bottom: boolean; left: boolean }> => ({
  top: !(options.hasHeader && platform === 'android'),
  right: true,
  bottom: true,
  left: true,
})
