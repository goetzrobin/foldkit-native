/**
 * Pieces every phone feature in this folder shares.
 *
 * Each feature is an Effect service. The app builds a `live` Layer from the
 * real module (`react-native` or an `expo-*` package) and hands it to
 * `Runtime.makeElement({ resources })`. A test builds a fake with `makeTest`.
 * Nothing in this folder imports a native module itself, which is what lets
 * the tests run in plain Node.
 */
import { Data, Effect, Queue, Stream } from 'effect'

/** A phone feature did not work: the module is missing, or the call failed. */
export class DeviceError extends Data.TaggedError('DeviceError')<{
  /** Which feature, such as `clipboard`. */
  capability: string
  /** What went wrong, in the module's own words. */
  reason: string
}> {}

export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Calls a native function and turns a throw or a rejection into a
 * `DeviceError`. A module that is installed but not linked throws at the
 * call, before any promise exists, so that is caught as well.
 */
export const attempt = <A>(
  capability: string,
  run: () => Promise<A> | A,
): Effect.Effect<A, DeviceError> =>
  Effect.tryPromise({
    try: async () => run(),
    catch: error => new DeviceError({ capability, reason: reasonOf(error) }),
  })

/**
 * Something on the phone that changes over time: the keyboard, the network.
 * `subscribe` reports the value as it is now, then every change, until the
 * function it returns is called.
 */
export type Source<A> = Readonly<{
  subscribe: (listener: (value: A) => void) => () => void
}>

/**
 * A Source as a Stream, for a Subscription. Listening starts when Foldkit
 * starts the Subscription and stops when it stops it.
 *
 * A Subscription's Stream may not fail: Foldkit treats that as a crash. A
 * source that throws while starting (a missing module) is logged and then
 * stays silent, so one broken feature does not take the app down.
 */
export const streamOf = <A>(capability: string, source: Source<A>): Stream.Stream<A> =>
  Stream.callback<A>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        try {
          return source.subscribe(value => {
            Queue.offerUnsafe(queue, value)
          })
        } catch (error) {
          console.warn(`[foldkit-native] ${capability} is not available: ${reasonOf(error)}`)
          return () => {}
        }
      }),
      stop =>
        Effect.sync(() => {
          try {
            stop()
          } catch {
            // Nothing to do: the listener is gone either way.
          }
        }),
    ),
  )

/** What a native `addListener` returns. */
export type NativeSubscription = Readonly<{ remove: () => void }>

/** A Source a test drives by hand. */
export type TestSource<A> = Readonly<{
  source: Source<A>
  /** Report a change, as the phone would. */
  emit: (value: A) => void
  /** How many Subscriptions are listening now. */
  listenerCount: () => number
}>

export const makeTestSource = <A>(initial: A): TestSource<A> => {
  const listeners = new Set<(value: A) => void>()
  let current = initial
  return {
    source: {
      subscribe: listener => {
        listeners.add(listener)
        listener(current)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    emit: value => {
      current = value
      for (const listener of [...listeners]) listener(value)
    },
    listenerCount: () => listeners.size,
  }
}

/** Makes a test fake's method fail the next time it is called, once. */
export type FailNext = (reason: string) => void

/** Shared by the test fakes: `failNext('why')` makes the next call fail. */
export const makeFailure = (capability: string) => {
  let pending: string | undefined
  const failNext: FailNext = reason => {
    pending = reason
  }
  /** Runs `run`, unless a failure is pending. */
  const guard = <A>(run: () => A): Effect.Effect<A, DeviceError> =>
    Effect.suspend(() => {
      if (pending !== undefined) {
        const reason = pending
        pending = undefined
        return Effect.fail(new DeviceError({ capability, reason }))
      }
      return Effect.sync(run)
    })
  return { failNext, guard }
}
