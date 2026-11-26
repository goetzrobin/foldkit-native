/**
 * Effect Chat's server data: what it reads, what it writes, and the reply
 * being written.
 *
 * The server is the pretend AI backend Fold Chat uses
 * (`packages/native/src/host/aiChat`), reached through the same RPC client.
 * What is new here is how the screens get the data: Effect UI's `Query`.
 *
 * - **Reads.** `ListConversations` and `GetConversation` are queries. A
 *   component names one in `queries` and draws what the cache holds.
 * - **Writes.** `CreateConversation` and `SendMessage` are Commands that say
 *   what they do to the cache: which entries are old afterwards, what to
 *   show before the server has answered, what the answer already tells us.
 * - **The reply.** A reply is not a query. It is a stream of numbered
 *   events, kept by the host's `TurnKeeper`, and `followTurn` is the
 *   Subscription that reads it in 32 ms bundles. When a reply ends, the
 *   keeper says so (`TurnNews`), the app hears it and runs `RefreshChat`,
 *   which marks the list and that chat as old. There is no sync bus.
 */
import { Command, Query, Subscription } from '@effect/ui'
import { Context, Effect, Layer, Queue, Schema, Stream } from 'effect'

import { AiChatRpcClient } from '../../native/src/host/aiChat/transport.js'
import {
  ChatError,
  type TurnChange,
  TurnKeeper,
  type TurnUpdate,
  followUpdates,
  toChatError,
  turnKeeperLayerWith,
} from '../../native/src/host/aiChat/turns.js'
import { type ChatMessage, Conversation, ConversationSummary, TurnStarted } from '../../native/src/host/aiChat/wire.js'

export { ChatError }

// READS

/** The list of chats belongs to this tag. A write that changes the list names it. */
export const ChatList = Query.Tag('chat/list')

/** Every conversation, newest first. */
export class ListConversations extends Query.Service<ListConversations>()('chat/ListConversations', {
  args: {},
  success: Schema.Array(ConversationSummary),
  error: ChatError,
  staleTime: '30 seconds',
  tags: [ChatList],
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const rpc = yield* AiChatRpcClient
      return () => Effect.mapError(rpc.ListConversations(), toChatError)
    }),
  )
}

/** One conversation with its messages. */
export class GetConversation extends Query.Service<GetConversation>()('chat/GetConversation', {
  args: { id: Schema.String },
  success: Conversation,
  error: ChatError,
  staleTime: '30 seconds',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const rpc = yield* AiChatRpcClient
      return ({ id }) => Effect.mapError(rpc.GetConversation({ id }), toChatError)
    }),
  )
}

// WRITES

/**
 * Makes a chat. The list is old afterwards. The new chat is known to be
 * empty, so it is written into the cache and opens with nothing to load.
 */
export class CreateConversation extends Command.Service<CreateConversation>()('chat/CreateConversation', {
  args: {},
  success: ConversationSummary,
  error: ChatError,
  invalidates: () => [ChatList],
  writes: summary => [GetConversation.set({ id: summary.id }, { ...summary, messages: [], activeTurnId: null })],
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const rpc = yield* AiChatRpcClient
      return () => Effect.mapError(rpc.CreateConversation({}), toChatError)
    }),
  )
}

/** The person's message as it is shown before the server has saved it. */
const unsaved = (conversation: Conversation, clientMessageId: string, text: string): ChatMessage => ({
  id: clientMessageId,
  role: 'user',
  parts: [{ _tag: 'Text', text }],
  status: 'complete',
  createdAt: conversation.updatedAt,
  turnId: null,
  clientMessageId,
  attachments: [],
  failure: null,
  usage: null,
})

/**
 * Sends a message and starts the reply. It ends when the server has saved
 * the message and said which reply it is writing, or has refused.
 *
 * The message is on screen from the moment the Command is issued. If the
 * server refuses, it comes off again. The reply itself arrives through
 * `followTurn`.
 */
export class SendMessage extends Command.Service<SendMessage>()('chat/SendMessage', {
  args: { conversationId: Schema.String, text: Schema.String, clientMessageId: Schema.String },
  success: TurnStarted,
  error: ChatError,
  invalidates: () => [ChatList],
  optimistic: ({ conversationId, text, clientMessageId }) => [
    GetConversation.patch({ id: conversationId }, conversation =>
      conversation.messages.some(message => message.clientMessageId === clientMessageId)
        ? conversation
        : { ...conversation, messages: [...conversation.messages, unsaved(conversation, clientMessageId, text)] },
    ),
  ],
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const rpc = yield* AiChatRpcClient
      const keeper = yield* TurnKeeper
      return ({ conversationId, text, clientMessageId }) =>
        keeper.start(rpc.SendMessage({ conversationId, text, clientMessageId }))
    }),
  )
}

