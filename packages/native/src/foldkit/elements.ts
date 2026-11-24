/**
 * The native elements a view can use. Each is a Foldkit element builder with
 * a native tag, so attributes and children work as they do for `h.div`.
 *
 *   view([h.Class('row')], [text([], ['Hello'])])
 */
import { Prop, element } from 'foldkit/renderTarget'

import { ELEMENTS, SCROLL_CONTENT_PROPS, SCROLL_VIEW_PROPS } from '../host/elements.js'

const el = element<any>()

const propsOf = (props: Readonly<Record<string, unknown>>) =>
  Object.entries(props).map(([key, value]) => Prop({ key, value }))

/** A box. `UIView` on iOS, `android.view.View` on Android. */
export const view = el(ELEMENTS.view)
/** A box meant to be pressed. The same view as `view`: the name is for the reader. */
export const pressable = el(ELEMENTS.view)
/** Text. Words must sit inside one of these. */
export const text = el(ELEMENTS.text)
/**
 * A box that scrolls.
 *
 * The native scroll view scrolls one content view, so the children are put
 * inside one, as React Native's own ScrollView does. `collapsable: false`
 * keeps that view from being optimised away. A vertical scroll view also
 * bounces when its content is shorter than itself, as it does in other apps.
 */
export const scrollView = (
  attributes: ReadonlyArray<any>,
  children: ReadonlyArray<any>,
) =>
  el(ELEMENTS.scrollView)(
    [...propsOf(SCROLL_VIEW_PROPS), ...attributes] as never,
    [el(ELEMENTS.view)(propsOf(SCROLL_CONTENT_PROPS) as never, children as never)],
  )
/** A picture. */
export const image = el(ELEMENTS.image)
/** A text field. Bind it with `h.Attribute('value', text)` and `h.OnInput`. */
export const textInput = el(ELEMENTS.textInput)
