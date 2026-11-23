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
  processColor,
} from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'

// Every Tailwind class the demos use, compiled by Metro (see metro.config.js).
import sheet from './.foldkit-native/tailwind.js'
import {
  Phone,
  type DeviceSources,
  createNativeSurface,
  registerNavigation,
  stylingOptions,
  watchStyling,
} from './native/src'
import { makeDemos } from './native/test/demos'
import { startShowcase } from './native/test/demos/shell'

registerPlatformComponents(Platform.OS)
registerNavigation()

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
  startShowcase(surface.container, device, makeDemos({ device: phone }))
})
