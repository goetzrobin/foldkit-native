/**
 * The home screen: every chat, newest first, grouped by day.
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
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import { prop, pressedStyle, style } from '../src/attributes.js'
import { text, textInput, view } from '../src/elements.js'
import { list } from '../src/list/index.js'
import { contextMenu } from '../src/menus/index.js'
import { searchBar } from '../src/navigation/searchBar.js'
import { type Device, safeArea, screen } from '../src/navigation/stack.js'
import { swipeAction, swipeActions, swipeRow, tiles } from '../src/swipe/index.js'
import {
  isNativeSwipeAvailable,
  nativeSwipeOptions,
  nativeSwipeRow,
  swipeAction as nativeAction,
} from '../src/swipeNative/index.js'
import { type ListItem, Message, type Model, listItems } from './model.js'
import { type Palette, RADIUS, SPACE, TYPE, paletteOf } from './theme.js'
import { navBar, solidButton, spinner } from './ui.js'

export const CHAT_LIST_ID = 'chats'

export const ROW_MENU = [
  { key: 'rename', title: 'Rename', symbol: 'pencil' },
  { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
] as const

const headerRow = (palette: Palette, title: string, isFirst: boolean): Html =>
  view(
    [style({ paddingHorizontal: SPACE.xl, paddingTop: isFirst ? SPACE.s : SPACE.xxl, paddingBottom: 6, backgroundColor: palette.bg })],
    [text([prop('accessibilityRole', 'header'), style({ ...TYPE.section, color: palette.ink3 })], [title])],
  )

const chatRow = (h: HtmlBuilder<Message>, model: Model, palette: Palette, item: Extract<ListItem, { _tag: 'Chat' }>): Html => {
  const { summary } = item
  const content = view(
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
  view(
    [prop('testID', id), prop('pointerEvents', 'box-none'), style({ position: 'absolute', left: 0, right: 0, top: '30%', alignItems: 'center', gap: SPACE.m, paddingHorizontal: SPACE.xxxl })],
    children,
  )

const emptyList = (h: HtmlBuilder<Message>, palette: Palette): Html =>
  centred(
    [
      text([style({ ...TYPE.headline, color: palette.ink })], ['No chats yet']),
      text([style({ ...TYPE.rowPreview, color: palette.ink2, textAlign: 'center' })], ['Start one and it shows up here.']),
      view([style({ height: SPACE.s })], []),
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
  view(
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

export const listScreen = (h: HtmlBuilder<Message>, device: Device, model: Model): Html => {
  const palette = paletteOf(model.scheme)
  const isIos = device.platform !== 'android'
  const summaries = Option.getOrElse(AsyncResult.value(model.list), () => [])
  const items = listItems(summaries, model.nowMs, model.query)
  const isLoading = AsyncResult.isInitial(model.list)
  const failed = AsyncResult.isFailure(model.list) && summaries.length === 0

  const chats = list(h, {
    id: CHAT_LIST_ID,
    items,
    key: item => item.key,
    row: (item, index) =>
      item._tag === 'Header' ? headerRow(palette, item.title, index === 0) : chatRow(h, model, palette, item),
    estimatedRowHeight: 66,
    attributes: [
      prop('testID', 'chat-list'),
      style({ flex: 1, backgroundColor: palette.bg }),
      prop('keyboardDismissMode', 'on-drag'),
      prop('indicatorStyle', model.scheme === 'dark' ? 'white' : 'black'),
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

  const body = view([style({ flex: 1, backgroundColor: palette.bg })], [chats, ...overlays])

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
