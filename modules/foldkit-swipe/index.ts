/**
 * The native swipe row. This folder is a "local Expo module": native code
 * that is built into an app by `npx expo prebuild`. It is shared: the
 * showcase app and Effect Chat both name this folder's parent in their
 * `package.json` (`expo.autolinking.nativeModulesDir`).
 *
 * There is almost no JavaScript here on purpose. Foldkit talks to the
 * native view without React, from `packages/native/src/swipeNative`, and
 * Effect UI from `packages/effect-ui-native/src/NativeViews.ts`. These two
 * names are what that code looks the module and its view up by, kept here
 * so they sit next to the Swift and Kotlin files that declare them.
 *
 * See docs/NATIVE_VIEWS.md.
 */
export const MODULE_NAME = 'FoldkitSwipe'
export const VIEW_NAME = 'SwipeRowView'
