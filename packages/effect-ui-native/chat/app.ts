/**
 * Effect Chat: the app. It owns the phone's screen stack and what every
 * part shares.
 *
 * The stack is the list of screens, the last one on top: the list of chats,
 * then at most one chat, then at most one sheet. Opening a chat adds a
 * screen and the phone slides it in. A swipe back is the phone's own: the
 * screen says so afterwards and the Model drops it, so the two agree again.
 * A sheet (Settings, a reply's reasoning, Select text, Rename) is a screen
 * of the same stack, so a part that wants one asks the app for it.
 *
 * Each screen is one part (`parts/`), a child component that draws a whole
 * native screen.
 *
 * What the parts share is kept here and handed down as props: light or
 * dark, the settings, the pretend server's switches, the clock, and whether
 * the phone is online. The settings are saved on the phone and read back at
 * the start.
 *
 * The app is also the one component that is always there. So it is the one
 * that hears when a reply ends, in any chat, and tells the cache that the
 * list and that chat are old. It is also the one that deletes and renames:
 * a chat deleted from its own screen closes that screen at once, and the
 * delete must still finish. If the server refuses, the app says so through
 * the events service, and whichever screen is on top shows the line.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native, Phone } from '../src/index.js'
import {
  Chaos,
  DeleteConversation,
  NO_CHAOS,
  ReadClock,
  RefreshChat,
  RenameConversation,
  SetServerDials,
  Speed,
  turnEnded,
} from './data.js'
import { Announce } from './events.js'
import { ChatScreen, SheetRequest } from './parts/chatScreen.js'
import { ConversationList } from './parts/conversationList.js'
import { ReasoningSheet } from './parts/reasoningSheet.js'
import { RenameSheet } from './parts/renameSheet.js'
import { ChaosName, SettingsSheet } from './parts/settingsSheet.js'
import { Scheme } from './theme.js'

const Screen = Schema.Union([
  Schema.TaggedStruct('Chats', { key: Schema.String }),
  Schema.TaggedStruct('Chat', { key: Schema.String, conversationId: Schema.String, isNew: Schema.Boolean }),
])

const Sheet = Schema.Union([
  Schema.TaggedStruct('Settings', {}),
  Schema.TaggedStruct('Text', { request: SheetRequest }),
  Schema.TaggedStruct('Rename', { id: Schema.String, title: Schema.String }),
])

/** What is kept on the phone between launches. */
export const Settings = Schema.Struct({ theme: Phone.Theme, speed: Speed })
export type Settings = typeof Settings.Type
export const SETTINGS_KEY = 'effect-chat.settings'
const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Settings))

export const AppMessage = UiSchema.TaggedEnum({
  OpenedChat: { id: Schema.String, isNew: Schema.Boolean },
  ToggledNumbers: {},
  DismissedByPhone: { count: Schema.Number },
  ChangedScheme: { scheme: Scheme },
  ChangedNetwork: { isOnline: Schema.Boolean },
  EndedTurn: { conversationId: Schema.String },
  GotTime: { at: Schema.Number },
  /** What the phone had saved, or null. */
  LoadedSettings: { value: Schema.NullOr(Schema.String) },
  OpenedSettings: {},
  OpenedSheet: { request: SheetRequest },
  ClosedSheet: {},
  /** `rename`, `delete` or `settings`, from the list or from a chat's own menu. */
  ChoseAction: { id: Schema.String, key: Schema.String, title: Schema.String },
  SavedRename: { title: Schema.String },
  FailedWrite: { action: Schema.String, reason: Schema.String },
  PressedTheme: { theme: Phone.Theme },
  PressedSpeed: { speed: Speed },
  PressedChaos: { name: ChaosName },
  Done: {},
})

export const AppProps = Schema.Struct({
  /** `ios` or `android`. */
  platform: Schema.String,
})

const AppModel = Schema.Struct({
  screens: Schema.Array(Screen),
  nextKey: Schema.Number,
  scheme: Scheme,
  /** The numbers strip in a chat is on. Kept here, so it stays on from one chat to the next. */
  showsNumbers: Schema.Boolean,
  theme: Phone.Theme,
  speed: Speed,
  /** The pretend server's failure switches. Not kept between launches. */
  chaos: Chaos,
  /** The clock when it was last read, for "Today" and "Yesterday". */
  nowMs: Schema.Number,
  isOnline: Schema.Boolean,
  /** The sheet over the stack, and a count that gives each one a key of its own. */
  sheet: Schema.NullOr(Sheet),
  sheetCount: Schema.Number,
})

