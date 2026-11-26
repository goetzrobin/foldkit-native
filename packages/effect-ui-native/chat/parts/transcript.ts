/**
 * The transcript: the messages of one chat, oldest first, and how they move.
 *
 * The list is an `AnchoredList`: the host layer's list controller places
 * it, and this part draws the rows. Each row is a child component,
 * `MessageRow` for the person's messages and `ReplyStream` for the
 * assistant's. The rows are props: the chat screen works them out from the
 * chat's query and hands them down.
 *
 * What the list does by itself, with no Message from here:
 *
 * - It opens at its end, unseen until it is there.
 * - After Send the chat screen names the question (`anchorKey`). The list
 *   takes it to 16 points from the top and keeps room under it for the
 *   reply. The room shrinks as the reply grows, and the question stays.
 * - Its bottom inset is what the composer and the keyboard cover.
 * - Once the reader has asked for the end (the round button, or scrolling
 *   there) it follows the reply as it grows, until a finger drags it away.
 *
 * What this part adds: it tells the list when a finger rests on a row, so
 * the list waits; it reports a tap that nothing took, so the chat screen can
 * put the keyboard away; and it tells the chat screen whether the end is in
 * view and whether the list follows it, for the round button.
 *
 * A hold on a row is a Message here, and the chat screen opens the row's
 * menu (`HeldRow`). The hold is read two ways at once: by the phone's own
 * long press recogniser on the row's view, and by the host's own timer as
 * the backup (`NativeHost.NATIVE_HOLD`). The phone's recogniser is what works
 * on a real iPhone while a reply streams and the list moves by itself.
 *
 * What a row's buttons ask for (copy, share, write again, show the
 * reasoning) is passed up with the row's key.
 *
 * The numbers strip is a thin dark line over the top of the transcript. The
 * list writes its own numbers into it as it moves.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Attachment, MessageStatus, Part } from '../../../native/src/host/aiChat/wire.js'
import { AnchoredList, KeyboardBar, Motion, Native, NativeHost, NativeViews } from '../../src/index.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { centred } from '../ui.js'
import { MessageRow } from './messageRow.js'
import { ReplyAction, ReplyStream } from './replyStream.js'

/** One row, as the chat screen hands it down. */
export const Row = Schema.Struct({
  /** Stays the same from the moment the row appears, so the row is never made again. */
  key: Schema.String,
  role: Schema.Literals(['user', 'assistant']),
  parts: Schema.Array(Part),
  status: MessageStatus,
  failure: Schema.NullOr(Schema.String),
  /** For a reply that is being written: its turn. */
  followTurnId: Schema.NullOr(Schema.String),
  /** Voice notes that went with a message. */
  attachments: Schema.Array(Attachment),
})
export type Row = typeof Row.Type

export const TranscriptProps = Schema.Struct({
  conversationId: Schema.String,
  rows: Schema.Array(Row),
  /** The chat's messages have not loaded yet. */
  isLoading: Schema.Boolean,
  scheme: Scheme,
  platform: Schema.String,
  /** The question held near the top of the screen, by its row key. */
  anchorKey: Schema.NullOr(Schema.String),
  /** The message that was sent a moment ago, by its row key. Its row rises into place. */
  risingKey: Schema.NullOr(Schema.String),
  /** The numbers strip is on. */
  showsNumbers: Schema.Boolean,
  /** A reply that is asked to copy what is written so far: its row, and a count that goes up by one. */
  copyRequest: Schema.NullOr(Schema.Struct({ key: Schema.String, count: Schema.Number })),
})

export const TranscriptMessage = UiSchema.TaggedEnum({
  PlannedWindow: { window: AnchoredList.Window },
  ChangedAtEnd: { isAtEnd: Schema.Boolean },
  ChangedFollowing: { isFollowing: Schema.Boolean },
  /** A finger came down on a row, or that touch is over. */
  TouchedRow: { isDown: Schema.Boolean },
  /** A finger rested on a row for half a second. */
  HeldRow: { key: Schema.String },
  /** A short touch on a row or on the list that nothing else took. */
  Tapped: {},
  PressedSuggestion: { text: Schema.String },
  PressedReplyAction: { key: Schema.String, action: ReplyAction },
  PressedReasoning: { title: Schema.String, text: Schema.String },
  PressedTryAgain: {},
  CopiedSoFar: {},
})

export const TranscriptEvents = UiSchema.TaggedEnum({
  PressedSuggestion: { text: Schema.String },
  Tapped: {},
  /** A finger rested on a row for half a second: its menu is wanted. */
  HeldRow: { key: Schema.String },
  PressedReplyAction: { key: Schema.String, action: ReplyAction },
  PressedReasoning: { title: Schema.String, text: Schema.String },
  PressedTryAgain: {},
  CopiedSoFar: {},
  /** Whether the end of the list is in view, and whether the list follows it. */
  ChangedEnd: { isAtEnd: Schema.Boolean, isFollowing: Schema.Boolean },
})

