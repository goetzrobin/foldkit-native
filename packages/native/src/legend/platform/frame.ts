/**
 * "Run this on the next frame", for Legend's core.
 *
 * Legend calls the global `requestAnimationFrame`. Two reasons not to call it
 * bare: the tests run in plain Node, which has none, and on a first launch in
 * Expo Go the frame clock was once seen not running (docs/BRIEF.md, lesson 1).
 *
 * So: where the phone has a frame clock, a frame is the phone's next frame,
 * with a slow timer behind it in case that clock is stopped. Where there is
 * no frame clock at all, a frame is a short timer.
 *
 * The short timer must stay under 16 ms. Legend pairs "on the next frame" with
 * 16 ms timers and expects the frame to come first (for one, its Android
 * nudge: scroll one point short, then to the target on the next frame).
 */
type FrameGlobals = {
  requestAnimationFrame?: (run: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

/** Used when there is no frame clock. */
const FRAME_MS = 8
/** Used behind a frame clock that may be stopped. */
const WATCHDOG_MS = 100

type Pending = { native: number | undefined; timer: ReturnType<typeof setTimeout> }

const pending = new Map<number, Pending>()
let nextHandle = 1

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

export const requestAnimationFrame = (run: (time: number) => void): number => {
  const handle = nextHandle++
  const fire = (time: number): void => {
    const entry = pending.get(handle)
    if (entry === undefined) return
    pending.delete(handle)
    clearTimeout(entry.timer)
    if (entry.native !== undefined) (globalThis as FrameGlobals).cancelAnimationFrame?.(entry.native)
    run(time)
  }
  const native = (globalThis as FrameGlobals).requestAnimationFrame
  const wait = typeof native === 'function' ? WATCHDOG_MS : FRAME_MS
  const entry: Pending = { native: undefined, timer: setTimeout(() => fire(now()), wait) }
  pending.set(handle, entry)
  if (typeof native === 'function') entry.native = native(fire)
  return handle
}

export const cancelAnimationFrame = (handle: number): void => {
  const entry = pending.get(handle)
  if (entry === undefined) return
  pending.delete(handle)
  clearTimeout(entry.timer)
  if (entry.native !== undefined) (globalThis as FrameGlobals).cancelAnimationFrame?.(entry.native)
}
