/**
 * The app's shared clock: one counter for everything that happens.
 *
 * The screens and the player are separate things, and each keeps its own
 * record of what it did. To put those records into one list, in the order
 * things really happened, every entry takes its number from this one
 * counter: 41, 42, 43. The lower number happened first.
 *
 * It counts. It does not tell the time.
 *
 * Provide it once, where the app starts. Whoever is given the same clock
 * shares the same numbers.
 */
import { Context, Layer } from 'effect'

export type SharedClockService = Readonly<{
  /** The next number. Each call gives a new one, one higher than the last. */
  next: () => number
  /** The last number given out. 0 before the first. */
  last: () => number
}>

export class SharedClock extends Context.Service<SharedClock, SharedClockService>()('chat/SharedClock') {
  /** A clock that starts at 1. */
  static readonly Live: Layer.Layer<SharedClock> = Layer.sync(SharedClock, () => makeClock())
}

export const makeClock = (start = 0): SharedClockService & { readonly set: (value: number) => void } => {
  let count = start
  return {
    next: () => ++count,
    last: () => count,
    /** For replay: the next number will be `value + 1`. */
    set: value => {
      count = value
    },
  }
}
