/**
 * How the Snake screen looks: an old handset with a small green screen and a
 * number keypad. The design is our own. It is the same in light and dark
 * mode, because it is a picture of a device and not a page.
 *
 * Everything is drawn with plain views. The digits of the score are small
 * grids of squares, so no font file is needed. Plain views have no colour
 * that fades into another, so the shell and the keys get a lighter line on
 * top and a darker one below.
 */
import type { Native } from '../../src/index.js'
import { GRID_SIZE } from './domain/position.js'

/** Behind the handset. */
export const BACKDROP = '#17181A'
/** The handset's shell: graphite, a little lighter at the top edge and darker at the bottom. */
export const SHELL = '#3B4046'
export const SHELL_LIFT = '#4A5057'
export const SHELL_EDGE = '#2C3035'
/** The dark frame around the screen. */
export const BEZEL = '#1F2225'
/** The screen with no pixel on. */
export const LCD = '#B9C651'
/** A pixel that is off: the pixel colour at 7 in 100 over the screen, so the grid shows faintly. */
export const LCD_OFF = '#AFBC4D'
/** A pixel that is on: dark olive. */
export const LCD_ON = '#2E3812'
export const KEY = '#555C64'
export const KEY_TOP = '#626A73'
export const KEY_TEXT = '#E8EBE6'
export const KEY_MARK = '#A9B0B5'
export const ENGRAVED = '#6D7379'
export const NUMBERS_TEXT = '#8A8F94'

/** What a cell of the board shows. One letter per cell in a row's text. */
export const CELL_OFF = '0'
export const CELL_SNAKE = '1'
export const CELL_APPLE = '2'

const OUTER = 8
const SHELL_SIDE = 14
const SHELL_TOP = 14
const SHELL_BOTTOM = 18
const EAR_HEIGHT = 5
const EAR_GAP = 12
const BEZEL_PAD = 10
const LCD_PAD = 8
/** The border of the play field and the gap inside it, both sides. */
const FIELD_EDGE = 8
const STRIP_HEIGHT = 20
const STRIP_GAP = 6
/** The engraved words under the screen, with the room above and below them. */
const LABEL_HEIGHT = 30
export const KEY_GAP = 10
const KEY_MIN = 38
const KEY_MAX = 54
/** The line of numbers under the handset. */
export const NUMBERS_HEIGHT = 30
/** A digit is three squares wide and five high. */
export const DIGIT_COLUMNS = 3
export const DIGIT_ROWS = 5

export type Space = Readonly<{ width: number; height: number }>

/** Used until the phone has said how much room there is. A small phone under its title bar. */
export const FIRST_SPACE: Space = { width: 375, height: 603 }

export type Sizes = Readonly<{
  /** One cell of the board, in points. A whole number, so every pixel is the same size. */
  cell: number
  /** The play field with its border. */
  field: number
  keyHeight: number
}>

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value))

/**
 * Sizes for the room the phone gives. The board is as wide as the handset
 * allows, and smaller when the phone is short, so the keypad always fits.
 */
export const sizesFor = (space: Space): Sizes => {
  const sides = 2 * (OUTER + SHELL_SIDE + BEZEL_PAD + LCD_PAD) + FIELD_EDGE
  const aroundBoard =
    NUMBERS_HEIGHT + OUTER + SHELL_TOP + SHELL_BOTTOM + EAR_HEIGHT + EAR_GAP + 2 * (BEZEL_PAD + LCD_PAD) +
    STRIP_HEIGHT + STRIP_GAP + FIELD_EDGE + LABEL_HEIGHT + 3 * KEY_GAP
  const widest = space.width - sides
  const tallest = space.height - aroundBoard - 4 * KEY_MIN
  const cell = clamp(Math.floor(Math.min(widest, tallest) / GRID_SIZE), 5, 22)
  const left = space.height - aroundBoard - cell * GRID_SIZE
  return {
    cell,
    field: cell * GRID_SIZE + FIELD_EDGE,
    keyHeight: clamp(Math.floor(left / 4), KEY_MIN, KEY_MAX),
  }
}

