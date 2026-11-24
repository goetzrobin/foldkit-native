/**
 * The client side of AI chat: what a Foldkit program uses to show
 * conversations and talk to the server.
 *
 * Four pieces:
 *
 * - **Reads.** The conversation list and one conversation are atoms (small
 *   holders of loaded data, see `docs/SERVER_STATE.md`). They load again by
 *   themselves when a sync topic is announced, and when the person comes
 *   back to the app.
 * - **Writes.** Send, stop, regenerate, create, rename, delete. Each is an
 *   Effect for a Foldkit Command, and always answers with a Message.
 * - **The live turn.** While a reply is being written, a Subscription turns
 *   its stream of events into a few Messages: the bits of text that arrive
 *   within about 30 ms of each other become one Message, so the Model is
 *   not updated once per token. Reasoning, tool calls and the end each get
 *   their own Message.
 * - **Model pieces.** `LiveTurn` holds the reply being written, `Pending`
 *   holds a message sent but not yet confirmed, and `transcript` puts the
 *   saved messages, the pending ones and the live reply in one list to draw.
 *
 * Reconnecting. The client keeps each turn's events as they arrive. If the
 * connection is lost, the Subscription reports `ConnectionLost`; the program
 * asks `resume`, which opens `WatchTurn` from the last event it has, and
 * the events go on where they stopped. When the person comes back to the
 * app with a reply still being written, the program also calls `resume`:
 * a phone may have closed the connection in the background without saying
 * so, and resuming an open connection costs one request and loses nothing.
 */
import {
  Cause,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Schema,
  Stream,
} from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import type * as Reactivity from 'effect/reactivity/Reactivity'
import { Subscription } from 'foldkit'

import {
  type ServerState,
  type ServerStateHandle,
  type WriteFailure,
  focusSignal,
  makeServerState,
  runWrite,
} from '../serverState/bridge.js'
import { Sync } from '../serverState/sync.js'
import { AiChatRpcClient } from './transport.js'
import {
  AiChatSync,
  type Attachment,
  Attachment as AttachmentSchema,
  type ChatMessage,
  type Conversation,
  Conversation as ConversationSchema,
  ConversationSummary,
  MessageStatus,
  Part,
  ReasoningDone,
  ToolCallResult,
  ToolCallStarted,
  TurnEvent,
  TurnFailed,
  TurnFinished,
  TurnStarted,
  Usage,
  applyToParts,
  isLastEvent,
} from './wire.js'

// ERRORS, AS THE SCREENS SEE THEM

/**
 * Anything that went wrong, in a form a Model can hold. `kind` says what a
 * screen should offer: `network` (try again), `not-found` (go back),
 * `refused` (the server said no; `reason` says why).
 */
export class ChatError extends Schema.TaggedError<ChatError>()('ChatError', {
  kind: Schema.Literals(['network', 'not-found', 'refused']),
  reason: Schema.String,
}) {}

const tagOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && '_tag' in error ? String(error._tag) : ''

/** The typed error in a failure, or words for a defect or an interruption. */
const errorIn = (cause: Cause.Cause<unknown>): unknown =>
  Option.getOrElse(Cause.findErrorOption(cause), () =>
    Cause.hasInterruptsOnly(cause) ? 'The request was cut short.' : Cause.pretty(cause),
  )

const toChatError = (error: unknown): ChatError => {
  switch (tagOf(error)) {
    case 'ChatError':
      return error as ChatError
    case 'ConversationNotFound':
      return new ChatError({ kind: 'not-found', reason: 'This conversation no longer exists.' })
    case 'TurnNotFound':
      return new ChatError({ kind: 'not-found', reason: 'The server has forgotten that reply.' })
    case 'TurnInProgress':
      return new ChatError({ kind: 'refused', reason: 'A reply is still being written. Stop it or wait.' })
    case 'BadRequest':
      return new ChatError({ kind: 'refused', reason: String((error as { reason: unknown }).reason) })
    case 'RpcClientError':
      return new ChatError({ kind: 'network', reason: 'Could not reach the server.' })
    default:
      return new ChatError({ kind: 'network', reason: String(error) })
  }
}

