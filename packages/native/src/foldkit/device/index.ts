/**
 * The phone's non-visual features as Foldkit Commands and Subscriptions.
 *
 * Each feature is a small module with the same four parts:
 *
 * - a service (`Haptics.Haptics`) that Commands and Subscriptions ask for,
 * - `live(module)`: a Layer over the real native module, built by the app,
 * - `makeTest()`: a fake Layer a test can read and drive,
 * - Messages, and the Commands or Subscription entries that produce them.
 *
 * This package never imports `react-native` or `expo-*`. The app does, and
 * passes the modules in:
 *
 *   import * as ExpoClipboard from 'expo-clipboard'
 *   import * as ExpoHaptics from 'expo-haptics'
 *   import * as ExpoNetwork from 'expo-network'
 *   import * as SecureStore from 'expo-secure-store'
 *   import * as ReactNative from 'react-native'
 *
 *   const resources = Device.live({
 *     reactNative: ReactNative,
 *     haptics: ExpoHaptics,
 *     clipboard: ExpoClipboard,
 *     secureStore: SecureStore,
 *     network: ExpoNetwork,
 *     blurFocused: () => surface.engine.blurFocused(),
 *   })
 *   Runtime.makeElement({ ..., resources, subscriptions })
 *
 * The Messages belong to each feature, so a program wraps them in one of its
 * own, the way Foldkit lifts a child's Messages:
 *
 *   GotClipboardMessage: { message: Clipboard.Message }
 *   ...
 *   Command.mapMessage(Clipboard.ReadText(), message =>
 *     Message.GotClipboardMessage({ message }))
 *
 * Every Command reports failure as a `Failed...` Message. None of them throw.
 */
import { Layer } from 'effect'

import * as Alert from './alert.js'
import * as Native from './audioNative.js'
import * as AppState from './appState.js'
import * as Clipboard from './clipboard.js'
import * as ColorScheme from './colorScheme.js'
import * as Haptics from './haptics.js'
import { measureAppWindow } from '../keyboard/appWindow.js'
import * as Keyboard from './keyboard.js'
import * as Linking from './linking.js'
import * as Network from './network.js'
import * as Player from './player.js'
import * as Recorder from './recorder.js'
import * as Share from './share.js'
import * as Storage from './storage.js'
import * as VoiceNotes from './voiceNotes.js'
import * as Window from './window.js'

export { DeviceError, makeTestSource, streamOf } from './common.js'
export type { Source, TestSource } from './common.js'

/**
 * Haptics. `Haptics.Impact({ style: 'light' | 'medium' | 'heavy' })`,
 * `Haptics.Select()`, `Haptics.Notify({ type: 'success' | 'warning' | 'error' })`.
 * Result: `CompletedPlayHaptic` or `FailedPlayHaptic`. Module: `expo-haptics`.
 */
export { Haptics }
/**
 * Clipboard. `Clipboard.CopyText({ text })`, `Clipboard.ReadText()`.
 * Result: `SucceededCopyText`, `SucceededReadText({ text })` or the
 * `Failed...` pair. Module: `expo-clipboard`.
 */
export { Clipboard }
/**
 * Storage. `Storage.GetItem({ key })`, `Storage.SetItem({ key, value })`,
 * `Storage.RemoveItem({ key })`, and `Storage.persisted({ key, schema })` to
 * keep a slice of the Model between launches. Module: `expo-secure-store`,
 * or anything shaped like AsyncStorage.
 */
export { Storage }
/**
 * Share sheet. `Share.Open({ message, url, title })`.
 * Result: `SucceededShare({ outcome: 'shared' | 'dismissed' })` or
 * `FailedShare`. Module: `Share` from `react-native`.
 */
export { Share }
/**
 * Links. `Linking.OpenUrl({ url })`, `Linking.CanOpenUrl({ url })`.
 * Result: `SucceededOpenUrl`, `SucceededCanOpenUrl({ canOpen })` or the
 * `Failed...` pair. Module: `Linking` from `react-native`.
 */
export { Linking }
/**
 * Alert. `Alert.Show({ title, message, buttons: [{ id, label, style }] })`.
 * Result: `PressedAlertButton({ id })`, `DismissedAlert` or `FailedShowAlert`.
 * Module: `Alert` from `react-native`.
 */
export { Alert }
/**
 * Keyboard. `Keyboard.Dismiss()` as a Command, and
 * `Keyboard.changesEntry(toMessage)` as a Subscription that reports
 * `ShownKeyboard({ height })` and `HidKeyboard`. Module: `Keyboard` from
 * `react-native`.
 */