/** Opens a new connection to a reply, from the last event the client has, after a wait. */
export class ResumeTurn extends Command.Service<ResumeTurn>()('chat/ResumeTurn', {
  args: { turnId: Schema.String, delayMs: Schema.Number },
  success: Schema.Void,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const keeper = yield* TurnKeeper
      return ({ turnId, delayMs }) => Effect.andThen(Effect.sleep(`${delayMs} millis`), keeper.resume(turnId))
    }),
  )
}

/**
 * Stops a reply. The server keeps what was written so far and marks it
 * stopped. The reply's own stream then says that it ended, as for any reply.
 * A turn that has ended already is not an error here.
 */
export class StopTurn extends Command.Service<StopTurn>()('chat/StopTurn', {
  args: { turnId: Schema.String },
  success: Schema.Void,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const rpc = yield* AiChatRpcClient
      return ({ turnId }) => Effect.ignore(rpc.StopTurn({ turnId }))
    }),
  )
}

/**
 * Asks the server for nothing. It only says that the list and one chat are
 * old, so the cache loads them again where a screen shows them, and the next
 * time a screen opens where none does. Run when a reply has ended.
 */
export class RefreshChat extends Command.Service<RefreshChat>()('chat/RefreshChat', {
  args: { conversationId: Schema.String },
  success: Schema.Void,
  invalidates: ({ conversationId }) => [ChatList, GetConversation.entry({ id: conversationId })],
}) {
  static readonly layer = this.toLayer(() => Effect.void)
}

// THE REPLY BEING WRITTEN

/** Where the turn keeper says that a turn started or ended. */
export class TurnNews extends Context.Service<
  TurnNews,
  {
    readonly publish: (change: TurnChange) => Effect.Effect<void>
    /** Every change from now on. */
    readonly changes: Stream.Stream<TurnChange>
  }
>()('chat/TurnNews') {}

const turnNewsLayer: Layer.Layer<TurnNews> = Layer.sync(TurnNews, () => {
  const listeners = new Set<(change: TurnChange) => void>()
  return {
    publish: change =>
      Effect.sync(() => {
        for (const listener of [...listeners]) listener(change)
      }),
    changes: Stream.callback<TurnChange>(queue =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = (change: TurnChange): void => void Queue.offerUnsafe(queue, change)
          listeners.add(listener)
          return listener
        }),
        listener => Effect.sync(() => void listeners.delete(listener)),
      ),
    ),
  }
})

/** The window in which pieces of a reply are joined into one Message, in milliseconds. */
export const BatchMs = Context.Reference<number>('chat/BatchMs', { defaultValue: () => 32 })

/** A reply ended, in any chat. For the component that is always on screen. */
export const turnEnded = <Msg>(
  toMessage: (conversationId: string) => Msg,
): Subscription.Subscription<Msg, TurnNews> =>
  Subscription.make(
    'chat/turnEnded',
    Stream.unwrap(
      TurnNews.use(news =>
        Effect.succeed(
          news.changes.pipe(
            Stream.filter(change => change.at === 'ended' && change.conversationId !== undefined),
            Stream.map(change => toMessage(change.conversationId as string)),
          ),
        ),
      ),
    ),
  )

/**
 * The reply being written, as Messages. Everything the keeper has for the
 * turn comes first, then the rest as it arrives, in bundles of `BatchMs`.
 * A turn the keeper has not seen (the chat was opened while a reply was
 * already being written) is joined first, from its first event.
 */
export const followTurn = <Msg>(
  turnId: string,
  toMessage: (update: TurnUpdate) => Msg,
): Subscription.Subscription<Msg, TurnKeeper> =>
  Subscription.make('chat/turn', turnId, id =>
    Stream.unwrap(
      Effect.gen(function* () {
        const keeper = yield* TurnKeeper
        const batchMs = yield* BatchMs
        if (!keeper.has(id)) yield* keeper.resume(id)
        return Stream.map(followUpdates(id, batchMs), ({ update }) => toMessage(update))
      }),
    ),
  )

// THE LAYER

export type Services =
  | ListConversations
  | GetConversation
  | CreateConversation
  | SendMessage
  | ResumeTurn
  | StopTurn
  | RefreshChat
  | TurnNews
  | TurnKeeper

/** Everything above, over the RPC client. */
export const layer: Layer.Layer<Services, never, AiChatRpcClient> = Layer.mergeAll(
  ListConversations.layer,
  GetConversation.layer,
  CreateConversation.layer,
  SendMessage.layer,
  ResumeTurn.layer,
  StopTurn.layer,
  RefreshChat.layer,
).pipe(
  Layer.provideMerge(turnKeeperLayerWith(TurnNews.use(news => Effect.succeed(news.publish)))),
  Layer.provideMerge(turnNewsLayer),
)
