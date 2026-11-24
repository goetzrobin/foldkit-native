/**
 * Multiple Object Tracking (MOT): the simulation, with no drawing in it.
 *
 * The task: some identical dots sit in an arena. A few of them are shown as
 * targets, then all look the same and move around, bouncing off the walls.
 * They stop, and the player picks the ones they think were the targets.
 *
 * Everything here is a pure function. A trial is fully described by a
 * `TrialSpec`. The same spec always gives the same starting places and the
 * same paths, on any phone and at any frame rate, so a trial can be replayed
 * exactly.
 *
 * How the path is kept independent of the frame rate: time moves in fixed
 * small steps of `STEP_MS`. A frame that took 16 ms advances the dots by the
 * whole steps that fit in the time so far. What is left over is not thrown
 * away: `drawnPositions` carries each dot that little bit further along its
 * line, so movement looks even when frames do not arrive evenly.
 */

export type TrialSpec = Readonly<{
  /** Any whole number. The same seed gives the same trial. */
  seed: number
  dotCount: number
  /** The first `targetCount` dots are the targets. Places are random, so which dots those are on screen is too. */
  targetCount: number
  /** Points per second. Every dot moves at this speed the whole time. */
  speed: number
  /** How long the dots move. */
  durationMs: number
  dotRadius: number
  /** The arena, in points. */
  width: number
  height: number
  /** Whether dots bounce off each other as well as the walls. */
  collide: boolean
}>

export type Dot = Readonly<{ x: number; y: number; vx: number; vy: number }>

export type MotState = Readonly<{
  /** Where each dot was at the last whole step. */
  dots: ReadonlyArray<Dot>
  /** Whole steps taken so far. */
  steps: number
  /** Movement time so far. Never more than the trial's duration. */
  elapsedMs: number
}>

export type Point = Readonly<{ x: number; y: number }>

/** One step of the simulation: 240 a second, which divides 60 and 120 frames a second evenly. */
export const STEP_MS = 1000 / 240

/**
 * A small seeded random number generator (mulberry32). Returns numbers from
 * 0 up to but not including 1. Same seed, same numbers.
 */
export const makeRandom = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The least clear space between two dots at the start, in points. */
const START_GAP = 4
const PLACING_TRIES = 400

const isClear = (placed: ReadonlyArray<Point>, x: number, y: number, apart: number): boolean =>
  placed.every(other => Math.hypot(other.x - x, other.y - y) >= apart)

/**
 * Places on a grid, used only when random placing cannot find room (a small
 * arena with many dots). Still no two dots overlap if the grid cells are
 * big enough, and the order is shuffled by the same generator.
 */
const gridPlaces = (spec: TrialSpec, random: () => number): Array<Point> => {
  const columns = Math.max(1, Math.ceil(Math.sqrt((spec.dotCount * spec.width) / spec.height)))
  const rows = Math.max(1, Math.ceil(spec.dotCount / columns))
  const cells: Array<Point> = []
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      cells.push({
        x: ((column + 0.5) * spec.width) / columns,
        y: ((row + 0.5) * spec.height) / rows,
      })
    }
  }
  for (let at = cells.length - 1; at > 0; at--) {
    const other = Math.floor(random() * (at + 1))
    const held = cells[at] as Point
    cells[at] = cells[other] as Point
    cells[other] = held
  }
  return cells.slice(0, spec.dotCount)
}

const place = (spec: TrialSpec, random: () => number): Array<Point> => {
  const r = spec.dotRadius
  const apart = 2 * r + START_GAP
  const placed: Array<Point> = []
  for (let index = 0; index < spec.dotCount; index++) {
    let found: Point | undefined
    for (let attempt = 0; attempt < PLACING_TRIES && found === undefined; attempt++) {
      const x = r + random() * Math.max(0, spec.width - 2 * r)
      const y = r + random() * Math.max(0, spec.height - 2 * r)
      if (isClear(placed, x, y, apart)) found = { x, y }
    }
    if (found === undefined) return gridPlaces(spec, random)
    placed.push(found)
  }
  return placed
}

/** The dots where a trial begins: apart from each other, each with its own direction. */
export const initialState = (spec: TrialSpec): MotState => {
  const random = makeRandom(spec.seed)
  const places = place(spec, random)
  const dots = places.map(({ x, y }) => {
    const angle = random() * 2 * Math.PI
    return { x, y, vx: Math.cos(angle) * spec.speed, vy: Math.sin(angle) * spec.speed }
  })
  return { dots, steps: 0, elapsedMs: 0 }
}

