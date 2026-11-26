/**
 * Effect UI's `Query` on a phone.
 *
 * A component declares `queries`, and its Commands declare `invalidates`,
 * `optimistic` and `writes`. Effect UI keeps the loaded data in a cache. Each
 * mount makes its own cache, so an app provides no cache Layer. (`Query.layer()`
 * is only for plain Effect code that runs outside a mount.)
 *
 * What the cache needs from the host is two facts, and this module gives them:
 *
 * - `Query.Visibility`: is the app in front? True while the phone says
 *   `active`. When it turns true again, the cache loads every stale entry a
 *   screen is showing.
 * - `Query.Connectivity`: is the phone online? When it turns true again, the
 *   cache does the same.
 *
 *   class ListNotes extends Query.Service<ListNotes>()('notes/List', {
 *     args: {}, success: Schema.Array(Note), error: Schema.Never, staleTime: '30 seconds',
 *   }) {
 *     static readonly layer = this.toLayer(() => api.listNotes)
 *   }
 *
 *   const Notes = Native.component({
 *     name: 'Notes', model, message,
 *     queries: { notes: { query: ListNotes, args: () => ({}) } },
 *   }).make({ ..., view: (h) => AsyncResult.match(h.queries.notes, { ... }) })
 *
 *   NativeHost.mount(Notes, {}, { fabric, rootTag }).pipe(
 *     Layer.provide(ListNotes.layer),
 *     // Both facts. Needs the phone's AppState and Network services.
 *     Layer.provide(NativeQuery.layer),
 *     Layer.provide(Phone.Device.live(modules)),
 *   )
 *
 * An app without the network module provides `NativeQuery.visibility` alone,
 * and the cache takes the phone to be online.
 *
 * The cache reads both facts once, when the mount starts. So these Layers
 * must be provided to the mount, not to something inside it.
 */
import * as Query from '@effect/ui/Query'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type * as Scope from 'effect/Scope'

import * as Device from '../../native/src/host/device/index.js'

/**
 * A `Query.Signal` over one of the phone's sources. It listens for as long
 * as the Scope is open. A source that cannot start (a missing native module)
 * leaves the signal at `initial`.
 */
export const signalOf = <A>(
  source: Device.Source<A>,
  isOn: (value: A) => boolean,
  initial = true,
): Effect.Effect<Query.Signal, never, Scope.Scope> =>
  Effect.gen(function* () {
    let current = initial
    const listeners = new Set<(value: boolean) => void>()
    const set = (value: boolean): void => {
      if (value === current) return
      current = value
      for (const listener of [...listeners]) listener(value)
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        try {
          return source.subscribe(value => set(isOn(value)))
        } catch {
          return () => {}
        }
      }),
      stop =>
        Effect.sync(() => {
          try {
            stop()
          } catch {
            // The listener is gone either way.
          }
        }),
    )
    return {
      get: () => current,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }
  })

/** `Query.Visibility` from the phone's app state: visible while `active`. */
export const visibility: Layer.Layer<never, never, Device.AppState.AppState> = Layer.effectContext(
  Effect.gen(function* () {
    const appState = yield* Device.AppState.AppState
    const signal = yield* signalOf(appState.statuses, status => status === 'active')
    return Context.make(Query.Visibility, signal) as Context.Context<never>
  }),
)

/** `Query.Connectivity` from the phone's network service: on while `online`. */
export const connectivity: Layer.Layer<never, never, Device.Network.Network> = Layer.effectContext(
  Effect.gen(function* () {
    const network = yield* Device.Network.Network
    const signal = yield* signalOf(network.states, state => state.status === 'online')
    return Context.make(Query.Connectivity, signal) as Context.Context<never>
  }),
)

/** Both facts. Provide it to `NativeHost.mount`. */
export const layer: Layer.Layer<never, never, Device.AppState.AppState | Device.Network.Network> = Layer.mergeAll(
  visibility,
  connectivity,
)