export const backdrop: Native.ViewStyle = { flex: 1, backgroundColor: BACKDROP, padding: OUTER, paddingBottom: 0 }

export const shell: Native.ViewStyle = {
  flex: 1,
  backgroundColor: SHELL,
  borderTopLeftRadius: 44,
  borderTopRightRadius: 44,
  borderBottomLeftRadius: 56,
  borderBottomRightRadius: 56,
  borderTopWidth: 1,
  borderTopColor: SHELL_LIFT,
  borderBottomWidth: 2,
  borderBottomColor: SHELL_EDGE,
  paddingHorizontal: SHELL_SIDE,
  paddingTop: SHELL_TOP,
  paddingBottom: SHELL_BOTTOM,
  justifyContent: 'space-between',
}

/** The small slit at the top, where the earpiece would be. */
export const ear: Native.ViewStyle = {
  alignSelf: 'center',
  width: 54,
  height: EAR_HEIGHT,
  borderRadius: 3,
  backgroundColor: SHELL_EDGE,
  marginBottom: EAR_GAP,
}

export const bezel: Native.ViewStyle = {
  alignSelf: 'center',
  backgroundColor: BEZEL,
  borderRadius: 16,
  padding: BEZEL_PAD,
}

export const lcd: Native.ViewStyle = { backgroundColor: LCD, borderRadius: 6, padding: LCD_PAD }

export const strip: Native.ViewStyle = {
  height: STRIP_HEIGHT,
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  marginBottom: STRIP_GAP,
}

export const scoreGroup: Native.ViewStyle = { flexDirection: 'row', alignItems: 'flex-end' }

export const field = (sizes: Sizes): Native.ViewStyle => ({
  width: sizes.field,
  height: sizes.field,
  borderWidth: 2,
  borderColor: LCD_ON,
  padding: 2,
})

/** Lies over the play field and holds the box with the words. Touches pass through it. */
export const bannerLayer: Native.ViewStyle = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  alignItems: 'center',
  justifyContent: 'center',
}
export const bannerBox: Native.ViewStyle = {
  backgroundColor: LCD,
  borderWidth: 2,
  borderColor: LCD_ON,
  paddingVertical: 6,
  paddingHorizontal: 8,
}
export const bannerText: Native.TextStyle = { fontSize: 13, fontWeight: '700', letterSpacing: 2, color: LCD_ON }

export const engraved: Native.TextStyle = {
  height: LABEL_HEIGHT,
  lineHeight: LABEL_HEIGHT,
  fontSize: 9,
  fontWeight: '600',
  letterSpacing: 2.5,
  color: ENGRAVED,
  textAlign: 'center',
}

export type CellStyles = Readonly<{
  row: Native.ViewStyle
  [CELL_OFF]: Native.ViewStyle
  [CELL_SNAKE]: Native.ViewStyle
  [CELL_APPLE]: Native.ViewStyle
}>

const squareStyles = new Map<number, CellStyles>()

/**
 * The styles of a row and of the three kinds of cell, for one cell size.
 * The same objects are given every time. A cell that did not change then
 * has the very same style as before, and Effect UI does no work for it.
 *
 * A pixel is half a point smaller than its cell on every side: that is the
 * thin line between pixels. The apple is a round dot, a little smaller than
 * a pixel, so it does not look like a piece of the snake.
 */
export const cellStyles = (size: number): CellStyles => {
  const known = squareStyles.get(size)
  if (known !== undefined) return known
  const square: Native.ViewStyle = { width: size - 1, height: size - 1, margin: 0.5 }
  const made: CellStyles = {
    row: { flexDirection: 'row' },
    [CELL_OFF]: { ...square, backgroundColor: LCD_OFF },
    [CELL_SNAKE]: { ...square, backgroundColor: LCD_ON },
    [CELL_APPLE]: { width: size - 2, height: size - 2, margin: 1, borderRadius: (size - 2) / 2, backgroundColor: LCD_ON },
  }
  squareStyles.set(size, made)
  return made
}

