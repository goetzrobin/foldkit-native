/**
 * The server state demo: a crew roster that lives on a (pretend) server.
 *
 * Two screens: the roster, and one member with a name you can edit. A panel
 * at the top of both says what just happened: whether each piece of data is
 * loading, fresh, stale, refreshing or failed, how old it is, how many
 * requests the server has received, and the last three things that happened.
 * The buttons under it change the conditions: slow the server down, make the
 * next request fail, change a member from "another device", and switch off
 * the two things that keep screens in step, to see what breaks.
 *
 * The Model does not hold the roster. It holds what the screen's chrome
 * needs: a status, a count, a time. The 200 rows are drawn straight from the
 * cache. The open member is small, so its whole result is in the Model.
 *
 * See `docs/SERVER_STATE.md` for the idea, and `serverStateCrew.ts` for the
 * pretend server and the client layer.
 */
import { Duration, Effect, Layer, Option, Schema, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { type AppState, type Services, streamOf } from '../../src/device/index.js'
import {
  type Device,
  header,
  onDismissed,
  prop,
  safeArea,
  screen,
  stack,
  style,
  text,
  textInput,
  title,
  view as box,
} from '../../src/index.js'
import { list } from '../../src/list/index.js'
import {
  Optimistic,
  type ServerState,
  type WriteFailure,
  focusEntry,
  focusSignal,
  makeServerState,
  runWrite,
  watchAtom,
} from '../../src/serverState/index.js'
import {
  CrewError,
  type CrewServer,
  CrewSync,
  Member,
  MemberKey,
  crewAtomsFor,
  makeCrewServer,
} from './serverStateCrew.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

export type ServerStateDemoOptions = Readonly<{
  /** The pretend server. A test passes its own to read its log. */
  api?: CrewServer
  /** Added to the Layer the atoms run in. A test passes a clock it controls. */
  extra?: Layer.Layer<never>
  /** How often the ages on screen are brought up to date. Default 1000 ms. */
  tickMs?: number
  /** How long loaded data is kept once no screen shows it. Default 5 minutes. */
  idleTtl?: Duration.Input
}>

const LATENCIES = [100, 600, 2000] as const
const STALE_CHOICES = [30, 5] as const
const LOG_LINES_KEPT = 8
const LOG_LINES_SHOWN = 3
const ROW_HEIGHT = 56
export const LIST_ID = 'crew-roster'

// MODEL

/**
 * What the roster screen needs to know about the roster. The members
 * themselves stay in the cache: see `rosterRows`.
 */
const RosterInfo = Schema.Struct({
  phase: Schema.Literals(['loading', 'ready', 'failed']),
  /** A request is on its way. With `ready`, the old rows are still shown. */
  isWaiting: Schema.Boolean,
  count: Schema.Number,
  /** When the rows on screen were loaded, in milliseconds. 0 for never. */
  fetchedAt: Schema.Number,
  /** Why the last load failed, or empty. */
  error: Schema.String,
})
type RosterInfo = typeof RosterInfo.Type

const MemberResult = AsyncResult.Schema({ success: Member, error: CrewError })
type MemberResult = AsyncResult.AsyncResult<Member, CrewError>

const NamePatch = Schema.Struct({ name: Schema.String })

export const Model = Schema.Struct({
  maybeOpenId: Schema.Option(Schema.Number),
  roster: RosterInfo,
  /** The open member, as the cache reports it. Small, so all of it is here. */
  member: MemberResult,
  /** True until the cache has answered once for the member just opened. */
  isAwaitingFirstMemberResult: Schema.Boolean,
  /** The crew count as the member screen's own Subscription reports it. */
  maybeCrewCount: Schema.Option(Schema.Number),
  draft: Schema.String,
  isDraftTouched: Schema.Boolean,
  /** The new name, shown before the server has answered. */
  overlay: Optimistic.Overlay(NamePatch),
  nextWriteId: Schema.Number,
  saveStatus: Schema.String,
  noteStatus: Schema.String,
  /** The time, brought up to date about once a second, for the ages on screen. */
  now: Schema.Number,
  latencyMs: Schema.Number,
  staleSeconds: Schema.Number,
  isAnnouncing: Schema.Boolean,
  isOptimistic: Schema.Boolean,
  isFailureArmed: Schema.Boolean,
  requests: Schema.Number,
  log: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  PressedMember: { id: Schema.Number },
  PressedBack: {},
  PoppedByPhone: { count: Schema.Number },
  ChangedRoster: { roster: RosterInfo },
  ChangedCrewCount: { maybeCount: Schema.Option(Schema.Number) },
  ChangedMember: { id: Schema.Number, result: MemberResult },
  ChangedDraft: { text: Schema.String },
  PressedSave: {},
  SucceededSave: { writeId: Schema.Number },
  FailedSave: { writeId: Schema.Number, reason: Schema.String },
  PressedAddNote: {},
  SucceededAddNote: {},
  FailedAddNote: { reason: Schema.String },
  PressedRetryRoster: {},
  PressedRetryMember: {},
  CompletedRetry: {},
  PressedRemoteEdit: {},
  CompletedRemoteEdit: { id: Schema.Number },
  PressedFailNext: {},
  CompletedArmFailure: {},
  PressedLatency: {},
  CompletedSetLatency: {},
  PressedStale: {},
  PressedAnnounce: {},
  PressedOptimistic: {},
  Ticked: { now: Schema.Number },
  LoggedRequest: {
    line: Schema.String,
    requests: Schema.Number,
    isFailureArmed: Schema.Boolean,
  },
  AnnouncedTopic: { topic: CrewSync.Topic },
  ReturnedToApp: {},
})
export type Message = typeof Message.Type

// READING THE CACHE'S RESULTS

/** The loaded value, also when a later load failed and the old one was kept. */
const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): Option.Option<A> =>
  AsyncResult.value(result)

