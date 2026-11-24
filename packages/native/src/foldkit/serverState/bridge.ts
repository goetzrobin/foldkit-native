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
  Cause,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  type Schema,
  Stream,
} from 'effect'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import type * as Reactivity from 'effect/reactivity/Reactivity'
import { Subscription } from 'foldkit'

import { AppState } from '../device/appState.js'
import { streamOf } from '../device/common.js'

// SERVICE

export type ServerStateService = Readonly<{
  registry: AtomRegistry.AtomRegistry
  /** How many running Subscriptions watch each atom. For tests and debugging. */
  watchers: Map<Atom.Atom<any>, number>
}>

/** The program's registry. Commands and Subscriptions ask for it. */
export class ServerState extends Context.Service<ServerState, ServerStateService>()(
  'foldkit-native/ServerState',
) {}

/**
 * Goes up by one each time the person comes back to the app. An atom made
 * with `Atom.swr({ revalidateOnFocus: true, focusSignal })` then loads again
 * if what it holds is old. Its value lives in the registry, so each program
 * has its own count.
 */
export const focusSignal: Atom.Writable<number> = Atom.keepAlive(Atom.make(0))

export type ServerStateOptions = Readonly<{
  /**
   * How long loaded data is kept after the last screen stops watching it.
   * Opening the same screen again within this time costs no request.
   * Default 5 minutes.
   */
  idleTtl?: Duration.Input
}>

/** What the atoms' Effects may ask for besides the app's own services. */
type AtomServices = AtomRegistry.AtomRegistry | Reactivity.Reactivity

export type ServerStateHandle<R> = Readonly<{
  /** For Foldkit's `resources`. Makes the registry, and disposes it at the end. */
  layer: Layer.Layer<ServerState>
  /**
   * Runs an Effect with the services the atoms use (the same objects, not
   * copies). For a Command that calls the API or announces a topic.
   */
  provide: <A, E>(effect: Effect.Effect<A, E, R | AtomServices>) => Effect.Effect<A, E, ServerState>
  /** The same for a Stream, for a Subscription such as `sync.listen(topic)`. */
  provideStream: <A, E>(
    stream: Stream.Stream<A, E, R | AtomServices>,
  ) => Stream.Stream<A, E, ServerState>
  /** Asks an atom to load again now. For a Retry button. */
  refresh: (atom: Atom.Atom<any>) => Effect.Effect<void, never, ServerState>
  /**
   * What an atom holds right now, without starting a request and without
   * watching it. `None` before the program starts, after it ends, and when
   * the atom has never been read. For a view that draws a long list straight
   * from the cache: see `docs/SERVER_STATE.md`, "Large lists".
   */
  peek: <A>(atom: Atom.Atom<A>) => Option.Option<A>
  /** How many running Subscriptions watch this atom. */
  watcherCount: (atom: Atom.Atom<any>) => number
  /** Whether the registry exists: true between program start and dispose. */
  isRunning: () => boolean
}>

/**
 * Make one of these for each program, next to its `Atom.runtime`. The handle
 * points at the registry of the program that is running, so two programs
 * running at once must not share a handle.
 */
export const makeServerState = <R, ER>(
  runtime: Atom.AtomRuntime<R, ER>,
  options: ServerStateOptions = {},
): ServerStateHandle<R> => {
  const idleTtl = Duration.toMillis(Duration.fromInputUnsafe(options.idleTtl ?? '5 minutes'))
  let current: ServerStateService | undefined

  const layer = Layer.effect(
    ServerState,
    Effect.acquireRelease(
      Effect.sync(() => {
        const registry = AtomRegistry.make({ defaultIdleTTL: idleTtl })
        // Mounted for the life of the program, so the app's services are
        // built once and are not thrown away between two screens.
        const unmountRuntime = registry.mount(runtime)
        const service: ServerStateService = { registry, watchers: new Map() }
        current = service
        return { service, unmountRuntime }
      }),
      ({ service, unmountRuntime }) =>
        Effect.sync(() => {
          if (current === service) current = undefined
          unmountRuntime()
          service.registry.dispose()
        }),
    ).pipe(Effect.map(({ service }) => service)),
  )

  /** The services the runtime built. A Layer that fails to build is a defect. */
  const services: Effect.Effect<Context.Context<R | AtomServices>, never, ServerState> =
    ServerState.use(({ registry }) =>
      AtomRegistry.getResult(registry, runtime).pipe(
        Effect.orDie,
        Effect.map(context =>
          // The runtime's context holds the app's services and `Reactivity`.
          // The registry is added, as Effect does for an atom's own Effect.
          Context.add(
            context as Context.Context<R | Reactivity.Reactivity>,
            AtomRegistry.AtomRegistry,
            registry,
          ),
        ),
      ),
    )

  return {
    layer,
    provide: effect => Effect.flatMap(services, context => Effect.provide(effect, context)),
    provideStream: stream =>
      Stream.unwrap(Effect.map(services, context => Stream.provideContext(stream, context))),
    refresh: atom => ServerState.useSync(({ registry }) => registry.refresh(atom)),
    peek: atom => {
      if (current === undefined) return Option.none()
      const node = current.registry.getNodes().get(atom)
      return node === undefined ? Option.none() : node.valueOption()
    },
    watcherCount: atom => current?.watchers.get(atom) ?? 0,
    isRunning: () => current !== undefined,
  }
}

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

