/**
 * The rules of a swipe, as small functions of numbers.
 *
 * Both drivers use these same functions, so a row behaves the same whether
 * the UI thread or JavaScript moves it. Each starts with the line
 * `'worklet'`, which lets the UI thread driver copy it over there. On the
 * JavaScript thread the line does nothing.
 *
 * One number says where a row is: `s`, in points. 0 is closed. Above 0 the
 * leading side shows. Below 0 the trailing side shows. Left and right do
 * not appear here: `dir` (1, or -1 for right-to-left) turns `s` into a
 * movement on screen at the last moment.
 */

/** What a row's sides allow. Only numbers and yes or no, so it can be copied to the UI thread. */
export type Limits = Readonly<{
  /** How far the row rests open on each side. 0 when the side has nothing. */
  leadingOpen: number
  trailingOpen: number
  /** Whether a full swipe triggers the side's first action. */
  leadingFull: boolean
  trailingFull: boolean
  /** A passive side shows and never rests open. */
  leadingPassive: boolean
  trailingPassive: boolean
  /** Whether the row slides away after a full swipe (a destructive action). */
  leadingAway: boolean
  trailingAway: boolean
  rowWidth: number
  rowHeight: number
  /** 1, or -1 when the app reads right to left. */
  dir: number
  reduceMotion: boolean
}>

/** One tile, as a style is asked about it. The same shape as `SwipeTileInput`. */
export type TileInput = Readonly<{
  index: number
  count: number
  reveal: number
  openWidth: number
  progress: number
  rowWidth: number
  rowHeight: number
  full: number
  isFullSwipeAction: boolean
}>

/** Used until the phone has said how wide the row is. */
export const ASSUMED_ROW_WIDTH = 360

/** Faster than this, in points a second, a flick decides where the row goes. */
export const FLICK_SPEED = 400

/** How a row comes to rest. */
export const REST_SPRING = { stiffness: 260, damping: 28, mass: 1 }
/** How the full swipe tile grows and shrinks back. */
export const FULL_SPRING = { stiffness: 320, damping: 30, mass: 1 }

export const openOf = (side: number, limits: Limits): number => {
  'worklet'
  return side > 0 ? limits.leadingOpen : side < 0 ? limits.trailingOpen : 0
}

const widthOf = (limits: Limits): number => {
  'worklet'
  return limits.rowWidth > 0 ? limits.rowWidth : ASSUMED_ROW_WIDTH
}

/** How far the row must be pulled before letting go triggers the full swipe. */
export const fullSwipeAt = (side: number, limits: Limits): number => {
  'worklet'
  return Math.max(openOf(side, limits) + 48, widthOf(limits) * 0.55)
}

/** Pulling past the end moves the row less and less, like stretching rubber. */
export const rubber = (over: number, room: number): number => {
  'worklet'
  if (over <= 0) return 0
  return (1 - 1 / ((over * 0.55) / room + 1)) * room
}

/** How far a side may be pulled freely. */
const freeOf = (side: number, limits: Limits): number => {
  'worklet'
  const allowsFull = side > 0 ? limits.leadingFull : limits.trailingFull
  return allowsFull ? widthOf(limits) : openOf(side, limits)
}

/** Where the row is when the finger has moved `wanted` points from closed. */
export const dragTo = (wanted: number, limits: Limits): number => {
  'worklet'
  const side = wanted > 0 ? 1 : wanted < 0 ? -1 : 0
  if (side === 0) return 0
  const far = Math.abs(wanted)
  const free = freeOf(side, limits)
  if (far <= free) return wanted
  return side * (free + rubber(far - free, widthOf(limits) * 0.5))
}

/** 1 or -1 when the row is past the full swipe line on that side, else 0. */
export const armedSide = (s: number, limits: Limits): number => {
  'worklet'
  const side = s > 0 ? 1 : s < 0 ? -1 : 0
  if (side === 0) return 0
  const allowsFull = side > 0 ? limits.leadingFull : limits.trailingFull
  const isPassive = side > 0 ? limits.leadingPassive : limits.trailingPassive
  if (!allowsFull || isPassive) return 0
  return Math.abs(s) >= fullSwipeAt(side, limits) ? side : 0
}

