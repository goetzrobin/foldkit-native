/**
 * The pretend server and the client layer for the server state demo.
 *
 * There is no network here. `makeCrewServer` keeps a crew of 200 in memory
 * and answers slowly on purpose, so loading can be seen. It counts every
 * request and writes each one down. It can be told to fail the next request,
 * and it can change a member "from another device": the data changes, and
 * this phone is not told.
 *
 * Below it is the client layer a real app would have: the reads as atoms,
 * the writes, and the sync topics that tie them together. It is the same
 * shape whether the API is a fake like this one or a real one.
 */
import { Context, Data, Duration, Effect, Layer, Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'

import type { Source } from '../../src/device/index.js'
import { type Sync, makeSync } from '../../src/serverState/index.js'

// THE DATA

export const Member = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  role: Schema.String,
  /** How many notes have been written about this member. */
  notes: Schema.Number,
})
export type Member = typeof Member.Type

/** The server said no, or could not be reached. */
export class CrewError extends Schema.TaggedError<CrewError>()('CrewError', {
  request: Schema.String,
  reason: Schema.String,
}) {}

// THE API, AS THE APP SEES IT

export type CrewApiService = Readonly<{
  /** GET /crew */
  list: Effect.Effect<ReadonlyArray<Member>, CrewError>
  /** GET /crew/:id */
  get: (id: number) => Effect.Effect<Member, CrewError>
  /** PUT /crew/:id */
  rename: (id: number, name: string) => Effect.Effect<Member, CrewError>
  /** POST /crew/:id/notes */
  addNote: (id: number) => Effect.Effect<Member, CrewError>
}>

export class CrewApi extends Context.Service<CrewApi, CrewApiService>()('demo/CrewApi') {}

// THE PRETEND SERVER

const FIRST_NAMES = [
  'Ada', 'Bram', 'Cleo', 'Dov', 'Esme', 'Finn', 'Greta', 'Hugo', 'Ines', 'Jory',
  'Kaia', 'Lev', 'Mira', 'Nico', 'Oona', 'Pax', 'Quill', 'Rhea', 'Sol', 'Tove',
] as const
const LAST_NAMES = [
  'Marlow', 'Okafor', 'Lindqvist', 'Abara', 'Castell', 'Dunmore', 'Ferro', 'Hale', 'Ibarra', 'Voss',
] as const
const ROLES = [
  'Navigator', 'Engineer', 'Cook', 'Medic', 'Deckhand', 'Pilot', 'Lookout', 'Quartermaster',
] as const

export const CREW_SIZE = 200

const firstCrew = (): Array<Member> =>
  Array.from({ length: CREW_SIZE }, (_, index) => ({
    id: index + 1,
    name: `${FIRST_NAMES[index % FIRST_NAMES.length]} ${
      LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]
    }`,
    role: index === 0 ? 'Captain' : (ROLES[index % ROLES.length] as string),
    notes: index % 4,
  }))

/** One line of the server's log, and where the server stands after it. */
export type ServerEvent = Readonly<{
  line: string
  /** Requests received so far, this one included. */
  requests: number
  /** Whether the next request is set to fail. */
  isFailureArmed: boolean
}>

export type CrewServer = Readonly<{
  layer: Layer.Layer<CrewApi>
  /** Every request so far, oldest first: "GET /crew", "PUT /crew/3". */
  log: () => ReadonlyArray<string>
  requests: () => number
  /** Requests answered so far, with success or failure. One cut short is not. */
  answered: () => number
  /** Each log line as it is written. Nothing is reported on subscribing. */
  events: Source<ServerEvent>
  latencyMs: () => number
  setLatency: (ms: number) => void
  /** The next request, of any kind, fails. Then things work again. */
  failNext: () => void
  /**
   * Renames a member as another device would: the server's data changes and
   * nothing on this phone is told. Returns the new name.
   */
  renameElsewhere: (id: number) => string
  /** The server's own copy, for a test to check against. */
  peek: (id: number) => Member | undefined
}>

export const DEFAULT_LATENCY_MS = 600