/** What a failed write says, for a Message. */
export const describeFailure = (failure: WriteFailure<ChatError>): string =>
  failure._tag === 'Rejected' ? failure.error.reason : failure.reason

// TURN UPDATES: WHAT THE LIVE TURN SUBSCRIPTION DELIVERS

/** Text pieces that arrived together, first one numbered `fromSeq`. */
export const TextBatch = Schema.TaggedStruct('TextBatch', {
  fromSeq: Schema.Number,
  pieces: Schema.Array(Schema.String),
})
export const ReasoningBatch = Schema.TaggedStruct('ReasoningBatch', {
  fromSeq: Schema.Number,
  pieces: Schema.Array(Schema.String),
})
/** The connection broke before the turn ended. Call `resume`. */
export const ConnectionLost = Schema.TaggedStruct('ConnectionLost', { reason: Schema.String })
/** The server no longer knows the turn. Load the conversation instead. */
export const TurnGone = Schema.TaggedStruct('TurnGone', {})

export const TurnUpdate = Schema.Union([
  TurnStarted,
  ReasoningBatch,
  ReasoningDone,
  ToolCallStarted,
  ToolCallResult,
  TextBatch,
  TurnFinished,
  TurnFailed,
  ConnectionLost,
  TurnGone,
])
export type TurnUpdate = typeof TurnUpdate.Type

/** One item the client keeps for a turn: an event, or news of the connection. */
type LogItem =
  | TurnEvent
  | typeof ConnectionLost.Type
  | typeof TurnGone.Type

const endsLog = (item: LogItem): boolean =>
  item._tag === 'TurnGone' || (item._tag !== 'ConnectionLost' && isLastEvent(item))

/**
 * Puts what arrived within one window into as few updates as possible:
 * text pieces in a row become one `TextBatch`, reasoning pieces one
 * `ReasoningBatch`. Everything else stays as it is, in order.
 */
export const toUpdates = (items: ReadonlyArray<LogItem>): ReadonlyArray<TurnUpdate> => {
  const updates: Array<TurnUpdate> = []
  for (const item of items) {
    const last = updates[updates.length - 1]
    if (item._tag === 'TextDelta') {
      if (last?._tag === 'TextBatch') {
        updates[updates.length - 1] = { ...last, pieces: [...last.pieces, item.text] }
      } else updates.push({ _tag: 'TextBatch', fromSeq: item.seq, pieces: [item.text] })
    } else if (item._tag === 'ReasoningDelta') {
      if (last?._tag === 'ReasoningBatch') {
        updates[updates.length - 1] = { ...last, pieces: [...last.pieces, item.text] }
      } else updates.push({ _tag: 'ReasoningBatch', fromSeq: item.seq, pieces: [item.text] })
    } else updates.push(item)
  }
  return updates
}

// THE TURN KEEPER: CONNECTIONS AND WHAT THEY BROUGHT

type TurnLog = {
  turnId: string
  items: Array<LogItem>
  listeners: Set<(item: LogItem) => void>
  lastSeq: number
  isOver: boolean
  connection: Fiber.Fiber<void> | undefined
}

export type TurnStartedEvent = typeof TurnStarted.Type

export type TurnKeeperService = Readonly<{
  /**
   * Opens a stream that starts a turn (`SendMessage`, `RegenerateTurn`) and
   * keeps it open in the background. Answers with the turn's first event,
   * or fails with the server's refusal.
   */
  start: (open: Stream.Stream<TurnEvent, unknown>) => Effect.Effect<TurnStartedEvent, ChatError>
  /** Opens a new connection to a turn, from the last event already here. */
  resume: (turnId: string) => Effect.Effect<void>
  /** Everything kept for the turn, then the rest as it comes. Ends with the turn. */
  follow: (turnId: string) => Stream.Stream<LogItem>
  /** How many connections are open, for tests and the demo. */
  openConnections: () => number
}>

/** Keeps turns' events and their connections, for as long as the program runs. */
export class TurnKeeper extends Context.Service<TurnKeeper, TurnKeeperService>()(
  'foldkit-native/AiChatTurnKeeper',
) {}

