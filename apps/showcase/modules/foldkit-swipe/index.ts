/**
 * The native swipe row. This folder is a "local Expo module": native code
 * that belongs to this app and is built into it by `npx expo prebuild`.
 *
 * There is almost no JavaScript here on purpose. Foldkit talks to the
 * native view without React, from `packages/native/src/swipeNative`. These
 * two names are what that code looks the module and its view up by, kept
 * here so they sit next to the Swift and Kotlin files that declare them.
 *
 * See docs/NATIVE_VIEWS.md.
 */
export const MODULE_NAME = 'FoldkitSwipe'
export const VIEW_NAME = 'SwipeRowView'
