/**
 * The chat screen: one conversation, pushed over the list of chats. It holds
 * the transcript, the composer floating over it, and the bar at the top, and
 * wires them: Send in the composer puts a question in the transcript and
 * starts a reply; a hold on a row opens its menu; a reply's failure comes
 * back as a notice above the composer.
 *
 * The conversation as the server last sent it is not kept here: it comes in
 * from above (`conversation`), as the future query cache will hand it.
 */
import { Duration, Effect, Option, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { OnCustomEvent } from 'foldkit/renderTarget'
import { modifyFields } from 'foldkit/struct'

import {
  type AiChat,
  AiWire,
  ConversationResult,
  Pending,
  PendingOps,
  transcript,
} from '../../src/aiChat/index.js'
import { chatSafeArea, composerDock } from '../../src/chat/index.js'
import { Clipboard, Linking, Share } from '../../src/device/index.js'
import { prop, style } from '../../src/foldkit/attributes.js'
import { text, view as box } from '../../src/foldkit/elements.js'
import { onDismissed, screen } from '../../src/foldkit/navigation/stack.js'
import { ActionSheet } from '../../src/menus/index.js'
import type { Context, Resources, Shared } from '../context.js'
import { dismissKeyboard, haptics } from '../effects.js'
import { focusField } from '../focus.js'
import { onLongPress } from '../longPress.js'
import { type ChatRow, MessageMenu, Notice, lastQuestionKey, textOf } from '../model.js'
import { type Palette, SPACE, TYPE, paletteOf } from '../theme.js'
import { navBar } from '../ui.js'
import * as Composer from './composer.js'
import * as ReplyStream from './replyStream.js'
import * as Transcript from './transcript.js'
import * as MessageRow from './messageRow.js'

export { DRAFT_FIELD, voiceNoteText } from './composer.js'
export { TRANSCRIPT_ID } from './transcript.js'

const NOTICE_MS = 2200
/** Longer than a push takes, on any phone. Only used if the phone never says it appeared. */
const PUSH_WAIT_MS = 700

// MODEL

export const Model = Schema.Struct({
  isOpen: Schema.Boolean,
  /** None in a new chat, until its first message makes the conversation. */
  openId: Schema.Option(Schema.String),
  /** Questions sent and not yet in the server's copy. */
  // effect-ui: h.isRunning (the running Send and Create Commands, with their
  // arguments, are what this list holds)
  pending: Schema.Array(Pending),
  nextClientId: Schema.Number,
  /**
   * A new chat raises the keyboard once its push has finished: set by the
   * pencil, cleared when the field is focused or the chat is left.
   */
  // effect-ui: h.isRunning (WaitForPush running means the focus is still to come)
  isDraftFocusPending: Schema.Boolean,
  notice: Schema.Option(Notice),
  /** The message a long press opened the action sheet for. */
  // effect-ui: h.isRunning (while ActionSheet.Show runs; its arguments can carry the row)
  menu: Schema.Option(MessageMenu),
  transcript: Transcript.Model,
  composer: Composer.Model,
  reply: ReplyStream.Model,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
  isOpen: false,
  openId: Option.none(),
  pending: [],
  nextClientId: 1,
  isDraftFocusPending: false,
  notice: Option.none(),
  menu: Option.none(),
  transcript: Transcript.init(),
  composer: Composer.init(),
  reply: ReplyStream.init(),
})

// MESSAGE

export const Message = defineMessageUnion({
  GotTranscriptMessage: { message: Transcript.Message },
  GotComposerMessage: { message: Composer.Message },
  GotReplyStreamMessage: { message: ReplyStream.Message },
  /** The phone says the chat's push has finished. */
  AppearedChat: {},
  /** Long enough for any push to have finished, in case the phone never says. */
  WaitedForPush: {},
  PoppedChat: {},
  SelectedChatMenu: { key: Schema.String },
  /** The title held: the developer's numbers. */
  PressedNumbers: {},
  CreatedConversation: { id: Schema.String },
  StartedTurn: { clientMessageId: Schema.String, started: AiWire.TurnStarted },
  FailedSend: { clientMessageId: Schema.String, text: Schema.String, reason: Schema.String },
  StartedRegenerate: { started: AiWire.TurnStarted },
  FailedWrite: { action: Schema.String, reason: Schema.String },
  GotActionSheetMessage: { message: ActionSheet.Message },
  DismissedNotice: { text: Schema.String },
  CompletedSideEffect: {},
})
export type Message = typeof Message.Type

/** What the app hears from the chat screen. */
export const OutMessage = defineMessageUnion({
  /** Swiped back to the list. */
  Closed: {},
  ChoseMenuItem: { key: Schema.String },
  PressedNumbers: {},
  /** A sheet over the chat: a reply's reasoning, or a reply to select text in. */
  OpenedSheet: { sheet: Schema.Union([
    Schema.TaggedStruct('Reasoning', { rowKey: Schema.String }),
    Schema.TaggedStruct('SelectText', { rowKey: Schema.String }),
  ]) },
})
export type OutMessage = typeof OutMessage.Type

// COMMANDS

const toTranscript = (message: Transcript.Message) => Message.GotTranscriptMessage({ message })
const toComposer = (message: Composer.Message) => Message.GotComposerMessage({ message })
const toReply = (message: ReplyStream.Message) => Message.GotReplyStreamMessage({ message })

export const makeCommands = (chat: AiChat) => {
  const failed = (action: string) => (reason: string) => Message.FailedWrite({ action, reason })
  return {
    reply: ReplyStream.makeCommands(chat),
    Create: Command.define('ChatCreate', {
      messages: [Message.CreatedConversation, Message.FailedWrite],
      execute: chat.create(undefined, summary => Message.CreatedConversation({ id: summary.id }), failed('start the chat')),
    }),
    Send: Command.define('ChatSend', {
      args: {
        conversationId: Schema.String,
        text: Schema.String,
        clientMessageId: Schema.String,
        attachments: Schema.Array(Schema.Struct({ name: Schema.String, mediaType: Schema.String, sizeBytes: Schema.Number })),
      },
      messages: [Message.StartedTurn, Message.FailedSend],
      execute: args =>
        Effect.map(chat.send(args), answer =>
          answer._tag === 'Started'
            ? Message.StartedTurn({ clientMessageId: args.clientMessageId, started: answer.started })
            : Message.FailedSend({ clientMessageId: args.clientMessageId, text: args.text, reason: answer.error.reason }),
        ),
    }),
    Regenerate: Command.define('ChatRegenerate', {
      args: { conversationId: Schema.String },
      messages: [Message.StartedRegenerate, Message.FailedWrite],
      execute: ({ conversationId }) =>
        Effect.map(chat.regenerate(conversationId), answer =>
          answer._tag === 'Started'
            ? Message.StartedRegenerate({ started: answer.started })
            : Message.FailedWrite({ action: 'write the reply again', reason: answer.error.reason }),
        ),
    }),
  }
}
export type Commands = ReturnType<typeof makeCommands>

const WaitForPush = Command.define('ChatWaitForPush', {
  messages: [Message.WaitedForPush],
  execute: Effect.sleep(Duration.millis(PUSH_WAIT_MS)).pipe(Effect.as(Message.WaitedForPush())),
})

const FocusDraft = Command.define('ChatFocusDraft', {
  messages: [Message.CompletedSideEffect],
  execute: focusField(Composer.DRAFT_FIELD).pipe(Effect.as(Message.CompletedSideEffect())),
})

const ClearNoticeLater = Command.define('ChatClearNotice', {
  args: { text: Schema.String },
  messages: [Message.DismissedNotice],
  execute: ({ text }) => Effect.sleep(Duration.millis(NOTICE_MS)).pipe(Effect.as(Message.DismissedNotice({ text }))),
})

const done = () => Message.CompletedSideEffect()
const haptic = haptics(done)
const ignore = () => Message.CompletedSideEffect()

// UPDATE

/** What an update reads besides its Model: the shared values, the server's copy, the Commands. */
export type Inputs = Readonly<{ shared: Shared; conversation: ConversationResult; commands: Commands }>

type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>

const replyInputs = (inputs: Inputs): ReplyStream.Inputs => ({
  commands: inputs.commands.reply,
  conversation: AsyncResult.value(inputs.conversation),
})

/** One row of the transcript, with a key that stays the same from sending to saved. */
export const rowsOf = (model: Model, conversation: ConversationResult): ReadonlyArray<ChatRow> => {
  const id = Option.getOrElse(model.openId, () => '')
  const saved = AsyncResult.value(conversation)
  const rows = transcript(id, saved, model.pending, model.reply.live)
  const clientIds = new Map<string, string>()
  Option.map(saved, each => {
    for (const message of each.messages) {
      if (message.role === 'user' && message.clientMessageId !== null) {
        clientIds.set(message.id, message.clientMessageId)
      }
    }
  })
  const lastReply = rows.reduce((found, row, index) => (row.role === 'assistant' ? index : found), -1)
  return rows.map((row, index) => ({
    ...row,
    key: row.source === 'saved' && row.role === 'user' ? (clientIds.get(row.key) ?? row.key) : row.key,
    isLastReply: index === lastReply,
  }))
}

const withNotice = (model: Model, notice: Notice): Update.Return<Model, Message, Resources> => ({
  model: modifyFields(model, { notice: () => Option.some(notice) }),
  commands: [ClearNoticeLater({ text: notice.text })],
})

type ReplyStep = Readonly<{ model: ReplyStream.Model; commands?: Update.Return<ReplyStream.Model, ReplyStream.Message, Resources>['commands'] }>

const withReply = (model: Model, result: ReplyStep): Return => ({
  model: modifyFields(model, { reply: () => result.model }),
  commands: Command.mapMessages(result.commands ?? [], toReply),
})

/** Sends `text` in the open chat, making the conversation first in a new one. */
const send = (model: Model, text: string, inputs: Inputs): Return => {
  if (text.trim() === '' || !inputs.shared.isOnline || ReplyStream.isStreaming(model.reply)) return { model }
  const clientMessageId = `c${model.nextClientId}`
  const attachments = Option.match(model.composer.attachment, { onNone: () => [], onSome: each => [each] })
  const conversationId = Option.getOrElse(model.openId, () => '')
  const next = modifyFields(model, {
    nextClientId: count => count + 1,
    // Shown at once, before the server has it.
    pending: pending =>
      PendingOps.add(pending, { clientMessageId, conversationId, text, attachments, createdAt: inputs.shared.nowMs }),
    composer: Composer.sent,
    isDraftFocusPending: () => false,
    // The list brings this question near the top by itself.
    transcript: each => Transcript.anchorAt(each, Option.some(clientMessageId)),
    notice: () => Option.none(),
  })
  return {
    model: next,
    commands: [
      Option.isSome(model.openId)
        ? inputs.commands.Send({ conversationId, text, clientMessageId, attachments })
        : inputs.commands.Create(),
      haptic.light(),
      dismissKeyboard(done),
    ],
  }
}

const regenerate = (model: Model, inputs: Inputs): Return => {
  if (Option.isNone(model.openId) || ReplyStream.isStreaming(model.reply) || !inputs.shared.isOnline) return { model }
  return {
    model: modifyFields(model, {
      transcript: each => Transcript.anchorAt(each, lastQuestionKey(rowsOf(model, inputs.conversation))),
      notice: () => Option.none(),
    }),
    commands: [inputs.commands.Regenerate({ conversationId: model.openId.value }), haptic.light()],
  }
}

const stop = (model: Model, inputs: Inputs): Return => withReply(model, ReplyStream.stop(model.reply, replyInputs(inputs)))

type Commands_ = NonNullable<Update.Return<Model, Message, Resources>['commands']>

const combine = (first: Update.Return<Model, Message, Resources>, more: Commands_): Return => ({
  model: first.model,
  commands: [...more, ...(first.commands ?? [])],
})

const onActionSheet = (model: Model, message: ActionSheet.Message, inputs: Inputs): Return => {
  const closed = modifyFields(model, { menu: () => Option.none() })
  if (message._tag !== 'SelectedActionSheetItem') return { model: closed }
  return Option.match(model.menu, {
    onNone: () => ({ model: closed }),
    onSome: menu => {
      switch (message.key) {
        case 'copy':
          return combine(withNotice(closed, { text: 'Copied', tone: 'info' }), [
            Command.mapMessage(Clipboard.CopyText({ text: menu.text }), ignore),
            haptic.success(),
          ])
        case 'share':
          return { model: closed, commands: [Command.mapMessage(Share.Open({ message: menu.text }), ignore)] }
        case 'select':
          return { model: closed, outMessage: OutMessage.OpenedSheet({ sheet: { _tag: 'SelectText', rowKey: menu.rowKey } }) }
        case 'regenerate':
          return regenerate(closed, inputs)
        case 'stop':
          return stop(closed, inputs)
        default:
          return { model: closed }
      }
    },
  })
}

const failedWrite = (model: Model, action: string, reason: string): Return => {
  // A new chat that could not be made: its first message comes back.
  const waiting = model.pending.filter(each => each.conversationId === '')
  const next = modifyFields(model, {
    pending: pending => pending.filter(each => each.conversationId !== ''),
    composer: composer => (waiting[0] === undefined ? composer : Composer.restore(composer, waiting[0].text)),
    reply: ReplyStream.writeFailed,
  })
  const shown = withNotice(next, { text: `Could not ${action}. ${reason}`, tone: 'error' })
  return { model: shown.model, commands: [...(shown.commands ?? []), haptic.error()] }
}

const onRow = (model: Model, message: MessageRow.OutMessage, inputs: Inputs): Return =>
  MessageRow.OutMessage.match<Return>(message, {
    LongPressed: ({ rowKey }) => {
      const row = rowsOf(model, inputs.conversation).find(each => each.key === rowKey)
      if (row === undefined) return { model }
      const canRegenerate = row.role === 'assistant' && row.isLastReply && !ReplyStream.isStreaming(model.reply)
      const words = textOf(row.parts)
      // A reply still being written: what is there so far, and a way to end it.
      const items =
        row.role === 'assistant' && row.status === 'streaming'
          ? [...(words === '' ? [] : [{ key: 'copy', title: 'Copy so far' }]), { key: 'stop', title: 'Stop' }]
          : [
              { key: 'copy', title: 'Copy' },
              { key: 'select', title: 'Select text' },
              { key: 'share', title: 'Share' },
              ...(canRegenerate ? [{ key: 'regenerate', title: 'Regenerate' }] : []),
            ]
      return {
        model: modifyFields(model, { menu: () => Option.some({ rowKey, text: words, canRegenerate }) }),
        commands: [
          haptic.medium(),
          Command.mapMessage(ActionSheet.Show({ items }), sheetMessage => Message.GotActionSheetMessage({ message: sheetMessage })),
        ],
      }
    },
    Tapped: () => ({ model, commands: inputs.shared.keyboardHeight > 0 ? [dismissKeyboard(done)] : [] }),
    PressedReplyAction: ({ rowKey, key }) => {
      const row = rowsOf(model, inputs.conversation).find(each => each.key === rowKey)
      if (row === undefined) return { model }
      const menu = { rowKey, text: textOf(row.parts), canRegenerate: row.isLastReply }
      return onActionSheet(
        modifyFields(model, { menu: () => Option.some(menu) }),
        ActionSheet.Message.SelectedActionSheetItem({ key }),
        inputs,
      )
    },
    PressedReasoning: ({ rowKey }) => ({
      model,
      commands: [dismissKeyboard(done)],
      outMessage: OutMessage.OpenedSheet({ sheet: { _tag: 'Reasoning', rowKey } }),
    }),
    PressedLink: ({ url }) => ({ model, commands: [Command.mapMessage(Linking.OpenUrl({ url }), ignore)] }),
    CopiedCode: () => {
      const shown = withNotice(model, { text: 'Code copied', tone: 'info' })
      return { model: shown.model, commands: [...(shown.commands ?? []), haptic.success()] }
    },
    PressedTryAgain: () => regenerate(model, inputs),
    GotReplyStreamMessage: ({ message: reply }) => onReply(model, reply, inputs),
  })

const onReply = (model: Model, message: ReplyStream.Message, inputs: Inputs): Return => {
  const result = ReplyStream.update(model.reply, message, replyInputs(inputs))
  const next = withReply(model, result)
  if (result.outMessage === undefined) return next
  const failure = failedWrite(next.model, result.outMessage.action, result.outMessage.reason)
  return { ...failure, commands: [...(next.commands ?? []), ...(failure.commands ?? [])] }
}

const onTranscript = (model: Model, message: Transcript.Message, inputs: Inputs): Return => {
  const result = Transcript.update(model.transcript, message)
  const next = modifyFields(model, { transcript: () => result.model })
  const commands = Command.mapMessages(result.commands ?? [], toTranscript)
  if (result.outMessage === undefined) return { model: next, commands }
  const after = Transcript.OutMessage.match<Return>(result.outMessage, {
    Tapped: () => ({ model: next, commands: inputs.shared.keyboardHeight > 0 ? [dismissKeyboard(done)] : [] }),
    DraggedWithKeyboardUp: () => ({ model: next, commands: [dismissKeyboard(done)] }),
    PressedSuggestion: ({ text }) => send(next, text, inputs),
    GotRowOutMessage: ({ message: row }) => onRow(next, row, inputs),
  })
  return { ...after, commands: [...commands, ...(after.commands ?? [])] }
}

const onComposer = (model: Model, message: Composer.Message, inputs: Inputs): Return => {
  const result = Composer.update(model.composer, message)
  const next = modifyFields(model, { composer: () => result.model })
  const commands = Command.mapMessages(result.commands ?? [], toComposer)
  if (result.outMessage === undefined) return { model: next, commands }
  const after = Composer.OutMessage.match<Return>(result.outMessage, {
    EditedDraft: () => ({ model: modifyFields(next, { notice: () => Option.none() }) }),
    PressedSend: () => send(next, next.composer.draft.trim(), inputs),
    PressedStop: () => stop(next, inputs),
    ShowedNotice: ({ notice }) => withNotice(next, notice),
  })
  return { ...after, commands: [...commands, ...(after.commands ?? [])] }
}

/** Raises the keyboard in a new chat, once: on the first of the two Messages that may say the push is done. */
const focusIfPending = (model: Model): Return =>
  model.isDraftFocusPending && model.isOpen
    ? { model: modifyFields(model, { isDraftFocusPending: () => false }), commands: [FocusDraft()] }
    : { model }

export const update = (model: Model, message: Message, inputs: Inputs): Return =>
  Message.match<Return>(message, {
    GotTranscriptMessage: ({ message: each }) => onTranscript(model, each, inputs),
    GotComposerMessage: ({ message: each }) => onComposer(model, each, inputs),
    GotReplyStreamMessage: ({ message: each }) => onReply(model, each, inputs),
    AppearedChat: () => focusIfPending(model),
    WaitedForPush: () => focusIfPending(model),
    PoppedChat: () => ({ model, outMessage: OutMessage.Closed() }),
    SelectedChatMenu: ({ key }) => ({ model, outMessage: OutMessage.ChoseMenuItem({ key }) }),
    PressedNumbers: () => ({ model, outMessage: OutMessage.PressedNumbers() }),
    CreatedConversation: ({ id }) => {
      // The first message of a new chat waited for its conversation.
      const waiting = model.pending.filter(each => each.conversationId === '')
      return {
        model: modifyFields(model, {
          openId: open => (Option.isNone(open) && model.isOpen ? Option.some(id) : open),
          pending: pending => pending.map(each => (each.conversationId === '' ? { ...each, conversationId: id } : each)),
        }),
        commands: waiting.map(each =>
          inputs.commands.Send({ conversationId: id, text: each.text, clientMessageId: each.clientMessageId, attachments: each.attachments }),
        ),
      }
    },
    StartedTurn: ({ started }) => ({ model: modifyFields(model, { reply: reply => ReplyStream.started(reply, started) }) }),
    FailedSend: ({ clientMessageId, text, reason }) => {
      const next = modifyFields(model, {
        pending: pending => PendingOps.rollBack(pending, clientMessageId),
        // What you wrote goes back in the field, so nothing is lost.
        composer: composer => Composer.restore(composer, text),
        transcript: each => Transcript.anchorAt(each, Option.none()),
      })
      const shown = withNotice(next, { text: `Not sent. ${reason}`, tone: 'error' })
      return { model: shown.model, commands: [...(shown.commands ?? []), haptic.error()] }
    },
    StartedRegenerate: ({ started }) => ({ model: modifyFields(model, { reply: reply => ReplyStream.regenerated(reply, started) }) }),
    FailedWrite: ({ action, reason }) => failedWrite(model, action, reason),
    GotActionSheetMessage: ({ message: sheetMessage }) => onActionSheet(model, sheetMessage, inputs),
    DismissedNotice: ({ text }) => ({
      model: modifyFields(model, { notice: notice => Option.filter(notice, each => each.text !== text) }),
    }),
    CompletedSideEffect: () => ({ model }),
  })

// WHAT THE APP ASKS OF IT

/** Opens a chat: a saved one, or none for a new one. Leaves the client ids and the haptic's memory alone. */
export const open = (model: Model, maybeId: Option.Option<string>): Model =>
  modifyFields(model, {
    isOpen: () => true,
    openId: () => maybeId,
    pending: () => [],
    reply: ReplyStream.reset,
    isDraftFocusPending: () => false,
    composer: () => Composer.init(),
    transcript: () => Transcript.init(),
    notice: () => Option.none(),
    menu: () => Option.none(),
  })

export const close = (model: Model): Model => modifyFields(open(model, Option.none()), { isOpen: () => false })

/** A new chat. The keyboard comes up once the push has finished: see `focus.ts`. */
export const startNew = (model: Model): Update.Return<Model, Message, Resources> => ({
  model: modifyFields(open(model, Option.none()), { isDraftFocusPending: () => true }),
  commands: [WaitForPush()],
})

/** The server sent the open chat: settle what was pending, and join a reply still being written. */
export const receivedConversation = (model: Model, result: ConversationResult, inputs: Inputs): Return => {
  const next = Option.match(AsyncResult.value(result), {
    onNone: () => model,
    onSome: conversation =>
      modifyFields(model, {
        pending: pending => PendingOps.settle(pending, conversation),
        reply: reply => ReplyStream.settle(reply, conversation),
      }),
  })
  const running = Option.flatMap(AsyncResult.value(result), conversation => Option.fromNullishOr(conversation.activeTurnId))
  if (Option.isNone(running)) return { model: next }
  const joined = ReplyStream.join(next.reply, running.value, replyInputs({ ...inputs, conversation: result }))
  return withReply(next, joined)
}

/** Follows a reply again: the app or the network came back. */
export const resume = (model: Model, inputs: Inputs): Return =>
  withReply(model, ReplyStream.resume(model.reply, replyInputs(inputs)))

/** A write the app made (rename, delete) failed. */
export const writeFailed = (model: Model, action: string, reason: string): Return =>
  failedWrite(model, action, reason)

// VIEW

export type ViewInputs = Context & Readonly<{ conversation: ConversationResult }>

/** The title in the bar, held down to show the developer's numbers. */
const barTitle = (palette: Palette, title: string): Html =>
  box(
    [prop('testID', 'chat-title'), ...onLongPress(Message.PressedNumbers()), style({ maxWidth: 220, paddingVertical: 6, paddingHorizontal: 8 })],
    [text([prop('numberOfLines', 1), style({ fontSize: 17, lineHeight: 22, fontWeight: '600', color: palette.ink })], [title])],
  )

export const chatTitle = (model: Model, conversation: ConversationResult): string =>
  Option.match(AsyncResult.value(conversation), {
    onNone: () => 'New chat',
    onSome: each => (Option.contains(model.openId, each.id) ? each.title : 'New chat'),
  })

export const CHAT_MENU = [
  { key: 'rename', title: 'Rename', symbol: 'pencil' },
  { key: 'settings', title: 'Settings', symbol: 'gearshape' },
  { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
] as const

const view_ = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { device, shared } = inputs
  const palette = paletteOf(shared.scheme)
  const rows = rowsOf(model, inputs.conversation)
  const isLoading = Option.isSome(model.openId) && AsyncResult.isInitial(inputs.conversation) && rows.length === 0
  const title = chatTitle(model, inputs.conversation)

  const transcriptView = h.submodel({
    slotId: 'transcript',
    view: Transcript.view,
    model: model.transcript,
    viewInputs: {
      device,
      shared,
      rows,
      isLoading,
      reply: model.reply,
      composerHeight: Composer.heightOf(model.composer),
    },
    toParentMessage: toTranscript,
  })

  const offline = shared.isOnline
    ? []
    : [
        box(
          [prop('testID', 'offline'), style({ paddingVertical: 6, paddingHorizontal: SPACE.xl, backgroundColor: palette.surface })],
          [text([style({ ...TYPE.caption, color: palette.ink2 })], ['You are offline. Sending is off until you are back.'])],
        ),
      ]

  return screen(
    [
      h.Key('chat'),
      prop('testID', 'screen-chat'),
      onDismissed(() => Message.PoppedChat()),
      // The push has finished. A new chat raises its keyboard then.
      OnCustomEvent<Message>({ name: 'appear', f: () => Option.some(Message.AppearedChat()) }),
      style({ backgroundColor: palette.bg }),
    ],
    [
      navBar(h, device, palette, {
        title,
        testID: 'bar-chat',
        center: barTitle(palette, title),
        right: {
          id: 'chat-menu',
          symbol: 'ellipsis',
          label: 'More',
          menu: { items: CHAT_MENU, onSelected: key => Message.SelectedChatMenu({ key }) },
        },
      }),
      chatSafeArea(device, { hasHeader: true }, [
        box(
          [style({ flex: 1, backgroundColor: palette.bg })],
          [
            ...offline,
            composerDock(h, {
              mode: 'inset',
              listId: Transcript.TRANSCRIPT_ID,
              keyboardHeight: shared.keyboardCovers,
              above: [transcriptView],
              children: [
                h.submodel({
                  slotId: 'composer',
                  view: Composer.view,
                  model: model.composer,
                  viewInputs: { device, shared, notice: model.notice, isStreaming: ReplyStream.isStreaming(model.reply) },
                  toParentMessage: toComposer,
                }),
              ],
            }),
          ],
        ),
      ]),
    ],
  )
}

export const view = Submodel.defineView<Model, Message, ViewInputs>(view_)

