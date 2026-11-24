/**
 * Whether a chat can keep clear of the keyboard with a bottom inset, the way
 * react-native-keyboard-controller's `KeyboardChatScrollView` does, and why
 * not when it cannot.
 *
 * WHAT THE INSET WAY IS. The list of messages is never resized. It runs the
 * whole height of the screen area, under the composer and under the
 * keyboard. Its scroll view is told how much of its bottom is covered
 * (`contentInset.bottom` on iOS), which only changes how far it can scroll.
 * When the keyboard starts to move the list is told ONCE where to scroll to,
 * and the phone glides there. The composer lies over the bottom of the list
 * and the phone moves it with the keyboard (`../keyboard/dock.ts`).
 *
 * Nothing is laid out again while the keyboard moves, no view carries a
 * transform at rest, and no JavaScript runs per frame.
 *
 * WHO DOES WHAT.
 *
 *   list(h, { id: 'messages', keyboardInset: { lift: 'whenAtEnd' }, ... })
 *   composerDock(h, { mode: 'inset', listId: 'messages', above: [...], ... })
 *
 * - `composerDock` in `'inset'` mode draws the composer over the list and
 *   hears the keyboard from react-native-keyboard-controller's native view.
 *   It passes each report on to the list by its id.
 * - The list (`../list/module.ts`) owns the inset and the scroll position.
 *   The arithmetic is the library's own (`./vendor/kbc`).
 *
 * WHAT IT NEEDS. The same three things as native following (see
 * `../keyboard/detect.ts`): an iPhone or iPad, the library's native half in
 * the build, and React Native's animation module handed to
 * `configureKeyboardDock`. `contentInset` is an iOS prop of React Native's
 * own scroll view, so nothing more is needed there.
 *
 * Android is left out. React Native's Android scroll view has no content
 * inset. The library adds one with a native view of its own
 * (`ClippingScrollViewDecoratorView`) and then scrolls on every frame of the
 * keyboard's movement from the UI thread, which needs Reanimated. Without
 * the inset way, `'inset'` behaves as `'follow'` does.
 */
import { keyboardDockFallbackReason } from '../keyboard/detect.js'

/**
 * Why the inset way is not used on this phone, in words a person can read on
 * the phone. Empty when it is used.
 */
export const chatInsetFallbackReason = (): string => keyboardDockFallbackReason()

/** Whether `keyboardInset` on a list and `'inset'` on a `composerDock` take effect. */
export const chatInsetAvailable = (): boolean => chatInsetFallbackReason() === ''
