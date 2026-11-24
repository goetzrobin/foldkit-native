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
import * as Alert from './alert.js'
import * as Native from '../../host/device/audioNative.js'
import * as AppState from './appState.js'
import * as Clipboard from './clipboard.js'
import * as ColorScheme from './colorScheme.js'
import * as Haptics from './haptics.js'
import * as Keyboard from './keyboard.js'
import * as Linking from './linking.js'
import * as Network from './network.js'
import * as Player from './player.js'
import * as Recorder from './recorder.js'
import * as Share from './share.js'
import * as Storage from './storage.js'
import * as VoiceNotes from './voiceNotes.js'
import * as Window from './window.js'

export { DeviceError, makeTestSource, streamOf } from '../../host/device/common.js'
export type { Source, TestSource } from '../../host/device/common.js'

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

export { live, makeTest } from '../../host/device/index.js'
export type { LiveModules, Services } from '../../host/device/index.js'
