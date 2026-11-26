/**
 * One chat: a native screen with the chat's title in its bar, the
 * transcript, and the composer over its bottom edge.
 *
 * The messages come from the `GetConversation` query. This part turns them
 * into the transcript's rows and decides which row is a reply still being
 * written. It also sends: the composer hands it the text, and it runs
 * `SendMessage`.
 *
 * What the person sees after Send:
 *
 * 1. Their message, at once. `SendMessage` says what the chat will look like
 *    with the message in it, and the cache shows that until the server has
 *    answered. The message is named as the transcript's anchor, so the list
 *    takes it to the top of the screen and keeps room under it.
 * 2. A row for the reply, as soon as the server has said which reply it is
 *    writing. The row follows the reply's stream by itself (`ReplyStream`).
 * 3. The saved chat, loaded again when the reply has ended. The rows keep
 *    their keys through all three, so none is made twice.
 *
 * The keyboard. The composer sits in a `KeyboardBar`, which the phone moves
 * with the keyboard. In a new chat the field takes the caret once, when the
 * phone says the push has finished (or 0.7 seconds later if it never says).
 * A tap on the transcript puts the keyboard away. So does Send.
 *
 * The round button to the end rides on the composer's top edge. It shows
 * when the end of the transcript is out of view and the list is not
 * following it.
 *
 * Holding a message opens its menu, the phone's own list of choices: Copy,
 * Select text, Share and, for the newest reply, Write again. For a reply
 * that is still being written the menu has Copy so far and Stop. With the
 * keyboard up, the keyboard is put away first and the menu opens a moment
 * later, so the list is not under the keyboard.
 *
 * The button at the top right opens the chat's own menu: Rename, Settings,
 * Delete. What those do belongs to the app (`ChoseMenuItem`), and so do the
 * sheets (`OpenedSheet`): the app owns the stack they are screens of.
 *
 * A message the server refuses comes off the screen (the cache's doing),
 * goes back into the field, and a line above the composer says why.
 *
 * A swipe back is the phone's. The screen reports it (`Dismissed`) and the
 * app drops the screen from its Model.
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Effect, Schema, Stream } from 'effect'
import { AsyncResult } from 'effect/reactivity'

import type { Conversation } from '../../../native/src/host/aiChat/wire.js'
import { Attachment } from '../../../native/src/host/aiChat/wire.js'
import { AnchoredList, KeyboardBar, Menus, Motion, Native, Phone } from '../../src/index.js'
import { GetConversation, RegenerateReply, SendMessage, StopTurn } from '../data.js'
import { After, NOTICE_MS, Toast, toasts } from '../events.js'
import { arrowDown } from '../icons.js'
import { MOTION, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { navBar } from '../ui.js'
import { Composer, DRAFT_FIELD_ID } from './composer.js'
import { ReplyAction } from './replyStream.js'
import { type Row, TRANSCRIPT_ID, Transcript } from './transcript.js'

export const ChatScreenProps = Schema.Struct({
  conversationId: Schema.String,
  platform: Schema.String,
  scheme: Scheme,
  /** The chat was made a moment ago: its field takes the caret once the push is over. */
  isNew: Schema.Boolean,
  /** The numbers strip is on. */
  showsNumbers: Schema.Boolean,
  isOnline: Schema.Boolean,
})

/** A sheet over the chat, as the app is asked to open it. */
export const SheetRequest = Schema.Struct({
  kind: Schema.Literals(['reasoning', 'select']),
  title: Schema.String,
  text: Schema.String,
  isMarkdown: Schema.Boolean,
})