/** The ten digits, each five rows of three squares. `#` is on. */
export const DIGITS: ReadonlyArray<ReadonlyArray<string>> = [
  ['###', '#.#', '#.#', '#.#', '###'],
  ['.#.', '##.', '.#.', '.#.', '###'],
  ['###', '..#', '###', '#..', '###'],
  ['###', '..#', '###', '..#', '###'],
  ['#.#', '#.#', '###', '..#', '..#'],
  ['###', '#..', '###', '..#', '###'],
  ['###', '#..', '###', '#.#', '###'],
  ['###', '..#', '.#.', '.#.', '.#.'],
  ['###', '#.#', '###', '#.#', '###'],
  ['###', '#.#', '###', '..#', '###'],
]

/** A small crown, five squares wide and two high. It marks the high score. */
export const CROWN: ReadonlyArray<string> = ['#.#.#', '#####']

export type DotStyles = Readonly<{ digit: Native.ViewStyle; row: Native.ViewStyle; on: Native.ViewStyle; off: Native.ViewStyle }>

/** One square of a digit, in points, with the thin line around it. */
export const DOT = 4

const dotSquare: Native.ViewStyle = { width: DOT - 1, height: DOT - 1, margin: 0.5 }
export const dots: DotStyles = {
  digit: { marginLeft: 3 },
  row: { flexDirection: 'row' },
  on: { ...dotSquare, backgroundColor: LCD_ON },
  off: { ...dotSquare, backgroundColor: LCD_OFF },
}
/** The squares of the crown that are off show nothing at all. */
export const crownOff: Native.ViewStyle = dotSquare
export const crown: Native.ViewStyle = { marginRight: 4 }

export const keypad: Native.ViewStyle = { gap: KEY_GAP, paddingHorizontal: 6 }
export const keyRow: Native.ViewStyle = { flexDirection: 'row', gap: 12 }

/** A rounded key, lighter along its top and with a dark lip under it. */
export const key = (height: number): Native.ViewStyle => ({
  flex: 1,
  height,
  borderRadius: 16,
  backgroundColor: KEY,
  borderTopWidth: 1,
  borderTopColor: KEY_TOP,
  borderBottomWidth: 3,
  borderBottomColor: SHELL_EDGE,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
})

/** A key dims while a finger is on it. */
export const keyPressed: Native.ViewStyle = { opacity: 0.6 }

export const keyDigit: Native.TextStyle = { fontSize: 18, fontWeight: '600', color: KEY_TEXT }

export const keyWord: Native.TextStyle = { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, color: KEY_MARK }

const SIDE = 5
const LONG = 5
const CLEAR = 'transparent'

/** A small arrow in the screen's colour, made of a view's borders. */
export const arrow: Readonly<Record<'Up' | 'Down' | 'Left' | 'Right', Native.ViewStyle>> = {
  Up: { width: 0, height: 0, borderLeftWidth: SIDE, borderRightWidth: SIDE, borderBottomWidth: LONG, borderLeftColor: CLEAR, borderRightColor: CLEAR, borderBottomColor: LCD },
  Down: { width: 0, height: 0, borderLeftWidth: SIDE, borderRightWidth: SIDE, borderTopWidth: LONG, borderLeftColor: CLEAR, borderRightColor: CLEAR, borderTopColor: LCD },
  Left: { width: 0, height: 0, borderTopWidth: SIDE, borderBottomWidth: SIDE, borderRightWidth: LONG, borderTopColor: CLEAR, borderBottomColor: CLEAR, borderRightColor: LCD },
  Right: { width: 0, height: 0, borderTopWidth: SIDE, borderBottomWidth: SIDE, borderLeftWidth: LONG, borderTopColor: CLEAR, borderBottomColor: CLEAR, borderLeftColor: LCD },
}

export const numbersRow: Native.ViewStyle = {
  height: NUMBERS_HEIGHT,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  paddingHorizontal: 8,
}
export const numbersText: Native.TextStyle = { flex: 1, fontSize: 10, color: NUMBERS_TEXT }
export const numbersSwitch: Native.ViewStyle = { paddingVertical: 6, paddingHorizontal: 8 }
export const numbersSwitchText: Native.TextStyle = { fontSize: 10, fontWeight: '600', color: KEY_MARK }
