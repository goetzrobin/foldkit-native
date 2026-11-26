/**
 * The phone's services as Effect UI Commands and Subscriptions: haptics, the
 * clipboard, the keyboard, whether the app is in front, light or dark.
 *
 *   // update
 *   PressedSave: $ => $.run(Phone.Impact.make({ style: 'light' }))
 *   PressedCopy: $ => $.run(Phone.Copy.make({ text: $.model.draft }).pipe(Command.map(...)))
 *
 *   // subscriptions
 *   subscriptions: () => [
 *     Phone.keyboard(frame => Message.ChangedKeyboard({ height: frame.height })),
 *     Phone.colorScheme(scheme => Message.ChangedScheme({ scheme })),
 *   ]
 *
 * The same for the rest of the phone: saved settings (`StorageGet`,
 * `StorageSet`), the share sheet (`Share`), links (`OpenUrl`), the app's own
 * light or dark (`SetAppearance`), the recorder (`RequestMicrophone`,
 * `StartRecording`, `StopRecording`, `CancelRecording`, and `recorder`), the
 * player (`PlaySound`, `StopSound`, and `player`), speech recognition
 * (`RequestSpeech`, `StartListening`, `StopListening`, `AbortListening`, and
 * `speech`) and the network (`network`). `Phone.layerAll` provides them all.
 *
 * The services themselves are the host layer's (`packages/native/src/host/device`):
 * `Phone.Device.live(modules)` over the real native modules, `Phone.Device.makeTest()`
 * as fakes a test can read and drive. `Phone.layer` turns them into the
 * Command services a component asks for.
 */
import * as Command from '@effect/ui/Command'
import * as Component from '@effect/ui/Component'
import * as Subscription from '@effect/ui/Subscription'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import * as Device from '../../native/src/host/device/index.js'

export { Device }

const { AppState, Clipboard, ColorScheme, Haptics, Keyboard } = Device
const { Appearance, Linking, Network, Player, Recorder, Speech, Storage } = Device

