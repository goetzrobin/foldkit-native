/**
 * Every phone feature as one Layer, live or faked, with no Foldkit in it.
 *
 * `live(modules)` builds every service over the real native modules the app
 * passes in. `makeTest()` builds every service as a fake a test can read and
 * drive. The Foldkit side (Messages, Commands, Subscriptions) is in
 * `src/foldkit/device`, which re-exports both.
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

export {
  Alert,
  AppState,
  Clipboard,
  ColorScheme,
  Haptics,
  Keyboard,
  Linking,
  Native,
  Network,
  Player,
  Recorder,
  Share,
  Storage,
  VoiceNotes,
  Window,
}

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
