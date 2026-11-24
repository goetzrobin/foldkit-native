/**
 * The phone features demo: one scrolling screen with a section for each
 * feature in `src/device`. Every button says what to expect, and every
 * result is written under it.
 *
 * The program never touches the phone itself. It asks for the services, and
 * whoever starts it passes the Layer: the app passes the real modules, a
 * test passes fakes.
 */
import { Effect, type Layer, Option, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  Alert,
  AppState,
  Clipboard,
  ColorScheme,
  Haptics,
  Keyboard,
  Linking,
  Network,
  type Services,
  Share,
  Storage,
  Window,
} from '../../src/device/index.js'
import {
  type Device,
  header,
  prop,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  text,
  textInput,
  title,
  view as box,
} from '../../src/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

const GOOD_URL = 'https://foldkit.dev'
/** A link no app handles, to show what a failure looks like. */
const BAD_URL = 'foldkit-nobody://nowhere'

/** The text of the "remember this" field, kept on the phone between launches. */
const Remembered = Storage.persisted({ key: 'foldkit.demo.remembered', schema: Schema.String })

// MODEL

export const Model = Schema.Struct({
  keyboardHeight: Schema.Number,
  /** How much of the app's window the keyboard covers. See `Keyboard`. */
  keyboardCovers: Schema.Number,
  maybeAppStatus: Schema.Option(AppState.AppStatus),
  /** Every status seen, oldest first: leaving the app cannot be watched live. */
  appStatusHistory: Schema.Array(AppState.AppStatus),
  maybeScheme: Schema.Option(ColorScheme.Scheme),
  maybeNetwork: Schema.Option(
    Schema.Struct({ status: Network.NetworkStatus, connection: Schema.String }),
  ),
  maybeWindow: Schema.Option(
    Schema.Struct({
      width: Schema.Number,
      height: Schema.Number,
      orientation: Window.Orientation,
    }),
  ),
  draft: Schema.String,
  clipboardResult: Schema.String,
  remembered: Schema.String,
  storageResult: Schema.String,
  hapticResult: Schema.String,
  shareResult: Schema.String,
  linkResult: Schema.String,
  alertResult: Schema.String,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ChangedDraft: { text: Schema.String },
  PressedCopy: {},
  PressedPaste: {},
  ChangedRemembered: { text: Schema.String },
  PressedForget: {},
  PressedImpact: { style: Haptics.ImpactStyle },
  PressedSelection: {},
  PressedNotification: { type: Haptics.NotificationType },
  PressedShare: {},
  PressedOpenUrl: { url: Schema.String },
  PressedCanOpenUrl: { url: Schema.String },
  PressedShowAlert: {},
  PressedDismissKeyboard: {},
  PressedExit: {},
  CompletedExit: {},
  GotHapticsMessage: { message: Haptics.Message },
  GotClipboardMessage: { message: Clipboard.Message },
  GotStorageMessage: { message: Storage.Message },
  GotRememberedMessage: { message: Remembered.Message },
  GotShareMessage: { message: Share.Message },
  GotLinkingMessage: { message: Linking.Message },
  GotAlertMessage: { message: Alert.Message },
  GotKeyboardMessage: { message: Keyboard.Message },
  GotAppStateMessage: { message: AppState.Message },
  GotColorSchemeMessage: { message: ColorScheme.Message },
  GotNetworkMessage: { message: Network.Message },
  GotWindowMessage: { message: Window.Message },
})
export type Message = typeof Message.Type

// COMMAND

const fromHaptics = (message: Haptics.Message) => Message.GotHapticsMessage({ message })
const fromClipboard = (message: Clipboard.Message) => Message.GotClipboardMessage({ message })
const fromStorage = (message: Storage.Message) => Message.GotStorageMessage({ message })
const fromRemembered = (message: typeof Remembered.Message.Type) =>
  Message.GotRememberedMessage({ message })
const fromShare = (message: Share.Message) => Message.GotShareMessage({ message })
const fromLinking = (message: Linking.Message) => Message.GotLinkingMessage({ message })
const fromAlert = (message: Alert.Message) => Message.GotAlertMessage({ message })
const fromKeyboard = (message: Keyboard.Message) => Message.GotKeyboardMessage({ message })

const makeExit = (exit: () => void) =>
  Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      exit()
      return Message.CompletedExit()
    }),
  })

// UPDATE

type Return = Update.Return<Model, Message, Services>

const ALERT_BUTTONS: ReadonlyArray<Alert.AlertButton> = [
  { id: 'cancel', label: 'Cancel', style: 'cancel' },
  { id: 'later', label: 'Later' },
  { id: 'delete', label: 'Delete', style: 'destructive' },
]

