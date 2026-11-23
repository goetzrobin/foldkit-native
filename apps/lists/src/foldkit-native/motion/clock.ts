/**
 * The clock that keeps animations moving.
 *
 * The engine does not run transitions by itself. Each frame, someone must
 * call `engine.advanceAnimations()`, which works out where every running
 * transition has got to, and then `engine.commit()`, which sends that to the
 * phone. In ng-native the Angular platform does this. Here this file does.
 *
 * Nothing needs to be started by hand. The motion module asks for a frame
 * after every draw, and the frames stop by themselves when nothing is moving.
 */
import type { Engine } from '@ng-native/fabric'

export type MotionOptions = Readonly<{
  /**
   * Calls `run` when the next frame is due. The default is the phone's
   * `requestAnimationFrame`, with a timer behind it in case that clock is
   * paused, as it was during this project's first launch in Expo Go.
   */
  requestFrame?: (run: () => void) => void
}>

type Pump = {
  requestFrame: (run: () => void) => void
  isQueued: boolean
  isStopped: boolean
}

/** If the frame clock has not answered after this long, a timer runs the frame. */
const STALLED_CLOCK_MS = 100
const FRAME_MS = 16

const defaultRequestFrame = (run: () => void): void => {
  const host = globalThis as { requestAnimationFrame?: (run: () => void) => unknown }
  let hasRun = false
  const once = (): void => {
    if (hasRun) return
    hasRun = true
    run()
  }
  if (host.requestAnimationFrame === undefined) {
    setTimeout(once, FRAME_MS)
    return
  }
  host.requestAnimationFrame(once)
  setTimeout(once, STALLED_CLOCK_MS)
}

const pumps = new WeakMap<Engine, Pump>()

const pumpOf = (engine: Engine): Pump => {
  let pump = pumps.get(engine)
  if (pump === undefined) {
    pump = { requestFrame: defaultRequestFrame, isQueued: false, isStopped: false }
    pumps.set(engine, pump)
  }
  return pump
}

const hasWork = (engine: Engine): boolean => engine.animating || engine.pending

/**
 * Asks for a frame if anything is moving or waiting to be committed. Safe to
 * call at any time and as often as you like: at most one frame is queued.
 */
export const keepMoving = (engine: Engine): void => {
  const pump = pumpOf(engine)
  if (pump.isQueued || pump.isStopped || !hasWork(engine)) return
  pump.isQueued = true
  pump.requestFrame(() => {
    pump.isQueued = false
    if (pump.isStopped) return
    engine.advanceAnimations()
    engine.commit()
    keepMoving(engine)
  })
}

/**
 * Optional. Call with the surface (or its engine) to change how frames are
 * asked for. Tests use this to step through an animation by hand.
 */
export const configureMotion = (
  surface: Readonly<{ engine: Engine }>,
  options: MotionOptions,
): void => {
  const pump = pumpOf(surface.engine)
  if (options.requestFrame !== undefined) pump.requestFrame = options.requestFrame
  pump.isStopped = false
}

/** Call before disposing a surface, so no frame runs on a dead engine. */
export const stopMotion = (surface: Readonly<{ engine: Engine }>): void => {
  pumpOf(surface.engine).isStopped = true
}