/** When the value on screen was loaded. 0 when there is none. */
const fetchedAtOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): number => {
  if (result._tag === 'Success') return result.timestamp
  if (result._tag === 'Failure') {
    return Option.match(result.previousSuccess, {
      onNone: () => 0,
      onSome: previous => previous.timestamp,
    })
  }
  return 0
}

const errorOf = (result: AsyncResult.AsyncResult<unknown, CrewError>): string =>
  result._tag !== 'Failure'
    ? ''
    : Option.match(AsyncResult.error(result), {
        onNone: () => 'something went wrong',
        onSome: error => error.reason,
      })

/** The roster's result cut down to what the Model keeps. This is the saving. */
const rosterInfoOf = (
  result: AsyncResult.AsyncResult<ReadonlyArray<Member>, CrewError>,
): RosterInfo => ({
  phase: result._tag === 'Failure' ? 'failed' : result._tag === 'Success' ? 'ready' : 'loading',
  isWaiting: result.waiting,
  count: Option.match(valueOf(result), { onNone: () => 0, onSome: members => members.length }),
  fetchedAt: fetchedAtOf(result),
  error: errorOf(result),
})

export type Status = 'loading' | 'fresh' | 'stale' | 'refreshing' | 'failed'

type Reading = Readonly<{
  hasValue: boolean
  isWaiting: boolean
  hasFailed: boolean
  fetchedAt: number
}>

const statusOf = (reading: Reading, now: number, staleSeconds: number): Status => {
  if (reading.isWaiting) return reading.hasValue ? 'refreshing' : 'loading'
  if (reading.hasFailed) return 'failed'
  if (!reading.hasValue) return 'loading'
  return now - reading.fetchedAt >= staleSeconds * 1000 ? 'stale' : 'fresh'
}

const rosterReading = (roster: RosterInfo): Reading => ({
  hasValue: roster.fetchedAt > 0 || roster.count > 0,
  isWaiting: roster.isWaiting,
  hasFailed: roster.phase === 'failed',
  fetchedAt: roster.fetchedAt,
})

const memberReading = (result: MemberResult): Reading => ({
  hasValue: Option.isSome(valueOf(result)),
  isWaiting: result.waiting,
  hasFailed: result._tag === 'Failure',
  fetchedAt: fetchedAtOf(result),
})

const statusLine = (reading: Reading, now: number, staleSeconds: number): string => {
  const status = statusOf(reading, now, staleSeconds)
  if (!reading.hasValue) return status
  const age = Math.max(0, Math.floor((now - reading.fetchedAt) / 1000))
  return `${status}, ${age} s old`
}

/** What happened between two readings, in the panel's words. Empty for nothing. */
const happened = (what: string, before: Reading, after: Reading): string => {
  if (after.isWaiting) return ''
  if (after.hasFailed) return before.hasFailed && !before.isWaiting ? '' : `${what} failed to load`
  if (!after.hasValue) return ''
  if (!before.isWaiting) return ''
  return before.hasValue ? `${what} refetched` : `${what} loaded`
}

const describeFailure = (failure: WriteFailure<CrewError>): string =>
  failure._tag === 'Rejected' ? failure.error.reason : failure.reason

const logged = (model: Model, ...lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...model.log, ...lines.filter(line => line !== '')].slice(-LOG_LINES_KEPT)