export const makeUpdate = (exit: () => void) => {
  const Exit = makeExit(exit)
  return (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text }) }),
      PressedCopy: () => ({
        model,
        commands: [
          Command.mapMessage(Clipboard.CopyText({ text: model.draft }), fromClipboard),
        ],
      }),
      PressedPaste: () => ({
        model,
        commands: [Command.mapMessage(Clipboard.ReadText(), fromClipboard)],
      }),

      ChangedRemembered: ({ text }) => ({
        model: modifyFields(model, { remembered: () => text }),
        commands: [Command.mapMessage(Remembered.Save({ value: text }), fromRemembered)],
      }),
      PressedForget: () => ({
        model: modifyFields(model, { remembered: () => '' }),
        commands: [
          Command.mapMessage(Storage.RemoveItem({ key: Remembered.key }), fromStorage),
        ],
      }),

      PressedImpact: ({ style }) => ({
        model,
        commands: [Command.mapMessage(Haptics.Impact({ style }), fromHaptics)],
      }),
      PressedSelection: () => ({
        model,
        commands: [Command.mapMessage(Haptics.Select(), fromHaptics)],
      }),
      PressedNotification: ({ type }) => ({
        model,
        commands: [Command.mapMessage(Haptics.Notify({ type }), fromHaptics)],
      }),

      PressedShare: () => ({
        model,
        commands: [
          Command.mapMessage(
            Share.Open({ message: 'Sent from a Foldkit program', url: GOOD_URL }),
            fromShare,
          ),
        ],
      }),
      PressedOpenUrl: ({ url }) => ({
        model,
        commands: [Command.mapMessage(Linking.OpenUrl({ url }), fromLinking)],
      }),
      PressedCanOpenUrl: ({ url }) => ({
        model,
        commands: [Command.mapMessage(Linking.CanOpenUrl({ url }), fromLinking)],
      }),

      PressedShowAlert: () => ({
        model,
        commands: [
          Command.mapMessage(
            Alert.Show({
              title: 'Delete this note?',
              message: 'Nothing is deleted. Press any button.',
              buttons: ALERT_BUTTONS,
            }),
            fromAlert,
          ),
        ],
      }),

      PressedDismissKeyboard: () => ({
        model,
        commands: [Command.mapMessage(Keyboard.Dismiss(), fromKeyboard)],
      }),

      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),

      GotHapticsMessage: ({ message }) => ({
        model: modifyFields(model, {
          hapticResult: () =>
            Haptics.Message.match(message, {
              CompletedPlayHaptic: ({ feedback }) => `Played ${feedback}`,
              FailedPlayHaptic: ({ feedback, reason }) =>
                `Could not play ${feedback}: ${reason}`,
            }),
        }),
      }),

      GotClipboardMessage: ({ message }) =>
        Clipboard.Message.match<Return>(message, {
          SucceededCopyText: ({ text }) => ({
            model: modifyFields(model, { clipboardResult: () => `Copied "${text}"` }),
          }),
          FailedCopyText: ({ reason }) => ({
            model: modifyFields(model, { clipboardResult: () => `Could not copy: ${reason}` }),
          }),
          SucceededReadText: ({ text }) => ({
            model: modifyFields(model, {
              draft: () => text,
              clipboardResult: () => `Pasted "${text}"`,
            }),
          }),
          FailedReadText: ({ reason }) => ({
            model: modifyFields(model, { clipboardResult: () => `Could not paste: ${reason}` }),
          }),
        }),

      GotRememberedMessage: ({ message }) => {
        switch (message._tag) {
          case 'SucceededRestore':
            return {
              model: modifyFields(model, {
                remembered: remembered => Option.getOrElse(message.maybeValue, () => remembered),
                storageResult: () =>
                  Option.isSome(message.maybeValue)
                    ? 'Restored from last time'
                    : 'Nothing saved yet',
              }),
            }
          case 'FailedRestore':
            return {
              model: modifyFields(model, {
                storageResult: () => `Could not restore: ${message.reason}`,
              }),
            }
          case 'SucceededSave':
            return { model: modifyFields(model, { storageResult: () => 'Saved' }) }
          case 'FailedSave':
            return {
              model: modifyFields(model, {
                storageResult: () => `Could not save: ${message.reason}`,
              }),
            }
        }
      },

      GotStorageMessage: ({ message }) => ({
        model: modifyFields(model, {
          storageResult: storageResult =>
            Storage.Message.match(message, {
              SucceededRemoveItem: () => 'Forgotten',
              FailedRemoveItem: ({ reason }) => `Could not forget: ${reason}`,
              // This demo reads and writes through `Remembered` only.
              SucceededGetItem: () => storageResult,
              FailedGetItem: () => storageResult,
              SucceededSetItem: () => storageResult,
              FailedSetItem: () => storageResult,
            }),
        }),
      }),

      GotShareMessage: ({ message }) => ({
        model: modifyFields(model, {
          shareResult: () =>
            Share.Message.match(message, {
              SucceededShare: ({ outcome }) =>
                outcome === 'shared' ? 'Shared' : 'Sheet closed without sharing',
              FailedShare: ({ reason }) => `Could not share: ${reason}`,
            }),
        }),
      }),

      GotLinkingMessage: ({ message }) => ({
        model: modifyFields(model, {
          linkResult: () =>
            Linking.Message.match(message, {
              SucceededOpenUrl: ({ url }) => `Opened ${url}`,
              FailedOpenUrl: ({ url, reason }) => `Could not open ${url}: ${reason}`,
              SucceededCanOpenUrl: ({ url, canOpen }) =>
                canOpen ? `Yes, an app opens ${url}` : `No app opens ${url}`,
              FailedCanOpenUrl: ({ url, reason }) => `Could not ask about ${url}: ${reason}`,
            }),
        }),
      }),

      GotAlertMessage: ({ message }) => ({
        model: modifyFields(model, {
          alertResult: () =>
            Alert.Message.match(message, {
              PressedAlertButton: ({ id }) => `You pressed "${id}"`,
              DismissedAlert: () => 'Closed without a button',
              FailedShowAlert: ({ reason }) => `Could not show the alert: ${reason}`,
            }),
        }),
      }),

      GotKeyboardMessage: ({ message }) => ({
        model: modifyFields(model, {
          keyboardCovers: keyboardCovers =>
            Keyboard.Message.match(message, {
              ShownKeyboard: ({ covers }) => covers,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => keyboardCovers,
            }),
          keyboardHeight: keyboardHeight =>
            Keyboard.Message.match(message, {
              ShownKeyboard: ({ height }) => height,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => keyboardHeight,
            }),
        }),
      }),

      GotAppStateMessage: ({ message: { status } }) => ({
        model: modifyFields(model, {
          maybeAppStatus: () => Option.some(status),
          // The last few are enough to see "background" after coming back.
          appStatusHistory: history => [...history, status].slice(-6),
        }),
      }),

      GotColorSchemeMessage: ({ message: { scheme } }) => ({
        model: modifyFields(model, { maybeScheme: () => Option.some(scheme) }),
      }),

      GotNetworkMessage: ({ message: { status, connection } }) => ({
        model: modifyFields(model, {
          maybeNetwork: () => Option.some({ status, connection }),
        }),
      }),

      GotWindowMessage: ({ message: { width, height, orientation } }) => ({
        model: modifyFields(model, {
          maybeWindow: () => Option.some({ width, height, orientation }),
        }),
      }),
    })
}