/** What a Command that can fail answers: it worked, or why not. */
export const Outcome = Schema.Union([
  Schema.TaggedStruct('Done', {}),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type Outcome = typeof Outcome.Type

const done: Outcome = { _tag: 'Done' }
const failed = (error: Device.DeviceError): Outcome => ({ _tag: 'Failed', reason: error.reason })

/**
 * A tap under the finger. `Done` means the phone took the request; whether
 * anything is felt is the phone's own choice (its settings can turn taps off).
 * `Failed` carries the reason, such as the native module missing from the build.
 */
export class Impact extends Command.Service<Impact>()('Phone/Impact', {
  args: { style: Haptics.ImpactStyle },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics.Haptics
      return ({ style }) => Effect.match(haptics.impact(style), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** The small tick of a picker moving. */
export class Selection extends Command.Service<Selection>()('Phone/Selection', {
  args: {},
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics.Haptics
      return () => Effect.match(haptics.selection, { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** The pattern the phone plays for an outcome. */
export class Notify extends Command.Service<Notify>()('Phone/Notify', {
  args: { type: Haptics.NotificationType },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const haptics = yield* Haptics.Haptics
      return ({ type }) => Effect.match(haptics.notification(type), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** Copies text to the clipboard. */
export class Copy extends Command.Service<Copy>()('Phone/Copy', {
  args: { text: Schema.String },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard.Clipboard
      return ({ text }) => Effect.match(clipboard.copy(text), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** What a read of the clipboard answers. */
export const Pasted = Schema.Union([
  Schema.TaggedStruct('Text', { text: Schema.String }),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type Pasted = typeof Pasted.Type

/** Reads the clipboard. Read when the user asks to paste, never on a timer. */
export class Paste extends Command.Service<Paste>()('Phone/Paste', {
  args: {},
  success: Pasted,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const clipboard = yield* Clipboard.Clipboard
      return () =>
        Effect.match(clipboard.read, {
          onSuccess: (text): Pasted => ({ _tag: 'Text', text }),
          onFailure: (error): Pasted => ({ _tag: 'Failed', reason: error.reason }),
        })
    }),
  )
}

/** Puts the keyboard away. */
export class DismissKeyboard extends Command.Service<DismissKeyboard>()('Phone/DismissKeyboard', {
  args: {},
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const keyboard = yield* Keyboard.Keyboard
      return () => Effect.as(keyboard.dismiss, Component.noop)
    }),
  )
}

/** Every Command service here. */
export type Commands = Impact | Selection | Notify | Copy | Paste | DismissKeyboard

/** What the Subscriptions here read. */
export type Sources = Device.Keyboard.Keyboard | Device.AppState.AppState | Device.ColorScheme.ColorScheme

/**
 * The Command services, over the phone's services. Give it the host's
 * `Device.live(modules)` or a test's `Device.makeTest().layer`:
 *
 *   Layer.provideMerge(Phone.layer, Phone.Device.live(modules))
 */
export const layer: Layer.Layer<
  Commands,
  never,
  Device.Haptics.Haptics | Device.Clipboard.Clipboard | Device.Keyboard.Keyboard
> = Layer.mergeAll(Impact.layer, Selection.layer, Notify.layer, Copy.layer, Paste.layer, DismissKeyboard.layer)

/** The real modules behind the five services here, as the app imports them. */
export type LiveModules = Readonly<{
  /** `import * as ReactNative from 'react-native'` */
  reactNative: Readonly<{
    Platform: Readonly<{ OS: string }>
    Keyboard: Device.Keyboard.KeyboardModule
    AppState: Device.AppState.AppStateModule
    Appearance: Device.ColorScheme.AppearanceModule
  }>
  /** `import * as ExpoHaptics from 'expo-haptics'` */
  haptics: Device.Haptics.HapticsModule
  /** `import * as ExpoClipboard from 'expo-clipboard'` */
  clipboard: Device.Clipboard.ClipboardModule
  /** `() => engine.blurFocused()`, so `DismissKeyboard` works. */
  blurFocused?: () => void
}>

/** The services the Commands and Subscriptions here read. */
export type Services =
  | Device.Haptics.Haptics
  | Device.Clipboard.Clipboard
  | Device.Keyboard.Keyboard
  | Device.AppState.AppState
  | Device.ColorScheme.ColorScheme

/**
 * The five services over the real modules. An app that wants the rest
 * (storage, share, network, the recorder) uses `Phone.Device.live` instead.
 */
export const live = (modules: LiveModules): Layer.Layer<Services> =>
  Layer.mergeAll(
    Haptics.live(modules.haptics),
    Clipboard.live(modules.clipboard),
    Keyboard.live(modules.reactNative.Keyboard, {
      platform: modules.reactNative.Platform.OS,
      ...(modules.blurFocused !== undefined && { blurFocused: modules.blurFocused }),
    }),
    AppState.live(modules.reactNative.AppState),
    ColorScheme.live(modules.reactNative.Appearance),
  )

/** The keyboard as it is now, then every change. Height 0 is hidden. */
export const keyboard = <Msg>(
  toMessage: (frame: Device.Keyboard.KeyboardFrame) => Msg,
): Subscription.Subscription<Msg, Device.Keyboard.Keyboard> =>
  Subscription.make(
    'Phone/keyboard',
    Stream.unwrap(
      Keyboard.Keyboard.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('keyboard', service.frames), toMessage)),
      ),
    ),
  )

/** Whether the app is in front, then every change. */
export const appState = <Msg>(
  toMessage: (status: Device.AppState.AppStatus) => Msg,
): Subscription.Subscription<Msg, Device.AppState.AppState> =>
  Subscription.make(
    'Phone/appState',
    Stream.unwrap(
      AppState.AppState.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('appState', service.statuses), toMessage)),
      ),
    ),
  )

/** Light or dark as the phone is set, then every change. */
export const colorScheme = <Msg>(
  toMessage: (scheme: Device.ColorScheme.Scheme) => Msg,
): Subscription.Subscription<Msg, Device.ColorScheme.ColorScheme> =>
  Subscription.make(
    'Phone/colorScheme',
    Stream.unwrap(
      ColorScheme.ColorScheme.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('colorScheme', service.schemes), toMessage)),
      ),
    ),
  )

// THE REST OF THE PHONE
//
// These need more of the phone than the five services above, so they have a
// Layer of their own: `layerAll`, over `Phone.Device.live(modules)`.

/** What a read of the phone's small store answers: the text, or nothing saved (or the store failed). */
export const Stored = Schema.Struct({ value: Schema.NullOr(Schema.String) })
export type Stored = typeof Stored.Type

/** Reads one saved value. A store that fails reads as nothing saved. */
export class StorageGet extends Command.Service<StorageGet>()('Phone/StorageGet', {
  args: { key: Schema.String },
  success: Stored,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const storage = yield* Storage.Storage
      return ({ key }) =>
        Effect.match(storage.get(key), {
          onSuccess: (value): Stored => ({ value: value._tag === 'Some' ? value.value : null }),
          onFailure: (): Stored => ({ value: null }),
        })
    }),
  )
}

/** Saves one value. It is still there the next time the app opens. */
export class StorageSet extends Command.Service<StorageSet>()('Phone/StorageSet', {
  args: { key: Schema.String, value: Schema.String },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const storage = yield* Storage.Storage
      return ({ key, value }) => Effect.match(storage.set(key, value), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** Opens the phone's share sheet with a piece of text. */
export class Share extends Command.Service<Share>()('Phone/Share', {
  args: { message: Schema.String },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const share = yield* Device.Share.Share
      return ({ message }) => Effect.match(share.share({ message }), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** Opens a link in the app the phone picks for it. */
export class OpenUrl extends Command.Service<OpenUrl>()('Phone/OpenUrl', {
  args: { url: Schema.String },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const linking = yield* Linking.Linking
      return ({ url }) => Effect.match(linking.open(url), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** `system` follows the phone. */
export const Theme = Schema.Literals(['system', 'light', 'dark'])
export type Theme = typeof Theme.Type

/**
 * Sets the app's own light or dark on the phone, so the phone's views (the
 * title bar, sheets, the keyboard) agree with the program's. Answers with
 * what the phone shows now.
 */
export class SetAppearance extends Command.Service<SetAppearance>()('Phone/SetAppearance', {
  args: { theme: Theme },
  success: Schema.Struct({ scheme: ColorScheme.Scheme }),
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const appearance = yield* Appearance.Appearance
      return ({ theme }) => Effect.map(appearance.set(theme), scheme => ({ scheme }))
    }),
  )
}

// The recorder

/** `granted`, or why not. `blocked`: the phone will not ask again. `failed`: the build cannot record. */
export const Access = Schema.Struct({
  access: Schema.Literals(['granted', 'denied', 'blocked', 'failed']),
  reason: Schema.String,
})
export type Access = typeof Access.Type

/** Asks for the microphone, if the phone may still ask. */
export class RequestMicrophone extends Command.Service<RequestMicrophone>()('Phone/RequestMicrophone', {
  args: {},
  success: Access,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const recorder = yield* Recorder.Recorder
      return () =>
        Effect.match(recorder.requestPermission, {
          onSuccess: (permission): Access => ({ access: permission === 'granted' ? 'granted' : permission === 'blocked' ? 'blocked' : 'denied', reason: '' }),
          onFailure: (error): Access => ({ access: 'failed', reason: error.reason }),
        })
    }),
  )
}

/** Starts a recording. It stops by itself at `maxSeconds`. */
export class StartRecording extends Command.Service<StartRecording>()('Phone/StartRecording', {
  args: { maxSeconds: Schema.Number, warnSeconds: Schema.Number },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const recorder = yield* Recorder.Recorder
      return options => Effect.match(recorder.start(options), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** What stopping a recording answers: the file, or why there is none. */
export const Recorded = Schema.Union([
  Schema.TaggedStruct('Recorded', { recording: Recorder.Recording }),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type Recorded = typeof Recorded.Type

/** Stops the recording and keeps the file. */
export class StopRecording extends Command.Service<StopRecording>()('Phone/StopRecording', {
  args: {},
  success: Recorded,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const recorder = yield* Recorder.Recorder
      return () =>
        Effect.match(recorder.stop, {
          onSuccess: (recording): Recorded => ({ _tag: 'Recorded', recording }),
          onFailure: (error): Recorded => ({ _tag: 'Failed', reason: error.reason }),
        })
    }),
  )
}

/** Stops the recording and deletes the file. */
export class CancelRecording extends Command.Service<CancelRecording>()('Phone/CancelRecording', {
  args: {},
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const recorder = yield* Recorder.Recorder
      return () => Effect.match(recorder.cancel, { onSuccess: () => done, onFailure: failed })
    }),
  )
}

// The player

/** Plays a sound file from where it was left. */
export class PlaySound extends Command.Service<PlaySound>()('Phone/PlaySound', {
  args: { uri: Schema.String },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const player = yield* Player.Player
      return ({ uri }) => Effect.match(player.play(uri, 1), { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** Stops the sound and frees the player. */
export class StopSound extends Command.Service<StopSound>()('Phone/StopSound', {
  args: {},
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const player = yield* Player.Player
      return () => Effect.as(player.stop, Component.noop)
    }),
  )
}

// Speech recognition

/** Asks for the microphone and for speech recognition, if the phone may still ask. */
export class RequestSpeech extends Command.Service<RequestSpeech>()('Phone/RequestSpeech', {
  args: {},
  success: Access,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const speech = yield* Speech.Speech
      return () =>
        Effect.match(speech.requestPermission, {
          onSuccess: (access): Access => ({ access, reason: '' }),
          onFailure: (error): Access => ({ access: 'failed', reason: error.reason }),
        })
    }),
  )
}

/**
 * Starts listening. The words arrive through the `speech` Subscription.
 * `audioUri` reads a sound file in place of the microphone. An empty `lang`
 * is the phone's own language.
 */
export class StartListening extends Command.Service<StartListening>()('Phone/StartListening', {
  args: { lang: Schema.String, audioUri: Schema.NullOr(Schema.String) },
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const speech = yield* Speech.Speech
      return ({ lang, audioUri }) =>
        Effect.match(
          speech.start({ ...(lang === '' ? {} : { lang }), ...(audioUri === null ? {} : { audioUri }) }),
          { onSuccess: () => done, onFailure: failed },
        )
    }),
  )
}

/** Stops listening. The phone may send one last result first. */
export class StopListening extends Command.Service<StopListening>()('Phone/StopListening', {
  args: {},
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const speech = yield* Speech.Speech
      return () => Effect.match(speech.stop, { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** Stops listening at once, with no last result. */
export class AbortListening extends Command.Service<AbortListening>()('Phone/AbortListening', {
  args: {},
  success: Outcome,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const speech = yield* Speech.Speech
      return () => Effect.match(speech.abort, { onSuccess: () => done, onFailure: failed })
    }),
  )
}

/** Every Command service in this file. */
export type AllCommands =
  | Commands
  | StorageGet
  | StorageSet
  | Share
  | OpenUrl
  | SetAppearance
  | RequestMicrophone
  | StartRecording
  | StopRecording
  | CancelRecording
  | PlaySound
  | StopSound
  | RequestSpeech
  | StartListening
  | StopListening
  | AbortListening

/** Every Command service in this file, over the whole of `Phone.Device.live(modules)`. */
export const layerAll: Layer.Layer<AllCommands, never, Device.Services> = Layer.mergeAll(
  layer,
  StorageGet.layer,
  StorageSet.layer,
  Share.layer,
  OpenUrl.layer,
  SetAppearance.layer,
  RequestMicrophone.layer,
  StartRecording.layer,
  StopRecording.layer,
  CancelRecording.layer,
  PlaySound.layer,
  StopSound.layer,
  RequestSpeech.layer,
  StartListening.layer,
  StopListening.layer,
  AbortListening.layer,
)

/** What the recorder says while it records: its clock, a recording that ended at its limit, a failure. */
export const RecorderEvent = Schema.Union([
  Schema.TaggedStruct('Status', { status: Recorder.RecorderStatus }),
  Schema.TaggedStruct('Finished', { recording: Recorder.Recording }),
  Schema.TaggedStruct('Failed', { reason: Schema.String }),
])
export type RecorderEvent = typeof RecorderEvent.Type

/** The recorder's clock, about once a second. Subscribe only while recording. */
export const recorder = <Msg>(
  toMessage: (event: RecorderEvent) => Msg,
): Subscription.Subscription<Msg, Device.Recorder.Recorder> =>
  Subscription.make(
    'Phone/recorder',
    Stream.unwrap(
      Recorder.Recorder.use(service =>
        Effect.succeed(Stream.map(Device.streamOf(Recorder.CAPABILITY, service.events), toMessage)),
      ),
    ),
  )

/** What the player says: where it is in the sound, and that it reached the end. */
export const PlayerEvent = Schema.Union([
  Schema.TaggedStruct('Changed', { playback: Player.Playback }),
  Schema.TaggedStruct('Finished', { uri: Schema.String }),
])
export type PlayerEvent = typeof PlayerEvent.Type

/** The player's changes. Subscribe only while a sound may be playing. */
export const player = <Msg>(
  toMessage: (event: PlayerEvent) => Msg,
): Subscription.Subscription<Msg, Device.Player.Player> =>
  Subscription.make(
    'Phone/player',
    Stream.unwrap(
      Player.Player.use(service =>
        Effect.succeed(Stream.map(Device.streamOf(Player.CAPABILITY, service.events), toMessage)),
      ),
    ),
  )

/**
 * What the phone hears. `Result` holds everything heard so far in this
 * session, so show the newest and forget the one before.
 */
export const SpeechEvent = Schema.Union([
  Schema.TaggedStruct('Started', {}),
  Schema.TaggedStruct('Result', { text: Schema.String, isFinal: Schema.Boolean }),
  Schema.TaggedStruct('Ended', {}),
  Schema.TaggedStruct('Failed', { code: Schema.String, reason: Schema.String }),
])
export type SpeechEvent = typeof SpeechEvent.Type

/** Speech recognition's events. Subscribe before `StartListening` and for as long as the phone listens. */
export const speech = <Msg>(
  toMessage: (event: SpeechEvent) => Msg,
): Subscription.Subscription<Msg, Device.Speech.Speech> =>
  Subscription.make(
    'Phone/speech',
    Stream.unwrap(
      Speech.Speech.use(service =>
        Effect.succeed(Stream.map(Device.streamOf(Speech.CAPABILITY, service.events), toMessage)),
      ),
    ),
  )

/** Whether the phone is online, then every change. */
export const network = <Msg>(
  toMessage: (isOnline: boolean) => Msg,
): Subscription.Subscription<Msg, Device.Network.Network> =>
  Subscription.make(
    'Phone/network',
    Stream.unwrap(
      Network.Network.use(service =>
        Effect.succeed(Stream.map(Device.streamOf('network', service.states), state => toMessage(state.status === 'online'))),
      ),
    ),
  )
