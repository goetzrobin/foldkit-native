/**
 * Fold Chat's Model and Messages at the top: what the app routes and wires.
 *
 * - `shared`: what every part reads (see `context.ts`), the future Provider.
 * - `list` and `conversation`: server data, as the server last sent it,
 *   handed down to the parts that draw it. In Effect UI, the query cache.
 * - one field for each part's own Model: the list of chats, the chat screen.
 * - `sheet`: which sheet is open over the stack.
 *
 * Every Message of a part arrives wrapped in one of the `Got...Message`
 * Messages here. What a part asks of the app comes back as its OutMessage.
 */
import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { ConversationListResult, ConversationResult } from '../src/aiChat/index.js'
import { Keyboard } from '../src/device/index.js'
import { Shared } from './context.js'
import { Settings, Sheet } from './model.js'
import * as ChatScreen from './parts/chatScreen.js'
import * as ConversationList from './parts/conversationList.js'
import * as ReasoningSheet from './parts/reasoningSheet.js'
import * as SettingsSheet from './parts/settingsSheet.js'

export const Model = Schema.Struct({
  shared: Shared,
  list: ConversationListResult,
  conversation: ConversationResult,
  conversations: ConversationList.Model,
  chat: ChatScreen.Model,
  sheet: Schema.Option(Sheet),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  // The phone and the settings
  ChangedColorScheme: { scheme: Schema.Literals(['light', 'dark']) },
  LoadedSettings: { settings: Settings },
  AppliedServerDials: {},
  GotTime: { at: Schema.Number },
  ChangedNetwork: { isOnline: Schema.Boolean },
  ReturnedToApp: {},
  GotKeyboardMessage: { message: Keyboard.Message },
  CompletedSideEffect: {},

  // Server data
  ChangedList: { result: ConversationListResult },
  ChangedConversation: { id: Schema.String, result: ConversationResult },

  // The parts
  GotConversationListMessage: { message: ConversationList.Message },
  GotChatScreenMessage: { message: ChatScreen.Message },
  GotSettingsSheetMessage: { message: SettingsSheet.Message },
  GotReasoningSheetMessage: { message: ReasoningSheet.Message },

  // Rename and Select text, the two sheets the app draws itself
  ClosedSheet: {},
  ChangedRenameDraft: { text: Schema.String },
  /** The phone moved the Select text sheet to another of its heights. */
  ChangedSheetDetent: { index: Schema.Number },
  PressedSaveRename: {},
  RenamedConversation: {},
  DeletedConversation: { id: Schema.String },
  FailedWrite: { action: Schema.String, reason: Schema.String },
})
export type Message = typeof Message.Type
