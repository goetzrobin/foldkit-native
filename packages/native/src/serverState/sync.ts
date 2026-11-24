/**
 * Sync keys: how one part of an app tells the others that data on the
 * server has changed.
 *
 * A screen that saves something announces a topic, such as
 * "crew:member-changed". Every piece of loaded data that named that topic
 * loads itself again. The screen that saved does not know who is listening,
 * and the listeners do not know who saved. A topic carries no data: it only
 * says "what you hold may be old".
 *
 *   export const CrewSync = makeSync(['crew:member-changed'])
 *
 *   // a read that loads again when the topic is announced
 *   runtime.atom(loadCrew).pipe(CrewSync.refreshOn('crew:member-changed'))
 *
 *   // a write that announces it
 *   yield* api.rename(id, name)
 *   yield* CrewSync.invalidate('crew:member-changed')
 *
 * For engineers. This sits on Effect's `Reactivity` service. The topic list
 * is closed: a topic that is not in it stops the program with a clear
 * message, in `invalidate`, in `listen`, and where an atom is defined
 * (`reactivityKey`, `refreshOn`). A typing mistake is therefore loud.
 *
 * `reactivityKey(topic)` is the key for `Atom.runtime.withReactivity([...])`.
 * `refreshOn(...topics)` is the same thing plus one repair. In Effect 4.1.0
 * the wrapper that listens for a key lives only while a screen is watching
 * the atom, but the loaded value is kept for a while after (its idle time).
 * A topic announced in that gap is missed, and the next screen to open gets
 * the old value marked as new. `refreshOn` counts announcements for each
 * registry and, when an atom is watched again, loads it again if the count
 * moved while nobody was watching.
 */
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from 'effect'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { AtomRegistry } from 'effect/reactivity/AtomRegistry'
import * as Reactivity from 'effect/reactivity/Reactivity'

/** Keeps these keys apart from anything else that uses `Reactivity`. */
const KEY_PREFIX = 'foldkit-native/sync:'

export type SyncService = Readonly<{
  /** Announce a topic. Dies if the topic is not in the list. */
  invalidate: (topic: string) => Effect.Effect<void>
  /** One empty value for each announcement, from now on. Dies if unknown. */
  listen: (topic: string) => Stream.Stream<void>
}>

/** The bus itself. An app has one, built by `makeSync(topics).layer`. */
export class Sync extends Context.Service<Sync, SyncService>()('foldkit-native/Sync') {}

/**
 * How many times each topic was announced, for each registry. A registry is
 * one running program, so two programs (or two tests) never share counts.
 */
const announcementsByRegistry = new WeakMap<object, Map<string, number>>()

const announcedCount = (registry: object, topics: ReadonlyArray<string>): number => {
  const counts = announcementsByRegistry.get(registry)
  if (counts === undefined) return 0
  let total = 0
  for (const topic of topics) total += counts.get(topic) ?? 0
  return total
}

const countAnnouncement = (registry: object, topic: string): void => {
  const counts = announcementsByRegistry.get(registry) ?? new Map<string, number>()
  counts.set(topic, (counts.get(topic) ?? 0) + 1)
  announcementsByRegistry.set(registry, counts)
}

export type SyncBus<Topic extends string> = Readonly<{
  /** The topics as a Schema, for a Model or a Message that names one. */
  Topic: Schema.Literals<ReadonlyArray<Topic>>
  topics: ReadonlyArray<Topic>
  /**
   * Give this to the Layer the atoms run in:
   * `Atom.runtime(Layer.mergeAll(apiLayer, CrewSync.layer))`.
   */
  layer: Layer.Layer<Sync, never, Reactivity.Reactivity>
  invalidate: (topic: Topic) => Effect.Effect<void, never, Sync>
  listen: (topic: Topic) => Stream.Stream<void, never, Sync>
  /** The key for `Atom.runtime.withReactivity([...])`. Throws if unknown. */
  reactivityKey: (topic: Topic) => string
  /**
   * Makes an atom load again when any of the topics is announced, including
   * one announced while no screen was watching it.
   */
  refreshOn: (
    ...topics: ReadonlyArray<Topic>
  ) => <A extends Atom.Atom<AsyncResult.AsyncResult<any, any>>>(atom: A) => A
}>

