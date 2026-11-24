/**
 * Attributes for native elements.
 *
 * Foldkit's own attributes (`h.Class`, `h.Style`, `h.OnClick`) were written
 * for web pages. These are the native ones. They are plain functions, so a
 * view needs no `h` to use them:
 *
 *   view(
 *     [style({ padding: 16 }), pressedStyle({ opacity: 0.6 }), onPress(PressedSave())],
 *     [text([], ['Save'])],
 *   )
 *
 * `style` is typed: a misspelled name or a wrong kind of value is a compile
 * error. The names and values are React Native's.
 */
import { Option } from 'effect'
import { OnCustomEvent, Prop } from 'foldkit/renderTarget'

import { type NativeStyle, PRESSED_STYLE } from '../host/style.js'

export type {
  AutoLength,
  Color,
  LayoutStyle,
  Length,
  LookStyle,
  NativeStyle,
  TextStyle,
} from '../host/style.js'

/** A native prop with any kind of value. `h.Attribute` takes only text. */
export const prop = (key: string, value: unknown) => Prop({ key, value })

/** Native styles: `style({ flexDirection: 'row', paddingVertical: 12 })`. */
export const style = (value: NativeStyle) => prop('style', value)

/**
 * Styles laid over `style` while a finger is down on the view. Only has an
 * effect on a view that also has `onPress`.
 */
export const pressedStyle = (value: NativeStyle) => prop(PRESSED_STYLE, value)

/**
 * A press: a touch that starts on the view and ends there. It is called off
 * if the finger drifts away or a scroll starts.
 */
export const onPress = <Message>(message: Message) =>
  OnCustomEvent<Message>({ name: 'click', f: () => Option.some(message) })

/** A name tests and accessibility tools can find the view by. */
export const testId = (value: string) => prop('testID', value)

/** What a screen reader says for the view. */
export const accessibilityLabel = (value: string) => prop('accessibilityLabel', value)

/** The grey hint shown in an empty text field. */
export const placeholder = (value: string) => prop('placeholder', value)

/** A text field's text, from the Model. Pair it with `h.OnInput`. */
export const value = (text: string) => prop('value', text)
