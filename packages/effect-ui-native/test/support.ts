/** Shared by the tests: runs a scoped Effect to the end. */
import { Effect, Layer, type Scope } from 'effect'

export const run = <A>(effect: Effect.Effect<A, never, any>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)

/**
 * Provides a Layer that stays built until the test ends. `Effect.provide`
 * closes the Layer when the effect it wraps returns, which stops the fetchers
 * of every query in it while the mounted app is still on screen.
 */
export const provideForTest =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, Exclude<R, ROut> | RIn | Scope.Scope> =>
    Effect.flatMap(Layer.build(layer), context => Effect.provideContext(effect, context)) as any