export const makeSync = <const Topics extends ReadonlyArray<string>>(
  topics: Topics,
): SyncBus<Topics[number]> => {
  type Topic = Topics[number]
  const known = new Set<string>(topics)

  const complaint = (topic: string): string =>
    `Sync: unknown topic "${topic}". The topics are: ${topics.join(', ')}. ` +
    'Add it to the list given to makeSync.'

  const keyFor = (topic: string): string => {
    if (!known.has(topic)) throw new Error(complaint(topic))
    return `${KEY_PREFIX}${topic}`
  }

  /** The same check inside an Effect: a defect, never a typed failure. */
  const check = (topic: string): Effect.Effect<string> =>
    known.has(topic) ? Effect.succeed(`${KEY_PREFIX}${topic}`) : Effect.die(new Error(complaint(topic)))

  const layer = Layer.effect(
    Sync,
    Effect.gen(function* () {
      const reactivity = yield* Reactivity.Reactivity
      // Present when the Layer is built for atoms, absent in a plain Effect.
      const maybeRegistry = yield* Effect.serviceOption(AtomRegistry)

      return Sync.of({
        invalidate: topic =>
          Effect.flatMap(check(topic), key => {
            // Counted first, so an atom that hears the announcement and one
            // that is watched again later both see the same count.
            if (Option.isSome(maybeRegistry)) countAnnouncement(maybeRegistry.value, topic)
            return reactivity.invalidate([key])
          }),
        listen: topic =>
          Stream.unwrap(
            Effect.map(check(topic), key =>
              Stream.callback<void>(queue =>
                Effect.acquireRelease(
                  Effect.sync(() =>
                    reactivity.registerUnsafe([key], () => {
                      Queue.offerUnsafe(queue, undefined)
                    }),
                  ),
                  stop => Effect.sync(stop),
                ),
              ),
            ),
          ),
      })
    }),
  )

  const refreshOn = (...watched: ReadonlyArray<Topic>) => {
    // Checked here, where the atom is defined, not when it is first used.
    const keys = watched.map(keyFor)
    return <A extends Atom.Atom<AsyncResult.AsyncResult<any, any>>>(atom: A): A => {
      const live = Atom.runtime.withReactivity(keys)(atom)
      /** The count when the last watcher left, for each registry. */
      const countWhenLeft = new WeakMap<object, number>()

      // This wrapper is built when a first screen watches the atom and thrown
      // away when the last one leaves. Those are the two moments needed.
      const wrapped = Atom.transform(
        live,
        get => {
          const registry = get.registry
          get.subscribe(live, value => get.setSelf(value))
          const current = get.once(live)

          let isWatched = true
          get.addFinalizer(() => {
            isWatched = false
            countWhenLeft.set(registry, announcedCount(registry, watched))
          })

          const before = countWhenLeft.get(registry)
          const missedOne = before !== undefined && before !== announcedCount(registry, watched)
          // A value still loading is already on its way to being new.
          if (missedOne && !current.waiting && current._tag !== 'Initial') {
            // After this read has returned, as Effect's own `swr` does it.
            registry.schedulerAsync.makeDispatcher().scheduleTask(() => {
              if (isWatched) get.refresh(live)
            }, 0)
          }
          return current
        },
        { initialValueTarget: atom },
      )
      return wrapped as unknown as A
    }
  }

  return {
    Topic: Schema.Literals(topics as ReadonlyArray<Topic>),
    topics,
    layer,
    invalidate: topic => Sync.use(sync => sync.invalidate(topic)),
    listen: topic => Stream.unwrap(Sync.use(sync => Effect.succeed(sync.listen(topic)))),
    reactivityKey: keyFor,
    refreshOn,
  }
}