/**
 * Where a row goes when the finger lifts. `rest` is 0 for closed, 1 for
 * open on the leading side, -1 for trailing. `velocity` is in points a
 * second, the same way round as `s`.
 *
 * Position and speed both count. A flick decides by its direction, however
 * short it was. A slow release decides by whether the row is more than half
 * open. Dragging back to where it started is how a swipe is cancelled.
 */
export const decide = (
  s: number,
  velocity: number,
  limits: Limits,
): Readonly<{ rest: number; isFullSwipe: boolean }> => {
  'worklet'
  const side = s > 0 ? 1 : s < 0 ? -1 : 0
  const open = openOf(side, limits)
  const isPassive = side > 0 ? limits.leadingPassive : limits.trailingPassive
  if (side === 0 || open <= 0 || isPassive) return { rest: 0, isFullSwipe: false }
  if (armedSide(s, limits) === side) return { rest: side, isFullSwipe: true }
  const opening = velocity * side
  if (opening > FLICK_SPEED) return { rest: side, isFullSwipe: false }
  if (opening < -FLICK_SPEED) return { rest: 0, isFullSwipe: false }
  return { rest: Math.abs(s) > open / 2 ? side : 0, isFullSwipe: false }
}

/** Whether a full swipe on this side slides the row away. */
export const slidesAway = (side: number, limits: Limits): boolean => {
  'worklet'
  return side > 0 ? limits.leadingAway : side < 0 ? limits.trailingAway : false
}

/** Where `s` is for a row resting closed (0) or open on a side (1, -1). */
export const restAt = (rest: number, limits: Limits): number => {
  'worklet'
  return rest * openOf(rest, limits)
}

/** Where `s` is for a row that has slid away on a side. */
export const awayAt = (side: number, limits: Limits): number => {
  'worklet'
  return side * (widthOf(limits) + 24)
}

export type Motion = Readonly<{ position: number; velocity: number; isAtRest: boolean }>

/** One step of a spring, `seconds` long. The same sums as `springTo` in the worklets folder. */
export const springStep = (
  position: number,
  velocity: number,
  to: number,
  seconds: number,
  spring: Readonly<{ stiffness: number; damping: number; mass: number }>,
): Motion => {
  'worklet'
  let left = seconds
  let at = position
  let speed = velocity
  // Small steps keep a stiff spring from blowing up.
  while (left > 0) {
    const dt = Math.min(left, 0.004)
    const force = -spring.stiffness * (at - to) - spring.damping * speed
    speed += (force / spring.mass) * dt
    at += speed * dt
    left -= dt
  }
  if (Math.abs(at - to) < 0.5 && Math.abs(speed) < 5) {
    return { position: to, velocity: 0, isAtRest: true }
  }
  return { position: at, velocity: speed, isAtRest: false }
}

/** What a style is asked for the tile `index` of the side `side` (1 leading, -1 trailing). */
export const tileInput = (
  side: number,
  index: number,
  count: number,
  s: number,
  full: number,
  limits: Limits,
): TileInput => {
  'worklet'
  const reveal = Math.max(0, side * s)
  const openWidth = openOf(side, limits)
  const allowsFull = side > 0 ? limits.leadingFull : limits.trailingFull
  return {
    index,
    count,
    reveal,
    openWidth,
    progress: openWidth > 0 ? reveal / openWidth : 0,
    rowWidth: widthOf(limits),
    rowHeight: limits.rowHeight,
    full: reveal > 0 ? full : 0,
    isFullSwipeAction: allowsFull && index === 0,
  }
}

/** The style props a tile is given for a layout. `toward` is 1 or -1: which way on screen is inward. */
export const tileProps = (
  layout: Readonly<{ offset: number; width: number; opacity: number; scale: number }>,
  toward: number,
  reveal: number,
): Readonly<{ width: number; opacity: number; transform: ReadonlyArray<object> }> => {
  'worklet'
  return {
    width: Math.max(0, layout.width),
    // A closed side shows nothing, whatever the style answers.
    opacity: reveal <= 0 ? 0 : Math.min(1, Math.max(0, layout.opacity)),
    transform: [{ translateX: toward * layout.offset }, { scale: layout.scale }],
  }
}
