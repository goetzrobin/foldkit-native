/**
 * The wire: what the phone and the AI chat server say to each other.
 *
 * Everything that crosses between them is described here once, as Schemas,
 * and both sides are built from these descriptions. The server answers each
 * request named below. The client calls them by name. Nothing else may cross.
 *
 * A conversation is a list of messages. A message has parts: plain text, the
 * model's reasoning, or a tool it called. Sending a message starts a "turn":
 * the server's reply, which arrives as a stream of small events (a few
 * letters of text, a tool call, the end). Every event carries a number,
 * `seq`, counting up from 1 within its turn, so a client that lost the
 * connection can ask for "everything after 41" and miss nothing.
 *
 * For engineers. `AiChatRpcs` is an Effect `RpcGroup`. Streaming requests are
 * declared with `stream: true`: the client gets a `Stream` of `TurnEvent`,
 * and the server's handler returns one. The sync topics at the bottom are
 * client-side only: a write the client makes announces one, and the reads
 * that listen load again (see `src/serverState/sync.ts`).
 */
import { Schema } from 'effect'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'

import { makeSync } from '../serverState/sync.js'

// IDS

/**
 * Ids are plain strings with a letter in front: `c4` is a conversation,
 * `m12` a message, `t7` a turn. The server makes them. A client makes only
 * `clientMessageId`, to recognise its own message when the server sends it
 * back.
 */
export const ConversationId = Schema.String
export type ConversationId = typeof ConversationId.Type
export const MessageId = Schema.String
export type MessageId = typeof MessageId.Type
export const TurnId = Schema.String
export type TurnId = typeof TurnId.Type

// MESSAGES AND THEIR PARTS

/** A file sent with a message. The pretend server keeps only these facts. */
export const Attachment = Schema.Struct({
  name: Schema.String,
  mediaType: Schema.String,
  sizeBytes: Schema.Number,
})
export type Attachment = typeof Attachment.Type

/** Words the reader sees. Markdown. */
export const TextPart = Schema.TaggedStruct('Text', { text: Schema.String })
export type TextPart = typeof TextPart.Type

/** What the model thought before it answered, and for how long. */
export const ReasoningPart = Schema.TaggedStruct('Reasoning', {
  text: Schema.String,
  seconds: Schema.Number,
})
export type ReasoningPart = typeof ReasoningPart.Type

/** A tool the model called. `output` is null until the tool has answered. */
export const ToolCallPart = Schema.TaggedStruct('ToolCall', {
  callId: Schema.String,
  name: Schema.String,
  input: Schema.Record(Schema.String, Schema.String),
  output: Schema.NullOr(Schema.String),
})
export type ToolCallPart = typeof ToolCallPart.Type

export const Part = Schema.Union([TextPart, ReasoningPart, ToolCallPart])
export type Part = typeof Part.Type

/** Tokens counted for one turn, as real model APIs report them. */
export const Usage = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
})
export type Usage = typeof Usage.Type

/**
 * `streaming`: the reply is still being written. `stopped`: someone pressed
 * Stop, or the app closed, and the part written so far was kept. `failed`:
 * the model gave up; `failure` says why.
 */
export const MessageStatus = Schema.Literals(['complete', 'streaming', 'stopped', 'failed'])
export type MessageStatus = typeof MessageStatus.Type

export const ChatMessage = Schema.Struct({
  id: MessageId,
  role: Schema.Literals(['user', 'assistant']),
  parts: Schema.Array(Part),
  status: MessageStatus,
  /** Milliseconds since 1970. */
  createdAt: Schema.Number,
  /** The turn that wrote this reply. Null for the person's own messages. */
  turnId: Schema.NullOr(TurnId),
  /** For a user message, the id the client gave it. */
  clientMessageId: Schema.NullOr(Schema.String),
  attachments: Schema.Array(Attachment),
  failure: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Usage),
})
export type ChatMessage = typeof ChatMessage.Type

/** One row of the conversation list. */
export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  title: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  messageCount: Schema.Number,
  /** The start of the newest message, for the list. */
  preview: Schema.String,
})
export type ConversationSummary = typeof ConversationSummary.Type