export const ChatScreenMessage = UiSchema.TaggedEnum({
  Submitted: { text: Schema.String, attachments: Schema.Array(Attachment) },
  StartedTurn: { turnId: Schema.String, messageId: Schema.String },
  FailedSend: { reason: Schema.String, text: Schema.String },
  /** Long enough after Send for the new message to have risen into place. */
  RoseMessage: { key: Schema.String },
  /** A finger rested on a message. */
  HeldRow: { key: Schema.String },
  /** A held message's menu waited for the keyboard to start going. */
  WaitedForKeyboard: {},
  AnsweredMenu: { answer: Menus.Answer },
  PressedReplyAction: { key: Schema.String, action: ReplyAction },
  PressedReasoning: { title: Schema.String, text: Schema.String },
  PressedTryAgain: {},
  FailedWrite: { action: Schema.String, reason: Schema.String },
  CopiedSoFar: {},
  /** An entry of the chat's own menu, from the bar. */
  SelectedChatMenu: { key: Schema.String },
  /** Android: the bar's More button, which opens that menu as a list. */
  PressedMore: {},
  AnsweredChatMenu: { answer: Menus.Answer },
  /** The composer has something to say above itself. */
  Noticed: { text: Schema.String },
  EditedDraft: {},
  HeardToast: { toast: Toast },
  WaitedForNotice: { text: Schema.String },
  Done: {},
  ChangedConversation: {},
  ChangedKeyboard: { height: Schema.Number, covers: Schema.Number },
  DismissedByPhone: { count: Schema.Number },
  /** The phone says the push has finished. */
  AppearedChat: {},
  /** Long enough for any push to have finished, in case the phone never says. */
  WaitedForPush: {},
  /** A tap on the transcript that nothing else took. */
  TappedTranscript: {},
  ChangedEnd: { isAtEnd: Schema.Boolean, isFollowing: Schema.Boolean },
  PressedScrollToEnd: {},
  PressedStop: {},
  HeldTitle: {},
})

export const ChatScreenEvents = UiSchema.TaggedEnum({
  Dismissed: { count: Schema.Number },
  /** The title was held: the numbers strip goes on or off. */
  ToggledNumbers: {},
  /** `rename`, `settings` or `delete`, from the chat's own menu. */
  ChoseMenuItem: { key: Schema.String, title: Schema.String },
  OpenedSheet: { sheet: SheetRequest },
})

const ChatScreenModel = Schema.Struct({
  /** The message is on its way to the server. */
  isSending: Schema.Boolean,
  /**
   * The reply the server has started, until the saved chat holds it. It
   * gives the reply a row before the chat has loaded again.
   */
  started: Schema.NullOr(Schema.Struct({ turnId: Schema.String, messageId: Schema.String })),
  /** A line above the composer: a refused message, "Copied". It goes by itself after a moment. */
  notice: Schema.NullOr(Toast),
  /** The message whose menu is open or about to open, by its row key. */
  menuFor: Schema.NullOr(Schema.String),
  /** Text handed back to the composer: a message the server refused. */
  restore: Schema.NullOr(Schema.Struct({ id: Schema.Number, text: Schema.String })),
  /** A reply asked to copy what is written so far. */
  copyRequest: Schema.NullOr(Schema.Struct({ key: Schema.String, count: Schema.Number })),
  keyboardHeight: Schema.Number,
  /**
   * How much of the app's window the keyboard covers. 0 on an Android window
   * that makes itself shorter for the keyboard. Read only where the app pads
   * the composer itself.
   */
  keyboardCovers: Schema.Number,
  /** The question held near the top of the screen, by its row key. */
  anchorKey: Schema.NullOr(Schema.String),
  /**
   * The message sent a moment ago, by its row key: its row rises into
   * place. Forgotten soon after, so the row does not rise again when it
   * scrolls out of view and back.
   */
  risingKey: Schema.NullOr(Schema.String),
  /** Whether the end of the transcript is in view, and whether the list follows it. */
  isAtEnd: Schema.Boolean,
  isFollowing: Schema.Boolean,
  /**
   * The caret in a new chat. `pending`: wanted once the push is over.
   * `asked`: the composer has been told. `off`: not wanted (a saved chat, or
   * a message was sent before the push was over).
   */
  focus: Schema.Literals(['pending', 'asked', 'off']),
})
type ChatScreenModel = typeof ChatScreenModel.Type

/** Longer than a push takes, on any phone. */
export const PUSH_WAIT_MS = 700
/**
 * A hold with the keyboard up puts the keyboard away and opens the menu
 * this much later. The phone's list comes up from the bottom of the screen,
 * where the keyboard is, and the keyboard is drawn over the app: shown at
 * once, the list could sit under it. A few frames are enough for the
 * keyboard to have started down. The two then move together.
 */
export const MENU_AFTER_KEYBOARD_MS = 60