export { Keyboard }
/**
 * App state. `AppState.changesEntry(toMessage)` reports
 * `ChangedAppState({ status: 'active' | 'background' | 'inactive' })`.
 * Module: `AppState` from `react-native`.
 */
export { AppState }
/**
 * Color scheme. `ColorScheme.changesEntry(toMessage)` reports
 * `ChangedColorScheme({ scheme: 'light' | 'dark' })`. Module: `Appearance`
 * from `react-native`.
 */
export { ColorScheme }
/**
 * Network. `Network.changesEntry(toMessage)` reports
 * `ChangedNetworkStatus({ status: 'online' | 'offline', connection })`.
 * Module: `expo-network`.
 */
export { Network }
/**
 * Window. `Window.changesEntry(toMessage)` reports
 * `ChangedWindowSize({ width, height, orientation })`. Module: `Dimensions`
 * from `react-native`.
 */
export { Window }
/**
 * Voice recorder. `Recorder.RequestPermission()`, `Recorder.Start({ maxSeconds,
 * warnSeconds })`, `Pause()`, `Resume()`, `Stop()`, `Cancel()`,
 * `TakeSnapshot()`, and `Recorder.status` as a Subscription Stream. The live
 * loudness is in `Recorder.levelMeter`, outside any Model. Module:
 * `expo-audio`, found by name with `Native.audioModuleFromGlobal()`.
 */
export { Recorder }
/**
 * Player. `Player.Play({ uri, rate })`, `Pause()`, `Seek({ positionMs })`,
 * `SetRate({ rate })`, `Stop()`, and `Player.positions` as a Subscription
 * Stream. One sound at a time. Module: `expo-audio`.
 */
export { Player }
/**
 * Saved voice notes. `VoiceNotes.List()`, `Add({ uri, durationMs, sizeBytes })`,
 * `Rename({ id, name })`, `Remove({ id })`. Files plus a JSON list in the
 * app's documents. Module: `expo-file-system`, found by name with
 * `Native.fileSystemFromGlobal()`.
 */
export { VoiceNotes }
/** How `expo-audio` and `expo-file-system` are reached with no React. */
export { Native }

/** Every service in this folder. The `Resources` of a program that uses them all. */
export type Services =
  | Haptics.Haptics
  | Clipboard.Clipboard
  | Storage.Storage
  | Share.Share
  | Linking.Linking
  | Alert.Alert
  | Keyboard.Keyboard
  | AppState.AppState
  | ColorScheme.ColorScheme
  | Network.Network
  | Window.Window
  | Recorder.Recorder
  | Player.Player
  | VoiceNotes.VoiceNotes

/** The real modules, as the app imports them. */
export type LiveModules = Readonly<{
  /** `import * as ReactNative from 'react-native'` */
  reactNative: Readonly<{
    Platform: Readonly<{ OS: string }>
    Share: Share.ShareModule
    Linking: Linking.LinkingModule
    Alert: Alert.AlertModule
    Keyboard: Keyboard.KeyboardModule
    AppState: AppState.AppStateModule
    Appearance: ColorScheme.AppearanceModule
    Dimensions: Window.DimensionsModule
  }>
  /** `import * as ExpoHaptics from 'expo-haptics'` */
  haptics: Haptics.HapticsModule
  /** `import * as ExpoClipboard from 'expo-clipboard'` */
  clipboard: Clipboard.ClipboardModule
  /** `import * as SecureStore from 'expo-secure-store'` */
  secureStore: Storage.SecureStoreModule
  /** `import * as ExpoNetwork from 'expo-network'` */
  network: Network.NetworkModule
  /** `() => surface.engine.blurFocused()`, so `Keyboard.Dismiss` works. */
  blurFocused?: () => void
  /**
   * `Native.audioModuleFromGlobal()`, for the recorder and the player. Left
   * out or null, both answer every Command with a `Failed...` Message.
   */
  audio?: Native.AudioModule | null
  /** `Native.fileSystemFromGlobal()`, for saved voice notes. */
  fileSystem?: Native.FileSystemModule | null
}>