const LOGS_KEPT = 8

export const turnKeeperLayer: Layer.Layer<TurnKeeper, never, AiChatRpcClient | Sync> = Layer.effect(
  TurnKeeper,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const rpc = yield* AiChatRpcClient
    const sync = yield* Sync
    const logs = new Map<string, TurnLog>()

    const newLog = (turnId: string): TurnLog => {
      const log: TurnLog = {
        turnId,
        items: [],
        listeners: new Set(),
        lastSeq: 0,
        isOver: false,
        connection: undefined,
      }
      logs.set(turnId, log)
      const over = [...logs.values()].filter(each => each.isOver)
      for (const old of over.slice(0, Math.max(0, logs.size - LOGS_KEPT))) logs.delete(old.turnId)
      return log
    }

    /** Adds an item, once. Announces the topics a turn's start and end change. */
    const add = (log: TurnLog, item: LogItem): Effect.Effect<void> =>
      Effect.suspend(() => {
        if (log.isOver) return Effect.void
        if (item._tag !== 'ConnectionLost' && item._tag !== 'TurnGone') {
          // A resumed connection may repeat what is already here.
          if (item.seq <= log.lastSeq) return Effect.void
          log.lastSeq = item.seq
        }
        log.items.push(item)
        if (endsLog(item)) log.isOver = true
        for (const listener of [...log.listeners]) listener(item)
        const announce = item._tag === 'TurnStarted' || endsLog(item)
        return announce
          ? Effect.andThen(
              sync.invalidate('chat:conversation-changed'),
              sync.invalidate('chat:conversation-list-changed'),
            )
          : Effect.void
      })

    /** Reads a connection into the log until it ends or breaks. */
    const pump = (log: TurnLog, events: Stream.Stream<TurnEvent, unknown>) =>
      events.pipe(
        Stream.runForEach(event => add(log, event)),
        Effect.catchCause(cause => {
          const error = errorIn(cause)
          return tagOf(error) === 'TurnNotFound'
            ? add(log, { _tag: 'TurnGone' })
            : add(log, { _tag: 'ConnectionLost', reason: toChatError(error).reason })
        }),
        // A stream that ended before the turn did was cut short.
        Effect.andThen(
          Effect.suspend(() =>
            log.isOver ? Effect.void : add(log, { _tag: 'ConnectionLost', reason: 'The stream ended early.' }),
          ),
        ),
      )

    const start: TurnKeeperService['start'] = open =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<TurnStartedEvent, ChatError>()
        let log: TurnLog | undefined
        const fiber = yield* open.pipe(
          Stream.runForEach(event =>
            Effect.gen(function* () {
              if (log === undefined) {
                if (event._tag !== 'TurnStarted') return
                log = newLog(event.turnId)
                yield* add(log, event)
                yield* Deferred.succeed(started, event)
                return
              }
              yield* add(log, event)
            }),
          ),
          Effect.matchCauseEffect({
            onSuccess: () =>
              Effect.suspend(() =>
                log === undefined
                  ? Deferred.fail(started, new ChatError({ kind: 'network', reason: 'The server did not start a reply.' }))
                  : log.isOver
                    ? Effect.void
                    : add(log, { _tag: 'ConnectionLost', reason: 'The stream ended early.' }),
              ),
            onFailure: cause => {
              const error = toChatError(errorIn(cause))
              return log === undefined
                ? Deferred.fail(started, error)
                : add(log, { _tag: 'ConnectionLost', reason: error.reason })
            },
          }),
          Effect.asVoid,
          Effect.forkIn(scope),
        )
        const first = yield* Deferred.await(started)
        const kept = logs.get(first.turnId)
        if (kept !== undefined) kept.connection = fiber
        return first
      })

    const resume: TurnKeeperService['resume'] = turnId =>
      Effect.gen(function* () {
        const log = logs.get(turnId) ?? newLog(turnId)
        if (log.isOver) return
        const old = log.connection
        log.connection = undefined
        if (old !== undefined) yield* Fiber.interrupt(old)
        log.connection = yield* Effect.forkIn(
          pump(log, rpc.WatchTurn({ turnId, afterSeq: log.lastSeq })),
          scope,
        )
      })

    const follow: TurnKeeperService['follow'] = turnId =>
      Stream.callback<LogItem>(queue =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const log = logs.get(turnId)
            if (log === undefined) {
              Queue.offerUnsafe(queue, { _tag: 'TurnGone' })
              Queue.endUnsafe(queue)
              return undefined
            }
            for (const item of log.items) Queue.offerUnsafe(queue, item)
            if (log.isOver) {
              Queue.endUnsafe(queue)
              return undefined
            }
            const listener = (item: LogItem) => {
              Queue.offerUnsafe(queue, item)
              if (endsLog(item)) Queue.endUnsafe(queue)
            }
            log.listeners.add(listener)
            return { log, listener }
          }),
          held =>
            Effect.sync(() => {
              held?.log.listeners.delete(held.listener)
            }),
        ),
      )

    return TurnKeeper.of({
      start,
      resume,
      follow,
      openConnections: () =>
        [...logs.values()].filter(log => log.connection !== undefined && !log.isOver).length,
    })
  }),
)

