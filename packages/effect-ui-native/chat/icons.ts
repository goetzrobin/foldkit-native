/**
 * The icons on the round buttons, drawn from plain views so they need
 * nothing from the build and look the same on both phones. The shapes are
 * Fold Chat's.
 */
import type { Native } from '../src/index.js'

/** One rounded bar of an icon, placed inside the icon's box. */
export type Bar = Readonly<{
  left: number
  top: number
  width: number
  height: number
  borderRadius: number
  /** Turned about its centre, in degrees. */
  turn?: number
}>

export const ARROW_SIZE = 16

/**
 * An arrow pointing up, 16 points square, as three bars: the stem and the
 * two sides of the head. Each side is turned so that its rounded end sits
 * exactly on the stem's rounded end, and the three meet in one point. Ending
 * side by side, they drew the point as if it were cut off.
 */
export const ARROW_BARS: ReadonlyArray<Bar> = [
  { left: 6.75, top: 1.75, width: 2.5, height: 12.5, borderRadius: 1.25 },
  { left: 4.45, top: 0.8, width: 2.5, height: 9, borderRadius: 1.25, turn: 45 },
  { left: 9.05, top: 0.8, width: 2.5, height: 9, borderRadius: 1.25, turn: -45 },
]

const arrow = <Msg>(h: Native.H<Msg>, color: string, isDown: boolean) =>
  h.view
    .set({ pointerEvents: 'none' })
    // The down arrow is the up arrow turned over whole, with nothing to clip it.
    .style({ width: ARROW_SIZE, height: ARROW_SIZE, ...(isDown ? { transform: [{ rotate: '180deg' }] } : {}) })
    .children(
      ARROW_BARS.map((bar, index) =>
        h.view.key(`bar-${index}`).style({
          position: 'absolute',
          left: bar.left,
          top: bar.top,
          width: bar.width,
          height: bar.height,
          borderRadius: bar.borderRadius,
          backgroundColor: color,
          ...(bar.turn === undefined ? {} : { transform: [{ rotate: `${bar.turn}deg` }] }),
        }),
      ),
    )

/** On Send. */
export const arrowUp = <Msg>(h: Native.H<Msg>, color: string) => arrow(h, color, false)

/** On the button that scrolls to the end. */
export const arrowDown = <Msg>(h: Native.H<Msg>, color: string) => arrow(h, color, true)

/** A filled square, on Stop. */
export const stopSquare = <Msg>(h: Native.H<Msg>, color: string) =>
  h.view.set({ pointerEvents: 'none' }).style({ width: 11, height: 11, borderRadius: 2.5, backgroundColor: color })

const drawn = <Msg>(h: Native.H<Msg>, width: number, height: number, bars: ReadonlyArray<Native.ViewStyle>) =>
  h.view
    .set({ pointerEvents: 'none' })
    .style({ width, height })
    .children(bars.map((bar, index) => h.view.key(`bar-${index}`).style({ position: 'absolute', ...bar })))

/** A microphone: a capsule in a cradle on a stem. On the button that listens. */
export const microphone = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(h, 16, 18, [
    { left: 4.5, top: 0, width: 7, height: 11, borderRadius: 3.5, backgroundColor: color },
    {
      left: 1.5,
      top: 5,
      width: 13,
      height: 9,
      borderWidth: 1.8,
      borderTopWidth: 0,
      borderColor: color,
      borderBottomLeftRadius: 6.5,
      borderBottomRightRadius: 6.5,
    },
    { left: 7.1, top: 13.5, width: 1.8, height: 4, borderRadius: 0.9, backgroundColor: color },
  ])

/** Five bars of a sound wave. On the button that records a voice note. */
export const soundWave = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(
    h,
    16,
    16,
    [5, 11, 15, 9, 4].map((height, index) => ({
      left: 0.6 + index * 3.3,
      top: (16 - height) / 2,
      width: 1.8,
      height,
      borderRadius: 0.9,
      backgroundColor: color,
    })),
  )

/** An x, 12 points square. */
export const cross = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(h, 12, 12, [
    { left: 5.2, top: -0.5, width: 1.6, height: 13, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '45deg' }] },
    { left: 5.2, top: -0.5, width: 1.6, height: 13, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-45deg' }] },
  ])

/** A tick, 12 points square. */
export const tick = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(h, 12, 12, [
    { left: 2.2, top: 5.57, width: 1.6, height: 5.5, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-45deg' }] },
    { left: 6.6, top: 0.6, width: 1.6, height: 11, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '40deg' }] },
  ])

/** Two sheets of paper, one over the other: Copy. */
export const copyIcon = <Msg>(h: Native.H<Msg>, color: string, paper: string) =>
  drawn(h, 16, 16, [
    { left: 5, top: 1, width: 10, height: 11, borderRadius: 2.5, borderWidth: 1.6, borderColor: color },
    { left: 1, top: 4.5, width: 10, height: 11, borderRadius: 2.5, borderWidth: 1.6, borderColor: color, backgroundColor: paper },
  ])

/** A tray with an arrow leaving it: Share. */
export const shareIcon = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(h, 16, 16, [
    { left: 1.5, top: 6, width: 13, height: 10, borderWidth: 1.6, borderTopWidth: 0, borderColor: color, borderBottomLeftRadius: 2.5, borderBottomRightRadius: 2.5 },
    { left: 7.2, top: 0.5, width: 1.6, height: 10, borderRadius: 0.8, backgroundColor: color },
    { left: 6.07, top: 0.03, width: 1.6, height: 4.8, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '45deg' }] },
    { left: 8.33, top: 0.03, width: 1.6, height: 4.8, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-45deg' }] },
  ])

/** A circle that does not close, with a point at its end: write the reply again. */
export const regenerateIcon = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(h, 16, 16, [
    { left: 1.5, top: 1.5, width: 13, height: 13, borderRadius: 6.5, borderWidth: 1.6, borderColor: color, borderTopColor: 'transparent', transform: [{ rotate: '45deg' }] },
    { left: 10.62, top: 0.5, width: 1.6, height: 5, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-20deg' }] },
    { left: 11.11, top: 3.29, width: 4.6, height: 1.6, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-20deg' }] },
  ])

/** A triangle pointing right: Play. Drawn from the borders of an empty box. */
export const playIcon = <Msg>(h: Native.H<Msg>, color: string) =>
  drawn(h, 10, 12, [
    {
      left: 1,
      top: 0,
      width: 0,
      height: 0,
      borderTopWidth: 6,
      borderBottomWidth: 6,
      borderLeftWidth: 9,
      borderTopColor: 'transparent',
      borderBottomColor: 'transparent',
      borderLeftColor: color,
    },
  ])
