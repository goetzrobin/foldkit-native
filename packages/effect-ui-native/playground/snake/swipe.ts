/**
 * A swipe, read from where a finger went down and where it was when the
 * touch ended.
 *
 * The host sends `pressIn` with the first point and `pressOut` with the last
 * one. `pressOut` comes as soon as the finger has drifted more than ten
 * points, so a swipe is known while the finger is still moving. One touch
 * gives one swipe.
 */
import type { Direction } from './domain/direction.js'

export type Point = Readonly<{ x: number; y: number }>

/** A finger that moved less than this, in points, did not swipe. */
export const SWIPE_MIN = 8

/** Which way the finger went, by the longer side of its path. Up is a smaller `y`. */
export const swipeDirection = (from: Point, to: Point): Direction | undefined => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.hypot(dx, dy) < SWIPE_MIN) return undefined
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'Right' : 'Left'
  return dy > 0 ? 'Down' : 'Up'
}
