/** Shared by the tests: runs a scoped Effect to the end. */
import { Effect } from 'effect'

export const run = <A>(effect: Effect.Effect<A, never, any>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)