/** The chat's own menu, on the button at the top right. */
export const CHAT_MENU: ReadonlyArray<Menus.MenuItem> = [
  { key: 'rename', title: 'Rename', symbol: 'pencil' },
  { key: 'settings', title: 'Settings', symbol: 'gearshape' },
  { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
]

const done = Command.as(ChatScreenMessage.Done())
const haptic = {
  light: () => Phone.Impact.make({ style: 'light' }).pipe(done),
  medium: () => Phone.Impact.make({ style: 'medium' }).pipe(done),
  success: () => Phone.Notify.make({ type: 'success' }).pipe(done),
  error: () => Phone.Notify.make({ type: 'error' }).pipe(done),
}

const clearLater = (text: string) =>
  After.make({ ms: NOTICE_MS, token: text }).pipe(Command.map(({ token }) => ChatScreenMessage.WaitedForNotice({ text: token })))

const textOfRow = (row: Row): string => row.parts.map(part => (part._tag === 'Text' ? part.text : '')).join('')

/** What a held message's menu offers. */
export const menuOf = (row: Row, isLastReply: boolean, isReplying: boolean): ReadonlyArray<Menus.Item> => {
  const item = (key: string, title: string): Menus.Item => ({ key, title, isDestructive: false })
  // A reply still being written: what is there so far, and a way to end it.
  if (row.role === 'assistant' && row.status === 'streaming') return [item('copy', 'Copy so far'), item('stop', 'Stop')]
  return [
    item('copy', 'Copy'),
    item('select', 'Select text'),
    item('share', 'Share'),
    ...(row.role === 'assistant' && isLastReply && !isReplying ? [item('regenerate', 'Write again')] : []),
  ]
}
/** The round button's size, and the gap between it and the composer's top. */
export const SCROLL_BUTTON_SIZE = 36
/** The round button when it is away: see-through and a little smaller. */
const BUTTON_AWAY: Motion.Values = { opacity: 0, scale: 0.8 }
const BUTTON_HERE: Motion.Values = { opacity: 1, scale: 1 }
/** How long a new message's row is told to rise. Longer than the rise itself. */
export const RISE_WINDOW_MS = 700

const pushWait = Subscription.make(
  'chat/pushWait',
  Stream.fromEffect(Effect.as(Effect.sleep(`${PUSH_WAIT_MS} millis`), ChatScreenMessage.WaitedForPush())),
)

/**
 * The transcript's rows: the saved messages, and a row for a reply the
 * server has started but the saved chat does not hold yet.
 *
 * A person's message is keyed by the id the app gave it when it was sent,
 * which the server keeps. So its row is the same one before and after it is
 * saved. A reply is keyed by the id the server gave it at the start.
 */
export const rowsOf = (conversation: Conversation, started: ChatScreenModel['started']): ReadonlyArray<Row> => {
  const rows: Array<Row> = conversation.messages.map(message => ({
    key: message.role === 'user' ? (message.clientMessageId ?? message.id) : message.id,
    role: message.role,
    parts: message.parts,
    status: message.status,
    failure: message.failure,
    followTurnId: message.role === 'assistant' && message.status === 'streaming' ? message.turnId : null,
    attachments: message.attachments,
  }))
  if (started !== null && !conversation.messages.some(message => message.id === started.messageId)) {
    rows.push({
      key: started.messageId,
      role: 'assistant',
      parts: [],
      status: 'streaming',
      failure: null,
      followTurnId: started.turnId,
      attachments: [],
    })
  }
  return rows
}

/** The key of the newest question, which a reply written again is held under. */
const lastQuestionKey = (rows: ReadonlyArray<Row>): string | null => {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row !== undefined && row.role === 'user') return row.key
  }
  return null
}

const regenerate = (conversationId: string) =>
  RegenerateReply.make({ conversationId }).pipe(
    Command.match({
      onSuccess: started => ChatScreenMessage.StartedTurn({ turnId: started.turnId, messageId: started.messageId }),
      onFailure: error => ChatScreenMessage.FailedWrite({ action: 'write the reply again', reason: error.reason }),
    }),
  )

/** Opens the menu of the message with this row key. */
const showMenu = (
  conversation: AsyncResult.AsyncResult<Conversation, unknown>,
  started: ChatScreenModel['started'],
  key: string,
) => {
  const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, started) : []
  const index = rows.findIndex(each => each.key === key)
  const row = rows[index]
  const lastReply = rows.reduce((found, each, at) => (each.role === 'assistant' ? at : found), -1)
  const items = row === undefined ? [] : menuOf(row, index === lastReply, rows.some(each => each.followTurnId !== null))
  return Menus.Show.make({ title: '', items }).pipe(Command.map(answer => ChatScreenMessage.AnsweredMenu({ answer })))
}

