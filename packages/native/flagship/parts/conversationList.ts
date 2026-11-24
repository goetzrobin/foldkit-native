/**
 * The list of chats: every chat, newest first, grouped by day, with search.
 * It owns only what was typed in search. The chats themselves are server
 * data and come in from above (`list`). Opening, starting, renaming and
 * deleting a chat are the app's: they go up as OutMessages.
 *
 * iOS: a large title with the phone's own search field under it. The list
 * runs under the bar and the phone insets it (`contentInsetAdjustmentBehavior`),
 * which is what lets the large title shrink as the list scrolls.
 * Android: a plain search field at the top, under the bar.
 *
 * A row swipes left for Delete and Rename (the JavaScript swipe row of
 * src/swipe: the native swipe view is not built into this app, see
 * apps/chat/README.md), and holds for a menu with the same two.
 */
import { Option, Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { prop, pressedStyle, style } from '../../src/foldkit/attributes.js'
import { text, textInput, view as box } from '../../src/foldkit/elements.js'
import { list } from '../../src/list/index.js'
import { contextMenu } from '../../src/menus/index.js'
import { searchBar } from '../../src/foldkit/navigation/searchBar.js'
import { safeArea, screen } from '../../src/foldkit/navigation/stack.js'
import { swipeAction, swipeActions, swipeRow, tiles } from '../../src/swipe/index.js'
import {
  isNativeSwipeAvailable,
  nativeSwipeOptions,
  nativeSwipeRow,
  swipeAction as nativeAction,
} from '../../src/swipeNative/index.js'
import type { ConversationListResult } from '../../src/aiChat/index.js'
import type { Context, Resources } from '../context.js'
import { type ListItem, listItems } from '../model.js'
import { type Palette, RADIUS, SPACE, TYPE, paletteOf } from '../theme.js'
import { navBar, solidButton, spinner } from '../ui.js'

export const CHAT_LIST_ID = 'chats'

// MODEL

export const Model = Schema.Struct({ query: Schema.String })
export type Model = typeof Model.Type

export const init = (): Model => ({ query: '' })

// MESSAGE

export const Message = defineMessageUnion({
  ChangedQuery: { text: Schema.String },
  PressedConversation: { id: Schema.String },
  PressedNewChat: {},
  PressedSettings: {},
  /** Rename or Delete, from a row's swipe or its menu. */
  SelectedRowAction: { id: Schema.String, key: Schema.String },
  ArmedFullSwipe: { isArmed: Schema.Boolean },
})
export type Message = typeof Message.Type

/** What the app hears from the list. */
export const OutMessage = defineMessageUnion({
  OpenedConversation: { id: Schema.String },
  StartedNewChat: {},
  OpenedSettings: {},
  ChoseRowAction: { id: Schema.String, key: Schema.String },
  ArmedFullSwipe: { isArmed: Schema.Boolean },
})
export type OutMessage = typeof OutMessage.Type

// UPDATE

export const update = (model: Model, message: Message): Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>>(message, {
    ChangedQuery: ({ text }) => ({ model: modifyFields(model, { query: () => text }) }),
    PressedConversation: ({ id }) => ({ model, outMessage: OutMessage.OpenedConversation({ id }) }),
    PressedNewChat: () => ({ model, outMessage: OutMessage.StartedNewChat() }),
    PressedSettings: () => ({ model, outMessage: OutMessage.OpenedSettings() }),
    SelectedRowAction: ({ id, key }) => ({ model, outMessage: OutMessage.ChoseRowAction({ id, key }) }),
    ArmedFullSwipe: ({ isArmed }) => ({ model, outMessage: OutMessage.ArmedFullSwipe({ isArmed }) }),
  })

// VIEW

export type ViewInputs = Context & Readonly<{ list: ConversationListResult }>

export const ROW_MENU = [
  { key: 'rename', title: 'Rename', symbol: 'pencil' },
  { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
] as const

const headerRow = (palette: Palette, title: string, isFirst: boolean): Html =>
  box(
    [style({ paddingHorizontal: SPACE.xl, paddingTop: isFirst ? SPACE.s : SPACE.xxl, paddingBottom: 6, backgroundColor: palette.bg })],
    [text([prop('accessibilityRole', 'header'), style({ ...TYPE.section, color: palette.ink3 })], [title])],
  )

const chatRow = (h: HtmlBuilder<Message>, palette: Palette, item: Extract<ListItem, { _tag: 'Chat' }>): Html => {
  const { summary } = item
  const content = box(
    [
      prop('testID', `chat-${summary.id}`),
      prop('accessibilityRole', 'button'),
      h.OnClick(Message.PressedConversation({ id: summary.id })),
      pressedStyle({ backgroundColor: palette.surface }),
      style({
        marginHorizontal: SPACE.s,
        paddingVertical: SPACE.m,
        paddingHorizontal: SPACE.m,
        borderRadius: RADIUS.row,
        gap: 2,
        backgroundColor: palette.bg,
      }),
    ],
    [
      text([prop('numberOfLines', 1), style({ ...TYPE.rowTitle, color: palette.ink })], [summary.title]),
      text(
        [prop('numberOfLines', 1), style({ ...TYPE.rowPreview, color: palette.ink2 })],
        [summary.preview === '' ? 'No messages yet' : summary.preview],
      ),
    ],
  )
  const held = contextMenu(
    {
      items: ROW_MENU,
      onSelected: key => Message.SelectedRowAction({ id: summary.id, key }),
      testID: `chat-menu-${summary.id}`,
      title: summary.title,
    },
    content,
  )
  if (isNativeSwipeAvailable()) {
    // The project's own native swipe view, when the build has it (see the
    // README): the drag is UIKit's or Android's from the first touch.
    return nativeSwipeRow(
      [
        h.Key(`swipe-${summary.id}`),
        nativeSwipeOptions<Message>({
          trailing: [
            nativeAction({ key: 'delete', label: 'Delete', symbol: 'trash', role: 'destructive', onTriggered: Message.SelectedRowAction({ id: summary.id, key: 'delete' }) }),
            nativeAction({ key: 'rename', label: 'Rename', symbol: 'pencil', tint: '#8E8E93', onTriggered: Message.SelectedRowAction({ id: summary.id, key: 'rename' }) }),
          ],
          allowsFullSwipe: true,
          mode: 'tiles',
          group: 'chats',
          cornerRadius: RADIUS.row,
        }),
      ],
      [held],
    )
  }
  return swipeRow(
    h,
    {
      id: summary.id,
      group: 'chats',
      style: tiles,
      trailing: swipeActions(
        [
          swipeAction({
            key: 'delete',
            label: 'Delete',
            role: 'destructive',
            onTriggered: Message.SelectedRowAction({ id: summary.id, key: 'delete' }),
          }),
          swipeAction({
            key: 'rename',
            label: 'Rename',
            tint: palette.ink2,
            onTriggered: Message.SelectedRowAction({ id: summary.id, key: 'rename' }),
          }),
        ],
        { allowsFullSwipe: true },
      ),
      onFullSwipeArmed: isArmed => Message.ArmedFullSwipe({ isArmed }),
      accessibilityLabel: summary.title,
      attributes: [h.Key(`swipe-${summary.id}`)],
    },
    [held],
  )
}

const centred = (children: ReadonlyArray<Html>, id: string): Html =>
  box(
    [prop('testID', id), prop('pointerEvents', 'box-none'), style({ position: 'absolute', left: 0, right: 0, top: '30%', alignItems: 'center', gap: SPACE.m, paddingHorizontal: SPACE.xxxl })],
    children,
  )

const emptyList = (h: HtmlBuilder<Message>, palette: Palette): Html =>
  centred(
    [
      text([style({ ...TYPE.headline, color: palette.ink })], ['No chats yet']),
      text([style({ ...TYPE.rowPreview, color: palette.ink2, textAlign: 'center' })], ['Start one and it shows up here.']),
      box([style({ height: SPACE.s })], []),
      solidButton(h, 'start-chat', 'New chat', palette, Message.PressedNewChat()),
    ],
    'empty-list',
  )

const noMatches = (palette: Palette, query: string): Html =>
  centred(
    [text([style({ ...TYPE.rowPreview, color: palette.ink2, textAlign: 'center' })], [`No chats match "${query.trim()}".`])],
    'no-matches',
  )

/** Android's search: a field at the top of the screen. */
const searchField = (h: HtmlBuilder<Message>, model: Model, palette: Palette): Html =>
  box(
    [style({ paddingHorizontal: SPACE.l, paddingTop: SPACE.s, paddingBottom: SPACE.s, backgroundColor: palette.bg })],
    [
      textInput(
        [
          h.Key('search'),
          prop('testID', 'search'),
          h.Attribute('value', model.query),
          h.Placeholder('Search'),
          prop('placeholderTextColor', palette.ink3),
          prop('cursorColor', palette.accent),
          prop('returnKeyType', 'search'),
          h.OnInput(value => Message.ChangedQuery({ text: value })),
          style({ height: 40, borderRadius: RADIUS.chip, paddingHorizontal: SPACE.m, backgroundColor: palette.surface, color: palette.ink, fontSize: 16 }),
        ],
        [],
      ),
    ],
  )

const view_ = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { device, shared } = inputs
  const palette = paletteOf(shared.scheme)
  const isIos = device.platform !== 'android'
  const summaries = Option.getOrElse(AsyncResult.value(inputs.list), () => [])
  const items = listItems(summaries, shared.nowMs, model.query)
  const isLoading = AsyncResult.isInitial(inputs.list)
  const failed = AsyncResult.isFailure(inputs.list) && summaries.length === 0

  const chats = list(h, {
    id: CHAT_LIST_ID,
    items,
    key: item => item.key,
    row: (item, index) =>
      item._tag === 'Header' ? headerRow(palette, item.title, index === 0) : chatRow(h, palette, item),
    estimatedRowHeight: 66,
    attributes: [
      prop('testID', 'chat-list'),
      style({ flex: 1, backgroundColor: palette.bg }),
      prop('keyboardDismissMode', 'on-drag'),
      prop('indicatorStyle', shared.scheme === 'dark' ? 'white' : 'black'),
      // iOS: the list runs under the bar and the phone keeps the rows clear
      // of the large title, the search field and the home indicator.
      ...(isIos ? [prop('contentInsetAdjustmentBehavior', 'automatic')] : []),
    ],
  })

  const overlays = [
    ...(isLoading ? [centred([spinner(device, palette.ink3)], 'list-loading')] : []),
    ...(failed ? [centred([text([style({ ...TYPE.rowPreview, color: palette.ink2 })], ['Could not load your chats.'])], 'list-failed')] : []),
    ...(!isLoading && !failed && summaries.length === 0 ? [emptyList(h, palette)] : []),
    ...(summaries.length > 0 && items.length === 0 ? [noMatches(palette, model.query)] : []),
  ]

  const body = box([style({ flex: 1, backgroundColor: palette.bg })], [chats, ...overlays])

  return screen(
    [h.Key('chats'), prop('testID', 'screen-chats'), style({ backgroundColor: palette.bg })],
    [
      navBar(h, device, palette, {
        title: 'Chats',
        testID: 'bar-chats',
        isLargeTitle: isIos,
        left: { id: 'settings', symbol: 'gearshape', label: 'Settings', onPress: Message.PressedSettings() },
        right: { id: 'new-chat', symbol: 'square.and.pencil', label: 'New', onPress: Message.PressedNewChat() },
        ...(isIos
          ? { children: [searchBar(h, { placeholder: 'Search', onChange: value => Message.ChangedQuery({ text: value }), testID: 'search' })] }
          : {}),
      }),
      isIos ? body : safeArea(device, { hasHeader: true }, [searchField(h, model, palette), body]),
    ],
  )
}

export const view = Submodel.defineView<Model, Message, ViewInputs>(view_)
