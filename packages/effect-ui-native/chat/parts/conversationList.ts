/**
 * The list of chats: the first screen. Every chat, newest first, under a
 * heading for its day, with search.
 *
 * The rows come from the `ListConversations` query. The screen draws what
 * the cache holds: nothing yet, the chats, or that loading failed. It never
 * asks for the list itself. The cache loads it when the screen appears and
 * again whenever a write says the list is old. A chat that is deleted is
 * gone from the cache's copy at once, so nothing here hides it.
 *
 * It owns what was typed in search and the notice line at the top.
 *
 * Holding a chat opens the phone's list of choices: Rename and Delete. What
 * those do belongs to the app (`ChoseRowAction`), because a chat can also be
 * renamed and deleted from its own screen.
 *
 * Swiping a chat to the left shows the same two as tiles, and swiping all
 * the way deletes. The row is the phone's own (`NativeViews.swipeRow`): the
 * finger is read and the row is moved by native code, and this part only
 * hears what was chosen and which row is open. One row is open at a time.
 * The native view closes the others when one is dragged. Scrolling the
 * list, or a tap anywhere else, closes the open row from here. In a build
 * without the native view the rows do not swipe, and holding still works.
 *
 * iOS: a large title with the phone's own search field under it. Android: a
 * plain search field at the top.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'

import type { ConversationSummary } from '../../../native/src/host/aiChat/wire.js'
import { Menus, Motion, Native, NativeViews, Phone } from '../../src/index.js'
import { CreateConversation, ListConversations } from '../data.js'
import { After, NOTICE_MS, Toast, toasts } from '../events.js'
import { listItems } from '../list.js'
import { MOTION, RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { centred, navBar, solidButton } from '../ui.js'

export const ConversationListProps = Schema.Struct({
  platform: Schema.String,
  scheme: Scheme,
  /** The clock, for "Today" and "Yesterday". */
  nowMs: Schema.Number,
})

export const ConversationListMessage = UiSchema.TaggedEnum({
  PressedNewChat: {},
  PressedSettings: {},
  PressedChat: { id: Schema.String },
  CreatedChat: { id: Schema.String },
  FailedCreate: { reason: Schema.String },
  ChangedQuery: { text: Schema.String },
  /** A finger rested on a chat for half a second. */
  HeldChat: { id: Schema.String, title: Schema.String },
  /** A tile behind a swiped chat was pressed, or the chat was swiped all the way. */
  ChoseSwipeAction: { id: Schema.String, title: Schema.String, key: Schema.String, isFullSwipe: Schema.Boolean },
  /** A chat came to rest swiped open, or closed again. */
  OpenedRow: { id: Schema.String },
  ClosedRow: { id: Schema.String },
  /** The list was dragged, or tapped where no chat is. */
  TouchedList: {},
  AnsweredMenu: { answer: Menus.Answer },
  HeardToast: { toast: Toast },
  WaitedForNotice: { text: Schema.String },
  Ignored: {},
})

export const ConversationListEvents = UiSchema.TaggedEnum({
  /** `isNew`: the chat was made just now, by this press. */
  OpenedChat: { id: Schema.String, isNew: Schema.Boolean },
  OpenedSettings: {},
  /** `rename` or `delete`, chosen from a chat's menu. */
  ChoseRowAction: { id: Schema.String, key: Schema.String, title: Schema.String },
})

const ConversationListModel = Schema.Struct({
  /** A new chat is being made. A second press does nothing until it is. */
  isCreating: Schema.Boolean,
  notice: Schema.NullOr(Toast),
  query: Schema.String,
  /** The chat whose menu is open. */
  menuFor: Schema.NullOr(Schema.Struct({ id: Schema.String, title: Schema.String })),
  /** The chat that is swiped open, as the native row last said. */
  openRow: Schema.NullOr(Schema.String),
})

export const ROW_MENU = [
  { key: 'rename', title: 'Rename', isDestructive: false },
  { key: 'delete', title: 'Delete', isDestructive: true },
] as const

/** Every chat's row is in this group, so the native view keeps one open at a time. */
export const SWIPE_GROUP = 'chats'

/**
 * Behind a chat, from the screen's edge inwards. Delete is first, so it is
 * the one a full swipe triggers. Rename is a quiet grey: the accent colour
 * is kept for Send and links.
 */
export const swipeActions = (scheme: 'light' | 'dark', danger: string): ReadonlyArray<NativeViews.SwipeAction> => [
  { key: 'delete', label: 'Delete', symbol: 'trash', isDestructive: true, color: danger },
  { key: 'rename', label: 'Rename', symbol: 'pencil', color: scheme === 'dark' ? '#48484A' : '#5C5C63' },
]

const previewOf = (summary: ConversationSummary): string =>
  summary.preview.trim() === '' ? 'No messages yet' : summary.preview.replace(/\s+/g, ' ')

const ignored = Command.as(ConversationListMessage.Ignored())
const closeRows = () => NativeViews.closeSwipeRows(SWIPE_GROUP).pipe(ignored)