const nextOf = <A>(choices: ReadonlyArray<A>, current: A): A =>
  choices[(choices.indexOf(current) + 1) % choices.length] as A

// THE PROGRAM

export const makeServerStateDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Services>,
  options: ServerStateDemoOptions = {},
) => {
  const api = options.api ?? makeCrewServer()

  // The services the atoms use. The registry builds this Layer once, and
  // Commands borrow the result through `server.provide`.
  const runtime = Atom.runtime(
    Layer.mergeAll(api.layer, CrewSync.layer, options.extra ?? Layer.empty),
  )
  const crew = crewAtomsFor(runtime, { focusSignal })
  const server = makeServerState(runtime, {
    ...(options.idleTtl === undefined ? {} : { idleTtl: options.idleTtl }),
  })

  type Resources = ServerState | Services
  type Return = Update.Return<Model, Message, Resources>

  // COMMAND

  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })

  /** A write through an atom made with `runtime.fn`. */
  const SaveName = Command.define('SaveName', {
    args: {
      id: Schema.Number,
      name: Schema.String,
      announce: Schema.Boolean,
      writeId: Schema.Number,
    },
    messages: [Message.SucceededSave, Message.FailedSave],
    execute: ({ id, name, announce, writeId }) =>
      runWrite(server, {
        fn: crew.rename,
        arg: { id, name, announce },
        onSuccess: () => Message.SucceededSave({ writeId }),
        onFailure: failure =>
          Message.FailedSave({ writeId, reason: describeFailure(failure) }),
      }),
  })

  /** A write as a plain Effect. It needs the same services the atoms use. */
  const AddNote = Command.define('AddNote', {
    args: { id: Schema.Number, announce: Schema.Boolean },
    messages: [Message.SucceededAddNote, Message.FailedAddNote],
    execute: ({ id, announce }) =>
      runWrite(server, {
        effect: crew.addNote({ id, announce }),
        onSuccess: () => Message.SucceededAddNote(),
        onFailure: failure => Message.FailedAddNote({ reason: describeFailure(failure) }),
      }),
  })

  const RetryRoster = Command.define('RetryRoster', {
    args: { staleSeconds: Schema.Number },
    messages: [Message.CompletedRetry],
    execute: ({ staleSeconds }) =>
      server.refresh(crew.roster(staleSeconds)).pipe(Effect.as(Message.CompletedRetry())),
  })

  const RetryMember = Command.define('RetryMember', {
    args: { id: Schema.Number, staleSeconds: Schema.Number },
    messages: [Message.CompletedRetry],
    execute: ({ id, staleSeconds }) =>
      server
        .refresh(crew.member(new MemberKey({ id, staleSeconds })))
        .pipe(Effect.as(Message.CompletedRetry())),
  })

  // The three Commands below reach into the pretend server directly. A real
  // app has no such door: they stand for things outside the app's control.

  const RemoteEdit = Command.define('RemoteEdit', {
    args: { id: Schema.Number },
    messages: [Message.CompletedRemoteEdit],
    execute: ({ id }) =>
      Effect.sync(() => {
        api.renameElsewhere(id)
        return Message.CompletedRemoteEdit({ id })
      }),
  })

  const ArmFailure = Command.define('ArmFailure', {
    messages: [Message.CompletedArmFailure],
    execute: Effect.sync(() => {
      api.failNext()
      return Message.CompletedArmFailure()
    }),
  })

  const SetLatency = Command.define('SetLatency', {
    args: { ms: Schema.Number },
    messages: [Message.CompletedSetLatency],
    execute: ({ ms }) =>
      Effect.sync(() => {
        api.setLatency(ms)
        return Message.CompletedSetLatency()
      }),
  })

  // INIT

  const init = (): Return => ({
    model: {
      maybeOpenId: Option.none(),
      roster: { phase: 'loading', isWaiting: true, count: 0, fetchedAt: 0, error: '' },
      member: AsyncResult.initial(),
      isAwaitingFirstMemberResult: false,
      maybeCrewCount: Option.none(),
      draft: '',
      isDraftTouched: false,
      overlay: Optimistic.none(),
      nextWriteId: 1,
      saveStatus: '',
      noteStatus: '',
      now: Date.now(),
      latencyMs: api.latencyMs(),
      staleSeconds: STALE_CHOICES[0],
      isAnnouncing: true,
      isOptimistic: true,
      isFailureArmed: false,
      requests: api.requests(),
      log: [],
    },
  })

  // UPDATE

  const closeMember = (model: Model): Model =>
    Option.match(model.maybeOpenId, {
      onNone: () => model,
      onSome: id =>
        modifyFields(model, {
          maybeOpenId: () => Option.none(),
          maybeCrewCount: () => Option.none(),
          overlay: () => Optimistic.none(),
          log: () => logged(model, `left member ${id}: stopped watching it`),
        }),
    })

  const update = (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),

      PressedMember: ({ id }) => ({
        model: modifyFields(model, {
          maybeOpenId: () => Option.some(id),
          member: () => AsyncResult.initial(true),
          isAwaitingFirstMemberResult: () => true,
          draft: () => '',
          isDraftTouched: () => false,
          overlay: () => Optimistic.none(),
          saveStatus: () => '',
          noteStatus: () => '',
        }),
      }),
      PressedBack: () => ({ model: closeMember(model) }),
      PoppedByPhone: () => ({ model: closeMember(model) }),

      ChangedRoster: ({ roster }) => ({
        model: modifyFields(model, {
          roster: () => roster,
          now: now => Math.max(now, roster.fetchedAt),
          log: () =>
            logged(model, happened('list', rosterReading(model.roster), rosterReading(roster))),
        }),
      }),

      ChangedCrewCount: ({ maybeCount }) => ({
        model: modifyFields(model, { maybeCrewCount: () => maybeCount }),
      }),

      ChangedMember: ({ id, result }) => {
        // An answer for a member that has since been closed.
        if (!Option.contains(model.maybeOpenId, id)) return { model }
        const maybeMember = valueOf(result)
        const isFromCache = model.isAwaitingFirstMemberResult && Option.isSome(maybeMember)
        return {
          model: modifyFields(model, {
            member: () => result,
            isAwaitingFirstMemberResult: () => false,
            overlay: overlay => Optimistic.settle(overlay, result),
            // The field starts with the server's name, until the person types.
            draft: draft =>
              model.isDraftTouched
                ? draft
                : Option.match(maybeMember, { onNone: () => draft, onSome: member => member.name }),
            now: now => Math.max(now, fetchedAtOf(result)),
            log: () =>
              logged(
                model,
                isFromCache
                  ? `member ${id} shown from the cache`
                  : happened(`member ${id}`, memberReading(model.member), memberReading(result)),
              ),
          }),
        }
      },

      ChangedDraft: ({ text: draft }) => ({
        model: modifyFields(model, { draft: () => draft, isDraftTouched: () => true }),
      }),

      PressedSave: () => {
        const name = model.draft.trim()
        if (name === '' || Option.isNone(model.maybeOpenId)) return { model }
        const id = model.maybeOpenId.value
        const writeId = model.nextWriteId
        return {
          model: modifyFields(model, {
            nextWriteId: () => writeId + 1,
            // Optimistic: the new name is on screen before the request has left.
            overlay: overlay => (model.isOptimistic ? Optimistic.begin(writeId, { name }) : overlay),
            saveStatus: () => 'Saving…',
          }),
          commands: [SaveName({ id, name, announce: model.isAnnouncing, writeId })],
        }
      },
      SucceededSave: ({ writeId }) => ({
        model: modifyFields(model, {
          overlay: overlay => Optimistic.confirm(overlay, writeId),
          saveStatus: () => 'Saved',
        }),
      }),
      FailedSave: ({ writeId, reason }) => {
        const hadOverlay = Option.isSome(model.overlay)
        return {
          model: modifyFields(model, {
            // The roll back: the layer comes off and the server's name shows.
            overlay: overlay => Optimistic.rollBack(overlay, writeId),
            saveStatus: () =>
              hadOverlay
                ? `Could not save: ${reason}. The old name was put back.`
                : `Could not save: ${reason}.`,
            log: () => logged(model, hadOverlay ? 'save failed: old name put back' : 'save failed'),
          }),
        }
      },

      PressedAddNote: () =>
        Option.match(model.maybeOpenId, {
          onNone: (): Return => ({ model }),
          onSome: id => ({
            model: modifyFields(model, { noteStatus: () => 'Adding a note…' }),
            commands: [AddNote({ id, announce: model.isAnnouncing })],
          }),
        }),
      SucceededAddNote: () => ({
        model: modifyFields(model, { noteStatus: () => 'Note added' }),
      }),
      FailedAddNote: ({ reason }) => ({
        model: modifyFields(model, { noteStatus: () => `Could not add a note: ${reason}.` }),
      }),

      PressedRetryRoster: () => ({
        model,
        commands: [RetryRoster({ staleSeconds: model.staleSeconds })],
      }),
      PressedRetryMember: () =>
        Option.match(model.maybeOpenId, {
          onNone: (): Return => ({ model }),
          onSome: id => ({
            model,
            commands: [RetryMember({ id, staleSeconds: model.staleSeconds })],
          }),
        }),
      CompletedRetry: () => ({ model }),

      PressedRemoteEdit: () => ({
        model,
        // The open member if there is one, otherwise the first row of the list.
        commands: [RemoteEdit({ id: Option.getOrElse(model.maybeOpenId, () => 1) })],
      }),
      CompletedRemoteEdit: ({ id }) => ({
        model: modifyFields(model, {
          log: () => logged(model, `another device renamed member ${id}: no topic here`),
        }),
      }),

      PressedFailNext: () => ({ model, commands: [ArmFailure()] }),
      CompletedArmFailure: () => ({
        model: modifyFields(model, { isFailureArmed: () => true }),
      }),

      PressedLatency: () => {
        const ms = nextOf<number>(LATENCIES, model.latencyMs)
        return {
          model: modifyFields(model, { latencyMs: () => ms }),
          commands: [SetLatency({ ms })],
        }
      },
      CompletedSetLatency: () => ({ model }),

      PressedStale: () => ({
        model: modifyFields(model, {
          staleSeconds: staleSeconds => nextOf<number>(STALE_CHOICES, staleSeconds),
        }),
      }),
      PressedAnnounce: () => ({
        model: modifyFields(model, { isAnnouncing: isAnnouncing => !isAnnouncing }),
      }),
      PressedOptimistic: () => ({
        model: modifyFields(model, { isOptimistic: isOptimistic => !isOptimistic }),
      }),

      Ticked: ({ now }) => ({ model: modifyFields(model, { now: () => now }) }),

      LoggedRequest: ({ line, requests, isFailureArmed }) => ({
        model: modifyFields(model, {
          requests: () => requests,
          isFailureArmed: () => isFailureArmed,
          log: () => logged(model, line),
        }),
      }),
      AnnouncedTopic: ({ topic }) => ({
        model: modifyFields(model, { log: () => logged(model, `topic ${topic} announced`) }),
      }),
      ReturnedToApp: () => ({
        model: modifyFields(model, { log: () => logged(model, 'came back to the app') }),
      }),
    })

  // SUBSCRIPTION

  const subscriptions = Subscription.make<Model, Message, ServerState | AppState.AppState>()(
    () => ({
      // The roster screen is always there, under the member screen too.
      roster: watchAtom(
        { staleSeconds: Schema.Number },
        {
          modelToDependencies: (model: Model) => ({ staleSeconds: model.staleSeconds }),
          atom: ({ staleSeconds }) => Option.some(crew.roster(staleSeconds)),
          // Only the summary crosses into the Model, not 200 members.
          toMessage: (result): Message => Message.ChangedRoster({ roster: rosterInfoOf(result) }),
        },
      ),

      // The member screen shows the crew count, so it watches the roster as
      // well. Two watchers, one atom, one request.
      crewCount: watchAtom(
        { isMemberOpen: Schema.Boolean, staleSeconds: Schema.Number },
        {
          modelToDependencies: (model: Model) => ({
            isMemberOpen: Option.isSome(model.maybeOpenId),
            staleSeconds: model.staleSeconds,
          }),
          atom: ({ isMemberOpen, staleSeconds }) =>
            isMemberOpen ? Option.some(crew.roster(staleSeconds)) : Option.none(),
          toMessage: (result): Message =>
            Message.ChangedCrewCount({
              maybeCount: Option.map(valueOf(result), members => members.length),
            }),
        },
      ),

      // Watched only while a member is open. Closing the screen stops it.
      member: watchAtom(
        { maybeOpenId: Schema.Option(Schema.Number), staleSeconds: Schema.Number },
        {
          modelToDependencies: (model: Model) => ({
            maybeOpenId: model.maybeOpenId,
            staleSeconds: model.staleSeconds,
          }),
          atom: ({ maybeOpenId, staleSeconds }) =>
            Option.map(maybeOpenId, id => crew.member(new MemberKey({ id, staleSeconds }))),
          toMessage: (result, { maybeOpenId }): Message =>
            Message.ChangedMember({ id: Option.getOrElse(maybeOpenId, () => 0), result }),
        },
      ),

      focus: focusEntry((): Message => Message.ReturnedToApp()),

      requests: Subscription.persistentEntry(
        Stream.map(
          streamOf('crew server', api.events),
          (event): Message => Message.LoggedRequest(event),
        ),
      ),

      // `listen` is the other half of a sync key: it is how anything that is
      // not an atom hears an announcement. Here it only feeds the log.
      topics: Subscription.persistentEntry(
        server.provideStream(
          Stream.mergeAll(
            CrewSync.topics.map(topic =>
              Stream.map(CrewSync.listen(topic), (): Message => Message.AnnouncedTopic({ topic })),
            ),
            { concurrency: 'unbounded' },
          ),
        ),
      ),

      clock: Subscription.persistentEntry(
        Stream.tick(Duration.millis(options.tickMs ?? 1000)).pipe(
          Stream.map((): Message => Message.Ticked({ now: Date.now() })),
        ),
      ),
    }),
  )

  // VIEW

  /**
   * The rows, read from the cache at draw time. The Model's `roster` changes
   * whenever these do, and that is what makes the view run again.
   */
  const rosterRows = (model: Model): ReadonlyArray<Member> =>
    Option.match(server.peek(crew.roster(model.staleSeconds)), {
      onNone: () => [],
      onSome: result => Option.getOrElse(valueOf(result), () => []),
    })

  const view = makeView(env.device, rosterRows)

  const program = Runtime.makeElement({
    Model,
    init,
    update,
    view,
    subscriptions,
    resources: Layer.mergeAll(server.layer, resources),
    container,
  })

  return { program, server, api, crew }
}

