/**
 * Whether this build of the app has the native swipe row, and why not when
 * it does not.
 *
 * The swipe row is this project's own native view. Its Swift and Kotlin code
 * lives in `apps/showcase/modules/foldkit-swipe`. That code is only inside
 * an app you build yourself (`npx expo run:ios`). Expo Go is a ready-made
 * app, so it cannot contain it.
 *
 * Expo keeps what a build contains in one place, and this file reads it:
 *
 * - `globalThis.expo.modules.FoldkitSwipe` is the native module.
 * - `globalThis.expo.getViewConfig('FoldkitSwipe', 'SwipeRowView')`
 *   describes the native view, and answers nothing where it is missing.
 *
 * Nothing in this file throws. A missing piece means "not present", with a
 * reason a person can read on the phone.
 */

/** The name the native module is registered by (see the Swift and Kotlin files). */
export const SWIPE_MODULE = 'FoldkitSwipe'
/** The module's native view. */
export const SWIPE_VIEW = 'SwipeRowView'

/** The part of the native module this project calls. */
export type SwipeModule = Readonly<{
  closeAll?: (group: string) => unknown
}>

/** The part of Expo's global object this file reads. */
export type SwipeExpoGlobal = Readonly<{
  /** Expo Go's name for the project that is running. Empty in an app built on its own. */
  __expo_app_identifier__?: string
  modules?: Readonly<Record<string, unknown>>
  getViewConfig?: (moduleName: string, viewName?: string) => unknown
}>

export type NativeSwipeOptions = Readonly<{
  /**
   * `true` or `false` says whether the native view is there, without
   * looking. `false` switches every row to its plain fallback. `'detect'`
   * (the default) looks.
   */
  available?: boolean | 'detect'
  /**
   * Expo's global object, in place of `globalThis.expo`. Tests pass a
   * stand-in. `null` says Expo is not there.
   */
  expo?: SwipeExpoGlobal | null | 'global'
}>

type Found = Readonly<{ isAvailable: boolean; reason: string }>

let given: boolean | 'detect' = 'detect'
let expoSource: SwipeExpoGlobal | null | 'global' = 'global'
let found: Found | undefined
let isRegistered = false

/** Optional. Call at startup, before the first draw. */
export const configureNativeSwipe = (options: NativeSwipeOptions): void => {
  if (options.available !== undefined) given = options.available
  if (options.expo !== undefined) expoSource = options.expo
  found = undefined
}

/** Back to the state before `registerNativeSwipe` and `configureNativeSwipe`. For tests. */
export const resetNativeSwipeDetection = (): void => {
  given = 'detect'
  expoSource = 'global'
  found = undefined
  isRegistered = false
}

/** Expo's global object, or undefined where there is none. */
export const swipeExpoGlobal = (): SwipeExpoGlobal | undefined => {
  if (expoSource !== 'global') return expoSource ?? undefined
  const expo = (globalThis as { expo?: SwipeExpoGlobal | null }).expo
  return expo === null || expo === undefined ? undefined : expo
}

/** Called by `registerNativeSwipe`. Until then every row is its fallback. */
export const noteNativeSwipeRegistered = (): void => {
  isRegistered = true
  found = undefined
}

/** The native module, or undefined where the build does not have it. Never throws. */
export const swipeModule = (): SwipeModule | undefined => {
  try {
    const module = swipeExpoGlobal()?.modules?.[SWIPE_MODULE]
    return module === undefined || module === null ? undefined : (module as SwipeModule)
  } catch {
    return undefined
  }
}

/** Said wherever the native code is missing. The demo and the docs use the same words. */
export const NEEDS_PREBUILT = 'needs the prebuilt app, see docs/NATIVE_VIEWS.md'

const detect = (): Found => {
  const no = (reason: string): Found => ({ isAvailable: false, reason })
  try {
    if (!isRegistered) return no('the app did not call registerNativeSwipe()')
    const expo = swipeExpoGlobal()
    if (expo === undefined) return no(NEEDS_PREBUILT)
    const module = expo.modules?.[SWIPE_MODULE]
    if (module === undefined || module === null) return no(NEEDS_PREBUILT)
    if (typeof expo.getViewConfig === 'function') {
      const config = expo.getViewConfig(SWIPE_MODULE, SWIPE_VIEW)
      if (config === undefined || config === null) {
        return no(`the native view ${SWIPE_VIEW} is missing from this build`)
      }
    }
    return { isAvailable: true, reason: '' }
  } catch (error) {
    return no(
      `looking for the native view failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

const resolved = (): Found => {
  if (given !== 'detect') {
    return { isAvailable: given, reason: given ? '' : 'switched off by the app' }
  }
  // Asked once: a build does not gain or lose native code while it runs.
  if (found === undefined) found = detect()
  return found
}

/** Whether `nativeSwipeRow` draws the real native view in this build. Never throws. */
export const isNativeSwipeAvailable = (): boolean => resolved().isAvailable

/** Why the native view is not there, in plain words. Empty when it is. */
export const nativeSwipeUnavailableReason = (): string => resolved().reason

/** One line for a screen: "Native view: present" or why not. */
export const nativeSwipeStatus = (): string =>
  isNativeSwipeAvailable()
    ? 'Native view: present'
    : `Native view: not present: ${nativeSwipeUnavailableReason()}`