// MODEL PIECES

export const LiveTurnStatus = MessageStatus
export type LiveTurnStatus = typeof LiveTurnStatus.Type

/**
 * The reply being written, as the Model holds it. Put one in the Model
 * when `send` or `regenerate` answers, and feed it every `TurnUpdate` with
 * `LiveTurn.apply`. Drop it with `LiveTurn.settle` once the saved
 * conversation has caught up.
 */
export const LiveTurn = Schema.Struct({
  turnId: Schema.String,
  conversationId: Schema.String,
  messageId: Schema.String,
  userMessageId: Schema.String,
  /** The newest event applied. Older ones, sent again, are skipped. */
  lastSeq: Schema.Number,
  parts: Schema.Array(Part),
  status: LiveTurnStatus,
  connection: Schema.Literals(['open', 'lost', 'resuming']),
  /** How many times in a row the connection was lost. */
  lostCount: Schema.Number,
  isStopping: Schema.Boolean,
  failure: Schema.NullOr(Schema.String),
  isRetryable: Schema.Boolean,
  usage: Schema.NullOr(Usage),
})
export type LiveTurn = typeof LiveTurn.Type

const startLive = (started: TurnStartedEvent): LiveTurn => ({
  turnId: started.turnId,
  conversationId: started.conversationId,
  messageId: started.messageId,
  userMessageId: started.userMessageId,
  lastSeq: started.seq,
  parts: [],
  status: 'streaming',
  connection: 'open',
  lostCount: 0,
  isStopping: false,
  failure: null,
  isRetryable: false,
  usage: null,
})

/** Applies the pieces that are new: some may have arrived before. */
const applyPieces = (
  live: LiveTurn,
  fromSeq: number,
  pieces: ReadonlyArray<string>,
  tag: 'TextDelta' | 'ReasoningDelta',
): LiveTurn => {
  let parts = live.parts
  let lastSeq = live.lastSeq
  pieces.forEach((text, index) => {
    const seq = fromSeq + index
    if (seq <= lastSeq) return
    parts = applyToParts(parts, { _tag: tag, seq, text })
    lastSeq = seq
  })
  return { ...live, parts, lastSeq, connection: 'open', lostCount: 0 }
}

const applyUpdate = (live: LiveTurn, update: TurnUpdate): LiveTurn => {
  switch (update._tag) {
    case 'TextBatch':
      return applyPieces(live, update.fromSeq, update.pieces, 'TextDelta')
    case 'ReasoningBatch':
      return applyPieces(live, update.fromSeq, update.pieces, 'ReasoningDelta')
    case 'ConnectionLost':
      return live.status === 'streaming'
        ? { ...live, connection: 'lost', lostCount: live.lostCount + 1 }
        : live
    case 'TurnGone':
      // The saved conversation has the end of it. `settle` takes over.
      return live.status === 'streaming' ? { ...live, connection: 'lost' } : live
    default: {
      if (update.seq <= live.lastSeq) return live
      const moved = { ...live, lastSeq: update.seq, connection: 'open' as const, lostCount: 0 }
      switch (update._tag) {
        case 'TurnStarted':
          return moved
        case 'TurnFinished':
          return {
            ...moved,
            status: update.reason === 'stopped' ? 'stopped' : 'complete',
            usage: update.usage,
            isStopping: false,
          }
        case 'TurnFailed':
          return {
            ...moved,
            status: 'failed',
            failure: update.reason,
            isRetryable: update.isRetryable,
            isStopping: false,
          }
        default:
          return { ...moved, parts: applyToParts(moved.parts, update) }
      }
    }
  }
}