export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Services>,
  options: ServerStateDemoOptions = {},
) => makeServerStateDemo(container, env, resources, options).program

// VIEW

const PAPER = '#f4f4f2'
const CARD = '#ffffff'
const INK = '#111111'
const MUTED = '#5f5f5f'
const LINE = '#dcdcd8'
const ACCENT = '#0a66d8'
const DANGER = '#c62828'
const ON_ACCENT = '#ffffff'

const STATUS_COLOR: Readonly<Record<Status, string>> = {
  loading: MUTED,
  fresh: '#1b7f3b',
  stale: '#a15c00',
  refreshing: ACCENT,
  failed: DANGER,
}

const chip = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  message: Message,
  isOn = false,
): Html =>
  box(
    [
      h.Key(id),
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: isOn ? ACCENT : LINE,
        backgroundColor: isOn ? ACCENT : CARD,
      }),
    ],
    [text([style({ color: isOn ? ON_ACCENT : INK, fontSize: 13, fontWeight: '600' })], [label])],
  )

const button = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  message: Message,
  color: string = ACCENT,
): Html =>
  box(
    [
      h.Key(id),
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: ON_ACCENT, fontSize: 16, fontWeight: '600' })], [label])],
  )

const panelRow = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  value: string,
  color: string = INK,
): Html =>
  box(
    [h.Key(id), style({ flexDirection: 'row', gap: 8 })],
    [
      text([style({ color: MUTED, fontSize: 13, width: 64 })], [label]),
      text(
        [h.Attribute('testID', id), style({ color, fontSize: 13, fontWeight: '600', flex: 1 })],
        [value],
      ),
    ],
  )