export const ChatScreen = Native.component({
  name: 'ChatScreen',
  props: ChatScreenProps,
  model: ChatScreenModel,
  message: ChatScreenMessage,
  events: ChatScreenEvents,
  queries: {
    conversation: {
      query: GetConversation,
      args: ({ props }) => ({ id: props.conversationId }),
      onChange: () => ChatScreenMessage.ChangedConversation(),
    },
  },
}).make({
  init: $ => ({
    isSending: false,
    started: null,
    notice: null,
    menuFor: null,
    restore: null,
    copyRequest: null,
    keyboardHeight: 0,
    keyboardCovers: 0,
    anchorKey: null,
    risingKey: null,
    isAtEnd: true,
    isFollowing: true,
    focus: $.props.isNew ? ('pending' as const) : ('off' as const),
  }),
  update: {
    Submitted: ($, { text, attachments }) => {
      const conversation = $.queries.conversation
      if ($.model.isSending || !$.props.isOnline || !AsyncResult.isSuccess(conversation)) return $.model
      if (rowsOf(conversation.value, $.model.started).some(row => row.followTurnId !== null)) return $.model
      // Made from what the chat holds, so the same Messages give the same id again.
      const clientMessageId = `local-${$.props.conversationId}-${conversation.value.messages.length}`
      return (
        $.evolve({
          isSending: true,
          notice: null,
          // The list takes this question to the top of the screen by itself.
          anchorKey: clientMessageId,
          risingKey: clientMessageId,
          focus: $.model.focus === 'pending' ? ('off' as const) : $.model.focus,
        })
          .run(
            SendMessage.make({ conversationId: $.props.conversationId, text, clientMessageId, attachments }).pipe(
              Command.match({
                onSuccess: started =>
                  ChatScreenMessage.StartedTurn({ turnId: started.turnId, messageId: started.messageId }),
                onFailure: error => ChatScreenMessage.FailedSend({ reason: error.reason, text }),
              }),
            ),
          )
          .run(haptic.light())
          .run(
            After.make({ ms: RISE_WINDOW_MS, token: clientMessageId }).pipe(
              Command.map(({ token }) => ChatScreenMessage.RoseMessage({ key: token })),
            ),
          )
          // Send puts the keyboard away, as in Fold Chat.
          .run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop))
      )
    },
    StartedTurn: ($, { turnId, messageId }) => $.evolve({ isSending: false, started: { turnId, messageId } }),
    RoseMessage: ($, { key }) => ($.model.risingKey === key ? $.evolve({ risingKey: null }) : $.model),
    // The cache has taken the message off the screen. What was written goes back into the field.
    FailedSend: ($, { reason, text }) => {
      const notice = { text: `Not sent. ${reason}`, tone: 'error' as const }
      return $.evolve({
        isSending: false,
        notice,
        anchorKey: null,
        risingKey: null,
        restore: { id: ($.model.restore?.id ?? 0) + 1, text },
      })
        .run(clearLater(notice.text))
        .run(haptic.error())
    },
    HeldRow: ($, { key }) => {
      const next = $.evolve({ menuFor: key }).run(haptic.medium())
      // With the keyboard up, it goes first and the menu follows.
      return $.model.keyboardHeight > 0
        ? next
            .run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop))
            .run(
              After.make({ ms: MENU_AFTER_KEYBOARD_MS, token: key }).pipe(
                Command.as(ChatScreenMessage.WaitedForKeyboard()),
              ),
            )
        : next.run(showMenu($.queries.conversation, $.model.started, key))
    },
    WaitedForKeyboard: $ =>
      $.model.menuFor === null ? $.model : $.run(showMenu($.queries.conversation, $.model.started, $.model.menuFor)),
    AnsweredMenu: ($, { answer }) => {
      const key = $.model.menuFor
      const closed = $.evolve({ menuFor: null })
      const conversation = $.queries.conversation
      const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, $.model.started) : []
      const row = rows.find(each => each.key === key)
      if (answer._tag !== 'Selected' || row === undefined) return closed
      const text = textOfRow(row)
      switch (answer.key) {
        case 'copy':
          // Only the row has what a reply holds while it is still being written.
          return row.status === 'streaming'
            ? $.evolve({ menuFor: null, copyRequest: { key: row.key, count: ($.model.copyRequest?.count ?? 0) + 1 } })
            : closed.run(Phone.Copy.make({ text }).pipe(Command.as(ChatScreenMessage.CopiedSoFar())))
        case 'share':
          return closed.run(Phone.Share.make({ message: text }).pipe(done))
        case 'select':
          return closed.emit(
            ChatScreenEvents.OpenedSheet({
              sheet: { kind: 'select', title: 'Select text', text, isMarkdown: row.role === 'assistant' },
            }),
          )
        case 'regenerate':
          return $.evolve({ menuFor: null, notice: null, anchorKey: lastQuestionKey(rows) })
            .run(regenerate($.props.conversationId))
            .run(haptic.light())
        case 'stop':
          return row.followTurnId === null
            ? closed
            : closed.run(StopTurn.make({ turnId: row.followTurnId }).pipe(Command.asNoop)).run(haptic.medium())
        default:
          return closed
      }
    },
    PressedReplyAction: ($, { key, action }) => {
      const conversation = $.queries.conversation
      const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, $.model.started) : []
      const row = rows.find(each => each.key === key)
      if (row === undefined) return $.model
      const text = textOfRow(row)
      if (action === 'copy') return $.run(Phone.Copy.make({ text }).pipe(Command.as(ChatScreenMessage.CopiedSoFar())))
      if (action === 'share') return $.run(Phone.Share.make({ message: text }).pipe(done))
      return rows.some(each => each.followTurnId !== null) || !$.props.isOnline
        ? $.model
        : $.evolve({ notice: null, anchorKey: lastQuestionKey(rows) }).run(regenerate($.props.conversationId)).run(haptic.light())
    },
    PressedTryAgain: $ => {
      const conversation = $.queries.conversation
      const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, $.model.started) : []
      return $.evolve({ notice: null, anchorKey: lastQuestionKey(rows) }).run(regenerate($.props.conversationId)).run(haptic.light())
    },
    PressedReasoning: ($, { title, text }) =>
      $.run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop)).emit(
        ChatScreenEvents.OpenedSheet({ sheet: { kind: 'reasoning', title, text, isMarkdown: false } }),
      ),
    FailedWrite: ($, { action, reason }) => {
      const notice = { text: `Could not ${action}. ${reason}`, tone: 'error' as const }
      return $.evolve({ notice }).run(clearLater(notice.text)).run(haptic.error())
    },
    CopiedSoFar: $ => {
      const notice = { text: 'Copied', tone: 'info' as const }
      return $.evolve({ notice }).run(clearLater(notice.text)).run(haptic.success())
    },
    SelectedChatMenu: ($, { key }) => {
      const conversation = $.queries.conversation
      const title = AsyncResult.isSuccess(conversation) ? conversation.value.title : ''
      const next = $.emit(ChatScreenEvents.ChoseMenuItem({ key, title }))
      return key === 'delete' ? next : next.run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop))
    },
    PressedMore: $ =>
      $.run(
        Menus.Show.make({ title: '', items: Menus.itemsOf(CHAT_MENU) }).pipe(
          Command.map(answer => ChatScreenMessage.AnsweredChatMenu({ answer })),
        ),
      ),
    AnsweredChatMenu: ($, { answer }) => {
      if (answer._tag !== 'Selected') return $.model
      const conversation = $.queries.conversation
      const title = AsyncResult.isSuccess(conversation) ? conversation.value.title : ''
      return $.emit(ChatScreenEvents.ChoseMenuItem({ key: answer.key, title }))
    },
    Noticed: ($, { text }) => {
      const notice = { text, tone: 'error' as const }
      return $.evolve({ notice }).run(clearLater(text))
    },
    // Whatever the line said is out of date once the person writes again.
    EditedDraft: $ => ($.model.notice === null ? $.model : $.evolve({ notice: null })),
    HeardToast: ($, { toast }) => $.evolve({ notice: toast }).run(clearLater(toast.text)),
    WaitedForNotice: ($, { text }) => ($.model.notice?.text === text ? $.evolve({ notice: null }) : $.model),
    Done: $ => $.model,
    // The saved chat holds the reply now: its row comes from there.
    ChangedConversation: $ => {
      const { started } = $.model
      const conversation = $.queries.conversation
      return started !== null &&
        AsyncResult.isSuccess(conversation) &&
        conversation.value.messages.some(message => message.id === started.messageId)
        ? $.evolve({ started: null })
        : $.model
    },
    ChangedKeyboard: ($, { height, covers }) =>
      Math.round(height) === $.model.keyboardHeight && Math.round(covers) === $.model.keyboardCovers
        ? $.model
        : $.evolve({ keyboardHeight: Math.round(height), keyboardCovers: Math.round(covers) }),
    DismissedByPhone: ($, { count }) => $.emit(ChatScreenEvents.Dismissed({ count })),
    // The first of the two that says the push is done raises the keyboard, once.
    AppearedChat: $ => ($.model.focus === 'pending' ? $.evolve({ focus: 'asked' as const }) : $.model),
    WaitedForPush: $ => ($.model.focus === 'pending' ? $.evolve({ focus: 'asked' as const }) : $.model),
    TappedTranscript: $ =>
      $.model.keyboardHeight > 0 ? $.run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop)) : $.model,
    ChangedEnd: ($, { isAtEnd, isFollowing }) => $.evolve({ isAtEnd, isFollowing }),
    PressedScrollToEnd: $ => $.run(AnchoredList.scrollToEnd(TRANSCRIPT_ID, true).pipe(Command.asNoop)),
    PressedStop: $ => {
      const conversation = $.queries.conversation
      const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, $.model.started) : []
      const turnId = rows.find(row => row.followTurnId !== null)?.followTurnId
      return turnId === undefined || turnId === null
        ? $.model
        : $.run(StopTurn.make({ turnId }).pipe(Command.asNoop)).run(haptic.medium())
    },
    HeldTitle: $ => $.emit(ChatScreenEvents.ToggledNumbers()),
  },
  subscriptions: ({ model }) => [
    Phone.keyboard(frame => ChatScreenMessage.ChangedKeyboard({ height: frame.height, covers: frame.covers })),
    model.focus === 'pending' && pushWait,
    toasts(toast => ChatScreenMessage.HeardToast({ toast })),
  ],
  view: (h, model) => {
    const { platform, scheme, conversationId, showsNumbers, isOnline } = h.props
    const palette = paletteOf(scheme)
    const conversation = h.queries.conversation
    const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, model.started) : []
    const isReplying = rows.some(row => row.followTurnId !== null)
    const title = AsyncResult.isSuccess(conversation) ? conversation.value.title : 'Chat'
    const hasFailed = AsyncResult.isFailure(conversation)
    // The end is out of view, and the list is not on its way there.
    const wantsScrollButton = rows.length > 0 && !model.isAtEnd && !model.isFollowing
    return h.screen
      .testId('screen-chat')
      .style({ backgroundColor: palette.bg })
      .on('dismissed', ({ dismissCount }) => ChatScreenMessage.DismissedByPhone({ count: dismissCount ?? 1 }))
      .on('appear', ChatScreenMessage.AppearedChat())
      .children(
        navBar(h, platform, palette, {
          title,
          testId: 'bar-chat',
          onHoldTitle: ChatScreenMessage.HeldTitle(),
          ignored: ChatScreenMessage.Done(),
          right: {
            id: 'chat-menu',
            label: 'More',
            symbol: 'ellipsis',
            message: ChatScreenMessage.PressedMore(),
            // iOS: the phone's own menu on the bar button. Android: `PressedMore` shows the same entries as a list.
            menu: { items: CHAT_MENU, onSelected: key => ChatScreenMessage.SelectedChatMenu({ key }) },
          },
        }),
        // The bottom edge is the bar's: it keeps clear of the home indicator
        // or of the keyboard, never both.
        h.safeArea.set({ edges: { ...Native.safeAreaEdges(platform, { hasHeader: true }), bottom: false } }).children(
          h.view.style({ flex: 1, backgroundColor: palette.bg }).children(
            isOnline
              ? null
              : h.view
                  .key('offline')
                  .testId('offline')
                  .style({ paddingVertical: 6, paddingHorizontal: SPACE.xl, backgroundColor: palette.surface })
                  .children(
                    h.text
                      .style({ ...TYPE.caption, color: palette.ink2 })
                      .children('You are offline. Sending is off until you are back.'),
                  ),
            KeyboardBar.view(h, {
              keyboardHeight: model.keyboardCovers,
              listId: TRANSCRIPT_ID,
              fieldId: DRAFT_FIELD_ID,
              // No colour where the list runs under the bar: the composer is glass, and the messages show through.
              backgroundColor: KeyboardBar.isInset() ? undefined : palette.bg,
              above: hasFailed
                ? h.text
                    .testId('chat-failed')
                    .style({ ...TYPE.rowPreview, color: palette.ink2, padding: SPACE.xl })
                    .children('Could not load this chat.')
                : Transcript(h, {
                    key: 'transcript',
                    props: {
                      conversationId,
                      rows,
                      isLoading: AsyncResult.isInitial(conversation),
                      scheme,
                      platform,
                      anchorKey: model.anchorKey,
                      risingKey: model.risingKey,
                      showsNumbers,
                      copyRequest: model.copyRequest,
                    },
                    onEmit: {
                      PressedSuggestion: ({ text }) => ChatScreenMessage.Submitted({ text, attachments: [] }),
                      Tapped: () => ChatScreenMessage.TappedTranscript(),
                      ChangedEnd: ({ isAtEnd, isFollowing }) => ChatScreenMessage.ChangedEnd({ isAtEnd, isFollowing }),
                      HeldRow: ({ key }) => ChatScreenMessage.HeldRow({ key }),
                      PressedReplyAction: ({ key, action }) => ChatScreenMessage.PressedReplyAction({ key, action }),
                      PressedReasoning: ({ title, text }) => ChatScreenMessage.PressedReasoning({ title, text }),
                      PressedTryAgain: () => ChatScreenMessage.PressedTryAgain(),
                      CopiedSoFar: () => ChatScreenMessage.CopiedSoFar(),
                    },
                  }),
              // The round button rides on the composer's top edge: the phone
              // moves it with the composer, and nothing here places it.
              overBar: h.view
                .testId('scroll-to-end-seat')
                // Touches beside the button go to the messages under it.
                .set({ pointerEvents: 'box-none' })
                .style({ alignItems: 'center', paddingTop: SPACE.s, paddingBottom: SPACE.s })
                .children(
                  // Only there while it is wanted. The phone fades and grows it in, and
                  // fades and shrinks it out before it is taken away.
                  wantsScrollButton
                    ? Motion.animate(h.view.key('scroll-to-end-motion').testId('scroll-to-end-motion'), {
                        from: BUTTON_AWAY,
                        to: BUTTON_HERE,
                        exit: BUTTON_AWAY,
                        ms: MOTION.scrollButton,
                      }).children(
                        h.pressable
                          .key('scroll-to-end')
                          .testId('scroll-to-end')
                          .set({ accessibilityRole: 'button', accessibilityLabel: 'Scroll to the newest message', hitSlop: 8 })
                          .style({
                            width: SCROLL_BUTTON_SIZE,
                            height: SCROLL_BUTTON_SIZE,
                            borderRadius: SCROLL_BUTTON_SIZE / 2,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: palette.bg,
                            borderWidth: 1,
                            borderColor: palette.line,
                          })
                          .pressedStyle({ opacity: 0.6 })
                          .on('press', ChatScreenMessage.PressedScrollToEnd())
                          .children(arrowDown(h, palette.ink)),
                      )
                    : null,
                ),
              bar: [
                // The line fades in, and out again before it is taken away.
                model.notice === null
                  ? null
                  : Motion.animate(h.view.key('notice').testId('chat-notice-motion'), {
                      from: { opacity: 0 },
                      to: { opacity: 1 },
                      exit: { opacity: 0 },
                      ms: MOTION.notice,
                    }).children(
                      h.text
                        .testId('chat-notice')
                        .style({
                          ...TYPE.caption,
                          color: model.notice.tone === 'error' ? palette.danger : palette.ink2,
                          paddingHorizontal: SPACE.xl,
                          paddingTop: SPACE.xs,
                        })
                        .children(model.notice.text),
                    ),
                Composer(h, {
                  key: 'composer',
                  props: {
                    scheme,
                    platform,
                    isSending: model.isSending,
                    isReplying,
                    isOnline,
                    focusRequest: model.focus === 'asked' ? 1 : 0,
                    restore: model.restore,
                  },
                  onEmit: {
                    Submitted: ({ text, attachments }) => ChatScreenMessage.Submitted({ text, attachments }),
                    PressedStop: () => ChatScreenMessage.PressedStop(),
                    EditedDraft: () => ChatScreenMessage.EditedDraft(),
                    Noticed: ({ text }) => ChatScreenMessage.Noticed({ text }),
                  },
                }),
              ],
            }),
          ),
        ),
      )
  },
})