const done = Command.as(AppMessage.Done())
const tick = () => Phone.Selection.make({}).pipe(done)
const readClock = () => ReadClock.make({}).pipe(Command.map(({ at }) => AppMessage.GotTime({ at })))
const dismissKeyboard = () => Phone.DismissKeyboard.make({}).pipe(Command.asNoop)
const save = (settings: Settings) =>
  Phone.StorageSet.make({ key: SETTINGS_KEY, value: JSON.stringify(settings) }).pipe(done)
const setAppearance = (theme: Phone.Theme) =>
  Phone.SetAppearance.make({ theme }).pipe(Command.map(({ scheme }) => AppMessage.ChangedScheme({ scheme })))

export const App = Native.component({
  name: 'App',
  props: AppProps,
  model: AppModel,
  message: AppMessage,
}).make({
  init: $ =>
    $.set({
      screens: [{ _tag: 'Chats' as const, key: 's0' }],
      nextKey: 1,
      scheme: 'light' as const,
      showsNumbers: false,
      theme: 'system' as const,
      speed: 'normal' as const,
      chaos: NO_CHAOS,
      nowMs: 0,
      isOnline: true,
      sheet: null,
      sheetCount: 0,
    })
      .run(Phone.StorageGet.make({ key: SETTINGS_KEY }).pipe(Command.map(({ value }) => AppMessage.LoadedSettings({ value }))))
      .run(readClock()),
  update: {
    OpenedChat: ($, { id, isNew }) =>
      // One chat at a time: a second press while the first is opening does nothing.
      $.model.screens.length > 1
        ? $.model
        : $.evolve({
            screens: [...$.model.screens, { _tag: 'Chat' as const, key: `s${$.model.nextKey}`, conversationId: id, isNew }],
            nextKey: $.model.nextKey + 1,
          }),
    // The phone closed screens by itself. The first screen always stays.
    DismissedByPhone: ($, { count }) =>
      $.evolve({ screens: $.model.screens.slice(0, Math.max(1, $.model.screens.length - Math.max(1, count))) }).run(
        dismissKeyboard(),
      ),
    ChangedScheme: ($, { scheme }) => $.evolve({ scheme }),
    ChangedNetwork: ($, { isOnline }) => $.evolve({ isOnline }),
    ToggledNumbers: $ => $.evolve({ showsNumbers: on => !on }).run(tick()),
    EndedTurn: ($, { conversationId }) => $.run(RefreshChat.make({ conversationId }).pipe(done)).run(readClock()),
    GotTime: ($, { at }) => $.evolve({ nowMs: at }),
    LoadedSettings: ($, { value }) => {
      const saved = value === null ? undefined : decodeSettings(value)
      if (saved === undefined || saved._tag === 'None') return $.model
      const { theme, speed } = saved.value
      const next = $.evolve({ theme, speed }).run(SetServerDials.make({ speed, chaos: $.model.chaos }).pipe(done))
      return theme === 'system' ? next : next.run(setAppearance(theme))
    },

    // SHEETS
    OpenedSettings: $ => $.evolve({ sheet: { _tag: 'Settings' as const }, sheetCount: count => count + 1 }),
    OpenedSheet: ($, { request }) => $.evolve({ sheet: { _tag: 'Text' as const, request }, sheetCount: count => count + 1 }),
    ClosedSheet: $ => ($.model.sheet === null ? $.model : $.evolve({ sheet: null }).run(dismissKeyboard())),

    // RENAME AND DELETE
    ChoseAction: ($, { id, key, title }) => {
      if (key === 'settings') return $.evolve({ sheet: { _tag: 'Settings' as const }, sheetCount: count => count + 1 })
      if (key === 'rename') {
        return $.evolve({ sheet: { _tag: 'Rename' as const, id, title }, sheetCount: count => count + 1 })
      }
      if (key !== 'delete') return $.model
      // Gone from the list at once: the Command says so to the cache. The chat's own screen closes.
      const isOpen = $.model.screens.some(screen => screen._tag === 'Chat' && screen.conversationId === id)
      return $.evolve({ screens: isOpen ? $.model.screens.slice(0, 1) : $.model.screens })
        .run(
          DeleteConversation.make({ id }).pipe(
            Command.match({
              onSuccess: () => AppMessage.Done(),
              onFailure: error => AppMessage.FailedWrite({ action: 'delete the chat', reason: error.reason }),
            }),
          ),
        )
        .run(Phone.Notify.make({ type: 'warning' }).pipe(done))
    },
    SavedRename: ($, { title }) => {
      const sheet = $.model.sheet
      if (sheet === null || sheet._tag !== 'Rename') return $.model
      return $.evolve({ sheet: null })
        .run(
          RenameConversation.make({ id: sheet.id, title }).pipe(
            Command.match({
              onSuccess: () => AppMessage.Done(),
              onFailure: error => AppMessage.FailedWrite({ action: 'rename the chat', reason: error.reason }),
            }),
          ),
        )
        .run(dismissKeyboard())
    },
    // Said through the events service: the screen that asked may be gone.
    FailedWrite: ($, { action, reason }) =>
      $.run(Announce.make({ text: `Could not ${action}. ${reason}`, tone: 'error' }).pipe(done)).run(
        Phone.Notify.make({ type: 'error' }).pipe(done),
      ),

    // SETTINGS
    PressedTheme: ($, { theme }) =>
      $.evolve({ theme }).run(setAppearance(theme)).run(save({ theme, speed: $.model.speed })).run(tick()),
    PressedSpeed: ($, { speed }) =>
      $.evolve({ speed })
        .run(SetServerDials.make({ speed, chaos: $.model.chaos }).pipe(done))
        .run(save({ theme: $.model.theme, speed }))
        .run(tick()),
    PressedChaos: ($, { name }) => {
      const chaos = { ...$.model.chaos, [name]: !$.model.chaos[name] }
      return $.evolve({ chaos }).run(SetServerDials.make({ speed: $.model.speed, chaos }).pipe(done))
    },
    Done: $ => $.model,
  },
  subscriptions: () => [
    Phone.colorScheme(scheme => AppMessage.ChangedScheme({ scheme })),
    Phone.network(isOnline => AppMessage.ChangedNetwork({ isOnline })),
    turnEnded(conversationId => AppMessage.EndedTurn({ conversationId })),
  ],
  view: (h, model) => {
    const { platform } = h.props
    const { scheme, showsNumbers, sheet } = model
    const sheetKey = `sheet-${model.sheetCount}`
    return h.stack.testId('stack').children(
      model.screens.map(screen =>
        screen._tag === 'Chats'
          ? ConversationList(h, {
              key: screen.key,
              props: { platform, scheme, nowMs: model.nowMs },
              onEmit: {
                OpenedChat: ({ id, isNew }) => AppMessage.OpenedChat({ id, isNew }),
                OpenedSettings: () => AppMessage.OpenedSettings(),
                ChoseRowAction: ({ id, key, title }) => AppMessage.ChoseAction({ id, key, title }),
              },
            })
          : ChatScreen(h, {
              key: screen.key,
              props: {
                conversationId: screen.conversationId,
                platform,
                scheme,
                isNew: screen.isNew,
                showsNumbers,
                isOnline: model.isOnline,
              },
              onEmit: {
                Dismissed: ({ count }) => AppMessage.DismissedByPhone({ count }),
                ToggledNumbers: () => AppMessage.ToggledNumbers(),
                ChoseMenuItem: ({ key, title }) => AppMessage.ChoseAction({ id: screen.conversationId, key, title }),
                OpenedSheet: ({ sheet: request }) => AppMessage.OpenedSheet({ request }),
              },
            }),
      ),
      sheet === null
        ? null
        : sheet._tag === 'Settings'
          ? SettingsSheet(h, {
              key: sheetKey,
              props: { platform, scheme, theme: model.theme, speed: model.speed, chaos: model.chaos, showsNumbers },
              onEmit: {
                PressedTheme: ({ theme }) => AppMessage.PressedTheme({ theme }),
                PressedSpeed: ({ speed }) => AppMessage.PressedSpeed({ speed }),
                PressedChaos: ({ name }) => AppMessage.PressedChaos({ name }),
                PressedNumbers: () => AppMessage.ToggledNumbers(),
                Closed: () => AppMessage.ClosedSheet(),
              },
            })
          : sheet._tag === 'Text'
            ? ReasoningSheet(h, {
                key: sheetKey,
                props: { platform, scheme, ...sheet.request },
                onEmit: { Closed: () => AppMessage.ClosedSheet() },
              })
            : RenameSheet(h, {
                key: sheetKey,
                props: { platform, scheme, title: sheet.title },
                onEmit: {
                  Saved: ({ title }) => AppMessage.SavedRename({ title }),
                  Closed: () => AppMessage.ClosedSheet(),
                },
              }),
    )
  },
})
