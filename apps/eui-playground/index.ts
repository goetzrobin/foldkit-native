// The Effect UI playground's start-up. React Native calls `main` with a
// screen to draw on, and the Effect UI program in native/effect-ui-native
// draws it. React draws nothing.
//
// Expo's runtime setup. Nothing else imports it, so it is imported here.
import 'expo'
import * as ExpoClipboard from 'expo-clipboard'
import * as ExpoHaptics from 'expo-haptics'
import * as ReactNative from 'react-native'
import { AppRegistry, Image, Platform, TurboModuleRegistry, processColor } from 'react-native'
import { getFabricUIManager, registerPlatformComponents } from '@ng-native/fabric'
import type { Layer } from 'effect'

import { configureWorklets } from './native/native/src/host/worklets'
import { Phone } from './native/effect-ui-native/src'
import { startPlayground } from './native/effect-ui-native/playground/start'

registerPlatformComponents(Platform.OS)

// For a Mount that attaches the phone's own long press (`NativeMount.TrackHold`).
// react-native-worklets is loaded on first use, inside a try: where its native
// code is missing, the Mount says "unavailable" and nothing else changes.
configureWorklets({
  load: () => require('react-native-worklets'),
  nativeModule: name => TurboModuleRegistry.get(name),
})

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
  startPlayground({
    fabric: getFabricUIManager(),
    rootTag: Number(rootTag),
    platform: Platform.OS,
    processColor: processColor as never,
    resolveAssetSource: value => Image.resolveAssetSource(value as never),
    dev: false,
    // The first launch of a build once came up blank until a second commit. See docs/BRIEF.md.
    recommitAfterFirstDraw: true,
    ...(devTools === undefined ? {} : { devTools }),
    onSurface: surface => {
      blurFocused = () => surface.engine.blurFocused()
    },
    device: Phone.live({
      reactNative: ReactNative,
      haptics: ExpoHaptics,
      clipboard: ExpoClipboard,
      blurFocused: () => blurFocused(),
    }),
  })
})