export const isTarget = (spec: TrialSpec, index: number): boolean => index < spec.targetCount

type Moving = { x: number; y: number; vx: number; vy: number }

/** Turns a dot back from any wall it has crossed, keeping its speed. */
const bounceOffWalls = (dot: Moving, spec: TrialSpec): void => {
  const r = spec.dotRadius
  const right = Math.max(r, spec.width - r)
  const bottom = Math.max(r, spec.height - r)
  if (dot.x < r) {
    dot.x = Math.min(right, 2 * r - dot.x)
    dot.vx = Math.abs(dot.vx)
  } else if (dot.x > right) {
    dot.x = Math.max(r, 2 * right - dot.x)
    dot.vx = -Math.abs(dot.vx)
  }
  if (dot.y < r) {
    dot.y = Math.min(bottom, 2 * r - dot.y)
    dot.vy = Math.abs(dot.vy)
  } else if (dot.y > bottom) {
    dot.y = Math.max(r, 2 * bottom - dot.y)
    dot.vy = -Math.abs(dot.vy)
  }
}

/** Sets a dot's speed back to the trial's speed, keeping its direction. */
const keepSpeed = (dot: Moving, speed: number): void => {
  const now = Math.hypot(dot.vx, dot.vy)
  if (now === 0) return
  dot.vx = (dot.vx / now) * speed
  dot.vy = (dot.vy / now) * speed
}

/**
 * Two touching dots that are closing on each other swap the part of their
 * movement that points at the other, as two equal balls do. Then each is set
 * back to the trial's speed, so no dot ends up faster or slower.
 */
const bounceOffEachOther = (dots: Array<Moving>, spec: TrialSpec): void => {
  const touching = 2 * spec.dotRadius
  for (let a = 0; a < dots.length; a++) {
    for (let b = a + 1; b < dots.length; b++) {
      const one = dots[a] as Moving
      const two = dots[b] as Moving
      const dx = two.x - one.x
      const dy = two.y - one.y
      const distance = Math.hypot(dx, dy)
      if (distance >= touching || distance === 0) continue
      const nx = dx / distance
      const ny = dy / distance
      const closing = (one.vx - two.vx) * nx + (one.vy - two.vy) * ny
      if (closing <= 0) continue
      one.vx -= closing * nx
      one.vy -= closing * ny
      two.vx += closing * nx
      two.vy += closing * ny
      keepSpeed(one, spec.speed)
      keepSpeed(two, spec.speed)
    }
  }
}

const stepOnce = (dots: Array<Moving>, spec: TrialSpec): void => {
  const seconds = STEP_MS / 1000
  for (const dot of dots) {
    dot.x += dot.vx * seconds
    dot.y += dot.vy * seconds
    bounceOffWalls(dot, spec)
  }
  if (spec.collide) bounceOffEachOther(dots, spec)
}

/**
 * The trial `dtMs` later. Time stops at the trial's duration, so calling
 * this with a long last frame does not move the dots past the end.
 */
export const step = (state: MotState, dtMs: number, spec: TrialSpec): MotState => {
  const elapsedMs = Math.min(spec.durationMs, state.elapsedMs + Math.max(0, dtMs))
  // A hair is added before rounding down, so a time that is a whole number
  // of steps in exact arithmetic is not one short in floating point.
  const wanted = Math.floor(elapsedMs / STEP_MS + 1e-7)
  if (wanted <= state.steps) return { ...state, elapsedMs }
  const dots: Array<Moving> = state.dots.map(dot => ({ ...dot }))
  for (let count = state.steps; count < wanted; count++) stepOnce(dots, spec)
  return { dots, steps: wanted, elapsedMs }
}

export const isFinished = (state: MotState, spec: TrialSpec): boolean =>
  state.elapsedMs >= spec.durationMs

/**
 * Where to draw each dot now: its place at the last whole step, carried on
 * for the part of a step that has passed since, and kept inside the arena.
 */