/** "What just happened": the same panel on both screens. */
const panel = (model: Model, h: HtmlBuilder<Message>, place: string): Html => {
  const roster = rosterReading(model.roster)
  const member = memberReading(model.member)
  const shownLog = model.log.slice(-LOG_LINES_SHOWN)
  return box(
    [
      h.Key('panel'),
      h.Attribute('testID', `${place}-panel`),
      style({
        backgroundColor: CARD,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: LINE,
        padding: 10,
        gap: 3,
      }),
    ],
    [
      text([style({ color: MUTED, fontSize: 11, fontWeight: '700' })], ['WHAT JUST HAPPENED']),
      panelRow(
        h,
        `${place}-list-status`,
        'List',
        `${statusLine(roster, model.now, model.staleSeconds)}${
          roster.hasValue ? `, ${model.roster.count} members` : ''
        }`,
        STATUS_COLOR[statusOf(roster, model.now, model.staleSeconds)],
      ),
      Option.match(model.maybeOpenId, {
        onNone: () => panelRow(h, `${place}-member-status`, 'Member', 'none open', MUTED),
        onSome: id =>
          panelRow(
            h,
            `${place}-member-status`,
            `Member ${id}`,
            statusLine(member, model.now, model.staleSeconds),
            STATUS_COLOR[statusOf(member, model.now, model.staleSeconds)],
          ),
      }),
      panelRow(
        h,
        `${place}-requests`,
        'Server',
        `${model.requests} ${model.requests === 1 ? 'request' : 'requests'} received`,
      ),
      panelRow(
        h,
        `${place}-watching`,
        'Watching',
        Option.match(model.maybeOpenId, {
          onNone: () => 'list ×1',
          onSome: id => `list ×2, member ${id} ×1`,
        }),
      ),
      box(
        [h.Attribute('testID', `${place}-log`), style({ marginTop: 3, gap: 1, minHeight: 50 })],
        shownLog.length === 0
          ? [text([style({ color: MUTED, fontSize: 12 })], ['Nothing yet'])]
          : shownLog.map((line, index) =>
              text([h.Key(`log-${index}`), style({ color: INK, fontSize: 12 })], [`· ${line}`]),
            ),
      ),
    ],
  )
}

