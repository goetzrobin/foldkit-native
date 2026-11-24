/**
 * A bar that follows the keyboard, for a chat's composer.
 *
 *   keyboardDock(h, { keyboardHeight, children, above?, offset?, backgroundColor? })
 *   dismissKeyboardOnDrag()   an attribute for the scroll view above the bar
 *   keyboardDockMode()        'native' or 'fallback', the same for the whole app
 *
 * `dock.ts` explains the two modes and `detect.ts` how one is chosen.
 */
export { dismissKeyboardOnDrag, keyboardDock } from './dock.js'
export type { KeyboardDock } from './dock.js'
export {
  configureKeyboardDock,
  forceKeyboardDockFallback,
  keyboardDockFallbackReason,
  keyboardDockMode,
} from './detect.js'
export type { KeyboardDockMode, KeyboardDockOptions } from './detect.js'