// INIT

export const init = (): Return => ({
  model: {
    keyboardHeight: 0,
    keyboardCovers: 0,
    maybeAppStatus: Option.none(),
    appStatusHistory: [],
    maybeScheme: Option.none(),
    maybeNetwork: Option.none(),
    maybeWindow: Option.none(),
    draft: 'Hello from Foldkit',
    clipboardResult: 'Nothing copied or pasted yet',
    remembered: '',
    storageResult: 'Looking for what was saved…',
    hapticResult: 'Nothing played yet',
    shareResult: 'Nothing shared yet',
    linkResult: 'Nothing opened yet',
    alertResult: 'No alert shown yet',
  },
  // The first screen is drawn first. What was saved arrives a moment later.
  commands: [Command.mapMessage(Remembered.Restore(), fromRemembered)],
})

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message, Services>()(() => ({
  keyboard: Keyboard.changesEntry(fromKeyboard),
  appState: AppState.changesEntry(message => Message.GotAppStateMessage({ message })),
  colorScheme: ColorScheme.changesEntry(message =>
    Message.GotColorSchemeMessage({ message }),
  ),
  network: Network.changesEntry(message => Message.GotNetworkMessage({ message })),
  window: Window.changesEntry(message => Message.GotWindowMessage({ message })),
}))

// VIEW

type Palette = Readonly<{
  paper: string
  card: string
  ink: string
  muted: string
  line: string
  accent: string
  danger: string
  onAccent: string
}>

