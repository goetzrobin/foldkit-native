/**
 * Native styles as types: React Native's style names and the kinds of value
 * each takes, so a misspelled name or a wrong kind of value is a compile
 * error. Also the names of the props the adapter reads itself.
 */
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

/** Read by the press handling (`fabric/nodes.ts`). Not a native prop. */
export const PRESSED_STYLE = 'pressedStyle'
