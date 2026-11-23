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

/** A length in points, or a percentage of the parent such as `'50%'`. */
export type Length = number | `${number}%`

/** A length that may also be left to the layout. */
export type AutoLength = Length | 'auto'

/** A CSS color: a name, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`. */
export type Color = string

type FlexAlign = 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline'

type Transform =
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { scaleX: number }
  | { scaleY: number }
  | { rotate: string }

/** Where a view sits and how big it is. */
export type LayoutStyle = Readonly<{
  display?: 'flex' | 'none'
  position?: 'relative' | 'absolute'
  top?: AutoLength
  right?: AutoLength
  bottom?: AutoLength
  left?: AutoLength
  zIndex?: number

  width?: AutoLength
  height?: AutoLength
  minWidth?: Length
  minHeight?: Length
  maxWidth?: Length
  maxHeight?: Length
  aspectRatio?: number

  flex?: number
  flexGrow?: number
  flexShrink?: number
  flexBasis?: AutoLength
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'wrap' | 'nowrap' | 'wrap-reverse'
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
  alignItems?: FlexAlign
  alignSelf?: FlexAlign | 'auto'
  alignContent?: FlexAlign | 'space-between' | 'space-around'
  gap?: number
  rowGap?: number
  columnGap?: number

  margin?: AutoLength
  marginTop?: AutoLength
  marginRight?: AutoLength
  marginBottom?: AutoLength
  marginLeft?: AutoLength
  marginHorizontal?: AutoLength
  marginVertical?: AutoLength

  padding?: Length
  paddingTop?: Length
  paddingRight?: Length
  paddingBottom?: Length
  paddingLeft?: Length
  paddingHorizontal?: Length
  paddingVertical?: Length

  overflow?: 'visible' | 'hidden' | 'scroll'
}>

/** How a view looks. */
export type LookStyle = Readonly<{
  backgroundColor?: Color
  opacity?: number

  borderWidth?: number
  borderTopWidth?: number
  borderRightWidth?: number
  borderBottomWidth?: number
  borderLeftWidth?: number
  borderColor?: Color
  borderTopColor?: Color
  borderRightColor?: Color
  borderBottomColor?: Color
  borderLeftColor?: Color
  borderStyle?: 'solid' | 'dotted' | 'dashed'
  borderRadius?: number
  borderTopLeftRadius?: number
  borderTopRightRadius?: number
  borderBottomLeftRadius?: number
  borderBottomRightRadius?: number

  shadowColor?: Color
  shadowOffset?: Readonly<{ width: number; height: number }>
  shadowOpacity?: number
  shadowRadius?: number
  /** Android's shadow. */
  elevation?: number

  transform?: ReadonlyArray<Transform>
}>

/** How text looks. Read by `text` and `textInput`. */
export type TextStyle = Readonly<{
  color?: Color
  fontSize?: number
  fontWeight?:
    | 'normal'
    | 'bold'
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900'
  fontStyle?: 'normal' | 'italic'
  fontFamily?: string
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'auto' | 'left' | 'right' | 'center' | 'justify'
  textDecorationLine?: 'none' | 'underline' | 'line-through' | 'underline line-through'
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}>

export type NativeStyle = LayoutStyle & LookStyle & TextStyle

/** A native prop with any kind of value. `h.Attribute` takes only text. */
export const prop = (key: string, value: unknown) => Prop({ key, value })

/** Native styles: `style({ flexDirection: 'row', paddingVertical: 12 })`. */
export const style = (value: NativeStyle) => prop('style', value)

/**
 * Styles laid over `style` while a finger is down on the view. Only has an
 * effect on a view that also has `onPress`.
 */
export const pressedStyle = (value: NativeStyle) => prop('pressedStyle', value)

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
