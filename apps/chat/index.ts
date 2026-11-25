// Fold Chat's start-up. React Native calls `main` with a screen to draw on,
// and the Foldkit program in native/flagship draws it. React draws nothing.
//
// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import * as ExpoClipboard from 'expo-clipboard'
import * as ExpoHaptics from 'expo-haptics'
import * as ExpoNetwork from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import * as ReactNative from 'react-native'
import {
  AppRegistry,
  AppState,
  Appearance,
  Dimensions,
  I18nManager,
  Image,
  PixelRatio,
  Platform,
  StyleSheet,
  TurboModuleRegistry,
  processColor,
} from 'react-native'
import { type NativeAnimated, getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import { Layer } from 'effect'
import remend from 'remend'

// The compiled Tailwind classes (see metro.config.js). Fold Chat draws with
// its own colour tokens, but the engine is set up as in the showcase.
import sheet from './.foldkit-native/tailwind.js'
import {
  Phone,
  type DeviceSources,
  createNativeSurface,
  registerNavigation,
  stylingOptions,
  watchStyling,
} from './native/src'
import { registerExpoUi } from './native/src/controls'
import { registerGlass } from './native/src/glass'
import { configureKeyboardDock } from './native/src/keyboard'
import { configureMarkdown } from './native/src/markdown'
import { ActionSheet, configureSheets } from './native/src/menus'
import { registerSearchBar } from './native/src/foldkit/navigation/searchBar'
import { configureSkia, registerSkia } from './native/src/skia'
import { registerNativeSwipe } from './native/src/swipeNative'
import { configureWorklets } from './native/src/worklets'
import { startChatApp } from './native/flagship/start'
import { appearanceLive } from './native/flagship/appearance'

registerPlatformComponents(Platform.OS)
registerNavigation()
registerSearchBar()

// The "Thinking" shimmer. Only Skia's native code is used, found by name.
registerSkia()
configureSkia({ nativeModule: name => TurboModuleRegistry.get(name) })

// The composer's Liquid Glass (iOS 26 and later). expo-glass-effect's native
// views are found by name; elsewhere the composer is a plain pale pill. This
// and the next must run after `import 'expo'`.
registerGlass()

// The menus (press and hold a chat in the list) and the switches and
// segments in Settings: Expo UI's SwiftUI and Compose views, by name.
registerExpoUi()
// The action sheet a held message opens: React Native's own native modules.
configureSheets({ nativeModule: name => TurboModuleRegistry.get(name) })

// The project's own native swipe view, if a build includes its module (it
// is left out for now: see README.md). Without it nothing changes.
registerNativeSwipe()

// The swipe rows' UI-thread driver. react-native-worklets is loaded on first
// use, inside a try: it throws where its native code is missing, and the
// rows then move from JavaScript.
configureWorklets({
  load: () => require('react-native-worklets'),
  nativeModule: name => TurboModuleRegistry.get(name),
})

/**
 * React Native's animation module, which moves the composer with the
 * keyboard on the native side. It has no public import path, so it is asked
 * for by file and anything going wrong means "not available".
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

// The composer follows the keyboard frame by frame, and the transcript makes
// room by scrolling ("inset"), with react-native-keyboard-controller's native
// views in the build.
configureKeyboardDock({ nativeAnimated: nativeAnimated() })

// Replies are drawn by react-native-enriched-markdown's native view, found by
// name. remend finishes half-written Markdown while a reply streams in.
configureMarkdown({ remend })

const device = {
  platform: Platform.OS,
  osVersion: Number.parseInt(String(Platform.Version), 10) || 0,
}

const sources: DeviceSources = {
  Appearance,
  AppState,
  Dimensions,
  I18nManager,
  PixelRatio,
  Platform,
  StyleSheet,
}

/**
 * The splash screen hides itself when the first screen is drawn. Our first
 * draw does not come through React, so it is told directly as well, once
 * the first screen is on its way. Missing module: nothing to hide.
 */
const hideSplash = (): void => {
  try {
    const expo = (globalThis as { expo?: { modules?: Record<string, { hide?: () => void; hideAsync?: () => Promise<void> } | undefined> } }).expo
    const splash = expo?.modules?.['ExpoSplashScreen']
    if (splash?.hide !== undefined) splash.hide()
    else void splash?.hideAsync?.()
  } catch {
    // The splash goes by itself in the end.
  }
}

AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const surface = createNativeSurface(getFabricUIManager(), Number(rootTag), {
    ...stylingOptions(sheet, sources),
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    dev: false,
    recommitAfterFirstDraw: true,
  })
  // The app has its own theme switch, so the engine is not told to follow
  // the phone's dark mode with a class: the program picks the colours.
  watchStyling(surface.engine, sources, { darkClass: false })
  const phone = Phone.live({
    reactNative: ReactNative,
    haptics: ExpoHaptics,
    clipboard: ExpoClipboard,
    secureStore: SecureStore,
    network: ExpoNetwork,
    blurFocused: () => surface.engine.blurFocused(),
    // Voice notes: expo-audio's and expo-file-system's native modules, by name.
    audio: Phone.Native.audioModuleFromGlobal(),
    fileSystem: Phone.Native.fileSystemFromGlobal(),
  })
  const resources = Layer.mergeAll(phone, ActionSheet.live(), appearanceLive(Appearance))
  // The crash screen's Reload starts the program again here; Copy puts the
  // error on the clipboard, to paste into a message.
  startChatApp(surface.container, { device }, resources, {
    copy: text => void ExpoClipboard.setStringAsync(text).catch(() => undefined),
  })
  setTimeout(hideSplash, 50)
})