/** The buttons that change the conditions. The same on both screens. */
const controls = (model: Model, h: HtmlBuilder<Message>, place: string): Html =>
  box(
    [h.Key('controls'), style({ flexDirection: 'row', flexWrap: 'wrap', gap: 6 })],
    [
      chip(h, `${place}-remote-edit`, 'Edit from another device', Message.PressedRemoteEdit()),
      chip(
        h,
        `${place}-fail-next`,
        model.isFailureArmed ? 'Next request will fail' : 'Fail next request',
        Message.PressedFailNext(),
        model.isFailureArmed,
      ),
      chip(h, `${place}-latency`, `Latency: ${model.latencyMs} ms`, Message.PressedLatency()),
      chip(h, `${place}-stale`, `Stale after: ${model.staleSeconds} s`, Message.PressedStale()),
      chip(
        h,
        `${place}-announce`,
        `Announce topic: ${model.isAnnouncing ? 'on' : 'off'}`,
        Message.PressedAnnounce(),
        model.isAnnouncing,
      ),
      chip(
        h,
        `${place}-optimistic`,
        `Optimistic: ${model.isOptimistic ? 'on' : 'off'}`,
        Message.PressedOptimistic(),
        model.isOptimistic,
      ),
    ],
  )

const failureNote = (
  h: HtmlBuilder<Message>,
  id: string,
  message: string,
  retryId: string,
  retry: Message,
): Html =>
  box(
    [
      h.Key(id),
      style({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: DANGER,
        backgroundColor: CARD,
      }),
    ],
    [
      text([h.Attribute('testID', id), style({ color: DANGER, fontSize: 14, flex: 1 })], [message]),
      button(h, retryId, 'Retry', retry, DANGER),
    ],
  )

