/**
 * The bridge between loaded server data and a Foldkit program.
 *
 * Data from a server is kept in a cache outside the Model, in small holders
 * called atoms. This file lets a Foldkit program use that cache in Foldkit's
 * own two ways. To read, a screen declares a Subscription: "while I am on
 * screen, tell me whenever member 3 changes". To write, `update` returns a
 * Command: "save this, then tell me if it worked". The bridge also tells the
 * cache when the person comes back to the app, so old data is loaded again.
 *
 * For engineers.
 *
 * One registry and one atom runtime for each program:
 *
 *   const runtime = Atom.runtime(Layer.mergeAll(apiLayer, CrewSync.layer))
 *   const server = makeServerState(runtime)
 *   Runtime.makeElement({ ..., resources: Layer.mergeAll(server.layer, device) })
 *
 * `server.layer` goes in Foldkit's `resources`. Foldkit builds that Layer
 * once when the program starts and closes it when the program is disposed.
 * Building it makes an `AtomRegistry` and mounts `runtime` in it. Closing it
 * disposes the registry, which stops every request in flight.
 *
 * The app's own services (the API, the sync bus) are NOT in `resources`.
 * They are in the Layer given to `Atom.runtime`, and the registry builds
 * them once. Commands and Subscriptions that need them borrow the built
 * services with `server.provide(effect)`. That way a write run by a Command
 * and a read run by an atom talk to the same API object and the same sync
 * bus. Two copies would mean an announcement nobody hears.
 *
 * - `watchAtom`   a Subscription entry: watch an atom while the Model says so
 * - `runWrite`    the Effect for a Command: run a write, answer with a Message
 * - `focusEntry`  a Subscription entry: bump `focusSignal` on return to the app
 * - `focusSignal` give this to `Atom.swr({ revalidateOnFocus: true, focusSignal })`
 */
import {
  Effect,
  Option,
  Queue,
  type Schema,
  Stream,
} from 'effect'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { Subscription } from 'foldkit'

import { AppState } from '../../host/device/appState.js'
import { streamOf } from '../../host/device/common.js'
import { ServerState, focusSignal } from '../../host/serverState/store.js'

export * from '../../host/serverState/store.js'

// READ: A SUBSCRIPTION

export type WatchAtomConfig<Model, Message, Dependencies, A, E> = Readonly<{
  /**
   * What the Model says about this read: usually which thing is on screen.
   * When the answer changes, the old atom is let go and the new one watched.
   */
  modelToDependencies: (model: Model) => Dependencies
  /** The atom for those dependencies, or `None` when nothing is on screen. */
  atom: (dependencies: Dependencies) => Option.Option<Atom.Atom<AsyncResult.AsyncResult<A, E>>>
  /**
   * Called with what the atom holds when watching starts, then on every
   * change: loading, loaded, loading again with the old value still there,
   * failed with the old value still there. Put the whole result in the
   * Message for something small. For something large, put in only what the
   * screen's chrome needs (a status, a count) and draw the rest with `peek`.
   */
  toMessage: (result: AsyncResult.AsyncResult<A, E>, dependencies: Dependencies) => Message
}>

/**
 * A Subscription entry that watches an atom.
 *
 *   Subscription.make<Model, Message, ServerState>()(() => ({
 *     member: watchAtom(
 *       { maybeMemberId: Schema.Option(Schema.Number) },
 *       {
 *         modelToDependencies: model => ({ maybeMemberId: openMemberId(model) }),
 *         atom: ({ maybeMemberId }) => Option.map(maybeMemberId, crew.member),
 *         toMessage: result => Message.ChangedMember({ result }),
 *       },
 *     ),
 *   }))
 *
 * Foldkit starts the entry's Stream when the dependencies first appear and
 * restarts it when they change. Starting subscribes to the atom in the
 * registry, which is what makes the atom load. Stopping unsubscribes. An
 * atom nobody watches is dropped after its idle time.
 *
 * Two entries, or two screens, that watch the same atom share one request:
 * the registry holds one node for an atom however many listen to it.
 */
export const watchAtom = <Model, Message, const Fields extends Schema.Struct.Fields, A, E>(
  fields: Fields,
  config: WatchAtomConfig<Model, Message, Schema.Struct.Type<Fields>, A, E>,
) => {
  type Dependencies = Schema.Struct.Type<Fields>
  return Subscription.make<Model, Message, ServerState>()(entry => ({
    watch: entry(fields, {
      modelToDependencies: config.modelToDependencies,
      dependenciesToStream: (dependencies: Dependencies) =>
        Option.match(config.atom(dependencies), {
          onNone: () => Stream.empty,
          onSome: atom =>
            Stream.unwrap(
              ServerState.useSync(({ registry, watchers }) =>
                Stream.callback<AsyncResult.AsyncResult<A, E>>(queue =>
                  Effect.acquireRelease(
                    Effect.sync(() => {
                      watchers.set(atom, (watchers.get(atom) ?? 0) + 1)
                      return registry.subscribe(
                        atom,
                        result => {
                          Queue.offerUnsafe(queue, result)
                        },
                        { immediate: true },
                      )
                    }),
                    unsubscribe =>
                      Effect.sync(() => {
                        const left = (watchers.get(atom) ?? 1) - 1
                        if (left > 0) watchers.set(atom, left)
                        else watchers.delete(atom)
                        unsubscribe()
                      }),
                  ),
                ),
              ),
            ).pipe(Stream.map(result => config.toMessage(result, dependencies))),
        }),
    }),
  })).watch
}

// FOCUS: A SUBSCRIPTION

/**
 * A Subscription entry that bumps `focusSignal` each time the app comes
 * back to the front, and then sends `toMessage()`. Needs `AppState` from
 * `src/device` in `resources`.
 *
 *   focus: focusEntry(() => Message.ReturnedToApp()),
 *
 * Starting the app is not coming back: the first report is skipped.
 */
export const focusEntry = <Message>(toMessage: () => Message) =>
  Subscription.persistentEntry<Message, ServerState | AppState>(
    Stream.unwrap(
      Effect.gen(function* () {
        const { registry } = yield* ServerState
        const appState = yield* AppState
        let wasAway = false
        let hasStarted = false
        return streamOf('app state', appState.statuses).pipe(
          Stream.map(status => {
            const cameBack = hasStarted && wasAway && status === 'active'
            hasStarted = true
            wasAway = status !== 'active'
            if (cameBack) registry.update(focusSignal, count => count + 1)
            return cameBack
          }),
          Stream.filter(cameBack => cameBack),
          Stream.map(toMessage),
        )
      }),
    ),
  )