const LIGHT: Palette = {
  paper: '#f4f4f2',
  card: '#ffffff',
  ink: '#111111',
  muted: '#5f5f5f',
  line: '#dcdcd8',
  accent: '#0a66d8',
  danger: '#c62828',
  onAccent: '#ffffff',
}

const DARK: Palette = {
  paper: '#0f0f10',
  card: '#1c1c1e',
  ink: '#f2f2f2',
  muted: '#a3a3a3',
  line: '#333336',
  accent: '#4d9bff',
  danger: '#ff6b60',
  onAccent: '#0f0f10',
}

const paletteOf = (model: Model): Palette =>
  Option.match(model.maybeScheme, {
    onNone: () => LIGHT,
    onSome: scheme => (scheme === 'dark' ? DARK : LIGHT),
  })

const WAITING = 'waiting for the phone'

const button = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  id: string,
  label: string,
  message: Message,
  kind: 'accent' | 'danger' = 'accent',
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: kind === 'danger' ? palette.danger : palette.accent,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: palette.onAccent, fontSize: 16, fontWeight: '600' })], [label])],
  )

const row = (children: ReadonlyArray<Html>): Html =>
  box([style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })], children)

const field = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  id: string,
  value: string,
  placeholder: string,
  toMessage: (text: string) => Message,
): Html =>
  textInput(
    [
      h.Attribute('testID', id),
      h.Attribute('value', value),
      h.Placeholder(placeholder),
      prop('editable', true),
      h.OnInput(toMessage),
      style({
        height: 44,
        fontSize: 17,
        color: palette.ink,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: palette.line,
        borderRadius: 10,
      }),
    ],
    [],
  )

const section = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  heading: string,
  hint: string,
  children: ReadonlyArray<Html>,
): Html =>
  box(
    [
      h.Key(heading),
      style({
        backgroundColor: palette.card,
        borderRadius: 14,
        padding: 14,
        gap: 10,
      }),
    ],
    [
      text([style({ color: palette.ink, fontSize: 18, fontWeight: '700' })], [heading]),
      text([style({ color: palette.muted, fontSize: 14 })], [hint]),
      ...children,
    ],
  )

const result = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  id: string,
  value: string,
): Html =>
  text([h.Attribute('testID', id), style({ color: palette.ink, fontSize: 15 })], [value])

const live = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  id: string,
  label: string,
  value: string,
): Html =>
  box(
    [style({ flexDirection: 'row', justifyContent: 'space-between', gap: 12 })],
    [
      text([style({ color: palette.muted, fontSize: 15 })], [label]),
      text(
        [
          h.Attribute('testID', id),
          style({ color: palette.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 }),
        ],
        [value],
      ),
    ],
  )

const round = (value: number): number => Math.round(value)

