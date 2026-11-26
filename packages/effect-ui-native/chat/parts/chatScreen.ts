/**
 * One chat: a native screen with the chat's title in its bar, the
 * transcript, and the composer under it.
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
 *    answered.
 * 2. A row for the reply, as soon as the server has said which reply it is
 *    writing. The row follows the reply's stream by itself (`ReplyStream`).
 * 3. The saved chat, loaded again when the reply has ended. The rows keep
 *    their keys through all three, so none is made twice.
 *
 * A swipe back is the phone's. The screen reports it (`Dismissed`) and the
 * app drops the screen from its Model.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'

import type { Conversation } from '../../../native/src/host/aiChat/wire.js'
import { Native, Phone } from '../../src/index.js'
import { GetConversation, SendMessage } from '../data.js'
import { SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { navBar } from '../ui.js'
import { Composer } from './composer.js'
import { type Row, Transcript } from './transcript.js'

export const ChatScreenProps = Schema.Struct({
  conversationId: Schema.String,
  platform: Schema.String,
  scheme: Scheme,
})

export const ChatScreenMessage = UiSchema.TaggedEnum({
  Submitted: { text: Schema.String },
  StartedTurn: { turnId: Schema.String, messageId: Schema.String },
  FailedSend: { reason: Schema.String },
  ChangedConversation: {},
  ChangedKeyboard: { height: Schema.Number },
  DismissedByPhone: { count: Schema.Number },
})

export const ChatScreenEvents = UiSchema.TaggedEnum({
  Dismissed: { count: Schema.Number },
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
})
type ChatScreenModel = typeof ChatScreenModel.Type

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
  init: () => ({ isSending: false, started: null, notice: '', keyboardHeight: 0 }),
  update: {
    Submitted: ($, { text }) => {
      const conversation = $.queries.conversation
      if ($.model.isSending || !AsyncResult.isSuccess(conversation)) return $.model
      return $.evolve({ isSending: true, notice: '' }).run(
        SendMessage.make({
          conversationId: $.props.conversationId,
          text,
          // Made from what the chat holds, so the same Messages give the same id again.
          clientMessageId: `local-${$.props.conversationId}-${conversation.value.messages.length}`,
        }).pipe(
          Command.match({
            onSuccess: started =>
              ChatScreenMessage.StartedTurn({ turnId: started.turnId, messageId: started.messageId }),
            onFailure: error => ChatScreenMessage.FailedSend({ reason: error.reason }),
          }),
        ),
      )
    },
    StartedTurn: ($, { turnId, messageId }) => $.evolve({ isSending: false, started: { turnId, messageId } }),
    FailedSend: ($, { reason }) => $.evolve({ isSending: false, notice: reason }),
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
    ChangedKeyboard: ($, { height }) =>
      Math.round(height) === $.model.keyboardHeight ? $.model : $.evolve({ keyboardHeight: Math.round(height) }),
    DismissedByPhone: ($, { count }) => $.emit(ChatScreenEvents.Dismissed({ count })),
  },
  subscriptions: () => [Phone.keyboard(frame => ChatScreenMessage.ChangedKeyboard({ height: frame.height }))],
  view: (h, model) => {
    const { platform, scheme, conversationId } = h.props
    const palette = paletteOf(scheme)
    const conversation = h.queries.conversation
    const rows = AsyncResult.isSuccess(conversation) ? rowsOf(conversation.value, model.started) : []
    const isReplying = rows.some(row => row.followTurnId !== null)
    const title = AsyncResult.isSuccess(conversation) ? conversation.value.title : 'Chat'
    const hasFailed = AsyncResult.isFailure(conversation)
    return h.screen
      .testId('screen-chat')
      .style({ backgroundColor: palette.bg })
      .on('dismissed', ({ dismissCount }) => ChatScreenMessage.DismissedByPhone({ count: dismissCount ?? 1 }))
      .children(
        navBar(h, platform, palette, { title, testId: 'bar-chat' }),
        h.safeArea.set({ edges: Native.safeAreaEdges(platform, { hasHeader: true }) }).children(
          // Step 1 only: the whole screen makes room for the keyboard, so the
          // field can be seen while typing. Step 2 replaces this.
          h.view.style({ flex: 1, backgroundColor: palette.bg, paddingBottom: model.keyboardHeight }).children(
            hasFailed
              ? h.text
                  .testId('chat-failed')
                  .style({ ...TYPE.rowPreview, color: palette.ink2, padding: SPACE.xl })
                  .children('Could not load this chat.')
              : Transcript(h, {
                  key: 'transcript',
                  props: { conversationId, rows, isLoading: AsyncResult.isInitial(conversation), scheme },
                  onEmit: { PressedSuggestion: ({ text }) => ChatScreenMessage.Submitted({ text }) },
                }),
            model.notice === ''
              ? null
              : h.text
                  .testId('chat-notice')
                  .style({ ...TYPE.caption, color: palette.danger, paddingHorizontal: SPACE.xl, paddingVertical: SPACE.xs })
                  .children(model.notice),
            Composer(h, {
              key: 'composer',
              props: { scheme, isBusy: model.isSending || isReplying },
              onEmit: { Submitted: ({ text }) => ChatScreenMessage.Submitted({ text }) },
            }),
          ),
        ),
      )
  },
})
