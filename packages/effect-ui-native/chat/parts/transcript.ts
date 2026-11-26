/**
 * The transcript: the messages of one chat, oldest first.
 *
 * It is a long list drawn the way `VirtualList` draws one. The Model holds
 * the window (which rows are drawn now), a scroll is a Message, and each row
 * is a child component: `MessageRow` for the person's messages,
 * `ReplyStream` for the assistant's.
 *
 * The rows are props. The chat screen works them out from the chat's query
 * and hands them down. This part does not know where they came from.
 *
 * Step 1 stops there. Keeping the question in place after Send, following
 * the end while a reply grows, making room for the keyboard and the "scroll
 * to end" button come in step 2, and go in this part.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { MessageStatus, Part } from '../../../native/src/host/aiChat/wire.js'
import { Native, VirtualList } from '../../src/index.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { centred } from '../ui.js'
import { MessageRow } from './messageRow.js'
import { ReplyStream } from './replyStream.js'

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
})
export type Row = typeof Row.Type

export const TranscriptProps = Schema.Struct({
  conversationId: Schema.String,
  rows: Schema.Array(Row),
  /** The chat's messages have not loaded yet. */
  isLoading: Schema.Boolean,
  scheme: Scheme,
})

export const TranscriptMessage = UiSchema.TaggedEnum({
  ScrolledList: { at: VirtualList.ScrollAt },
  MeasuredRow: { index: Schema.Number, height: Schema.Number },
  PressedSuggestion: { text: Schema.String },
})

export const TranscriptEvents = UiSchema.TaggedEnum({
  PressedSuggestion: { text: Schema.String },
})

const TranscriptModel = Schema.Struct({
  list: VirtualList.Model,
  /** Where the list was when the window last moved. */
  offset: Schema.Number,
})

/** Questions an empty chat offers. A press sends one. */
export const SUGGESTIONS = [
  'How do I start running?',
  'Train or car for a weekend trip?',
  'Will it rain in Lisbon tomorrow?',
] as const

const textOf = (row: Row): string => row.parts.map(part => (part._tag === 'Text' ? part.text : '')).join('')

export const Transcript = Native.component({
  name: 'Transcript',
  props: TranscriptProps,
  model: TranscriptModel,
  message: TranscriptMessage,
  events: TranscriptEvents,
}).make({
  init: $ => ({ list: VirtualList.init({ count: $.props.rows.length, estimate: 120 }), offset: 0 }),
  update: {
    ScrolledList: ($, { at }) => {
      const list = VirtualList.scrolled($.model.list, at, $.props.rows.length)
      return list === $.model.list ? $.model : $.evolve({ list, offset: at.y })
    },
    MeasuredRow: ($, { index, height }) => {
      const list = VirtualList.measured($.model.list, index, height, $.props.rows.length)
      return list === $.model.list ? $.model : $.evolve({ list })
    },
    PressedSuggestion: ($, { text }) => $.emit(TranscriptEvents.PressedSuggestion({ text })),
  },
  view: (h, model) => {
    const { rows, scheme, conversationId, isLoading } = h.props
    const palette = paletteOf(scheme)
    // The rows may have changed since the window was chosen: a message was
    // added, or the chat has just loaded. The window is fitted to them here.
    const list = VirtualList.resized(model.list, model.offset, rows.length)
    return h.view.style({ flex: 1, backgroundColor: palette.bg }).children(
      VirtualList.view(h, {
        model: list,
        count: rows.length,
        testId: 'transcript',
        style: { backgroundColor: palette.bg },
        idOf: index => rows[index]?.key ?? String(index),
        onScroll: at => TranscriptMessage.ScrolledList({ at }),
        onRowLayout: (index, height) => TranscriptMessage.MeasuredRow({ index, height }),
        row: (index, key) => {
          const row = rows[index] as Row
          return row.role === 'user'
            ? MessageRow(h, { key, props: { id: row.key, text: textOf(row), scheme } })
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
                },
              })
        },
        footer: h.view.key('end').style({ height: SPACE.xxl }),
      }),
      isLoading
        ? centred(h, 'chat-loading', [h.text.style({ ...TYPE.rowPreview, color: palette.ink3 }).children('Loading')])
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
    )
  },
})
