/**
 * The AI backend demo: a plain developer's view of the pretend AI chat
 * server, not the finished chat screen.
 *
 * What to try:
 * - Press "New", then one of the three questions. The first answers
 *   straight away, the second thinks first, the third calls a weather tool.
 * - Watch the event log: every Message that reached the program, with the
 *   time since the reply started. Text arrives in batches, about 30 a second
 *   at most, however fast the server writes.
 * - "Stop" in the middle keeps what was written, marked stopped.
 *   "Regenerate" writes the last reply again.
 * - The chaos switches make the server fail halfway, cut the connection
 *   (the reply picks up where it stopped), wait four seconds before the
 *   first word, or refuse new messages (your message comes off the screen).
 * - Close the demo and open it again: the conversations are still there.
 *
 * The server runs inside the app. Everything between it and this screen goes
 * through Effect's RPC client and server, written out as lines of JSON. See
 * `docs/AI_BACKEND.md`.
 */
import { Duration, Effect, Layer, Option, Schema, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  ConversationListResult,
  ConversationResult,
  type Disk,
  LiveTurn,
  LiveTurnOps,
  MAX_RECONNECTS,
  NO_CHAOS,
  Pending,
  PendingOps,
  SPEEDS,
  type Speed,
  type TranscriptRow,
  TurnUpdate,
  diskFromFiles,
  layerInProcess,
  makeAiChat,
  makeAiServer,
  makeInProcessLink,
  memoryDisk,
  reconnectDelayMs,
  transcript,
  type AiServer,
  type InProcessLink,
} from '../../src/aiChat/index.js'
import { AiWire } from '../../src/aiChat/index.js'
import { type AppState, Native, type Services } from '../../src/device/index.js'
import {
  type Device,
  header,
  safeArea,
  screen,
  scrollView,
  style,
  text,
  title,
  view as box,
} from '../../src/index.js'
import { type ServerState, focusEntry, watchAtom } from '../../src/serverState/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

export type AiBackendDemoOptions = Readonly<{
  /** The pretend server. A test passes its own to read its log and set its dials. */
  server?: AiServer
  /** Where the server keeps conversations when no server is given. */
  disk?: Disk
  link?: InProcessLink
  /** Added under the client and the server. A test passes a `TestClock`. */
  extra?: Layer.Layer<never>
  /** The window in which text pieces become one Message. Default 32 ms. */
  batchMs?: number
}>

export const PROMPTS = [
  { id: 'plain', label: 'Plain', text: 'How do I start running?' },
  { id: 'thinking', label: 'Thinks first', text: 'Should I take the train or drive to the coast? Think it through.' },
  { id: 'tool', label: 'Calls a tool', text: 'What is the weather in Lisbon tomorrow?' },
] as const

const SPEED_ORDER: ReadonlyArray<Speed> = ['normal', 'fast', 'slow']
const LOG_LINES_KEPT = 200
/** The log on screen: how the turn began, and the newest lines. */
const LOG_HEAD = 3
const LOG_TAIL = 13

const ChaosSchema = Schema.Struct({
  failMidStream: Schema.Boolean,
  dropConnection: Schema.Boolean,
  slowFirstToken: Schema.Boolean,
  refuseSend: Schema.Boolean,
})
const ChaosName = Schema.Literals(['failMidStream', 'dropConnection', 'slowFirstToken', 'refuseSend'])
type ChaosName = typeof ChaosName.Type

// MODEL