const TranscriptModel = Schema.Struct({
  /** The rows drawn now, as the list last chose. */
  window: AnchoredList.Window,
  isAtEnd: Schema.Boolean,
  isFollowing: Schema.Boolean,
  /** How many holds this chat has seen. Shown in the numbers strip. */
  holds: Schema.Number,
  lastHeld: Schema.String,
  /** Counts the touches the list was told of, so it can tell their order. */
  touches: Schema.Number,
})

/** The transcript's list, by the name the Commands and the numbers know it by. */
export const TRANSCRIPT_ID = 'transcript'

/** A question taller than this shows only its last lines at the top, so the reply has room. */
const ANCHOR_MAX_SIZE = 3 * TYPE.message.lineHeight + 20
/** How far below the top of the list the question sits. */
export const ANCHOR_OFFSET = SPACE.l

/** Questions an empty chat offers. A press sends one. */
export const SUGGESTIONS = [
  'How do I start running?',
  'Train or car for a weekend trip?',
  'Will it rain in Lisbon tomorrow?',
] as const

/** On a row: read its hold with the phone's own recogniser too. One object, so a draw that changes nothing changes nothing. */
const NATIVE_HOLD = { [NativeHost.NATIVE_HOLD]: true }

const textOf = (row: Row): string => row.parts.map(part => (part._tag === 'Text' ? part.text : '')).join('')

const STRIP_TEXT = { color: '#FFFFFF', fontSize: 11, lineHeight: 15 } as const

