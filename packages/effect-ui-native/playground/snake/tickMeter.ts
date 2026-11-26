/**
 * How long one tick of the game clock takes in JavaScript: from the moment
 * `update` gets the tick until its draw has been sent to the phone.
 *
 * `begin` is called when the tick arrives. `drawn` is called from the view.
 * Effect UI runs the views, works out what changed and sends it to the phone
 * in one go, so a microtask queued from the view runs right after that.
 *
 * It only measures. Nothing is drawn from here and nothing waits for it.
 */
export type TickReading = Readonly<{ ticks: number; lastMs: number; worstMs: number }>

const nowMs = (): number => performance.now()

export const makeTickMeter = () => {
  let startedAt: number | undefined
  let isQueued = false
  let ticks = 0
  let lastMs = 0
  let worstMs = 0
  return {
    begin: (): void => {
      startedAt = nowMs()
    },
    drawn: (): void => {
      if (startedAt === undefined || isQueued) return
      isQueued = true
      queueMicrotask(() => {
        isQueued = false
        if (startedAt === undefined) return
        lastMs = nowMs() - startedAt
        startedAt = undefined
        ticks++
        if (lastMs > worstMs) worstMs = lastMs
      })
    },
    read: (): TickReading => ({ ticks, lastMs, worstMs }),
    reset: (): void => {
      startedAt = undefined
      ticks = 0
      lastMs = 0
      worstMs = 0
    },
  }
}
