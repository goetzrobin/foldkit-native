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
  BackHandler,
  Dimensions,
  I18nManager,
  Image,
  PixelRatio,
  Platform,
  StyleSheet,
  TurboModuleRegistry,
  processColor,
} from 'react-native'
import {
  type NativeAnimated,
  getFabricUIManager,
  registerPlatformComponents,
} from '@ng-native/fabric'

// Every Tailwind class the demos use, compiled by Metro (see metro.config.js).
import sheet from './.foldkit-native/tailwind.js'
import {
  Phone,
  type DeviceSources,
  backSourceFrom,
  createNativeSurface,
  registerNavigation,
  stylingOptions,
  watchStyling,
} from './native/src'
import { registerGlass } from './native/src/glass'
import { configureKeyboardDock } from './native/src/keyboard'
import { configureSkia, registerSkia } from './native/src/skia'
import { configureWorklets } from './native/src/worklets'
import { makeDemos } from './native/test/demos'
import { startShowcase } from './native/test/demos/shell'

registerPlatformComponents(Platform.OS)
registerNavigation()

// For the object tracking demo. Skia's React components are not used and its
// package is not imported: only its native code is, found by name. Where the
// build does not have it, the demo draws with plain views and says so.
registerSkia()
configureSkia({ nativeModule: name => TurboModuleRegistry.get(name) })

// For the Glass demo. expo-glass-effect's React components are not used and
// its package is not imported: only its native views are, found by name.
// Expo Go includes them. Where a build does not have them, or the phone is
// older than iOS 26, or it is Android, the demo draws plain views and says so.
// This must run after `import 'expo'` above, which is what tells JavaScript
// the name Expo Go gives this project's views.
registerGlass()

// For the Worklets demo: code that runs on the phone's UI thread. Only
// `react-native-worklets` is loaded as JavaScript, and it imports no React.
// It is loaded the first time something asks for the UI thread, inside a
// try, because it throws where its native code is missing. Reanimated and
// gesture-handler are in package.json for their native code alone: they are
// found by name and none of their JavaScript is imported. Where a piece is
// missing the demo says which and the rest of the app is untouched.
configureWorklets({
  load: () => require('react-native-worklets'),
  nativeModule: name => TurboModuleRegistry.get(name),
})

/**
 * React Native's animation module, which can move a view on the native side
 * with no JavaScript per frame. It has no public import path, so it is asked
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

// For the keyboard dock only. With this, and react-native-keyboard-controller's
// native views in the build, the dock follows the keyboard frame by frame.
// Without either it uses its fallback. Nothing else in the app reads this.
configureKeyboardDock({ nativeAnimated: nativeAnimated() })

const device = {
  platform: Platform.OS,
  osVersion: Number.parseInt(String(Platform.Version), 10) || 0,
}

// Where the styling code reads light or dark, the window size and the text
// size. The adapter does not import react-native itself, so tests can run.
const sources: DeviceSources = {
  Appearance,
  AppState,
  Dimensions,
  I18nManager,
  PixelRatio,
  Platform,
  StyleSheet,
}

// React Native starts the app by calling this with a screen to draw on.
// React's own start-up is not used: Foldkit draws the screen.
AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const surface = createNativeSurface(getFabricUIManager(), Number(rootTag), {
    // The compiled classes, and what the phone reports right now.
    ...stylingOptions(sheet, sources),
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    // The engine's dev checks expect ng-native's Angular components.
    dev: false,
    // Experiment for the blank first screen. See createNativeSurface.
    recommitAfterFirstDraw: true,
  })
  // From here on the engine restyles by itself when the phone switches
  // between light and dark or is rotated. No Foldkit view runs for that.
  watchStyling(surface.engine, sources)
  // The phone features, backed by the real modules. The adapter never
  // imports them itself, so its tests can pass fakes.
  const phone = Phone.live({
    reactNative: ReactNative,
    haptics: ExpoHaptics,
    clipboard: ExpoClipboard,
    secureStore: SecureStore,
    network: ExpoNetwork,
    // The engine knows which text field has the focus. Without this,
    // "Hide keyboard" leaves the keyboard up.
    blurFocused: () => surface.engine.blurFocused(),
  })
  startShowcase(surface.container, device, makeDemos({ device: phone, backSource: backSourceFrom(BackHandler), rightToLeft: I18nManager.isRTL }))
})