export const Transcript = Native.component({
  name: 'Transcript',
  props: TranscriptProps,
  model: TranscriptModel,
  message: TranscriptMessage,
  events: TranscriptEvents,
}).make({
  // A list that opens at its end starts there and follows.
  init: () => ({ window: AnchoredList.init(), isAtEnd: true, isFollowing: true, holds: 0, lastHeld: 'none', touches: 0 }),
  update: {
    PlannedWindow: ($, { window }) => $.evolve({ window }),
    ChangedAtEnd: ($, { isAtEnd }) =>
      $.evolve({ isAtEnd }).emit(TranscriptEvents.ChangedEnd({ isAtEnd, isFollowing: $.model.isFollowing })),
    ChangedFollowing: ($, { isFollowing }) =>
      $.evolve({ isFollowing }).emit(TranscriptEvents.ChangedEnd({ isAtEnd: $.model.isAtEnd, isFollowing })),
    // The list waits under a resting finger, and catches up when it lifts.
    TouchedRow: ($, { isDown }) =>
      $.evolve({ touches: count => count + 1 }).run(
        AnchoredList.touch(TRANSCRIPT_ID, isDown, $.model.touches + 1).pipe(Command.asNoop),
      ),
    HeldRow: ($, { key }) =>
      $.evolve({ holds: count => count + 1, lastHeld: key }).emit(TranscriptEvents.HeldRow({ key })),
    Tapped: $ => $.emit(TranscriptEvents.Tapped()),
    PressedSuggestion: ($, { text }) => $.emit(TranscriptEvents.PressedSuggestion({ text })),
    PressedReplyAction: ($, { key, action }) => $.emit(TranscriptEvents.PressedReplyAction({ key, action })),
    PressedReasoning: ($, { title, text }) => $.emit(TranscriptEvents.PressedReasoning({ title, text })),
    PressedTryAgain: $ => $.emit(TranscriptEvents.PressedTryAgain()),
    CopiedSoFar: $ => $.emit(TranscriptEvents.CopiedSoFar()),
  },
  view: (h, model) => {
    const { rows, scheme, platform, conversationId, isLoading, anchorKey, risingKey, showsNumbers, copyRequest } = h.props
    const palette = paletteOf(scheme)
    const anchorIndex = anchorKey === null ? -1 : rows.findIndex(row => row.key === anchorKey)
    const last = rows.length - 1
    const lastReply = rows.reduce((found, row, index) => (row.role === 'assistant' ? index : found), -1)
    return h.view.style({ flex: 1, backgroundColor: palette.bg }).children(
      // Not drawn until the messages are here: the list then opens at its
      // end with all of them, and nothing is seen to move.
      isLoading
        ? null
        : AnchoredList.view(h, {
            id: TRANSCRIPT_ID,
            window: model.window,
            keys: rows.map(row => row.key),
            estimate: 120,
            testId: 'transcript',
            style: { backgroundColor: palette.bg },
            props: {
              indicatorStyle: scheme === 'dark' ? 'white' : 'black',
              keyboardDismissMode: KeyboardBar.dismissOnDrag(),
            },
            inset: 'whenAtEnd',
            anchor: anchorIndex < 0 ? undefined : { index: anchorIndex, maxSize: ANCHOR_MAX_SIZE, offset: ANCHOR_OFFSET },
            onWindow: window => TranscriptMessage.PlannedWindow({ window }),
            onAtEnd: isAtEnd => TranscriptMessage.ChangedAtEnd({ isAtEnd }),
            onFollow: isFollowing => TranscriptMessage.ChangedFollowing({ isFollowing }),
            // A tap where no row is puts the keyboard away, as in Messages.
            onTap: TranscriptMessage.Tapped(),
            // Android's scroll view cannot put the keyboard away by itself.
            onDragStart: h.props.platform === 'android' ? TranscriptMessage.Tapped() : undefined,
            row: (index, key) => {
              const row = rows[index] as Row
              return (
                h.view
                  .testId(`row-${key}`)
                  // A real view, so the touch has something to land on.
                  .set({ collapsable: false })
                  .prop(NativeHost.NODE_DATA, NATIVE_HOLD)
                  .style({ paddingBottom: index === last ? SPACE.l : 0 })
                  .on('pressIn', TranscriptMessage.TouchedRow({ isDown: true }))
                  .on('pressOut', TranscriptMessage.TouchedRow({ isDown: false }))
                  .on('longPress', TranscriptMessage.HeldRow({ key }))
                  .on('press', TranscriptMessage.Tapped())
                  .children(
                    row.role === 'user'
                      ? MessageRow(h, {
                          key,
                          props: {
                            id: row.key,
                            text: textOf(row),
                            attachments: row.attachments.map(each => each.name),
                            scheme,
                            rises: row.key === risingKey,
                          },
                        })
                      : ReplyStream(h, {
                          key,
                          props: {
                            id: row.key,
                            conversationId,
                            parts: row.parts,
                            status: row.status,
                            failure: row.failure,
                            followTurnId: row.followTurnId,
                            scheme,
                            platform,
                            isLast: index === lastReply,
                            copyRequest: copyRequest !== null && copyRequest.key === row.key ? copyRequest.count : 0,
                          },
                          onEmit: {
                            PressedAction: ({ action }) => TranscriptMessage.PressedReplyAction({ key, action }),
                            PressedReasoning: ({ title, text }) => TranscriptMessage.PressedReasoning({ title, text }),
                            PressedTryAgain: () => TranscriptMessage.PressedTryAgain(),
                            CopiedSoFar: () => TranscriptMessage.CopiedSoFar(),
                          },
                        }),
                  )
              )
            },
          }),
      isLoading
        ? centred(h, 'chat-loading', [NativeViews.spinner(h, platform, palette.ink3)])
        : rows.length === 0
          ? centred(h, 'empty-chat', [
              h.text.style({ ...TYPE.headline, color: palette.ink }).children('Ask anything'),
              h.view.style({ height: SPACE.xs }),
              ...SUGGESTIONS.map((text, index) =>
                h.pressable
                  .key(text)
                  .testId(`suggestion-${index}`)
                  .set({ accessibilityRole: 'button' })
                  .style({
                    paddingVertical: SPACE.s,
                    paddingHorizontal: SPACE.m,
                    borderRadius: RADIUS.chip,
                    backgroundColor: palette.surface,
                  })
                  .pressedStyle({ opacity: 0.6 })
                  .on('press', TranscriptMessage.PressedSuggestion({ text }))
                  .children(h.text.style({ ...TYPE.rowPreview, color: palette.ink }).children(text)),
              ),
            ])
          : null,
      showsNumbers && !isLoading
        ? h.view
            .key('numbers')
            .testId('numbers')
            .set({ pointerEvents: 'none' })
            .style({
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              paddingVertical: 4,
              paddingHorizontal: 8,
              backgroundColor: 'rgba(13,13,14,0.86)',
            })
            .children(
              AnchoredList.numbersLabel(h, TRANSCRIPT_ID, STRIP_TEXT, 'numbers-list'),
              h.text
                .testId('numbers-holds')
                .style(STRIP_TEXT)
                .children(
                  `holds ${model.holds}, last held ${model.lastHeld}, keyboard ${KeyboardBar.isInset() ? 'moved by the phone' : 'padded'}`,
                ),
              // Which way holds are read, and how the last one went. Drawn again with each hold.
              h.text.testId('numbers-hold-route').style(STRIP_TEXT).children(NativeHost.holdReport()),
              // Whether animations run on the phone's own thread in this build, and how many did.
              h.text
                .testId('numbers-motion')
                .style(STRIP_TEXT)
                .children(`motion: ${Motion.status()} | ${Motion.stats().onUiThread} run there, ${Motion.stats().atOnce} set at once`),
              // Whether this build has the native view the list of chats swipes with.
              h.text.testId('numbers-swipe').style(STRIP_TEXT).children(`swipe: ${NativeViews.swipeStatus()}`),
            )
        : null,
    )
  },
})
