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
 * A swipe back is the phone's. The screen reports it (`Dismissed`) and the
 * app drops the screen from its Model.
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Effect, Schema, Stream } from 'effect'
import { AsyncResult } from 'effect/reactivity'

import type { Conversation } from '../../../native/src/host/aiChat/wire.js'
import { AnchoredList, KeyboardBar, Native, Phone } from '../../src/index.js'
import { GetConversation, SendMessage, StopTurn } from '../data.js'
import { arrowDown } from '../icons.js'
import { SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { navBar } from '../ui.js'
import { Composer, DRAFT_FIELD_ID } from './composer.js'
import { type Row, TRANSCRIPT_ID, Transcript } from './transcript.js'

export const ChatScreenProps = Schema.Struct({
  conversationId: Schema.String,
  platform: Schema.String,
  scheme: Scheme,
  /** The chat was made a moment ago: its field takes the caret once the push is over. */
  isNew: Schema.Boolean,
  /** The numbers strip is on. */
  showsNumbers: Schema.Boolean,
})

export const ChatScreenMessage = UiSchema.TaggedEnum({
  Submitted: { text: Schema.String },
  StartedTurn: { turnId: Schema.String, messageId: Schema.String },
  FailedSend: { reason: Schema.String },
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
})

const ChatScreenModel = Schema.Struct({
  /** The message is on its way to the server. */
  isSending: Schema.Boolean,
  /**
   * The reply the server has started, until the saved chat holds it. It
   * gives the reply a row before the chat has loaded again.
   */
  started: Schema.NullOr(Schema.Struct({ turnId: Schema.String, messageId: Schema.String })),
  notice: Schema.String,
  keyboardHeight: Schema.Number,
  /**
   * How much of the app's window the keyboard covers. 0 on an Android window
   * that makes itself shorter for the keyboard. Read only where the app pads
   * the composer itself.
   */
  keyboardCovers: Schema.Number,
  /** The question held near the top of the screen, by its row key. */
  anchorKey: Schema.NullOr(Schema.String),
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
/** The round button's size, and the gap between it and the composer's top. */
export const SCROLL_BUTTON_SIZE = 36

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
  }))
  if (started !== null && !conversation.messages.some(message => message.id === started.messageId)) {
    rows.push({
      key: started.messageId,
      role: 'assistant',
      parts: [],
      status: 'streaming',
      failure: null,
      followTurnId: started.turnId,
    })
  }
  return rows
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
    notice: '',
    keyboardHeight: 0,
    keyboardCovers: 0,
    anchorKey: null,
    isAtEnd: true,
    isFollowing: true,
    focus: $.props.isNew ? ('pending' as const) : ('off' as const),
  }),
  update: {
    Submitted: ($, { text }) => {
      const conversation = $.queries.conversation
      if ($.model.isSending || !AsyncResult.isSuccess(conversation)) return $.model
      // Made from what the chat holds, so the same Messages give the same id again.
      const clientMessageId = `local-${$.props.conversationId}-${conversation.value.messages.length}`
      return (
        $.evolve({
          isSending: true,
          notice: '',
          // The list takes this question to the top of the screen by itself.
          anchorKey: clientMessageId,
          focus: $.model.focus === 'pending' ? ('off' as const) : $.model.focus,
        })
          .run(
            SendMessage.make({ conversationId: $.props.conversationId, text, clientMessageId }).pipe(
              Command.match({
                onSuccess: started =>
                  ChatScreenMessage.StartedTurn({ turnId: started.turnId, messageId: started.messageId }),
                onFailure: error => ChatScreenMessage.FailedSend({ reason: error.reason }),
              }),
            ),
          )
          // Send puts the keyboard away, as in Fold Chat.
          .run(Phone.DismissKeyboard.make({}).pipe(Command.asNoop))
      )
    },
    StartedTurn: ($, { turnId, messageId }) => $.evolve({ isSending: false, started: { turnId, messageId } }),
    FailedSend: ($, { reason }) => $.evolve({ isSending: false, notice: reason, anchorKey: null }),
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
      return turnId === undefined || turnId === null ? $.model : $.run(StopTurn.make({ turnId }).pipe(Command.asNoop))
    },
    HeldTitle: $ => $.emit(ChatScreenEvents.ToggledNumbers()),
  },
  subscriptions: ({ model }) => [
    Phone.keyboard(frame => ChatScreenMessage.ChangedKeyboard({ height: frame.height, covers: frame.covers })),
    model.focus === 'pending' && pushWait,
  ],
  view: (h, model) => {
    const { platform, scheme, conversationId, showsNumbers } = h.props
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
        navBar(h, platform, palette, { title, testId: 'bar-chat', onHoldTitle: ChatScreenMessage.HeldTitle() }),
        // The bottom edge is the bar's: it keeps clear of the home indicator
        // or of the keyboard, never both.
        h.safeArea.set({ edges: { ...Native.safeAreaEdges(platform, { hasHeader: true }), bottom: false } }).children(
          h.view.style({ flex: 1, backgroundColor: palette.bg }).children(
            KeyboardBar.view(h, {
              keyboardHeight: model.keyboardCovers,
              listId: TRANSCRIPT_ID,
              fieldId: DRAFT_FIELD_ID,
              backgroundColor: palette.bg,
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
                      showsNumbers,
                    },
                    onEmit: {
                      PressedSuggestion: ({ text }) => ChatScreenMessage.Submitted({ text }),
                      Tapped: () => ChatScreenMessage.TappedTranscript(),
                      ChangedEnd: ({ isAtEnd, isFollowing }) => ChatScreenMessage.ChangedEnd({ isAtEnd, isFollowing }),
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
                  wantsScrollButton
                    ? h.pressable
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
                        .children(arrowDown(h, palette.ink))
                    : null,
                ),
              bar: [
                model.notice === ''
                  ? null
                  : h.text
                      .key('notice')
                      .testId('chat-notice')
                      .style({ ...TYPE.caption, color: palette.danger, paddingHorizontal: SPACE.xl, paddingTop: SPACE.xs })
                      .children(model.notice),
                Composer(h, {
                  key: 'composer',
                  props: {
                    scheme,
                    platform,
                    isSending: model.isSending,
                    isReplying,
                    focusRequest: model.focus === 'asked' ? 1 : 0,
                  },
                  onEmit: {
                    Submitted: ({ text }) => ChatScreenMessage.Submitted({ text }),
                    PressedStop: () => ChatScreenMessage.PressedStop(),
                  },
                }),
              ],
            }),
          ),
        ),
      )
  },
})
