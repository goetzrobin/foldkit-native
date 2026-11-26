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
import { Duration, Effect, Layer, Schema, Stream } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import type * as Reactivity from 'effect/reactivity/Reactivity'

import {
  type ServerState,
  type ServerStateHandle,
  type WriteFailure,
  focusSignal,
  makeServerState,
  runWrite,
} from '../serverState/store.js'
import { Sync } from '../serverState/sync.js'
import { AiChatRpcClient } from './transport.js'
import {
  ChatError,
  TurnKeeper,
  type TurnStartedEvent,
  type TurnUpdate,
  followUpdates,
  toChatError,
  turnKeeperLayerWith,
} from './turns.js'
import {
  AiChatSync,
  type Attachment,
  type Conversation,
  Conversation as ConversationSchema,
  ConversationSummary,
  type TurnEvent,
} from './wire.js'

// The errors, the turn keeper and the Model pieces are in `turns.ts`.
export * from './turns.js'

/** The keeper, announcing both sync topics when a turn starts and when it ends. */
export const turnKeeperLayer: Layer.Layer<TurnKeeper, never, AiChatRpcClient | Sync> = turnKeeperLayerWith(
  Sync.use(sync =>
    Effect.succeed(() =>
      Effect.andThen(
        sync.invalidate('chat:conversation-changed'),
        sync.invalidate('chat:conversation-list-changed'),
      ),
    ),
  ),
)

/** What a failed write says, for a Message. */
export const describeFailure = (failure: WriteFailure<ChatError>): string =>
  failure._tag === 'Rejected' ? failure.error.reason : failure.reason

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
     * The live turn as a Stream of Messages. Text and reasoning that arrive
     * within `batchMs` of the first piece are joined into one update.
     * Everything else is its own update. Following a turn again (the screen
     * closed and opened) replays it from the start; `LiveTurn` skips what it
     * has. The Foldkit binding wraps this in a Subscription entry
     * (`liveTurnEntry`).
     */
    followTurn: <Message>(
      turnId: string,
      toMessage: (update: TurnUpdate, receivedAt: number) => Message,
      batchMs = 32,
    ): Stream.Stream<Message, never, ServerState> =>
      server.provideStream(
        Stream.map(followUpdates(turnId, batchMs), ({ update, receivedAt }) => toMessage(update, receivedAt)),
      ),
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
