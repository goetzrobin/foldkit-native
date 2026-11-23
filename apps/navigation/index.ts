// The navigation demo as an app of its own: tabs, stacks, modals, sheets,
// navigation bar options and Android's Back button.
//
// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import { AppRegistry, BackHandler, Image, Platform, processColor } from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import { Runtime } from 'foldkit'

import { createNativeSurface, registerNavigation } from './src/foldkit-native'
import { backSourceFrom } from './src/foldkit-native/navigation'
import { makeDemo } from './src/demo'

registerPlatformComponents(Platform.OS)
registerNavigation()

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
    // Experiment for the blank first screen. See createNativeSurface.
    recommitAfterFirstDraw: true,
  })
  Runtime.embed(
    makeDemo(surface.container, {
      device,
      // This app is the demo alone, so there is no menu to go back to.
      exit: () => {},
      // The adapter does not import react-native. The app hands the Back button in.
      backSource: backSourceFrom(BackHandler),
    }),
  )
})
