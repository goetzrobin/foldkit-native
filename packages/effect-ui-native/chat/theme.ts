/**
 * Effect Chat's look, as numbers: colours for light and dark, the type
 * scale, spacing and corner radii. The values are Fold Chat's, from
 * `docs/flagship/DESIGN.md`. Change them there first.
 *
 * Black, white and greys, and one accent colour for Send and links.
 */
import { Schema } from 'effect'

export const Scheme = Schema.Literals(['light', 'dark'])
export type Scheme = typeof Scheme.Type

export type Palette = Readonly<{
  bg: string
  surface: string
  surface2: string
  line: string
  ink: string
  ink2: string
  ink3: string
  accent: string
  onAccent: string
  danger: string
  /** The composer where the phone has no Liquid Glass. */
  glassFallback: string
  /** The dimmed band of the Thinking shimmer: `bg` as red, green, blue. */
  shimmerVeil: readonly [number, number, number]
}>

export const PALETTES: Readonly<Record<Scheme, Palette>> = {
  light: {
    bg: '#FFFFFF',
    surface: '#F2F2F3',
    surface2: '#E8E8EA',
    line: '#E3E3E6',
    ink: '#0D0D0E',
    ink2: '#5C5C63',
    ink3: '#9A9AA1',
    accent: '#0B6BCB',
    onAccent: '#FFFFFF',
    danger: '#C4352B',
    glassFallback: 'rgba(242,242,243,0.92)',
    shimmerVeil: [255, 255, 255],
  },
  dark: {
    bg: '#0B0B0C',
    surface: '#1C1C1E',
    surface2: '#2A2A2D',
    line: '#2C2C30',
    ink: '#F4F4F5',
    ink2: '#A1A1A8',
    ink3: '#6E6E75',
    accent: '#4DA3FF',
    onAccent: '#0B0B0C',
    danger: '#FF6B5E',
    glassFallback: 'rgba(28,28,30,0.92)',
    shimmerVeil: [11, 11, 12],
  },
}

export const paletteOf = (scheme: Scheme): Palette => PALETTES[scheme]

/** Size and line height in points, and weight. */
export const TYPE = {
  replyBody: { fontSize: 16, lineHeight: 24 },
  message: { fontSize: 16, lineHeight: 22 },
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  rowPreview: { fontSize: 14, lineHeight: 19 },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  meta: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  caption: { fontSize: 13, lineHeight: 18 },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  button: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
} as const

export const SPACE = { xs: 4, s: 8, m: 12, l: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const

export const RADIUS = { bubble: 20, field: 22, chip: 12, row: 12 } as const

/** Milliseconds. */
export const MOTION = {
  /** Your new message rises and fades in. */
  messageEnter: 380,
  /** "Thinking" fades in, once your message has risen. */
  thinkingIn: 200,
  thinkingDelay: 300,
  /** Send and Stop take each other's place. */
  sendStop: 120,
  scrollButton: 150,
  notice: 150,
  shimmerSweep: 1400,
} as const

/** How far your new message rises as it fades in, in points. */
export const ENTER_RISE = 24

/** As thin as the screen draws a line. */
export const HAIRLINE = 0.5