export const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const palette = paletteOf(model)
    return stack(
      [h.Attribute('testID', 'stack')],
      [
        screen(
          [h.Key('device'), h.Attribute('testID', 'screen-device')],
          [
            header([title('Phone features')], []),
            safeArea(device, { hasHeader: true }, [
              scrollView(
                [
                  h.Attribute('testID', 'scroll'),
                  style({ flex: 1, backgroundColor: palette.paper }),
                ],
                [
                  box(
                    [
                      style({
                        padding: 16,
                        gap: 14,
                        // Room to scroll a field clear of the keyboard.
                        paddingBottom: 16 + model.keyboardCovers,
                      }),
                    ],
                    [
                      section(
                        h,
                        palette,
                        'Live',
                        'These lines change by themselves. Open the keyboard, turn the phone, switch to dark mode, turn on airplane mode, or leave the app and come back.',
                        [
                          live(
                            h,
                            palette,
                            'live-keyboard',
                            'Keyboard',
                            model.keyboardHeight > 0
                              ? `shown, ${round(model.keyboardHeight)} points tall`
                              : 'hidden',
                          ),
                          live(
                            h,
                            palette,
                            'live-app-state',
                            'App state',
                            Option.getOrElse(model.maybeAppStatus, () => WAITING),
                          ),
                          live(
                            h,
                            palette,
                            'live-app-history',
                            'App state so far',
                            model.appStatusHistory.length === 0
                              ? WAITING
                              : model.appStatusHistory.join(' → '),
                          ),
                          live(
                            h,
                            palette,
                            'live-scheme',
                            'Color scheme',
                            Option.getOrElse(model.maybeScheme, () => WAITING),
                          ),
                          live(
                            h,
                            palette,
                            'live-network',
                            'Network',
                            Option.match(model.maybeNetwork, {
                              onNone: () => WAITING,
                              onSome: ({ status, connection }) => `${status} (${connection})`,
                            }),
                          ),
                          live(
                            h,
                            palette,
                            'live-window',
                            'Window',
                            Option.match(model.maybeWindow, {
                              onNone: () => WAITING,
                              onSome: ({ width, height, orientation }) =>
                                `${round(width)} × ${round(height)}, ${orientation}`,
                            }),
                          ),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Clipboard',
                        'Copy puts the field\'s text on the clipboard. Paste replaces the field with what is on the clipboard. iOS may ask before pasting text from another app.',
                        [
                          field(h, palette, 'draft', model.draft, 'Text to copy', text =>
                            Message.ChangedDraft({ text }),
                          ),
                          row([
                            button(h, palette, 'copy', 'Copy', Message.PressedCopy()),
                            button(h, palette, 'paste', 'Paste', Message.PressedPaste()),
                            button(
                              h,
                              palette,
                              'dismiss-keyboard',
                              'Hide keyboard',
                              Message.PressedDismissKeyboard(),
                            ),
                          ]),
                          result(h, palette, 'clipboard-result', model.clipboardResult),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Remember this',
                        'Type something, close the app completely, and open it again. The text should still be here. Forget erases it.',
                        [
                          field(
                            h,
                            palette,
                            'remembered',
                            model.remembered,
                            'Something to remember',
                            text => Message.ChangedRemembered({ text }),
                          ),
                          row([
                            button(
                              h,
                              palette,
                              'forget',
                              'Forget',
                              Message.PressedForget(),
                              'danger',
                            ),
                          ]),
                          result(h, palette, 'storage-result', model.storageResult),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Haptics',
                        'Each button should be felt in the hand, each a little differently. Nothing is felt in a simulator or in low power mode.',
                        [
                          row([
                            button(
                              h,
                              palette,
                              'haptic-light',
                              'Light',
                              Message.PressedImpact({ style: 'light' }),
                            ),
                            button(
                              h,
                              palette,
                              'haptic-medium',
                              'Medium',
                              Message.PressedImpact({ style: 'medium' }),
                            ),
                            button(
                              h,
                              palette,
                              'haptic-heavy',
                              'Heavy',
                              Message.PressedImpact({ style: 'heavy' }),
                            ),
                            button(
                              h,
                              palette,
                              'haptic-selection',
                              'Selection',
                              Message.PressedSelection(),
                            ),
                          ]),
                          row([
                            button(
                              h,
                              palette,
                              'haptic-success',
                              'Success',
                              Message.PressedNotification({ type: 'success' }),
                            ),
                            button(
                              h,
                              palette,
                              'haptic-warning',
                              'Warning',
                              Message.PressedNotification({ type: 'warning' }),
                            ),
                            button(
                              h,
                              palette,
                              'haptic-error',
                              'Error',
                              Message.PressedNotification({ type: 'error' }),
                              'danger',
                            ),
                          ]),
                          result(h, palette, 'haptic-result', model.hapticResult),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Share and links',
                        'Share opens the phone\'s share sheet. Open link leaves for the browser. The last button tries a link no app handles, to show a failure.',
                        [
                          row([
                            button(h, palette, 'share', 'Share', Message.PressedShare()),
                            button(
                              h,
                              palette,
                              'open-url',
                              'Open link',
                              Message.PressedOpenUrl({ url: GOOD_URL }),
                            ),
                            button(
                              h,
                              palette,
                              'can-open-url',
                              'Can it open?',
                              Message.PressedCanOpenUrl({ url: GOOD_URL }),
                            ),
                            button(
                              h,
                              palette,
                              'open-bad-url',
                              'Open a broken link',
                              Message.PressedOpenUrl({ url: BAD_URL }),
                              'danger',
                            ),
                          ]),
                          result(h, palette, 'share-result', model.shareResult),
                          result(h, palette, 'link-result', model.linkResult),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Alert',
                        'Shows the phone\'s own alert with three buttons. The line below says which one you pressed.',
                        [
                          row([
                            button(
                              h,
                              palette,
                              'show-alert',
                              'Show alert',
                              Message.PressedShowAlert(),
                            ),
                          ]),
                          result(h, palette, 'alert-result', model.alertResult),
                        ],
                      ),
                      row([button(h, palette, 'exit', 'Exit', Message.PressedExit())]),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )
  }

/**
 * `resources` is the Layer with every service: `Device.live({...})` in an
 * app, `Device.makeTest().layer` in a test.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Services>,
) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env.exit),
    view: makeView(env.device),
    subscriptions,
    resources,
    container,
  })
