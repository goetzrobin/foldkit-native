/**
 * The live turn, with no server-state code in it: the errors a screen sees,
 * the updates a reply arrives as, the keeper of turns and their connections,
 * and the Model pieces (`LiveTurn`, `Pending`, `transcript`).
 *
 * `client.ts` builds the atoms client on top of this and announces sync
 * topics. A program that keeps its server data some other way (Effect UI's
 * Query, say) uses this file alone: `turnKeeperLayerWith` takes the function
 * to call when a turn starts or ends.
 */
import { Cause, Clock, Context, Deferred, Duration, Effect, Fiber, Layer, Option, Queue, Schema, Stream } from 'effect'

import { AiChatRpcClient } from './transport.js'
import {
  type Attachment,
  Attachment as AttachmentSchema,
  type ChatMessage,
  type Conversation,
  MessageStatus,
  Part,
  ReasoningDone,
  ToolCallResult,
  ToolCallStarted,
  type TurnEvent,
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

export const tagOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && '_tag' in error ? String(error._tag) : ''

/** The typed error in a failure, or words for a defect or an interruption. */
export const errorIn = (cause: Cause.Cause<unknown>): unknown =>
  Option.getOrElse(Cause.findErrorOption(cause), () =>
    Cause.hasInterruptsOnly(cause) ? 'The request was cut short.' : Cause.pretty(cause),
  )

export const toChatError = (error: unknown): ChatError => {
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
export type LogItem =
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
  /** From the turn's first event. Not known for a turn joined with `resume` before that event came. */
  conversationId: string | undefined
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
  /** Whether anything is kept for the turn. `follow` of a turn that is not kept answers `TurnGone`. */
  has: (turnId: string) => boolean
  /** How many connections are open, for tests and the demo. */
  openConnections: () => number
}>

/** Keeps turns' events and their connections, for as long as the program runs. */
export class TurnKeeper extends Context.Service<TurnKeeper, TurnKeeperService>()(
  'foldkit-native/AiChatTurnKeeper',
) {}

const LOGS_KEPT = 8

/** A turn started or ended: what the server holds for its conversation has changed. */
export type TurnChange = Readonly<{
  turnId: string
  conversationId: string | undefined
  at: 'started' | 'ended'
}>

/**
 * The keeper, telling `announce` each time a turn starts and each time one
 * ends. That is when the conversation and the list on the server change, so
 * it is where an app marks its loaded copies as old. `announcer` is built
 * once, with the Layer, and may read services.
 */
export const turnKeeperLayerWith = <R>(
  announcer: Effect.Effect<(change: TurnChange) => Effect.Effect<void>, never, R>,
): Layer.Layer<TurnKeeper, never, AiChatRpcClient | R> => Layer.effect(
  TurnKeeper,
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const rpc = yield* AiChatRpcClient
    const announce = yield* announcer
    const logs = new Map<string, TurnLog>()

    const newLog = (turnId: string): TurnLog => {
      const log: TurnLog = {
        turnId,
        conversationId: undefined,
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
        if (item._tag === 'TurnStarted') log.conversationId = item.conversationId
        return item._tag === 'TurnStarted' || endsLog(item)
          ? announce({
              turnId: log.turnId,
              conversationId: log.conversationId,
              at: item._tag === 'TurnStarted' ? 'started' : 'ended',
            })
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
      has: turnId => logs.has(turnId),
      openConnections: () =>
        [...logs.values()].filter(log => log.connection !== undefined && !log.isOver).length,
    })
  }),
)

/**
 * A turn as a Stream of updates, each with the clock's time when it left the
 * client. Text and reasoning that arrive within `batchMs` of the first piece
 * are joined into one update. Everything else is its own update. Following a
 * turn again replays it from the start; `LiveTurn` skips what it has.
 */
export const followUpdates = (
  turnId: string,
  batchMs = 32,
): Stream.Stream<Readonly<{ update: TurnUpdate; receivedAt: number }>, never, TurnKeeper> =>
  Stream.unwrap(
    TurnKeeper.use(keeper =>
      Effect.succeed(
        keeper.follow(turnId).pipe(
          Stream.groupedWithin(4096, Duration.millis(batchMs)),
          Stream.mapEffect(items =>
            Effect.map(Clock.currentTimeMillis, receivedAt =>
              toUpdates(items).map(update => ({ update, receivedAt })),
            ),
          ),
          Stream.flatMap(updates => Stream.fromIterable(updates)),
        ),
      ),
    ),
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
  // effect-ui: h.isRunning ('resuming' is a Resume Command still running)
  connection: Schema.Literals(['open', 'lost', 'resuming']),
  /** How many times in a row the connection was lost. */
  lostCount: Schema.Number,
  // effect-ui: h.isRunning (a Stop Command still running)
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