export const ConversationList = Native.component({
  name: 'ConversationList',
  props: ConversationListProps,
  model: ConversationListModel,
  message: ConversationListMessage,
  events: ConversationListEvents,
  queries: { list: { query: ListConversations, args: () => ({}) } },
}).make({
  init: () => ({ isCreating: false, notice: null, query: '', menuFor: null, openRow: null }),
  update: {
    PressedNewChat: $ =>
      $.model.isCreating
        ? $.model
        : $.evolve({ isCreating: true, notice: null }).run(
            CreateConversation.make().pipe(
              Command.match({
                onSuccess: summary => ConversationListMessage.CreatedChat({ id: summary.id }),
                onFailure: error => ConversationListMessage.FailedCreate({ reason: error.reason }),
              }),
            ),
          ),
    PressedSettings: $ =>
      $.model.openRow === null
        ? $.emit(ConversationListEvents.OpenedSettings())
        : $.run(closeRows()).emit(ConversationListEvents.OpenedSettings()),
    // With a chat swiped open, a tap anywhere else only closes it, as in Mail.
    PressedChat: ($, { id }) =>
      $.model.openRow === null ? $.emit(ConversationListEvents.OpenedChat({ id, isNew: false })) : $.run(closeRows()),
    TouchedList: $ => ($.model.openRow === null ? $.model : $.run(closeRows())),
    OpenedRow: ($, { id }) => $.evolve({ openRow: id }),
    ClosedRow: ($, { id }) => ($.model.openRow === id ? $.evolve({ openRow: null }) : $.model),
    // The same as choosing it from the chat's menu. The native row closes itself, or slides away for Delete.
    ChoseSwipeAction: ($, { id, title, key }) =>
      $.evolve({ openRow: $.model.openRow === id ? null : $.model.openRow }).emit(
        ConversationListEvents.ChoseRowAction({ id, key, title }),
      ),
    CreatedChat: ($, { id }) => $.evolve({ isCreating: false }).emit(ConversationListEvents.OpenedChat({ id, isNew: true })),
    FailedCreate: ($, { reason }) =>
      $.evolve({ isCreating: false, notice: { text: `Could not start a chat: ${reason}`, tone: 'error' as const } }),
    ChangedQuery: ($, { text }) => $.evolve({ query: text }),
    HeldChat: ($, { id, title }) =>
      $.evolve({ menuFor: { id, title } }).run(
        Phone.Impact.make({ style: 'medium' }).pipe(ignored),
        Menus.Show.make({ title, items: ROW_MENU }).pipe(Command.map(answer => ConversationListMessage.AnsweredMenu({ answer }))),
        // A chat that is swiped open closes under the menu.
        ...($.model.openRow === null ? [] : [closeRows()]),
      ),
    AnsweredMenu: ($, { answer }) => {
      const chat = $.model.menuFor
      const next = $.evolve({ menuFor: null })
      return chat === null || answer._tag !== 'Selected'
        ? next
        : next.emit(ConversationListEvents.ChoseRowAction({ id: chat.id, key: answer.key, title: chat.title }))
    },
    HeardToast: ($, { toast }) =>
      $.evolve({ notice: toast }).run(
        After.make({ ms: NOTICE_MS, token: toast.text }).pipe(
          Command.map(({ token }) => ConversationListMessage.WaitedForNotice({ text: token })),
        ),
      ),
    WaitedForNotice: ($, { text }) => ($.model.notice?.text === text ? $.evolve({ notice: null }) : $.model),
    Ignored: $ => $.model,
  },
  subscriptions: () => [toasts(toast => ConversationListMessage.HeardToast({ toast }))],
  view: (h, model) => {
    const { platform, scheme, nowMs } = h.props
    const palette = paletteOf(scheme)
    const isIos = platform !== 'android'
    const list = h.queries.list
    const summaries = AsyncResult.isSuccess(list) ? list.value : []
    const isLoading = AsyncResult.isInitial(list)
    const hasFailed = AsyncResult.isFailure(list)
    const items = listItems(summaries, nowMs, model.query)

    const rows = h.scrollView
      .testId('chat-list')
      .style({ flex: 1, backgroundColor: palette.bg })
      // iOS: the list runs under the bar, and the phone keeps the rows clear of the large title and the search field.
      .set({
        keyboardDismissMode: 'on-drag',
        indicatorStyle: scheme === 'dark' ? 'white' : 'black',
        ...(isIos ? { contentInsetAdjustmentBehavior: 'automatic' as const } : {}),
      })
      // A drag, or a tap where no chat is, closes a chat that is swiped open.
      .on('scrollBeginDrag', ConversationListMessage.TouchedList())
      .on('press', ConversationListMessage.TouchedList())
      .children(
        items.map((item, index) =>
          item._tag === 'Header'
            ? h.view
                .key(item.key)
                .style({ paddingHorizontal: SPACE.xl, paddingTop: index === 0 ? SPACE.s : SPACE.xxl, paddingBottom: 6 })
                .children(
                  h.text
                    .testId(`chat-group-${item.title}`)
                    .set({ accessibilityRole: 'header' })
                    .style({ ...TYPE.section, color: palette.ink3 })
                    .children(item.title),
                )
            : NativeViews.swipeRow(h, {
                testId: `chat-swipe-${item.summary.id}`,
                trailing: swipeActions(scheme, palette.danger),
                group: SWIPE_GROUP,
                cornerRadius: RADIUS.row,
                style: { marginHorizontal: SPACE.s },
                onAction: ({ key, isFullSwipe }) =>
                  ConversationListMessage.ChoseSwipeAction({ id: item.summary.id, title: item.summary.title, key, isFullSwipe }),
                onOpened: () => ConversationListMessage.OpenedRow({ id: item.summary.id }),
                onClosed: () => ConversationListMessage.ClosedRow({ id: item.summary.id }),
              })
                .key(item.key)
                .children(
                  h.pressable
                    .testId(`chat-row-${item.summary.id}`)
                    .set({ accessibilityRole: 'button', accessibilityLabel: item.summary.title })
                    .style({
                      paddingHorizontal: SPACE.m,
                      paddingVertical: SPACE.m,
                      borderRadius: RADIUS.row,
                      gap: 2,
                      // Solid, so the tiles behind the row do not show through it.
                      backgroundColor: palette.bg,
                    })
                    .pressedStyle({ backgroundColor: palette.surface2 })
                    .on('press', ConversationListMessage.PressedChat({ id: item.summary.id }))
                    .on('longPress', ConversationListMessage.HeldChat({ id: item.summary.id, title: item.summary.title }))
                    .children(
                      h.text
                        .testId(`chat-title-${item.summary.id}`)
                        .style({ ...TYPE.rowTitle, color: palette.ink })
                        .set({ numberOfLines: 1 })
                        .children(item.summary.title),
                      h.text
                        .testId(`chat-preview-${item.summary.id}`)
                        .style({ ...TYPE.rowPreview, color: palette.ink2 })
                        .set({ numberOfLines: 1 })
                        .children(previewOf(item.summary)),
                    ),
                ),
        ),
      )

    const overlay = isLoading
      ? centred(h, 'list-loading', [NativeViews.spinner(h, platform, palette.ink3)])
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
          : items.length === 0
            ? centred(h, 'no-matches', [
                h.text
                  .style({ ...TYPE.rowPreview, color: palette.ink2, textAlign: 'center' })
                  .children(`No chats match "${model.query.trim()}".`),
              ])
            : null

    const notice = model.notice
    const body = h.view.style({ flex: 1, backgroundColor: palette.bg }).children(
      isIos
        ? null
        : h.view
            .key('search-row')
            .style({ paddingHorizontal: SPACE.l, paddingVertical: SPACE.s })
            .children(
              h.textInput
                .testId('search')
                .style({
                  height: 40,
                  borderRadius: RADIUS.chip,
                  paddingHorizontal: SPACE.m,
                  backgroundColor: palette.surface,
                  color: palette.ink,
                  fontSize: 16,
                })
                .set({ placeholderTextColor: palette.ink3, returnKeyType: 'search', selectionColor: palette.accent })
                .placeholder('Search')
                .value(model.query)
                .on('changeText', ({ text }) => ConversationListMessage.ChangedQuery({ text })),
            ),
      rows,
      overlay,
      // Over the list, at the bottom, so the rows do not jump when it comes and goes.
      // It fades in, and out again before it is taken away.
      notice === null
        ? null
        : Motion.animate(
            h.view
              .key('notice')
              .set({ pointerEvents: 'none' })
              .style({ position: 'absolute', left: SPACE.l, right: SPACE.l, bottom: SPACE.xxxl, alignItems: 'center' }),
            { from: { opacity: 0 }, to: { opacity: 1 }, exit: { opacity: 0 }, ms: MOTION.notice },
          ).children(
            h.text
              .testId('list-notice')
              .style({
                ...TYPE.caption,
                color: notice.tone === 'error' ? palette.danger : palette.ink,
                backgroundColor: palette.surface,
                paddingHorizontal: SPACE.m,
                paddingVertical: SPACE.s,
                borderRadius: RADIUS.chip,
                overflow: 'hidden',
              })
              .children(notice.text),
          ),
    )

    return h.screen
      .testId('screen-chats')
      .style({ backgroundColor: palette.bg })
      .children(
        navBar(h, platform, palette, {
          title: 'Chats',
          testId: 'bar-chats',
          isLargeTitle: true,
          left: { id: 'settings', label: 'Settings', symbol: 'gearshape', message: ConversationListMessage.PressedSettings() },
          right: {
            id: 'new-chat',
            label: 'New',
            symbol: 'square.and.pencil',
            message: ConversationListMessage.PressedNewChat(),
          },
          ignored: ConversationListMessage.Ignored(),
          onSearch: text => ConversationListMessage.ChangedQuery({ text }),
        }),
        isIos ? body : h.safeArea.set({ edges: Native.safeAreaEdges(platform, { hasHeader: true }) }).children(body),
      )
  },
})