export const Model = Schema.Struct({
  maybeOpenId: Schema.Option(Schema.String),
  list: ConversationListResult,
  conversation: ConversationResult,
  /** Messages sent and not yet confirmed: shown greyed at once. */
  pending: Schema.Array(Pending),
  live: Schema.Option(LiveTurn),
  nextClientId: Schema.Number,
  /** The current turn's Messages, newest last. */
  log: Schema.Array(Schema.String),
  /** The clock when the current turn's first Message arrived. */
  turnZeroAt: Schema.Number,
  messagesThisSecond: Schema.Number,
  messagesPerSecond: Schema.Number,
  peakPerSecond: Schema.Number,
  /** Messages from the live turn, this turn. */
  turnMessages: Schema.Number,
  /** Events (text pieces counted one by one) those Messages carried. */
  turnEvents: Schema.Number,
  speed: Schema.Literals(['slow', 'normal', 'fast', 'custom']),
  chaos: ChaosSchema,
  status: Schema.String,
  renames: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  PressedNew: {},
  CreatedConversation: { id: Schema.String },
  FailedWrite: { action: Schema.String, reason: Schema.String },
  PressedConversation: { id: Schema.String },
  PressedRename: {},
  RenamedConversation: { title: Schema.String },
  PressedDelete: {},
  DeletedConversation: { id: Schema.String },
  PressedPrompt: { index: Schema.Number },
  StartedTurn: { clientMessageId: Schema.String, started: AiWire.TurnStarted },
  FailedSend: { clientMessageId: Schema.String, reason: Schema.String },
  PressedStop: {},
  StoppedTurn: {},
  PressedRegenerate: {},
  StartedRegenerate: { started: AiWire.TurnStarted },
  PressedReconnect: {},
  Resumed: { turnId: Schema.String },
  ReceivedTurnUpdate: { update: TurnUpdate, at: Schema.Number },
  ChangedList: { result: ConversationListResult },
  ChangedConversation: { id: Schema.String, result: ConversationResult },
  RefreshedConversation: {},
  PressedSpeed: {},
  PressedChaos: { name: ChaosName },
  AppliedSettings: {},
  Ticked: {},
  ReturnedToApp: {},
})
export type Message = typeof Message.Type

// HELPERS

const describeUpdate = (update: TurnUpdate): string => {
  switch (update._tag) {
    case 'TurnStarted':
      return `TurnStarted ${update.turnId}, reply ${update.messageId}`
    case 'TextBatch':
      return `Text ×${update.pieces.length} (seq ${update.fromSeq}-${update.fromSeq + update.pieces.length - 1})`
    case 'ReasoningBatch':
      return `Reasoning ×${update.pieces.length} (seq ${update.fromSeq}-${update.fromSeq + update.pieces.length - 1})`
    case 'ReasoningDone':
      return `ReasoningDone after ${update.seconds} s`
    case 'ToolCallStarted':
      return `ToolCallStarted ${update.name}(${Object.entries(update.input).map(([key, value]) => `${key}=${value}`).join(', ')})`
    case 'ToolCallResult':
      return `ToolCallResult ${update.output.length} characters`
    case 'TurnFinished':
      return `TurnFinished ${update.reason}, ${update.usage.outputTokens} tokens out`
    case 'TurnFailed':
      return `TurnFailed: ${update.reason}`
    case 'ConnectionLost':
      return `ConnectionLost: ${update.reason}`
    case 'TurnGone':
      return 'TurnGone: the server forgot the turn'
  }
}

/** How many events a Message carried. */
const eventsIn = (update: TurnUpdate): number =>
  update._tag === 'TextBatch' || update._tag === 'ReasoningBatch'
    ? update.pieces.length
    : update._tag === 'ConnectionLost' || update._tag === 'TurnGone'
      ? 0
      : 1

const withLine = (model: Model, line: string): ReadonlyArray<string> =>
  [...model.log, line].slice(-LOG_LINES_KEPT)

const freshTurn = (model: Model): Model =>
  modifyFields(model, {
    log: () => [],
    turnZeroAt: () => 0,
    turnMessages: () => 0,
    turnEvents: () => 0,
    messagesThisSecond: () => 0,
    messagesPerSecond: () => 0,
    peakPerSecond: () => 0,
  })

const openId = (model: Model): string => Option.getOrElse(model.maybeOpenId, () => '')

let sharedDisk: Disk | undefined

/**
 * On a phone: files in the app's documents, which survive a restart. Where
 * the build has no file module: memory, kept while the app runs.
 */
const defaultDisk = (): Disk => {
  if (sharedDisk !== undefined) return sharedDisk
  const module = Native.fileSystemFromGlobal()
  try {
    sharedDisk = module === null ? memoryDisk().disk : diskFromFiles(Native.filesFrom(module, 'ai-chat'))
  } catch {
    sharedDisk = memoryDisk().disk
  }
  return sharedDisk
}

