/**
 * The element vocabulary, as data: the tag of each basic element, and the
 * props an element of that kind always carries. A view library's binding
 * turns these into its own element builders (`src/foldkit/elements.ts`).
 *
 * ng-native's engine knows these tags already: `registerPlatformComponents`
 * names their native views. Other features name their own tags with
 * `registerViewName` (see `navigation/views.ts`).
 */
export const ELEMENTS = {
  /** A box. `UIView` on iOS, `android.view.View` on Android. */
  view: 'view',
  /** Text. Words must sit inside one of these. */
  text: 'text',
  /** A box that scrolls. It scrolls one content view: see `SCROLL_CONTENT_PROPS`. */
  scrollView: 'scroll-view',
  /** A picture. */
  image: 'image',
  /** A text field. Its text is kept in step by `fabric/nodes.ts`. */
  textInput: 'text-input',
} as const

export type ElementName = keyof typeof ELEMENTS

/**
 * A vertical scroll view bounces when its content is shorter than itself, as
 * it does in other apps.
 */
export const SCROLL_VIEW_PROPS: Readonly<Record<string, unknown>> = { alwaysBounceVertical: true }

/**
 * The native scroll view scrolls one content view, so children go inside one,
 * as React Native's own ScrollView does. `collapsable: false` keeps that view
 * from being optimised away.
 */
export const SCROLL_CONTENT_PROPS: Readonly<Record<string, unknown>> = { collapsable: false }
