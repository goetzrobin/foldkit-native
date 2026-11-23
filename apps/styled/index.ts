// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
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
  processColor,
} from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import { Runtime } from 'foldkit'

// Every Tailwind class the app uses, compiled by Metro (see metro.config.js).
import sheet from './.foldkit-native/tailwind.js'
import { createNativeSurface, registerNavigation } from './src/foldkit-native'
import { type DeviceSources, stylingOptions, watchStyling } from './src/foldkit-native/styling'
import { makeDemo } from './src/demos/styling'

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
  // between light and dark or is rotated. The Foldkit view does not run.
  watchStyling(surface.engine, sources)

  // This app has one screen and no menu to go back to. Exit closes the app
  // on Android. iOS has no way for an app to close itself.
  const exit = (): void => {
    if (Platform.OS === 'android') BackHandler.exitApp()
  }
  Runtime.embed(makeDemo(surface.container, { device, exit }))
})
