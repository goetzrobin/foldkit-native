// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import { AppRegistry, Image, Platform, processColor } from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'

import { type NativeSurface, createNativeSurface, registerNavigation } from './src/foldkit-native'
import { type HotModule, hotProgram } from './src/foldkit-native/devLoop'
import { makeDemo } from './src/demo'

// Metro gives every file a `module`. In a development bundle it has `hot`.
declare const module: HotModule

registerPlatformComponents(Platform.OS)
registerNavigation()

const device = {
  platform: Platform.OS,
  osVersion: Number.parseInt(String(Platform.Version), 10) || 0,
}

// The screen the phone gave the app. It is kept on a global because a hot
// update runs this file again, and the screen is from before that.
const host = globalThis as { __devLoopSurface?: NativeSurface }

// This app has no menu to go back to, so Exit starts the demo from scratch.
const exit = (): void => {
  const surface = host.__devLoopSurface
  if (surface === undefined) return
  void program.dispose().then(() => program.run(surface))
}

// Must stay at the top level. A save makes Metro run this file again, and
// this call is what swaps the running program for the new code. `module` is
// Metro's object for this file: passing it stops the hot update here, so the
// app is not reloaded and the Model survives.
const program = hotProgram({
  module,
  make: container => makeDemo(container, { device, exit }),
})

// React Native starts the app by calling this with a screen to draw on.
// React's own start-up is not used: Foldkit draws the screen.
AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const surface = createNativeSurface(getFabricUIManager(), Number(rootTag), {
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    // The engine's dev checks expect ng-native's Angular components.
    dev: false,
    // Experiment for the blank first screen. See createNativeSurface.
    recommitAfterFirstDraw: true,
  })
  host.__devLoopSurface = surface
  program.run(surface)
})