// WRITE: A COMMAND

/**
 * Why a write did not work. `Rejected` is the write's own typed error, such
 * as "the server said no". `Crashed` is everything else: a bug, or a write
 * cut short because the same write was started again.
 */
export type WriteFailure<E> =
  | Readonly<{ _tag: 'Rejected'; error: E }>
  | Readonly<{ _tag: 'Crashed'; reason: string }>

export type WriteConfig<R, A, E, Succeeded, Failed> = Readonly<{
  onSuccess: (value: A) => Succeeded
  onFailure: (failure: WriteFailure<E>) => Failed
}> &
  (
    | Readonly<{
        /** A plain Effect that needs the services the atoms use. */
        effect: Effect.Effect<A, E, R | AtomServices>
      }>
    | Readonly<{
        /**
         * An atom made with `runtime.fn(...)`, and its argument. One such
         * atom runs one call at a time: a second call cuts the first short.
         */
        fn: Atom.AtomResultFn<any, A, E>
        arg: unknown
      }>
  )

const failureOf = <E>(cause: Cause.Cause<E>): WriteFailure<E> =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (error): WriteFailure<E> => ({ _tag: 'Rejected', error }),
    onNone: (): WriteFailure<E> => ({
      _tag: 'Crashed',
      reason: Cause.hasInterruptsOnly(cause) ? 'The write was cut short' : Cause.pretty(cause),
    }),
  })

/**
 * The Effect for a Command that writes to the server. It never fails: the
 * answer is always a Message, made by `onSuccess` or by `onFailure`.
 *
 *   const SaveName = Command.define('SaveName', {
 *     args: { id: Schema.Number, name: Schema.String },
 *     messages: [Message.SucceededSave, Message.FailedSave],
 *     execute: ({ id, name }) =>
 *       runWrite(server, {
 *         fn: crew.rename,
 *         arg: { id, name },
 *         onSuccess: member => Message.SucceededSave({ member }),
 *         onFailure: failure => Message.FailedSave({ reason: describe(failure) }),
 *       }),
 *   })
 *
 * The write announces its own sync topic (see `sync.ts`). Nothing here
 * refreshes a read: the reads that named the topic do that themselves.
 */
export const runWrite = <R, A, E, Succeeded, Failed>(
  server: ServerStateHandle<R>,
  config: WriteConfig<R, A, E, Succeeded, Failed>,
): Effect.Effect<Succeeded | Failed, never, ServerState> => {
  const exit: Effect.Effect<Exit.Exit<A, E>, never, ServerState> =
    'effect' in config
      ? Effect.exit(server.provide(config.effect))
      : ServerState.use(({ registry }) =>
          Effect.scoped(
            Effect.gen(function* () {
              // Mounted for the length of the call, so the registry keeps it.
              yield* AtomRegistry.mount(registry, config.fn)
              registry.set(config.fn, config.arg)
              return yield* Effect.exit(
                AtomRegistry.getResult(registry, config.fn, { suspendOnWaiting: true }),
              )
            }),
          ),
        )
  return Effect.map(
    exit,
    Exit.match({
      onSuccess: (value): Succeeded | Failed => config.onSuccess(value),
      onFailure: (cause): Succeeded | Failed => config.onFailure(failureOf(cause)),
    }),
  )
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
