// Runs the lists and motion demo by itself, to prove it builds for a phone.
// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import { AppRegistry, Image, Platform, processColor } from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import { Runtime } from 'foldkit'

import { createNativeSurface, registerNavigation } from './src/foldkit-native'
import { makeDemo } from './src/demos/lists'

registerPlatformComponents(Platform.OS)
registerNavigation()

// EXPERIMENT, off by default. With this on, fades and slides are played by
// React Native's own animation driver on the phone's UI thread, and
// JavaScript commits only the start and the end. Checked on the simulated
// phone only. Turn it on to compare smoothness on a real one.
const USE_NATIVE_ANIMATION_DRIVER = false

const nativeAnimated = (): unknown => {
  if (!USE_NATIVE_ANIMATION_DRIVER) return undefined
  try {
    // The same module ng-native hands its engine.
    return require('react-native/src/private/animated/NativeAnimatedHelper').default
  } catch {
    return undefined
  }
}

const device = {
  platform: Platform.OS,
  osVersion: Number.parseInt(String(Platform.Version), 10) || 0,
}

// React Native starts the app by calling this with a screen to draw on.
// React's own start-up is not used: Foldkit draws the screen.
AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const surface = createNativeSurface(getFabricUIManager(), Number(rootTag), {
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    // The engine's dev checks expect ng-native's Angular components.
    dev: false,
    recommitAfterFirstDraw: true,
    nativeAnimated: nativeAnimated() as never,
  })
  // This app has no menu to go back to, so Exit does nothing here.
  Runtime.embed(makeDemo(surface.container, { device, exit: () => {} }))
})