/** The recorder, the player and the notes store, sharing one audio session. */
const liveVoice = (
  modules: LiveModules,
): Layer.Layer<Recorder.Recorder | Player.Player | VoiceNotes.VoiceNotes> => {
  const platform = modules.reactNative.Platform.OS
  const audio = modules.audio ?? null
  const fileSystem = modules.fileSystem ?? null
  const session = audio === null ? undefined : Native.makeAudioSession(audio, platform)
  // React Native's Linking has `openSettings`. It is read here so that
  // `linking.ts` need not know about it.
  const linking = modules.reactNative.Linking as { openSettings?: () => Promise<unknown> }
  let files: Native.Files | undefined
  try {
    files = fileSystem === null ? undefined : Native.filesFrom(fileSystem)
  } catch {
    files = undefined
  }
  return Layer.mergeAll(
    Recorder.live(audio, {
      platform,
      ...(session === undefined ? {} : { session }),
      ...(files === undefined ? {} : { removeFile: files.remove, fileSize: files.size }),
      ...(typeof linking.openSettings === 'function'
        ? { openSettings: () => linking.openSettings?.() }
        : {}),
    }),
    Player.live(audio, { platform, ...(session === undefined ? {} : { session }) }),
    VoiceNotes.live(fileSystem),
  )
}

/** One Layer with every feature, over the real modules. */
export const live = (modules: LiveModules): Layer.Layer<Services> => {
  const { reactNative } = modules
  return Layer.mergeAll(
    Haptics.live(modules.haptics),
    Clipboard.live(modules.clipboard),
    Storage.liveSecureStore(modules.secureStore),
    Share.live(reactNative.Share, reactNative.Platform.OS),
    Linking.live(reactNative.Linking),
    Alert.live(reactNative.Alert),
    Keyboard.live(reactNative.Keyboard, {
      platform: reactNative.Platform.OS,
      ...(modules.blurFocused !== undefined && { blurFocused: modules.blurFocused }),
      // Android: learns on the phone whether the window makes its own room.
      measureWindow: measureAppWindow,
    }),
    AppState.live(reactNative.AppState),
    ColorScheme.live(reactNative.Appearance),
    Network.live(modules.network),
    Window.live(reactNative.Dimensions),
    liveVoice(modules),
  )
}

/**
 * Every feature faked, for a test. `layer` goes to the program. The rest
 * are the fakes themselves: read what the program asked for, and drive what
 * the phone reports.
 *
 *   const device = Device.makeTest()
 *   Runtime.embed(makeProgram(container, device.layer))
 *   device.keyboard.show(300)
 *   expect(device.haptics.calls).toEqual(['impact:light'])
 */
export const makeTest = (
  options: Readonly<{
    /** What storage holds before the program starts. */
    stored?: Readonly<Record<string, string>>
    /** A storage fake to reuse, to stand for reopening the app. */
    storage?: ReturnType<typeof Storage.makeTest>
    blurFocused?: () => void
    /** Files to reuse, to stand for reopening the app with its voice notes. */
    files?: ReturnType<typeof Native.makeMemoryFiles>
    /** The pretend audio module to use, when a test wants to set it up first. */
    audio?: Native.FakeAudio
  }> = {},
) => {
  const haptics = Haptics.makeTest()
  const clipboard = Clipboard.makeTest()
  const storage = options.storage ?? Storage.makeTest(options.stored)
  const share = Share.makeTest()
  const linking = Linking.makeTest()
  const alert = Alert.makeTest()
  const keyboard = Keyboard.makeTest(
    options.blurFocused === undefined ? {} : { blurFocused: options.blurFocused },
  )
  const appState = AppState.makeTest()
  const colorScheme = ColorScheme.makeTest()
  const network = Network.makeTest()
  const window = Window.makeTest()
  // One pretend audio module and one audio session for the recorder and the
  // player, as on the phone, and one set of files for them and the notes.
  const files = options.files ?? Native.makeMemoryFiles()
  const audio = options.audio ?? Native.makeFakeAudio({ files })
  const session = Native.makeAudioSession(audio.module, 'ios')
  const recorder = Recorder.makeTest({ audio, files, session })
  const player = Player.makeTest({ audio, session })
  const voiceNotes = VoiceNotes.makeTest({ files })
  const layer: Layer.Layer<Services> = Layer.mergeAll(
    haptics.layer,
    clipboard.layer,
    storage.layer,
    share.layer,
    linking.layer,
    alert.layer,
    keyboard.layer,
    appState.layer,
    colorScheme.layer,
    network.layer,
    window.layer,
    recorder.layer,
    player.layer,
    voiceNotes.layer,
  )
  return {
    layer,
    haptics,
    clipboard,
    storage,
    share,
    linking,
    alert,
    keyboard,
    appState,
    colorScheme,
    network,
    window,
    recorder,
    player,
    voiceNotes,
    /** The pretend audio module behind the recorder and the player. */
    audio,
    /** The pretend files behind the recorder and the notes store. */
    files,
  }
}
