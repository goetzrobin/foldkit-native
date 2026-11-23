/**
 * "Run this on the next frame", for Legend's core.
 *
 * Legend calls the global `requestAnimationFrame`. Two reasons not to:
 * the tests run in plain Node, which has none, and on a first launch in Expo
 * Go the frame clock was once seen not running (docs/BRIEF.md, lesson 1).
 * So a frame here is whichever comes first: the phone's own next frame, or a
 * timer a little longer than one frame.
 */
type FrameGlobals = {
  requestAnimationFrame?: (run: (time: number) => void) => number
  cancelAnimationFrame?: (handle: number) => void
}

const FALLBACK_MS = 32

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
  const entry: Pending = { native: undefined, timer: setTimeout(() => fire(now()), FALLBACK_MS) }
  pending.set(handle, entry)
  entry.native = (globalThis as FrameGlobals).requestAnimationFrame?.(fire)
  return handle
}

export const cancelAnimationFrame = (handle: number): void => {
  const entry = pending.get(handle)
  if (entry === undefined) return
  pending.delete(handle)
  clearTimeout(entry.timer)
  if (entry.native !== undefined) (globalThis as FrameGlobals).cancelAnimationFrame?.(entry.native)
}