const memberRow =
  (h: HtmlBuilder<Message>) =>
  (member: Member): Html =>
    box(
      [
        h.Attribute('testID', `member-${member.id}`),
        h.OnClick(Message.PressedMember({ id: member.id })),
        style({
          height: ROW_HEIGHT,
          paddingHorizontal: 4,
          justifyContent: 'center',
          borderBottomWidth: 1,
          borderBottomColor: LINE,
        }),
      ],
      [
        text(
          [h.Attribute('testID', `member-${member.id}-name`), style({ color: INK, fontSize: 16 })],
          [member.name],
        ),
        text(
          [style({ color: MUTED, fontSize: 13 })],
          [`${member.role}, ${member.notes} ${member.notes === 1 ? 'note' : 'notes'}`],
        ),
      ],
    )

const rosterScreen = (
  model: Model,
  h: HtmlBuilder<Message>,
  device: Device,
  rows: ReadonlyArray<Member>,
): Html =>
  screen(
    [h.Key('roster'), h.Attribute('testID', 'screen-roster')],
    [
      header([title('Crew')], []),
      safeArea(device, { hasHeader: true }, [
        box(
          [style({ flex: 1, backgroundColor: PAPER, padding: 12, gap: 10 })],
          [
            box(
              [h.Key('top'), style({ flexDirection: 'row', alignItems: 'center', gap: 10 })],
              [
                chip(h, 'menu', 'Menu', Message.PressedExit()),
                text(
                  [style({ color: MUTED, fontSize: 13, flex: 1 })],
                  ['Open a member, change the name, come back. Watch the panel.'],
                ),
              ],
            ),
            panel(model, h, 'roster'),
            controls(model, h, 'roster'),
            ...(model.roster.phase === 'failed'
              ? [
                  failureNote(
                    h,
                    'roster-error',
                    rows.length === 0
                      ? `Could not load the crew: ${model.roster.error}.`
                      : `Could not refresh: ${model.roster.error}. This is the last good list.`,
                    'retry-roster',
                    Message.PressedRetryRoster(),
                  ),
                ]
              : []),
            list(h, {
              id: LIST_ID,
              items: rows,
              key: member => member.id,
              estimatedRowHeight: ROW_HEIGHT,
              rowHeight: ROW_HEIGHT,
              row: memberRow(h),
              attributes: [h.Attribute('testID', 'roster-list'), style({ flex: 1 })],
            }),
          ],
        ),
      ]),
    ],
  )

