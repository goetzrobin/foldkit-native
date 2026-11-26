/**
 * How long JavaScript frames take, for the readout on the Long list screen.
 *
 * It asks the phone for every frame (`requestAnimationFrame`) and keeps the
 * time between two. A frame at 60 a second is about 16.7 ms and at 120 a
 * second about 8.3 ms. A longer one means JavaScript was busy and a frame
 * was late. It sees JavaScript's side only: the phone scrolls a list on
 * another thread and can stay smooth while this number is bad.
 *
 * Nothing is drawn from here and nothing waits for it: it only measures.
 */
type Frame = (run: (time: number) => void) => number

export type FrameReading = Readonly<{ frames: number; averageMs: number; worstMs: number }>

const nowMs = (): number => performance.now()

export const makeFrameMeter = () => {
  let isOn = false
  let last = 0
  let frames = 0
  let total = 0
  let worst = 0
  const request = (globalThis as { requestAnimationFrame?: Frame }).requestAnimationFrame
  const next = (run: () => void): void => {
    if (typeof request === 'function') request(() => run())
    else setTimeout(run, 16)
  }
  const tick = (): void => {
    if (!isOn) return
    const at = nowMs()
    const took = at - last
    last = at
    frames++
    total += took
    if (took > worst) worst = took
    next(tick)
  }
  return {
    start: (): void => {
      if (isOn) return
      isOn = true
      last = nowMs()
      next(tick)
    },
    stop: (): void => {
      isOn = false
    },
    /** What was seen since the last read, and starts counting again. */
    read: (): FrameReading => {
      const reading = { frames, averageMs: frames === 0 ? 0 : total / frames, worstMs: worst }
      frames = 0
      total = 0
      worst = 0
      return reading
    },
  }
}