/** A whole conversation, as opening it returns it. */
export const Conversation = Schema.Struct({
  ...ConversationSummary.fields,
  messages: Schema.Array(ChatMessage),
  /** The turn still being written, if any. Open a stream to it with `WatchTurn`. */
  activeTurnId: Schema.NullOr(TurnId),
})
export type Conversation = typeof Conversation.Type

// TURN EVENTS

/**
 * The events of one turn, in the order they can come:
 *
 *   TurnStarted
 *   ReasoningDelta... ReasoningDone          (some replies)
 *   ToolCallStarted ToolCallResult           (some replies, any number)
 *   TextDelta...
 *   TurnFinished  or  TurnFailed             (always exactly one, always last)
 *
 * Modelled on the streaming events of today's model APIs, with one addition:
 * `seq`, which starts at 1 and goes up by one per event.
 */
export const TurnStarted = Schema.TaggedStruct('TurnStarted', {
  seq: Schema.Number,
  turnId: TurnId,
  conversationId: ConversationId,
  /** The reply being written. */
  messageId: MessageId,
  /** The person's message this turn answers. */
  userMessageId: MessageId,
})
export const ReasoningDelta = Schema.TaggedStruct('ReasoningDelta', {
  seq: Schema.Number,
  text: Schema.String,
})
export const ReasoningDone = Schema.TaggedStruct('ReasoningDone', {
  seq: Schema.Number,
  seconds: Schema.Number,
})
export const ToolCallStarted = Schema.TaggedStruct('ToolCallStarted', {
  seq: Schema.Number,
  callId: Schema.String,
  name: Schema.String,
  input: Schema.Record(Schema.String, Schema.String),
})
export const ToolCallResult = Schema.TaggedStruct('ToolCallResult', {
  seq: Schema.Number,
  callId: Schema.String,
  output: Schema.String,
})
export const TextDelta = Schema.TaggedStruct('TextDelta', {
  seq: Schema.Number,
  text: Schema.String,
})
export const TurnFinished = Schema.TaggedStruct('TurnFinished', {
  seq: Schema.Number,
  usage: Usage,
  /** `stopped` when someone pressed Stop: the reply is cut short on purpose. */
  reason: Schema.Literals(['complete', 'stopped']),
})
export const TurnFailed = Schema.TaggedStruct('TurnFailed', {
  seq: Schema.Number,
  reason: Schema.String,
  /** True when trying again (Regenerate) may well work. */
  isRetryable: Schema.Boolean,
})

export const TurnEvent = Schema.Union([
  TurnStarted,
  ReasoningDelta,
  ReasoningDone,
  ToolCallStarted,
  ToolCallResult,
  TextDelta,
  TurnFinished,
  TurnFailed,
])
export type TurnEvent = typeof TurnEvent.Type

/** Whether this is the last event of its turn. */
export const isLastEvent = (event: TurnEvent): boolean =>
  event._tag === 'TurnFinished' || event._tag === 'TurnFailed'

/**
 * What an event does to the parts of the reply being written. The server
 * uses it to save the reply and the client to draw it, so the two always
 * agree. Events that do not change the parts return them unchanged.
 */
export const applyToParts = (
  parts: ReadonlyArray<Part>,
  event: TurnEvent,
): ReadonlyArray<Part> => {
  const next = [...parts]
  const last = next[next.length - 1]
  switch (event._tag) {
    case 'ReasoningDelta':
      if (last?._tag === 'Reasoning') next[next.length - 1] = { ...last, text: last.text + event.text }
      else next.push({ _tag: 'Reasoning', text: event.text, seconds: 0 })
      return next
    case 'ReasoningDone': {
      let index = next.length - 1
      while (index >= 0 && next[index]?._tag !== 'Reasoning') index -= 1
      const reasoning = next[index]
      if (reasoning?._tag === 'Reasoning') next[index] = { ...reasoning, seconds: event.seconds }
      return next
    }
    case 'ToolCallStarted':
      next.push({
        _tag: 'ToolCall',
        callId: event.callId,
        name: event.name,
        input: event.input,
        output: null,
      })
      return next
    case 'ToolCallResult': {
      const index = next.findIndex(part => part._tag === 'ToolCall' && part.callId === event.callId)
      const call = next[index]
      if (call?._tag === 'ToolCall') next[index] = { ...call, output: event.output }
      return next
    }
    case 'TextDelta':
      if (last?._tag === 'Text') next[next.length - 1] = { ...last, text: last.text + event.text }
      else next.push({ _tag: 'Text', text: event.text })
      return next
    default:
      return parts
  }
}