const memberScreen = (model: Model, id: number, h: HtmlBuilder<Message>, device: Device): Html => {
  const maybeMember = Option.map(valueOf(model.member), member =>
    // The optimistic layer, if there is one, goes over the server's value.
    Optimistic.shown(model.overlay, member, (each, patch) => ({ ...each, ...patch })),
  )
  return screen(
    [
      h.Key(`member-${id}`),
      h.Attribute('testID', 'screen-member'),
      onDismissed<Message>(count => Message.PoppedByPhone({ count })),
    ],
    [
      header([title('Crew member')], []),
      safeArea(device, { hasHeader: true }, [
        box(
          [style({ flex: 1, backgroundColor: PAPER, padding: 12, gap: 10 })],
          [
            panel(model, h, 'member'),
            box(
              [
                h.Key('card'),
                style({ backgroundColor: CARD, borderRadius: 12, padding: 12, gap: 8 }),
              ],
              Option.match(maybeMember, {
                onNone: () => [
                  text(
                    [h.Attribute('testID', 'member-name'), style({ color: MUTED, fontSize: 20 })],
                    [model.member._tag === 'Failure' ? 'No data for this member' : 'Loading…'],
                  ),
                ],
                onSome: member => [
                  text(
                    [
                      h.Attribute('testID', 'member-name'),
                      style({ color: INK, fontSize: 22, fontWeight: '700' }),
                    ],
                    [member.name],
                  ),
                  text(
                    [h.Attribute('testID', 'member-detail'), style({ color: MUTED, fontSize: 15 })],
                    [
                      `${member.role}, ${member.notes} ${member.notes === 1 ? 'note' : 'notes'}. ${Option.match(
                        model.maybeCrewCount,
                        {
                          onNone: () => 'Counting the crew…',
                          onSome: count => `One of ${count} crew.`,
                        },
                      )}`,
                    ],
                  ),
                  box(
                    [h.Key('edit'), style({ flexDirection: 'row', gap: 8, alignItems: 'center' })],
                    [
                      textInput(
                        [
                          h.Attribute('testID', 'name-field'),
                          h.Attribute('value', model.draft),
                          h.Placeholder('Name'),
                          prop('editable', true),
                          h.OnInput(draft => Message.ChangedDraft({ text: draft })),
                          style({
                            flex: 1,
                            height: 44,
                            fontSize: 17,
                            color: INK,
                            paddingVertical: 10,
                            paddingHorizontal: 12,
                            borderWidth: 1,
                            borderColor: LINE,
                            borderRadius: 10,
                          }),
                        ],
                        [],
                      ),
                      button(h, 'save', 'Save', Message.PressedSave()),
                    ],
                  ),
                  text(
                    [h.Attribute('testID', 'save-status'), style({ color: MUTED, fontSize: 14 })],
                    [
                      model.saveStatus === ''
                        ? 'Change the name and press Save.'
                        : model.saveStatus,
                    ],
                  ),
                  box(
                    [h.Key('notes'), style({ flexDirection: 'row', gap: 10, alignItems: 'center' })],
                    [
                      chip(h, 'add-note', 'Add a note', Message.PressedAddNote()),
                      text(
                        [
                          h.Attribute('testID', 'note-status'),
                          style({ color: MUTED, fontSize: 14, flex: 1 }),
                        ],
                        [model.noteStatus],
                      ),
                    ],
                  ),
                ],
              }),
            ),
            ...(model.member._tag === 'Failure' && !model.member.waiting
              ? [
                  failureNote(
                    h,
                    'member-error',
                    Option.isSome(maybeMember)
                      ? `Could not refresh: ${errorOf(model.member)}. This is the last good data.`
                      : `Could not load this member: ${errorOf(model.member)}.`,
                    'retry-member',
                    Message.PressedRetryMember(),
                  ),
                ]
              : []),
            controls(model, h, 'member'),
            chip(h, 'back', 'Back to the crew', Message.PressedBack()),
          ],
        ),
      ]),
    ],
  )
}

const makeView =
  (device: Device, rosterRows: (model: Model) => ReadonlyArray<Member>) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'stack')],
      [
        rosterScreen(model, h, device, rosterRows(model)),
        ...Option.match(model.maybeOpenId, {
          onNone: () => [],
          onSome: id => [memberScreen(model, id, h, device)],
        }),
      ],
    )
