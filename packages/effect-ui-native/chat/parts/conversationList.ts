/**
 * The list of chats: the first screen.
 *
 * The rows come from the `ListConversations` query. The screen draws what
 * the cache holds: nothing yet, the chats, or that loading failed. It never
 * asks for the list itself. The cache loads it when the screen appears and
 * again whenever a write says the list is old.
 *
 * This part is one native screen with its own title bar. It tells the app
 * which chat to open (`OpenedChat`), and the app pushes that screen.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'

import type { ConversationSummary } from '../../../native/src/host/aiChat/wire.js'
import { Native } from '../../src/index.js'
import { CreateConversation, ListConversations } from '../data.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { centred, navBar, solidButton } from '../ui.js'

export const ConversationListProps = Schema.Struct({ platform: Schema.String, scheme: Scheme })

export const ConversationListMessage = UiSchema.TaggedEnum({
  PressedNewChat: {},
  PressedChat: { id: Schema.String },
  CreatedChat: { id: Schema.String },
  FailedCreate: { reason: Schema.String },
})

export const ConversationListEvents = UiSchema.TaggedEnum({
  /** `isNew`: the chat was made just now, by this press. */
  OpenedChat: { id: Schema.String, isNew: Schema.Boolean },
})

const ConversationListModel = Schema.Struct({
  /** A new chat is being made. A second press does nothing until it is. */
  isCreating: Schema.Boolean,
  notice: Schema.String,
})

const previewOf = (summary: ConversationSummary): string =>
  summary.preview.trim() === '' ? 'No messages yet' : summary.preview.replace(/\s+/g, ' ')

export const ConversationList = Native.component({
  name: 'ConversationList',
  props: ConversationListProps,
  model: ConversationListModel,
  message: ConversationListMessage,
  events: ConversationListEvents,
  queries: { list: { query: ListConversations, args: () => ({}) } },
}).make({
  init: () => ({ isCreating: false, notice: '' }),
  update: {
    PressedNewChat: $ =>
      $.model.isCreating
        ? $.model
        : $.evolve({ isCreating: true, notice: '' }).run(
            CreateConversation.make().pipe(
              Command.match({
                onSuccess: summary => ConversationListMessage.CreatedChat({ id: summary.id }),
                onFailure: error => ConversationListMessage.FailedCreate({ reason: error.reason }),
              }),
            ),
          ),
    PressedChat: ($, { id }) => $.emit(ConversationListEvents.OpenedChat({ id, isNew: false })),
    CreatedChat: ($, { id }) => $.evolve({ isCreating: false }).emit(ConversationListEvents.OpenedChat({ id, isNew: true })),
    FailedCreate: ($, { reason }) => $.evolve({ isCreating: false, notice: `Could not start a chat: ${reason}` }),
  },
  view: (h, model) => {
    const { platform, scheme } = h.props
    const palette = paletteOf(scheme)
    const isIos = platform !== 'android'
    const list = h.queries.list
    const summaries = AsyncResult.isSuccess(list) ? list.value : []
    const isLoading = AsyncResult.isInitial(list)
    const hasFailed = AsyncResult.isFailure(list)

    const rows = h.scrollView
      .testId('chat-list')
      .style({ flex: 1, backgroundColor: palette.bg })
      // iOS: the list runs under the bar, and the phone keeps the rows clear of the large title.
      .set(isIos ? { contentInsetAdjustmentBehavior: 'automatic' } : {})
      .children(
        summaries.map(summary =>
          h.pressable
            .key(summary.id)
            .testId(`chat-row-${summary.id}`)
            .set({ accessibilityRole: 'button', accessibilityLabel: summary.title })
            .style({
              marginHorizontal: SPACE.s,
              paddingHorizontal: SPACE.s,
              paddingVertical: SPACE.m,
              borderRadius: RADIUS.row,
              gap: 2,
            })
            .pressedStyle({ backgroundColor: palette.surface2 })
            .on('press', ConversationListMessage.PressedChat({ id: summary.id }))
            .children(
              h.text
                .testId(`chat-title-${summary.id}`)
                .style({ ...TYPE.rowTitle, color: palette.ink })
                .set({ numberOfLines: 1 })
                .children(summary.title),
              h.text
                .testId(`chat-preview-${summary.id}`)
                .style({ ...TYPE.rowPreview, color: palette.ink2 })
                .set({ numberOfLines: 1 })
                .children(previewOf(summary)),
            ),
        ),
      )

    const overlay = isLoading
      ? centred(h, 'list-loading', [h.text.style({ ...TYPE.rowPreview, color: palette.ink3 }).children('Loading your chats')])
      : hasFailed
        ? centred(h, 'list-failed', [
            h.text.style({ ...TYPE.rowPreview, color: palette.ink2 }).children('Could not load your chats.'),
          ])
        : summaries.length === 0
          ? centred(h, 'empty-list', [
              h.text.style({ ...TYPE.headline, color: palette.ink }).children('No chats yet'),
              h.text
                .style({ ...TYPE.rowPreview, color: palette.ink2, textAlign: 'center' })
                .children('Start one and it shows up here.'),
              h.view.style({ height: SPACE.s }),
              solidButton(h, 'start-chat', 'New chat', palette, ConversationListMessage.PressedNewChat()),
            ])
          : null

    const body = h.view.style({ flex: 1, backgroundColor: palette.bg }).children(
      model.notice === ''
        ? null
        : h.text
            .testId('list-notice')
            .style({ ...TYPE.caption, color: palette.danger, paddingHorizontal: SPACE.l, paddingVertical: SPACE.s })
            .children(model.notice),
      rows,
      overlay,
    )

    return h.screen
      .testId('screen-chats')
      .style({ backgroundColor: palette.bg })
      .children(
        navBar(h, platform, palette, {
          title: 'Chats',
          testId: 'bar-chats',
          isLargeTitle: true,
          right: {
            id: 'new-chat',
            label: 'New',
            symbol: 'square.and.pencil',
            message: ConversationListMessage.PressedNewChat(),
          },
        }),
        isIos ? body : h.safeArea.set({ edges: Native.safeAreaEdges(platform, { hasHeader: true }) }).children(body),
      )
  },
})