// ERRORS

export class ConversationNotFound extends Schema.TaggedError<ConversationNotFound>()(
  'ConversationNotFound',
  { conversationId: ConversationId },
) {}

export class TurnNotFound extends Schema.TaggedError<TurnNotFound>()('TurnNotFound', {
  turnId: TurnId,
}) {}

/** A conversation writes one reply at a time. */
export class TurnInProgress extends Schema.TaggedError<TurnInProgress>()('TurnInProgress', {
  conversationId: ConversationId,
  turnId: TurnId,
}) {}

/** The request does not make sense: an empty message, nothing to regenerate. */
export class BadRequest extends Schema.TaggedError<BadRequest>()('BadRequest', {
  reason: Schema.String,
}) {}

// THE REQUESTS

export class ListConversations extends Rpc.make('ListConversations', {
  success: Schema.Array(ConversationSummary),
}) {}

export class GetConversation extends Rpc.make('GetConversation', {
  payload: { id: ConversationId },
  success: Conversation,
  error: ConversationNotFound,
}) {}

export class CreateConversation extends Rpc.make('CreateConversation', {
  payload: { title: Schema.optional(Schema.String) },
  success: ConversationSummary,
}) {}

export class RenameConversation extends Rpc.make('RenameConversation', {
  payload: { id: ConversationId, title: Schema.String },
  success: ConversationSummary,
  error: Schema.Union([ConversationNotFound, BadRequest]),
}) {}

export class DeleteConversation extends Rpc.make('DeleteConversation', {
  payload: { id: ConversationId },
  error: ConversationNotFound,
}) {}

/**
 * Saves the person's message and streams the reply. The turn runs on the
 * server whether or not anyone is listening: closing this stream does not
 * stop it (use `StopTurn`), and `WatchTurn` picks it up again.
 */
export class SendMessage extends Rpc.make('SendMessage', {
  payload: {
    conversationId: ConversationId,
    text: Schema.String,
    attachments: Schema.optional(Schema.Array(Attachment)),
    /** Made by the client, sent back on the saved message. */
    clientMessageId: Schema.optional(Schema.String),
  },
  success: TurnEvent,
  error: Schema.Union([ConversationNotFound, TurnInProgress, BadRequest]),
  stream: true,
}) {}

/** Stops a turn. What was written so far is kept and marked `stopped`. */
export class StopTurn extends Rpc.make('StopTurn', {
  payload: { turnId: TurnId },
  error: TurnNotFound,
}) {}

/** Throws away the newest reply and writes a new one to the same question. */
export class RegenerateTurn extends Rpc.make('RegenerateTurn', {
  payload: { conversationId: ConversationId },
  success: TurnEvent,
  error: Schema.Union([ConversationNotFound, TurnInProgress, BadRequest]),
  stream: true,
}) {}

/**
 * The events of a turn after `afterSeq`, then the rest as they come. For a
 * client that lost its stream, or came back to the app. `TurnNotFound` once
 * the server has forgotten the turn: load the conversation instead.
 */
export class WatchTurn extends Rpc.make('WatchTurn', {
  payload: { turnId: TurnId, afterSeq: Schema.Number },
  success: TurnEvent,
  error: TurnNotFound,
  stream: true,
}) {}

export class AiChatRpcs extends RpcGroup.make(
  ListConversations,
  GetConversation,
  CreateConversation,
  RenameConversation,
  DeleteConversation,
  SendMessage,
  StopTurn,
  RegenerateTurn,
  WatchTurn,
) {}

// SYNC TOPICS

/**
 * Announced by the client after its own writes. `conversation-list-changed`:
 * a conversation was made, renamed, deleted, or got a new message (its
 * preview and time changed). `conversation-changed`: the messages of a
 * conversation changed. One topic for every conversation: only the open one
 * is being watched, so only it loads again.
 */
export const AiChatSync = makeSync([
  'chat:conversation-list-changed',
  'chat:conversation-changed',
])
export type AiChatTopic = (typeof AiChatSync.topics)[number]