/**
 * Whether the saved conversation now holds this reply as finished, so the
 * live copy can go. While the reply is still being written, or the saved
 * copy is older, the live one stays.
 */
const isSettledBy = (live: LiveTurn, conversation: Conversation): boolean => {
  if (live.status === 'streaming') return false
  if (conversation.id !== live.conversationId) return false
  const saved = conversation.messages.find(message => message.id === live.messageId)
  // Not there yet: this copy was loaded before the reply was saved.
  return saved !== undefined && saved.status !== 'streaming'
}

/** How long to wait before reconnecting, after losing the connection `lostCount` times. */
export const reconnectDelayMs = (lostCount: number): number =>
  Math.min(4000, 250 * 2 ** Math.max(0, lostCount - 1))

/** Connections lost in a row before giving up and asking the person. */
export const MAX_RECONNECTS = 4

export const LiveTurnOps = {
  start: startLive,
  apply: (maybeLive: Option.Option<LiveTurn>, update: TurnUpdate): Option.Option<LiveTurn> =>
    Option.map(maybeLive, live => applyUpdate(live, update)),
  /** Marks the turn as being stopped, for a "Stopping…" label. */
  stopping: (live: LiveTurn): LiveTurn => ({ ...live, isStopping: true }),
  resuming: (live: LiveTurn): LiveTurn => ({ ...live, connection: 'resuming' }),
  /** Drops the live turn once `conversation` has its finished copy. */
  settle: (maybeLive: Option.Option<LiveTurn>, conversation: Conversation): Option.Option<LiveTurn> =>
    Option.filter(maybeLive, live => !isSettledBy(live, conversation)),
  /** True while the reply is still being written. */
  isStreaming: (maybeLive: Option.Option<LiveTurn>): boolean =>
    Option.isSome(maybeLive) && maybeLive.value.status === 'streaming',
  /** The text written so far, all text parts joined. */
  text: (live: LiveTurn): string =>
    live.parts.map(part => (part._tag === 'Text' ? part.text : '')).join(''),
}

/**
 * A message the person sent that the server has not confirmed yet. It is
 * shown at once, greyed, and removed when the saved copy arrives (`settle`)
 * or when sending fails (`rollBack`).
 */
export const Pending = Schema.Struct({
  clientMessageId: Schema.String,
  conversationId: Schema.String,
  text: Schema.String,
  attachments: Schema.Array(AttachmentSchema),
  createdAt: Schema.Number,
})
export type Pending = typeof Pending.Type

export const PendingOps = {
  add: (pending: ReadonlyArray<Pending>, message: Pending): ReadonlyArray<Pending> => [
    ...pending,
    message,
  ],
  /** Sending failed: the message comes off the screen. */
  rollBack: (pending: ReadonlyArray<Pending>, clientMessageId: string): ReadonlyArray<Pending> =>
    pending.filter(each => each.clientMessageId !== clientMessageId),
  /** The saved conversation arrived: drop the ones it now holds. */
  settle: (pending: ReadonlyArray<Pending>, conversation: Conversation): ReadonlyArray<Pending> => {
    const saved = new Set(conversation.messages.map(message => message.clientMessageId))
    return pending.filter(
      each => each.conversationId !== conversation.id || !saved.has(each.clientMessageId),
    )
  },
}

