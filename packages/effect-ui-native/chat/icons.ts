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
