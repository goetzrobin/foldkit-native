// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import { AppRegistry, Image, Platform, processColor } from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import { Runtime } from 'foldkit'

import { makeCounter } from './src/counter'
import { createNativeSurface } from './src/foldkit-native'

registerPlatformComponents(Platform.OS)

// React Native starts the app by calling this with a screen to draw on.
// React's own start-up is not used: Foldkit draws the screen.
AppRegistry.registerRunnable('main', ({ rootTag }) => {
  const surface = createNativeSurface(getFabricUIManager(), Number(rootTag), {
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    // The engine's dev checks expect ng-native's Angular components.
    dev: false,
  })
  Runtime.embed(makeCounter(surface.container))
})