/** One row to draw: a saved message, a pending one, or the live reply. */
export type TranscriptRow = Readonly<{
  /** A stable key: the message id, or the client id for a pending message. */
  key: string
  role: 'user' | 'assistant'
  parts: ReadonlyArray<Part>
  status: LiveTurnStatus | 'sending'
  attachments: ReadonlyArray<Attachment>
  failure: string | null
  source: 'saved' | 'pending' | 'live'
}>

const rowOf = (message: ChatMessage): TranscriptRow => ({
  key: message.id,
  role: message.role,
  parts: message.parts,
  status: message.status,
  attachments: message.attachments,
  failure: message.failure,
  source: 'saved',
})

/**
 * The rows of a conversation, oldest first: what the server saved, with the
 * live reply in place of its saved copy, and messages still on their way at
 * the end. A regenerated reply hides the old one at once.
 */
export const transcript = (
  conversationId: string,
  maybeConversation: Option.Option<Conversation>,
  pending: ReadonlyArray<Pending>,
  maybeLive: Option.Option<LiveTurn>,
): ReadonlyArray<TranscriptRow> => {
  const live = Option.filter(maybeLive, each => each.conversationId === conversationId)
  const saved = Option.match(maybeConversation, {
    onNone: () => [] as ReadonlyArray<ChatMessage>,
    onSome: conversation => (conversation.id === conversationId ? conversation.messages : []),
  })
  const rows: Array<TranscriptRow> = []
  let isAfterLiveQuestion = false
  for (const message of saved) {
    if (Option.isSome(live)) {
      if (message.id === live.value.messageId) continue
      // An older reply to the question the live turn answers again.
      if (isAfterLiveQuestion && message.role === 'assistant') continue
      if (message.id === live.value.userMessageId) isAfterLiveQuestion = true
    }
    rows.push(rowOf(message))
  }
  const savedClientIds = new Set(saved.map(message => message.clientMessageId))
  for (const each of pending) {
    if (each.conversationId !== conversationId || savedClientIds.has(each.clientMessageId)) continue
    rows.push({
      key: each.clientMessageId,
      role: 'user',
      parts: [{ _tag: 'Text', text: each.text }],
      status: 'sending',
      attachments: each.attachments,
      failure: null,
      source: 'pending',
    })
  }
  if (Option.isSome(live)) {
    rows.push({
      key: live.value.messageId,
      role: 'assistant',
      parts: live.value.parts,
      status: live.value.status,
      attachments: [],
      failure: live.value.failure,
      source: 'live',
    })
  }
  return rows
}

// THE CLIENT

export type AiChatServices = AiChatRpcClient | Sync | TurnKeeper

export type AiChatOptions = Readonly<{
  /** How the client reaches the server: `layerInProcess(server)`, or a real network. */
  transport: Layer.Layer<AiChatRpcClient>
  /**
   * Added under everything the client runs, the transport included. A test
   * passes a `TestClock` here.
   */
  extra?: Layer.Layer<never>
  /** How long loaded data is kept once no screen shows it. Default 5 minutes. */
  idleTtl?: Duration.Input
  /** Data older than this is loaded again when shown or on return to the app. Default 30 s. */
  staleAfter?: Duration.Input
}>

/** The answer to `send` and `regenerate`. */
export type TurnStart =
  | Readonly<{ _tag: 'Started'; started: TurnStartedEvent }>
  | Readonly<{ _tag: 'Failed'; error: ChatError }>

export type LiveTurnEntryConfig<Model, Message> = Readonly<{
  /** The turn to follow, or none. Following starts when this turns to some. */
  modelToTurnId: (model: Model) => Option.Option<string>
  /** `receivedAt` is the clock's time in milliseconds when the update left the client. */
  toMessage: (update: TurnUpdate, receivedAt: number) => Message
  /** The window in which text pieces are joined into one Message. Default 32 ms. */
  batchMs?: number
}>

/**
 * Makes the client for one program. Put `layer` in the program's
 * `resources`. The handle points at that program's registry: two programs
 * running at once need two clients.
 */
