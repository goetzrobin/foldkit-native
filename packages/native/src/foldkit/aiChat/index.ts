/**
 * AI chat: a pretend AI chat server that runs inside the app, the wire it
 * speaks, and the client a Foldkit program uses. Shaped like a real backend
 * (Effect RPC, streamed replies as NDJSON), so the screens built on it work
 * the same against a real one.
 *
 *   wire.ts       the requests, the reply events, the sync topics
 *   server.ts     the pretend server: conversations, scripted replies, chaos
 *   replies.ts    what the pretend model says
 *   transport.ts  the in-process cable, and where a real network goes
 *   client.ts     reads, writes, the live turn, and Model pieces
 *
 * Start with `docs/AI_BACKEND.md`.
 */
export * as AiWire from '../../host/aiChat/wire.js'
export {
  AiChatRpcs,
  AiChatSync,
  Attachment,
  BadRequest,
  ChatMessage,
  Conversation,
  ConversationNotFound,
  ConversationSummary,
  MessageStatus,
  Part,
  ReasoningPart,
  TextPart,
  ToolCallPart,
  TurnEvent,
  TurnInProgress,
  TurnNotFound,
  Usage,
  applyToParts,
  isLastEvent,
} from '../../host/aiChat/wire.js'
export type { AiChatTopic } from '../../host/aiChat/wire.js'

export {
  DiskError,
  NO_CHAOS,
  SPEEDS,
  diskFromFiles,
  diskFromStorage,
  makeAiServer,
  memoryDisk,
} from '../../host/aiChat/server.js'
export type { AiServer, AiServerOptions, Chaos, Disk, Speed, Timing } from '../../host/aiChat/server.js'
export { pickReply, titleFrom, tokenize } from '../../host/aiChat/replies.js'
export type { Script, ScriptedTool } from '../../host/aiChat/replies.js'

export { AiChatRpcClient, layerInProcess, makeInProcessLink } from '../../host/aiChat/transport.js'
export type { AiChatRpcClientService, InProcessLink, LinkStats } from '../../host/aiChat/transport.js'

export {
  ChatError,
  ConnectionLost,
  ConversationListResult,
  ConversationResult,
  LiveTurn,
  LiveTurnOps,
  MAX_RECONNECTS,
  Pending,
  PendingOps,
  ReasoningBatch,
  TextBatch,
  TurnGone,
  TurnKeeper,
  TurnUpdate,
  describeFailure,
  makeAiChat,
  reconnectDelayMs,
  toUpdates,
  transcript,
  turnKeeperLayer,
} from '../../host/aiChat/client.js'
export type {
  AiChat,
  AiChatOptions,
  AiChatServices,
  LiveTurnEntryConfig,
  TranscriptRow,
  TurnKeeperService,
  TurnStart,
  TurnStartedEvent,
} from '../../host/aiChat/client.js'