export const makeAiBackendDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Services>,
  options: AiBackendDemoOptions = {},
) => {
  const server = options.server ?? makeAiServer({ disk: options.disk ?? defaultDisk() })
  const link = options.link ?? makeInProcessLink()
  const chat = makeAiChat({
    transport: layerInProcess(server, link),
    ...(options.extra === undefined ? {} : { extra: options.extra }),
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

  const failed = (action: string) => (reason: string) => Message.FailedWrite({ action, reason })

  const Create = Command.define('AiCreate', {
    messages: [Message.CreatedConversation, Message.FailedWrite],
    execute: chat.create(undefined, summary => Message.CreatedConversation({ id: summary.id }), failed('make a conversation')),
  })

  const Rename = Command.define('AiRename', {
    args: { id: Schema.String, title: Schema.String },
    messages: [Message.RenamedConversation, Message.FailedWrite],
    execute: ({ id, title }) =>
      chat.rename(id, title, summary => Message.RenamedConversation({ title: summary.title }), failed('rename')),
  })

  const Delete = Command.define('AiDelete', {
    args: { id: Schema.String },
    messages: [Message.DeletedConversation, Message.FailedWrite],
    execute: ({ id }) => chat.delete(id, () => Message.DeletedConversation({ id }), failed('delete')),
  })

  const Send = Command.define('AiSend', {
    args: { conversationId: Schema.String, text: Schema.String, clientMessageId: Schema.String },
    messages: [Message.StartedTurn, Message.FailedSend],
    execute: args =>
      Effect.map(chat.send(args), answer =>
        answer._tag === 'Started'
          ? Message.StartedTurn({ clientMessageId: args.clientMessageId, started: answer.started })
          : Message.FailedSend({ clientMessageId: args.clientMessageId, reason: answer.error.reason }),
      ),
  })

  const Regenerate = Command.define('AiRegenerate', {
    args: { conversationId: Schema.String },
    messages: [Message.StartedRegenerate, Message.FailedWrite],
    execute: ({ conversationId }) =>
      Effect.map(chat.regenerate(conversationId), answer =>
        answer._tag === 'Started'
          ? Message.StartedRegenerate({ started: answer.started })
          : Message.FailedWrite({ action: 'regenerate', reason: answer.error.reason }),
      ),
  })

  const Stop = Command.define('AiStop', {
    args: { turnId: Schema.String },
    messages: [Message.StoppedTurn, Message.FailedWrite],
    execute: ({ turnId }) => chat.stop(turnId, () => Message.StoppedTurn(), failed('stop')),
  })

  const Resume = Command.define('AiResume', {
    args: { turnId: Schema.String, delayMs: Schema.Number },
    messages: [Message.Resumed],
    execute: ({ turnId, delayMs }) => chat.resume(turnId, delayMs, () => Message.Resumed({ turnId })),
  })

  const RefreshConversation = Command.define('AiRefreshConversation', {
    args: { id: Schema.String },
    messages: [Message.RefreshedConversation],
    execute: ({ id }) =>
      chat.server.refresh(chat.conversation(id)).pipe(Effect.as(Message.RefreshedConversation())),
  })

  // The pretend server's dials. A real app has no such door.
  const SetSpeed = Command.define('AiSetSpeed', {
    args: { speed: Schema.Literals(['slow', 'normal', 'fast']) },
    messages: [Message.AppliedSettings],
    execute: ({ speed }) =>
      Effect.sync(() => {
        server.setTiming(SPEEDS[speed])
        return Message.AppliedSettings()
      }),
  })

  const SetChaos = Command.define('AiSetChaos', {
    args: { chaos: ChaosSchema },
    messages: [Message.AppliedSettings],
    execute: ({ chaos }) =>
      Effect.sync(() => {
        server.setChaos(chaos)
        return Message.AppliedSettings()
      }),
  })

  // INIT

  /** The server's speed by name, or "custom" when a test set its own. */
  const speedOf = (): Speed | 'custom' =>
    (Object.keys(SPEEDS) as ReadonlyArray<Speed>).find(speed => SPEEDS[speed] === server.timing()) ??
    'custom'

  const init = (): Return => ({
    model: {
      maybeOpenId: Option.none(),
      list: AsyncResult.initial(),
      conversation: AsyncResult.initial(),
      pending: [],
      live: Option.none(),
      nextClientId: 1,
      log: [],
      turnZeroAt: 0,
      messagesThisSecond: 0,
      messagesPerSecond: 0,
      peakPerSecond: 0,
      turnMessages: 0,
      turnEvents: 0,
      speed: speedOf(),
      chaos: { ...NO_CHAOS, ...server.chaos() },
      status: '',
      renames: 0,
    },
  })

  // UPDATE

  const startedLive = (model: Model, started: typeof AiWire.TurnStarted.Type): Model =>
    modifyFields(freshTurn(model), { live: () => Option.some(LiveTurnOps.start(started)) })

  const onTurnUpdate = (model: Model, update: TurnUpdate, at: number): Return => {
    const zero = model.turnMessages === 0 ? at : model.turnZeroAt
    const next = modifyFields(model, {
      live: () => LiveTurnOps.apply(model.live, update),
      turnZeroAt: () => zero,
      turnMessages: count => count + 1,
      turnEvents: count => count + eventsIn(update),
      messagesThisSecond: count => count + 1,
      log: () => withLine(model, `+${at - zero} ms  ${describeUpdate(update)}`),
    })
    if (Option.isNone(next.live)) return { model: next }
    const live = next.live.value
    if (update._tag === 'ConnectionLost' && live.status === 'streaming') {
      if (live.lostCount > MAX_RECONNECTS) {
        return {
          model: modifyFields(next, {
            status: () => `Lost the connection ${live.lostCount} times. Press Reconnect.`,
          }),
        }
      }
      const delayMs = reconnectDelayMs(live.lostCount)
      return {
        model: modifyFields(next, {
          live: () => Option.some(LiveTurnOps.resuming(live)),
          log: lines => [...lines, `reconnecting in ${delayMs} ms`].slice(-LOG_LINES_KEPT),
          status: () => `Connection lost: ${update.reason} Reconnecting…`,
        }),
        commands: [Resume({ turnId: live.turnId, delayMs })],
      }
    }
    if (update._tag === 'TurnGone') {
      return { model: next, commands: [RefreshConversation({ id: live.conversationId })] }
    }
    return { model: next }
  }

  const update = (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),

      PressedNew: () => ({ model, commands: [Create()] }),
      CreatedConversation: ({ id }) => ({
        model: modifyFields(model, {
          maybeOpenId: () => Option.some(id),
          conversation: () => AsyncResult.initial(),
          status: () => `Made conversation ${id}.`,
        }),
      }),
      FailedWrite: ({ action, reason }) => ({
        model: modifyFields(model, {
          status: () => `Could not ${action}: ${reason}`,
          live: live => Option.map(live, each => ({ ...each, isStopping: false })),
        }),
      }),
      PressedConversation: ({ id }) => ({
        model: modifyFields(model, {
          maybeOpenId: () => Option.some(id),
          conversation: () => AsyncResult.initial(),
        }),
      }),
      PressedRename: () =>
        Option.match(model.maybeOpenId, {
          onNone: () => ({ model }),
          onSome: id => ({
            model: modifyFields(model, { renames: count => count + 1 }),
            commands: [Rename({ id, title: `Renamed ${model.renames + 1}` })],
          }),
        }),
      RenamedConversation: ({ title }) => ({
        model: modifyFields(model, { status: () => `Renamed to "${title}".` }),
      }),
      PressedDelete: () =>
        Option.match(model.maybeOpenId, {
          onNone: () => ({ model }),
          onSome: id => ({ model, commands: [Delete({ id })] }),
        }),
      DeletedConversation: ({ id }) => ({
        model: modifyFields(model, {
          maybeOpenId: open => (Option.contains(open, id) ? Option.none() : open),
          conversation: () => AsyncResult.initial(),
          live: live => Option.filter(live, each => each.conversationId !== id),
          status: () => `Deleted ${id}.`,
        }),
      }),

      PressedPrompt: ({ index }) => {
        const prompt = PROMPTS[index]
        if (prompt === undefined) return { model }
        if (Option.isNone(model.maybeOpenId)) {
          return { model: modifyFields(model, { status: () => 'Press New or open a conversation first.' }) }
        }
        if (LiveTurnOps.isStreaming(model.live)) {
          return { model: modifyFields(model, { status: () => 'A reply is still being written. Stop it or wait.' }) }
        }
        const conversationId = model.maybeOpenId.value
        const clientMessageId = `k${model.nextClientId}`
        return {
          model: modifyFields(freshTurn(model), {
            nextClientId: count => count + 1,
            // Shown at once, before the server has it.
            pending: pending =>
              PendingOps.add(pending, {
                clientMessageId,
                conversationId,
                text: prompt.text,
                attachments: [],
                createdAt: Date.now(),
              }),
            status: () => 'Sending…',
          }),
          commands: [Send({ conversationId, text: prompt.text, clientMessageId })],
        }
      },
      StartedTurn: ({ started }) => ({
        model: modifyFields(startedLive(model, started), { status: () => 'The reply is being written.' }),
      }),
      FailedSend: ({ clientMessageId, reason }) => ({
        model: modifyFields(model, {
          pending: pending => PendingOps.rollBack(pending, clientMessageId),
          status: () => `Not sent: ${reason} Your message was taken off.`,
        }),
      }),

      PressedStop: () =>
        Option.match(Option.filter(model.live, each => each.status === 'streaming'), {
          onNone: () => ({ model }),
          onSome: live => ({
            model: modifyFields(model, { live: () => Option.some(LiveTurnOps.stopping(live)) }),
            commands: [Stop({ turnId: live.turnId })],
          }),
        }),
      StoppedTurn: () => ({ model: modifyFields(model, { status: () => 'Stopped. What was written is kept.' }) }),

      PressedRegenerate: () => {
        if (Option.isNone(model.maybeOpenId) || LiveTurnOps.isStreaming(model.live)) return { model }
        return {
          model: modifyFields(model, { status: () => 'Writing the reply again…' }),
          commands: [Regenerate({ conversationId: model.maybeOpenId.value })],
        }
      },
      StartedRegenerate: ({ started }) => ({ model: startedLive(model, started) }),

      PressedReconnect: () =>
        Option.match(Option.filter(model.live, each => each.status === 'streaming'), {
          onNone: () => ({ model }),
          onSome: live => ({
            model: modifyFields(model, {
              live: () => Option.some(LiveTurnOps.resuming(live)),
              status: () => '',
            }),
            commands: [Resume({ turnId: live.turnId, delayMs: 0 })],
          }),
        }),
      Resumed: ({ turnId }) => ({
        model: modifyFields(model, {
          log: () => withLine(model, `resumed ${turnId}: WatchTurn from the last event`),
          status: status => (status.startsWith('Connection lost') ? 'Reconnected. The reply goes on where it stopped.' : status),
        }),
      }),
      ReceivedTurnUpdate: ({ update: turnUpdate, at }) => onTurnUpdate(model, turnUpdate, at),

      ChangedList: ({ result }) => ({ model: modifyFields(model, { list: () => result }) }),
      ChangedConversation: ({ id, result }) => {
        if (!Option.contains(model.maybeOpenId, id)) return { model }
        return {
          model: modifyFields(model, {
            conversation: () => result,
            ...Option.match(AsyncResult.value(result), {
              onNone: () => ({}),
              onSome: conversation => ({
                pending: (pending: ReadonlyArray<Pending>) => PendingOps.settle(pending, conversation),
                live: (live: Option.Option<LiveTurn>) => LiveTurnOps.settle(live, conversation),
              }),
            }),
          }),
        }
      },
      RefreshedConversation: () => ({ model }),

      PressedSpeed: () => {
        const current = model.speed === 'custom' ? -1 : SPEED_ORDER.indexOf(model.speed)
        const speed = SPEED_ORDER[(current + 1) % SPEED_ORDER.length] ?? 'normal'
        return {
          model: modifyFields(model, { speed: () => speed }),
          commands: [SetSpeed({ speed })],
        }
      },
      PressedChaos: ({ name }) => {
        const chaos = { ...model.chaos, [name]: !model.chaos[name] }
        return {
          model: modifyFields(model, { chaos: () => chaos }),
          commands: [SetChaos({ chaos })],
        }
      },
      AppliedSettings: () => ({ model }),

      Ticked: () => ({
        model: modifyFields(model, {
          messagesPerSecond: () => model.messagesThisSecond,
          peakPerSecond: peak => Math.max(peak, model.messagesThisSecond),
          messagesThisSecond: () => 0,
        }),
      }),

      // The phone may have closed the connection while the app was away,
      // without saying so. Resuming from the last event costs one request.
      ReturnedToApp: () =>
        Option.match(Option.filter(model.live, each => each.status === 'streaming'), {
          onNone: () => ({ model }),
          onSome: live => ({
            model: modifyFields(model, {
              live: () => Option.some(LiveTurnOps.resuming(live)),
              log: () => withLine(model, 'back in the app: resuming the reply'),
            }),
            commands: [Resume({ turnId: live.turnId, delayMs: 0 })],
          }),
        }),
    })

  // SUBSCRIPTION

  const subscriptions = Subscription.make<Model, Message, ServerState | AppState.AppState>()(
    entry => ({
      list: watchAtom(
        { isShown: Schema.Boolean },
        {
          modelToDependencies: () => ({ isShown: true }),
          atom: () => Option.some(chat.conversationList),
          toMessage: (result): Message => Message.ChangedList({ result }),
        },
      ),
      conversation: watchAtom(
        { maybeOpenId: Schema.Option(Schema.String) },
        {
          modelToDependencies: (model: Model) => ({ maybeOpenId: model.maybeOpenId }),
          atom: ({ maybeOpenId }) => Option.map(maybeOpenId, chat.conversation),
          toMessage: (result, { maybeOpenId }): Message =>
            Message.ChangedConversation({ id: Option.getOrElse(maybeOpenId, () => ''), result }),
        },
      ),
      // Counts Messages per second while a reply is written. On the clock
      // the client runs on, so a test's clock drives it too.
      tick: entry(
        { isStreaming: Schema.Boolean },
        {
          modelToDependencies: model => ({ isStreaming: LiveTurnOps.isStreaming(model.live) }),
          dependenciesToStream: ({ isStreaming }) =>
            isStreaming
              ? chat.server.provideStream(
                  Stream.fromEffectRepeat(Effect.as(Effect.sleep(Duration.seconds(1)), Message.Ticked())),
                )
              : Stream.empty,
        },
      ),
      focus: focusEntry((): Message => Message.ReturnedToApp()),
      // The reply being written: a few Messages a second, however fast it comes.
      turn: chat.liveTurnEntry<Model, Message>({
        modelToTurnId: model =>
          Option.map(
            Option.filter(model.live, live => live.status === 'streaming'),
            live => live.turnId,
          ),
        toMessage: (update, at) => Message.ReceivedTurnUpdate({ update, at }),
        ...(options.batchMs === undefined ? {} : { batchMs: options.batchMs }),
      }),
    }),
  )

  const view = makeView(env.device, server)

  const program = Runtime.makeElement({
    Model,
    init,
    update,
    view,
    subscriptions,
    resources: Layer.mergeAll(chat.layer, resources),
    container,
  })

  return { program, server, link, chat, init, update }
}