export const makeCrewServer = (
  options: Readonly<{ latencyMs?: number }> = {},
): CrewServer => {
  const crew = firstCrew()
  const log: Array<string> = []
  const listeners = new Set<(event: ServerEvent) => void>()
  let requests = 0
  let answered = 0
  let latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS
  let isFailureArmed = false
  let remoteEdits = 0

  const write = (line: string): void => {
    log.push(line)
    const event: ServerEvent = { line, requests, isFailureArmed }
    for (const listener of [...listeners]) listener(event)
  }

  const find = (request: string, id: number): Effect.Effect<Member, CrewError> => {
    const member = crew.find(each => each.id === id)
    return member === undefined
      ? Effect.fail(new CrewError({ request, reason: 'no such member' }))
      : Effect.succeed(member)
  }

  const change = (id: number, edit: (member: Member) => Member): void => {
    const index = crew.findIndex(each => each.id === id)
    if (index >= 0) crew[index] = edit(crew[index] as Member)
  }

  /**
   * One request: written down when it arrives, answered after the latency.
   * `answer` runs at the end, so it sees what the server holds by then.
   */
  const request = <A>(
    line: string,
    answer: () => Effect.Effect<A, CrewError>,
  ): Effect.Effect<A, CrewError> =>
    Effect.suspend(() => {
      requests += 1
      const willFail = isFailureArmed
      isFailureArmed = false
      write(line)
      return Effect.sleep(Duration.millis(latencyMs)).pipe(
        Effect.flatMap(() => {
          answered += 1
          if (!willFail) return answer()
          write(`${line} failed`)
          return Effect.fail(new CrewError({ request: line, reason: 'the server said no (500)' }))
        }),
      )
    })

  const api: CrewApiService = {
    list: request('GET /crew', () => Effect.succeed([...crew])),
    get: id => request(`GET /crew/${id}`, () => find(`GET /crew/${id}`, id)),
    rename: (id, name) =>
      request(`PUT /crew/${id}`, () => {
        change(id, member => ({ ...member, name }))
        return find(`PUT /crew/${id}`, id)
      }),
    addNote: id =>
      request(`POST /crew/${id}/notes`, () => {
        change(id, member => ({ ...member, notes: member.notes + 1 }))
        return find(`POST /crew/${id}/notes`, id)
      }),
  }

  return {
    layer: Layer.succeed(CrewApi, api),
    log: () => log,
    requests: () => requests,
    answered: () => answered,
    events: {
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    latencyMs: () => latencyMs,
    setLatency: ms => {
      latencyMs = ms
    },
    failNext: () => {
      isFailureArmed = true
    },
    renameElsewhere: id => {
      remoteEdits += 1
      const name = `Renamed elsewhere ${remoteEdits}`
      change(id, member => ({ ...member, name }))
      return name
    },
    peek: id => crew.find(each => each.id === id),
  }
}

// THE CLIENT LAYER: TOPICS, READS, WRITES

/** Every topic this app announces. A topic not listed here stops the program. */
export const CrewSync = makeSync(['crew:member-changed', 'crew:note-added'])
export type CrewTopic = (typeof CrewSync.topics)[number]

/** Which member, and how old its data may be before it is loaded again. */
export class MemberKey extends Data.Class<{
  readonly id: number
  readonly staleSeconds: number
}> {}

export type CrewServices = CrewApi | Sync

export const crewAtomsFor = (
  runtime: Atom.AtomRuntime<CrewServices>,
  { focusSignal }: Readonly<{ focusSignal: Atom.Atom<unknown> }>,
) => {
  /**
   * Stale-while-revalidate: what is held is shown at once. If it is older
   * than `staleSeconds` when a screen opens or the app comes back, it is
   * loaded again behind what is shown.
   */
  const staleAfter = (staleSeconds: number) =>
    Atom.swr({
      staleTime: Duration.seconds(staleSeconds),
      revalidateOnMount: true,
      revalidateOnFocus: true,
      focusSignal,
    })

  // The whole roster. One request, however many screens watch it.
  const rosterSource = runtime
    .atom(CrewApi.use(api => api.list))
    .pipe(CrewSync.refreshOn('crew:member-changed', 'crew:note-added'))

  // The demo lets you change how old "old" is. The loaded roster is shared:
  // only the rule about its age differs between the two.
  const roster = Atom.family((staleSeconds: number) => rosterSource.pipe(staleAfter(staleSeconds)))

  // One member. The id is the family's key, so member 3 is loaded once and
  // every screen that shows member 3 gets the same atom.
  const memberSource = Atom.family((id: number) =>
    runtime
      .atom(CrewApi.use(api => api.get(id)))
      .pipe(CrewSync.refreshOn('crew:member-changed', 'crew:note-added')),
  )

  const member = Atom.family((key: MemberKey) =>
    memberSource(key.id).pipe(staleAfter(key.staleSeconds)),
  )

  /**
   * Rename a member, then announce the topic. `announce: false` is the demo's
   * way of showing what a write without a sync key does to the other screens.
   */
  const rename = runtime.fn(
    Effect.fnUntraced(function* (args: {
      readonly id: number
      readonly name: string
      readonly announce: boolean
    }) {
      const api = yield* CrewApi
      const saved = yield* api.rename(args.id, args.name)
      if (args.announce) yield* CrewSync.invalidate('crew:member-changed')
      return saved
    }),
  )

  /** The same kind of write as a plain Effect, with no atom around it. */
  const addNote = (args: {
    readonly id: number
    readonly announce: boolean
  }): Effect.Effect<Member, CrewError, CrewServices> =>
    Effect.gen(function* () {
      const api = yield* CrewApi
      const saved = yield* api.addNote(args.id)
      if (args.announce) yield* CrewSync.invalidate('crew:note-added')
      return saved
    })

  return { roster, member, rename, addNote }
}

export type CrewAtoms = ReturnType<typeof crewAtomsFor>
