/**
 * Which way the keyboard dock works in this build of the app.
 *
 * There are two ways:
 *
 * - `native`: the phone moves the bar itself, on every frame of the
 *   keyboard's movement, including while a finger drags the keyboard down.
 *   No JavaScript runs per frame.
 * - `fallback`: the program hears the keyboard's height once, as it starts to
 *   move, and the bar eases to its new place on a timer.
 *
 * `native` needs three things, and this file checks all three:
 *
 * 1. An iPhone or iPad. Android always uses the fallback (see `dock.ts`).
 * 2. react-native-keyboard-controller's native half in the build. None of its
 *    JavaScript is used, so it is looked for by asking React Native for its
 *    native module by name, which answers nothing when it is not there.
 * 3. An engine that was given React Native's animation module
 *    (`nativeAnimated` in `createNativeSurface`), which is what moves a view
 *    on the native side.
 *
 * Nothing here throws when a piece is missing: the answer is `fallback`.
 */
import { nativePlatform } from '@ng-native/fabric'

export type KeyboardDockMode = 'native' | 'fallback'

/** The name react-native-keyboard-controller registers its native module by. */
const CONTROLLER_MODULE = 'KeyboardController'

type Host = {
  __turboModuleProxy?: (name: string) => unknown
  nativeModuleProxy?: Record<string, unknown>
}

/** Whether this build has react-native-keyboard-controller's native half. */
const detectController = (): boolean => {
  try {
    const host = globalThis as Host
    const found =
      host.__turboModuleProxy?.(CONTROLLER_MODULE) ?? host.nativeModuleProxy?.[CONTROLLER_MODULE]
    return found !== undefined && found !== null
  } catch {
    return false
  }
}

export type KeyboardDockOptions = Readonly<{
  /**
   * `true` or `false` says whether react-native-keyboard-controller's native
   * views are in this build, without looking. `false` is how to force the
   * fallback. `'detect'` (the default) looks for them.
   */
  controller?: boolean | 'detect'
}>

let controller: boolean | 'detect' = 'detect'
let detected: boolean | undefined
/** Whether the engine of the surface now on screen can move views natively. */
let engineDrives = false

/**
 * Optional. Call at startup, before the first draw, to say whether the
 * native views are there instead of having the dock look for them.
 */
export const configureKeyboardDock = (options: KeyboardDockOptions): void => {
  if (options.controller !== undefined) controller = options.controller
}

/** Called by the dock's module when a surface is created. */
export const noteEngine = (drives: boolean): void => {
  engineDrives = drives
}

const hasController = (): boolean => {
  if (controller !== 'detect') return controller
  // Asked once: a build does not gain or lose a native module while it runs.
  if (detected === undefined) detected = detectController()
  return detected
}

const platform = (): string => {
  try {
    return String(nativePlatform())
  } catch {
    return 'unknown'
  }
}

/**
 * Why the dock is in the mode it is in, in words a person can read on the
 * phone. Empty when the mode is `native`.
 */
export const keyboardDockFallbackReason = (): string => {
  if (platform() !== 'ios') return 'native following is built for iOS only'
  if (!hasController()) return 'react-native-keyboard-controller is not in this build'
  if (!engineDrives) return 'the app did not pass nativeAnimated to createNativeSurface'
  return ''
}

/** The mode every `keyboardDock` in this app uses. It does not change while the app runs. */
export const keyboardDockMode = (): KeyboardDockMode =>
  keyboardDockFallbackReason() === '' ? 'native' : 'fallback'
