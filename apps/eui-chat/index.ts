// Effect Chat's start-up. React Native calls `main` with a screen to draw on,
// and the Effect UI program in native/effect-ui-native/chat draws it. React
// draws nothing.
//
// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import * as ExpoClipboard from 'expo-clipboard'
import * as ExpoHaptics from 'expo-haptics'
import * as ExpoNetwork from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import * as ReactNative from 'react-native'
import { AppRegistry, Image, Platform, TurboModuleRegistry, processColor } from 'react-native'
import { type NativeAnimated, getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import type { Layer } from 'effect'
import remend from 'remend'

import { configureWorklets } from './native/native/src/host/worklets'
import { KeyboardBar, Menus, NativeViews, Phone } from './native/effect-ui-native/src'
import { phoneDisk, startChat } from './native/effect-ui-native/chat/start'

registerPlatformComponents(Platform.OS)

// Replies are drawn by react-native-enriched-markdown's native view, found by
// name. remend finishes half-written Markdown while a reply streams in.
NativeViews.configureMarkdown({ remend })

/**
 * React Native's animation module. With it, the phone moves the composer
 * with the keyboard on the native side. It has no public import path, so it
 * is asked for by its file. Missing: the composer is padded up from
 * JavaScript, and the numbers strip says so.
 */
const nativeAnimated = (): NativeAnimated | null => {
  try {
    const helper = require('react-native/src/private/animated/NativeAnimatedHelper').default as
      | (NativeAnimated & { assertNativeAnimatedModule: () => void })
      | undefined
    if (helper === undefined) return null
    helper.assertNativeAnimatedModule()
    return helper
  } catch {
    return null
  }
}

// The composer travels with the keyboard frame by frame, and the transcript
// makes room by scrolling, with react-native-keyboard-controller's native
// view where the build has it (iPhone).
KeyboardBar.configure({ nativeAnimated: nativeAnimated() })

// The composer's Liquid Glass (iOS 26 and later). expo-glass-effect's native
// views are found by name. Elsewhere the composer is a plain pale pill. This
// must run after `import 'expo'`.
NativeViews.registerGlass()

// The "Thinking" shimmer. Only Skia's native code is used, found by name.
NativeViews.configureSkia({ nativeModule: name => TurboModuleRegistry.get(name) })

// The list of choices a held message opens: React Native's own native modules.
Menus.configure({ nativeModule: name => TurboModuleRegistry.get(name) })

// The phone's own long press on a message (gesture-handler), with the host's
// timer as its backup. react-native-worklets is loaded on first use, inside a
// try: where its native code is missing, the timer alone reads a hold.
configureWorklets({
  load: () => require('react-native-worklets'),
  nativeModule: name => TurboModuleRegistry.get(name),
})

/**
 * The splash screen hides itself when the first screen is drawn. Our first
 * draw does not come through React, so it is told directly as well, once the
 * first screen is on its way. Missing module: nothing to hide.
 */
const hideSplash = (): void => {
  try {
    const expo = (
      globalThis as {
        expo?: { modules?: Record<string, { hide?: () => void; hideAsync?: () => Promise<void> } | undefined> }
      }
    ).expo
    const splash = expo?.modules?.['ExpoSplashScreen']
    if (splash?.hide !== undefined) splash.hide()
    else void splash?.hideAsync?.()
  } catch {
    // The splash goes by itself in the end.
  }
}

/**
 * Development builds only: Effect UI's dev tools. The app sends its message
 * log to the dev tools server on the Mac (`npm run devtools`), which shows
 * it on a page in a browser. The Mac's address is the one this build loaded
 * its code from, as React Native keeps it. A release build has no such
 * address, and this whole block is left out of it. See docs/DEV_TOOLS.md.
 */
let devTools: Layer.Layer<never> | undefined
if (__DEV__) {
  try {
    const NativeDevTools = require('./native/effect-ui-native/src/NativeDevTools') as typeof import('./native/effect-ui-native/src/NativeDevTools')
    const source = TurboModuleRegistry.get('SourceCode') as { getConstants?: () => { scriptURL?: string } } | null
    const server = NativeDevTools.serverFromBundle(source?.getConstants?.().scriptURL)
    if (server !== undefined) devTools = NativeDevTools.layer({ server })
  } catch {
    // No dev tools in this build. The app runs as it always does.
  }
}

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  let blurFocused = (): void => {}
  startChat({
    fabric: getFabricUIManager(),
    rootTag: Number(rootTag),
    platform: Platform.OS,
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    dev: false,
    // The first launch of a build once came up blank until a second commit. See docs/BRIEF.md.
    recommitAfterFirstDraw: true,
    onSurface: surface => {
      blurFocused = () => surface.engine.blurFocused()
    },
    // The chats are kept in the app's documents, so they are still there after the app closes.
    disk: phoneDisk(),
    ...(devTools === undefined ? {} : { devTools }),
    device: Phone.Device.live({
      reactNative: ReactNative,
      haptics: ExpoHaptics,
      clipboard: ExpoClipboard,
      secureStore: SecureStore,
      network: ExpoNetwork,
      blurFocused: () => blurFocused(),
      // Voice notes: expo-audio's and expo-file-system's native modules, by name.
      audio: Phone.Device.Native.audioModuleFromGlobal(),
      fileSystem: Phone.Device.Native.fileSystemFromGlobal(),
      // Speech recognition: expo-speech-recognition's native module, by name.
      // A build made before it was added has none, and the app says so when
      // the microphone button is pressed.
      speech: Phone.Device.Speech.moduleFromGlobal(),
    }),
  })
  setTimeout(hideSplash, 50)
})
