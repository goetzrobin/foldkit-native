// The phone features demo on a real phone. This file is the only place the
// real native modules are imported: it builds the live Layers from them and
// hands those to the demo, which is the same program the tests run on fakes.
//
// Every module here is included in Expo Go, so no custom native build is
// needed: react-native itself, expo-haptics, expo-clipboard,
// expo-secure-store and expo-network.
//
// `src/demo.ts` is a copy of `packages/native/test/demos/device.ts` with its
// two import paths pointed at `./foldkit-native`. `src/foldkit-native` is
// written by `scripts/sync-apps.sh`. Edit the originals, not the copies.

// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import * as ExpoClipboard from 'expo-clipboard'
import * as ExpoHaptics from 'expo-haptics'
import * as ExpoNetwork from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import * as ReactNative from 'react-native'
import { AppRegistry, Image, Platform, processColor } from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import { Runtime } from 'foldkit'

import { makeDemo } from './src/demo'
import { createNativeSurface, registerNavigation } from './src/foldkit-native'
import * as Device from './src/foldkit-native/device'

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
  const resources = Device.live({
    reactNative: ReactNative,
    haptics: ExpoHaptics,
    clipboard: ExpoClipboard,
    secureStore: SecureStore,
    network: ExpoNetwork,
    // The engine knows which text field has the focus. Without this,
    // "Hide keyboard" leaves the keyboard up.
    blurFocused: () => surface.engine.blurFocused(),
  })
  Runtime.embed(makeDemo(surface.container, { device, exit: () => {} }, resources))
})