export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Services>,
  options: AiBackendDemoOptions = {},
) => makeAiBackendDemo(container, env, resources, options).program

// VIEW

const PAPER = '#f4f4f2'
const CARD = '#ffffff'
const INK = '#111111'
const MUTED = '#5f5f5f'
const LINE = '#dcdcd8'
const ACCENT = '#0a66d8'
const DANGER = '#c62828'
const ON_ACCENT = '#ffffff'

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

const heading = (h: HtmlBuilder<Message>, key: string, label: string): Html =>
  text([h.Key(key), style({ color: INK, fontSize: 15, fontWeight: '700', marginTop: 6 })], [label])

const note = (h: HtmlBuilder<Message>, id: string, value: string, color = MUTED): Html =>
  text([h.Key(id), h.Attribute('testID', id), style({ color, fontSize: 13 })], [value])

const row = (h: HtmlBuilder<Message>, key: string, children: ReadonlyArray<Html>): Html =>
  box([h.Key(key), style({ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' })], children)

/** A row of the transcript as plain text: who, the state, then the parts. */
const rowText = (each: TranscriptRow): string => {
  const who = each.role === 'user' ? 'You' : 'Assistant'
  const state = each.status === 'complete' ? '' : ` (${each.status})`
  const parts = each.parts.map(part => {
    switch (part._tag) {
      case 'Reasoning':
        return part.seconds > 0
          ? `[thought for ${part.seconds} s: ${part.text.length} characters]`
          : `[thinking: ${part.text.slice(-60)}]`
      case 'ToolCall':
        return `[tool ${part.name}(${Object.values(part.input).join(', ')}) ${part.output === null ? 'running…' : 'answered'}]`
      case 'Text':
        return part.text
    }
  })
  const failure = each.failure === null ? '' : `\n! ${each.failure}`
  return `${who}${state}: ${parts.join('\n')}${failure}`
}

const shownLog = (log: ReadonlyArray<string>): ReadonlyArray<string> =>
  log.length <= LOG_HEAD + LOG_TAIL
    ? log
    : [...log.slice(0, LOG_HEAD), `… ${log.length - LOG_HEAD - LOG_TAIL} more …`, ...log.slice(-LOG_TAIL)]

const listStatus = (model: Model): string => {
  const result = model.list
  if (result._tag === 'Initial') return 'Loading the list…'
  if (result._tag === 'Failure') return 'Could not load the list.'
  const count = result.value.length
  const loading = result.waiting ? ' Loading again…' : ''
  return count === 0 ? `No conversations yet. Press New.${loading}` : `${count} conversations.${loading}`
}

const turnStatus = (model: Model): string =>
  Option.match(model.live, {
    onNone: () => 'No reply in progress.',
    onSome: live => {
      const connection =
        live.connection === 'open' ? '' : live.connection === 'lost' ? ', connection lost' : ', reconnecting'
      const stopping = live.isStopping ? ', stopping' : ''
      return `Reply ${live.messageId} in ${live.conversationId}: ${live.status}${connection}${stopping}, ${LiveTurnOps.text(live).length} characters`
    },
  })

const makeView =
  (device: Device, server: AiServer) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const summaries = Option.getOrElse(AsyncResult.value(model.list), () => [])
    const rows = transcript(
      openId(model),
      AsyncResult.value(model.conversation),
      model.pending,
      model.live,
    )
    const isStreaming = LiveTurnOps.isStreaming(model.live)
    const isLost = Option.exists(model.live, live => live.status === 'streaming' && live.connection === 'lost')
    const chaosChip = (id: string, name: ChaosName, label: string) =>
      chip(h, id, label, Message.PressedChaos({ name }), model.chaos[name])

    return screen(
      [h.Key('ai-backend'), h.Attribute('testID', 'screen-ai-backend')],
      [
        header([title('AI backend')], []),
        safeArea(device, { hasHeader: true }, [
          scrollView(
            [h.Attribute('testID', 'ai-scroll'), style({ flex: 1, backgroundColor: PAPER })],
            [
              box(
                [h.Key('content'), style({ padding: 12, gap: 8 })],
                [
                  row(h, 'top', [
                    chip(h, 'menu', 'Menu', Message.PressedExit()),
                    text(
                      [style({ color: MUTED, fontSize: 13, flex: 1 })],
                      ['A pretend AI server inside the app. Press New, then a question.'],
                    ),
                  ]),
                  note(h, 'saved-in', `Saved in: ${server.disk.describe}`),

                  heading(h, 'h-list', 'Conversations'),
                  row(h, 'list-actions', [
                    chip(h, 'new', 'New', Message.PressedNew()),
                    ...(Option.isSome(model.maybeOpenId)
                      ? [
                          chip(h, 'rename', 'Rename', Message.PressedRename()),
                          chip(h, 'delete', 'Delete', Message.PressedDelete()),
                        ]
                      : []),
                  ]),
                  note(h, 'list-status', listStatus(model)),
                  box(
                    [h.Key('list'), h.Attribute('testID', 'conversation-list'), style({ gap: 4 })],
                    summaries.slice(0, 8).map(summary => {
                      const isOpen = Option.contains(model.maybeOpenId, summary.id)
                      return box(
                        [
                          h.Key(summary.id),
                          h.Attribute('testID', `conversation-${summary.id}`),
                          h.OnClick(Message.PressedConversation({ id: summary.id })),
                          style({
                            padding: 8,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: isOpen ? ACCENT : LINE,
                            backgroundColor: CARD,
                          }),
                        ],
                        [
                          text(
                            [style({ color: INK, fontSize: 14, fontWeight: '600' })],
                            [`${summary.title} · ${summary.messageCount} messages`],
                          ),
                          text([style({ color: MUTED, fontSize: 12 })], [summary.preview || 'Empty']),
                        ],
                      )
                    }),
                  ),

                  heading(h, 'h-send', 'Ask'),
                  row(
                    h,
                    'prompts',
                    PROMPTS.map((prompt, index) =>
                      chip(h, `prompt-${prompt.id}`, `${prompt.label}: ${prompt.text}`, Message.PressedPrompt({ index })),
                    ),
                  ),
                  row(h, 'turn-actions', [
                    chip(h, 'stop', isStreaming ? 'Stop' : 'Stop (nothing to stop)', Message.PressedStop(), isStreaming),
                    chip(h, 'regenerate', 'Regenerate', Message.PressedRegenerate()),
                    ...(isLost ? [chip(h, 'reconnect', 'Reconnect', Message.PressedReconnect(), true)] : []),
                  ]),
                  note(h, 'status', model.status === '' ? ' ' : model.status, /^(Not sent|Could not|Lost|Connection lost)/.test(model.status) ? DANGER : MUTED),

                  heading(h, 'h-dials', 'Server dials'),
                  row(h, 'dials', [
                    chip(h, 'speed', `Speed: ${model.speed}`, Message.PressedSpeed()),
                    chaosChip('chaos-fail', 'failMidStream', 'Fail halfway'),
                    chaosChip('chaos-drop', 'dropConnection', 'Drop connection'),
                    chaosChip('chaos-slow', 'slowFirstToken', 'Slow first word'),
                    chaosChip('chaos-refuse', 'refuseSend', 'Refuse sends'),
                  ]),

                  heading(h, 'h-live', 'This reply'),
                  note(h, 'turn-status', turnStatus(model), INK),
                  note(
                    h,
                    'rate',
                    `Messages per second to the Model: ${model.messagesPerSecond} (highest ${model.peakPerSecond})`,
                    INK,
                  ),
                  note(
                    h,
                    'turn-count',
                    `${model.turnMessages} Messages carried ${model.turnEvents} events`,
                  ),
                  box(
                    [h.Key('log'), h.Attribute('testID', 'event-log'), style({ gap: 1 })],
                    model.log.length === 0
                      ? [text([style({ color: MUTED, fontSize: 12 })], ['Nothing yet'])]
                      : shownLog(model.log).map((line, index) =>
                          text(
                            [h.Key(`log-${index}`), style({ color: INK, fontSize: 12, fontFamily: 'Menlo' })],
                            [line],
                          ),
                        ),
                  ),

                  heading(h, 'h-reply', 'The conversation, as plain text'),
                  box(
                    [h.Key('reply'), h.Attribute('testID', 'reply'), style({ gap: 8 })],
                    rows.length === 0
                      ? [text([style({ color: MUTED, fontSize: 13 })], ['Nothing to show'])]
                      : rows.map(each =>
                          text(
                            [
                              h.Key(each.key),
                              h.Attribute('testID', `row-${each.source}-${each.key}`),
                              style({
                                color: each.source === 'pending' ? MUTED : INK,
                                fontSize: 13,
                                backgroundColor: CARD,
                                padding: 8,
                                borderRadius: 8,
                              }),
                            ],
                            [rowText(each)],
                          ),
                        ),
                  ),
                ],
              ),
            ],
          ),
        ]),
      ],
    )
  }
