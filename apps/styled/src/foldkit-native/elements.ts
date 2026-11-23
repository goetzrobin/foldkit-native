/**
 * The native elements a view can use. Each is a Foldkit element builder with
 * a native tag, so attributes and children work as they do for `h.div`.
 *
 *   view([h.Class('row')], [text([], ['Hello'])])
 */
import { Prop, element } from 'foldkit/renderTarget'

const el = element<any>()

/** A box. `UIView` on iOS, `android.view.View` on Android. */
export const view = el('view')
/** Text. Words must sit inside one of these. */
export const text = el('text')
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
  el('scroll-view')(
    [Prop({ key: 'alwaysBounceVertical', value: true }), ...attributes] as never,
    [el('view')([Prop({ key: 'collapsable', value: false })] as never, children as never)],
  )
/** A picture. */
export const image = el('image')
/** A text field. Bind it with `h.Attribute('value', text)` and `h.OnInput`. */
export const textInput = el('text-input')