export const makeAiChat = (options: AiChatOptions) => {
  const extra = options.extra ?? Layer.empty
  const services = turnKeeperLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(options.transport, AiChatSync.layer)),
    Layer.provideMerge(extra),
  )
  const runtime = Atom.runtime(services)
  const server: ServerStateHandle<AiChatServices> = makeServerState(runtime, {
    ...(options.idleTtl === undefined ? {} : { idleTtl: options.idleTtl }),
  })

  const fresh = Atom.swr({
    staleTime: options.staleAfter ?? Duration.seconds(30),
    revalidateOnMount: true,
    revalidateOnFocus: true,
    focusSignal,
  })

  const call = <A>(
    request: (rpc: typeof AiChatRpcClient.Service) => Effect.Effect<A, unknown>,
  ): Effect.Effect<A, ChatError, AiChatRpcClient> =>
    AiChatRpcClient.use(rpc => Effect.mapError(request(rpc), toChatError))

  /** Every conversation, newest first. */
  const conversationList: Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<ConversationSummary>, ChatError>> =
    runtime
      .atom(call(rpc => rpc.ListConversations()))
      .pipe(AiChatSync.refreshOn('chat:conversation-list-changed'), fresh)

  /** One conversation with its messages. The same id gives the same atom. */
  const conversation = Atom.family(
    (id: string): Atom.Atom<AsyncResult.AsyncResult<Conversation, ChatError>> =>
      runtime
        .atom(call(rpc => rpc.GetConversation({ id })))
        .pipe(AiChatSync.refreshOn('chat:conversation-changed'), fresh),
  )

  /** A write: the request, then the topics it changed. */
  const write = <A>(
    request: (rpc: typeof AiChatRpcClient.Service) => Effect.Effect<A, unknown>,
    topics: ReadonlyArray<'chat:conversation-list-changed' | 'chat:conversation-changed'>,
  ): Effect.Effect<A, ChatError, AiChatServices | Reactivity.Reactivity> =>
    Effect.tap(call(request), () => Effect.forEach(topics, AiChatSync.invalidate, { discard: true }))

  const answer = <A, Succeeded, Failed>(
    effect: Effect.Effect<A, ChatError, AiChatServices | Reactivity.Reactivity>,
    onSuccess: (value: A) => Succeeded,
    onFailure: (reason: string, error: ChatError | undefined) => Failed,
  ): Effect.Effect<Succeeded | Failed, never, ServerState> =>
    runWrite(server, {
      effect,
      onSuccess,
      onFailure: failure =>
        onFailure(describeFailure(failure), failure._tag === 'Rejected' ? failure.error : undefined),
    })

  const startTurn = (
    open: (rpc: typeof AiChatRpcClient.Service) => Stream.Stream<TurnEvent, unknown>,
  ): Effect.Effect<TurnStart, never, ServerState> =>
    server.provide(
      Effect.gen(function* () {
        const rpc = yield* AiChatRpcClient
        const keeper = yield* TurnKeeper
        return yield* keeper.start(open(rpc))
      }),
    ).pipe(
      Effect.map((started): TurnStart => ({ _tag: 'Started', started })),
      Effect.catch(error => Effect.succeed<TurnStart>({ _tag: 'Failed', error })),
    )

  return {
    /** For Foldkit's `resources`. */
    layer: server.layer,
    /** The server state handle underneath, for `watchAtom`, `peek` and `refresh`. */
    server,
    runtime,
    conversationList,
    conversation,

    /**
     * Sends a message and opens the reply's stream. Answers once the server
     * has saved the message and started the reply (`Started`), or refused
     * (`Failed`). The reply itself arrives through `liveTurnEntry`.
     */
    send: (args: Readonly<{
      conversationId: string
      text: string
      clientMessageId: string
      attachments?: ReadonlyArray<Attachment>
    }>) =>
      startTurn(rpc =>
        rpc.SendMessage({
          conversationId: args.conversationId,
          text: args.text,
          clientMessageId: args.clientMessageId,
          ...(args.attachments === undefined ? {} : { attachments: args.attachments }),
        }),
      ),

    /** Writes the newest reply again. Answers like `send`. */
    regenerate: (conversationId: string) =>
      startTurn(rpc => rpc.RegenerateTurn({ conversationId })),

    /** Stops a reply. Answers once the server has kept what was written. */
    stop: <Succeeded, Failed>(
      turnId: string,
      onSuccess: () => Succeeded,
      onFailure: (reason: string) => Failed,
    ) => answer(call(rpc => rpc.StopTurn({ turnId })), onSuccess, onFailure),

    /**
     * Opens a new connection to a reply, from the last event the client has,
     * after waiting `delayMs`. Never fails: a turn the server forgot comes
     * through the live turn as `TurnGone`.
     */
    resume: <Done>(turnId: string, delayMs: number, done: () => Done) =>
      server
        .provide(
          Effect.andThen(
            Effect.sleep(Duration.millis(delayMs)),
            TurnKeeper.use(keeper => keeper.resume(turnId)),
          ),
        )
        .pipe(Effect.as(done())),

    create: <Succeeded, Failed>(
      title: string | undefined,
      onSuccess: (summary: ConversationSummary) => Succeeded,
      onFailure: (reason: string) => Failed,
    ) =>
      answer(
        write(rpc => rpc.CreateConversation(title === undefined ? {} : { title }), [
          'chat:conversation-list-changed',
        ]),
        onSuccess,
        onFailure,
      ),

    rename: <Succeeded, Failed>(
      id: string,
      title: string,
      onSuccess: (summary: ConversationSummary) => Succeeded,
      onFailure: (reason: string) => Failed,
    ) =>
      answer(
        write(rpc => rpc.RenameConversation({ id, title }), [
          'chat:conversation-list-changed',
          'chat:conversation-changed',
        ]),
        onSuccess,
        onFailure,
      ),

    delete: <Succeeded, Failed>(
      id: string,
      onSuccess: () => Succeeded,
      onFailure: (reason: string) => Failed,
    ) =>
      answer(
        write(rpc => rpc.DeleteConversation({ id }), [
          'chat:conversation-list-changed',
          'chat:conversation-changed',
        ]),
        onSuccess,
        onFailure,
      ),

    /**
     * A Subscription entry that follows the live turn. Text and reasoning
     * that arrive within `batchMs` of the first piece are joined into one
     * update. Everything else is its own update. Following a turn again
     * (the screen closed and opened) replays it from the start; `LiveTurn`
     * skips what it has.
     */
    liveTurnEntry: <Model, Message>(config: LiveTurnEntryConfig<Model, Message>) =>
      Subscription.make<Model, Message, ServerState>()(entry => ({
        turn: entry(
          { maybeTurnId: Schema.Option(Schema.String) },
          {
            modelToDependencies: model => ({ maybeTurnId: config.modelToTurnId(model) }),
            dependenciesToStream: ({ maybeTurnId }) =>
              Option.match(maybeTurnId, {
                onNone: () => Stream.empty,
                onSome: turnId =>
                  server.provideStream(
                    Stream.unwrap(
                      TurnKeeper.use(keeper =>
                        Effect.succeed(
                          keeper.follow(turnId).pipe(
                            Stream.groupedWithin(4096, Duration.millis(config.batchMs ?? 32)),
                            Stream.mapEffect(items =>
                              Effect.map(Clock.currentTimeMillis, at =>
                                toUpdates(items).map(update => config.toMessage(update, at)),
                              ),
                            ),
                            Stream.flatMap(messages => Stream.fromIterable(messages)),
                          ),
                        ),
                      ),
                    ),
                  ),
              }),
          },
        ),
      })).turn,
  }
}

export type AiChat = ReturnType<typeof makeAiChat>

/** The result of a conversation's read, as a Schema, for a Model field. */
export const ConversationResult = AsyncResult.Schema({ success: ConversationSchema, error: ChatError })
export type ConversationResult = AsyncResult.AsyncResult<Conversation, ChatError>

/** The result of the list's read, as a Schema, for a Model field. */
export const ConversationListResult = AsyncResult.Schema({
  success: Schema.Array(ConversationSummary),
  error: ChatError,
})
export type ConversationListResult = AsyncResult.AsyncResult<ReadonlyArray<ConversationSummary>, ChatError>