export const drawnPositions = (state: MotState, spec: TrialSpec): Array<Point> => {
  const carry = Math.max(0, state.elapsedMs - state.steps * STEP_MS) / 1000
  const r = spec.dotRadius
  const right = Math.max(r, spec.width - r)
  const bottom = Math.max(r, spec.height - r)
  return state.dots.map(dot => ({
    x: Math.min(right, Math.max(r, dot.x + dot.vx * carry)),
    y: Math.min(bottom, Math.max(r, dot.y + dot.vy * carry)),
  }))
}

/**
 * How far each dot was drawn to move between two moments, for measuring
 * speed on screen. A dot that turned in between (it bounced), or that is
 * drawn held against a wall, has no straight line to measure and answers
 * undefined.
 */
export const straightDistances = (
  before: MotState,
  after: MotState,
  spec: TrialSpec,
): Array<number | undefined> => {
  const r = spec.dotRadius
  const right = Math.max(r, spec.width - r)
  const bottom = Math.max(r, spec.height - r)
  const place = (state: MotState, index: number): Point | undefined => {
    const dot = state.dots[index] as Dot
    const carry = Math.max(0, state.elapsedMs - state.steps * STEP_MS) / 1000
    const x = dot.x + dot.vx * carry
    const y = dot.y + dot.vy * carry
    return x < r || x > right || y < r || y > bottom ? undefined : { x, y }
  }
  return after.dots.map((dot, index) => {
    const was = before.dots[index]
    if (was === undefined || was.vx !== dot.vx || was.vy !== dot.vy) return undefined
    const from = place(before, index)
    const to = place(after, index)
    return from === undefined || to === undefined
      ? undefined
      : Math.hypot(to.x - from.x, to.y - from.y)
  })
}

/** The whole trial in one go: where the dots are `ms` after they start moving. */
export const stateAt = (spec: TrialSpec, ms: number): MotState =>
  step(initialState(spec), ms, spec)

/**
 * Which dot a tap means: the nearest one whose edge is within `slop` points
 * of the tap. -1 when the tap is not near any dot.
 */
export const dotAt = (
  positions: ReadonlyArray<Point>,
  x: number,
  y: number,
  radius: number,
  slop: number,
): number => {
  let best = -1
  let bestDistance = radius + slop
  positions.forEach((dot, index) => {
    const distance = Math.hypot(dot.x - x, dot.y - y)
    if (distance <= bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

export type TrialResult = Readonly<{
  /** Picked dots that were targets. */
  correct: ReadonlyArray<number>
  /** Picked dots that were not. */
  wrong: ReadonlyArray<number>
  /** Targets that were not picked. */
  missed: ReadonlyArray<number>
}>

export const scoreTrial = (spec: TrialSpec, picks: ReadonlyArray<number>): TrialResult => ({
  correct: picks.filter(index => isTarget(spec, index)),
  wrong: picks.filter(index => !isTarget(spec, index)),
  missed: Array.from({ length: spec.targetCount }, (_, index) => index).filter(
    index => !picks.includes(index),
  ),
})

/** What the frame clock did during a trial, for the readout on screen. */
export type Timing = Readonly<{
  /** Frames drawn while the dots moved. */
  frames: number
  /** Frames that came more than 1.5 times the usual gap after the one before. */
  dropped: number
  /** The usual gap between frames, in milliseconds. */
  medianFrameMs: number
  /** The longest gap between two frames. */
  worstFrameMs: number
  /**
   * How fast the dots were drawn to move, in points per second: distance on
   * screen over time on the phone's clock, averaged over dots and frames.
   * Frames in which a dot bounced are left out for that dot.
   */
  measuredSpeed: number
  /** How long the dots moved, by the phone's clock. */
  actualDurationMs: number
  /** How long the targets were shown, by the phone's clock. */
  actualCueMs: number
}>

/**
 * Sums up a trial's frames. `gaps` are the times between one frame and the
 * next while the dots moved.
 */
export const summarise = (
  gaps: ReadonlyArray<number>,
  measuredSpeed: number,
  actualDurationMs: number,
  actualCueMs: number,
): Timing => {
  const sorted = [...gaps].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length === 0
      ? 0
      : sorted.length % 2 === 1
        ? (sorted[middle] as number)
        : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
  return {
    frames: gaps.length,
    dropped: gaps.filter(gap => gap > 1.5 * median).length,
    medianFrameMs: median,
    worstFrameMs: sorted.length === 0 ? 0 : (sorted[sorted.length - 1] as number),
    measuredSpeed,
    actualDurationMs,
    actualCueMs,
  }
}
