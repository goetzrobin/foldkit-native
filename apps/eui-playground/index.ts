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

import { configureWorklets } from './native/native/src/host/worklets'
import { Motion, Phone } from './native/effect-ui-native/src'
import { startPlayground } from './native/effect-ui-native/playground/start'

registerPlatformComponents(Platform.OS)

// For a Mount that attaches the phone's own long press (`NativeMount.TrackHold`).
// react-native-worklets is loaded on first use, inside a try: where its native
// code is missing, the Mount says "unavailable" and nothing else changes.
configureWorklets({
  load: () => require('react-native-worklets'),
  nativeModule: name => TurboModuleRegistry.get(name),
})

// The Motion screen: animations run on the phone's own thread through the
// worklets above. With the phone's Reduce Motion setting on, nothing moves
// and only a short fade is left.
Motion.configure({ accessibilityInfo: ReactNative.AccessibilityInfo })

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
