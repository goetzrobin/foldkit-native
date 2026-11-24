/**
 * Whether this build of the app can draw Liquid Glass, and why not when it
 * cannot.
 *
 * Liquid Glass is the see-through material of iOS 26 and later. Expo ships
 * it as the package `expo-glass-effect`, and Expo Go includes its native
 * code. The package's JavaScript is two React components and two small
 * functions. This project uses none of it. It reads the same things the
 * package reads, from where Expo keeps them:
 *
 * - `globalThis.expo.modules.ExpoGlassEffect` is the native module. It has
 *   two yes/no values, worked out on the phone when the app starts:
 *   `isLiquidGlassAvailable` (iOS 26 or later, and the app has not asked for
 *   the old look) and `isGlassEffectAPIAvailable` (the phone really has the
 *   class that draws glass, which some early iOS 26 betas did not).
 * - `globalThis.expo.getViewConfig(module, view)` describes one of a
 *   module's native views, and answers nothing for a view that is not there.
 *
 * Android has no such module (the package is for Apple's systems only), so
 * the answer there is always "not available".
 *
 * Nothing in this file throws. A missing piece means "not available", with
 * a reason a person can read on the phone.
 */
import { nativePlatform } from '@ng-native/fabric'

/** The name Expo's native module is registered by. */
export const GLASS_MODULE = 'ExpoGlassEffect'
/** The module's two native views. */
export const GLASS_VIEW = 'GlassView'
export const GLASS_CONTAINER_VIEW = 'GlassContainer'

type GlassModule = Readonly<{
  isLiquidGlassAvailable?: unknown
  isGlassEffectAPIAvailable?: unknown
}>

/** The part of Expo's global object this file reads. */
export type ExpoGlobal = Readonly<{
  /** Expo Go's name for the project that is running. Empty in an app built on its own. */
  __expo_app_identifier__?: string
  modules?: Readonly<Record<string, unknown>>
  getViewConfig?: (moduleName: string, viewName?: string) => unknown
}>

export type GlassOptions = Readonly<{
  /**
   * `true` or `false` says whether Liquid Glass is there, without looking.
   * `false` is how an app switches every glass view to its fallback.
   * `'detect'` (the default) looks.
   */
  available?: boolean | 'detect'
  /**
   * Expo's global object, in place of `globalThis.expo`. Tests pass a
   * stand-in. `null` says Expo is not there.
   */
  expo?: ExpoGlobal | null | 'global'
}>

let given: boolean | 'detect' = 'detect'
let expoSource: ExpoGlobal | null | 'global' = 'global'
let found: { isAvailable: boolean; reason: string } | undefined
let isRegistered = false

/** Optional. Call at startup, before the first draw. */
export const configureGlass = (options: GlassOptions): void => {
  if (options.available !== undefined) given = options.available
  if (options.expo !== undefined) expoSource = options.expo
  found = undefined
}

/** Back to the state before `registerGlass` and `configureGlass`. For tests. */
export const resetGlass = (): void => {
  given = 'detect'
  expoSource = 'global'
  found = undefined
  isRegistered = false
}

/** Expo's global object, or undefined where there is none. */
export const expoGlobal = (): ExpoGlobal | undefined => {
  if (expoSource !== 'global') return expoSource ?? undefined
  const expo = (globalThis as { expo?: ExpoGlobal | null }).expo
  return expo === null || expo === undefined ? undefined : expo
}

/** Called by `registerGlass`. Until then every glass view is its fallback. */
export const noteRegistered = (): void => {
  isRegistered = true
  found = undefined
}

const platform = (): string => {
  try {
    return String(nativePlatform())
  } catch {
    return 'unknown'
  }
}

const NOT_IN_BUILD = "expo-glass-effect's native code is not in this build"

const detect = (): { isAvailable: boolean; reason: string } => {
  const no = (reason: string) => ({ isAvailable: false, reason })
  try {
    if (!isRegistered) return no('the app did not call registerGlass()')
    const isAndroid = platform() === 'android'
    const expo = expoGlobal()
    if (expo === undefined) {
      return no(isAndroid ? 'Android has no Liquid Glass' : "Expo's native modules are not in this build")
    }
    const module = expo.modules?.[GLASS_MODULE] as GlassModule | null | undefined
    if (module === undefined || module === null) {
      return no(isAndroid ? 'Android has no Liquid Glass' : NOT_IN_BUILD)
    }
    // Asked first: it is the one that guards against a crash.
    if (module.isGlassEffectAPIAvailable === false) {
      return no('this version of iOS cannot draw Liquid Glass (it needs iOS 26 or later)')
    }
    if (module.isLiquidGlassAvailable !== true) {
      return no('Liquid Glass is off for this app, or iOS is older than 26')
    }
    if (typeof expo.getViewConfig === 'function') {
      for (const view of [GLASS_VIEW, GLASS_CONTAINER_VIEW]) {
        const config = expo.getViewConfig(GLASS_MODULE, view)
        if (config === undefined || config === null) {
          return no(`the native view ${view} is missing from this build`)
        }
      }
    }
    return { isAvailable: true, reason: '' }
  } catch (error) {
    return no(
      `looking for Liquid Glass failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

const resolved = (): { isAvailable: boolean; reason: string } => {
  if (given !== 'detect') {
    return { isAvailable: given, reason: given ? '' : 'switched off by the app' }
  }
  // Asked once: a build does not gain or lose native code while it runs.
  if (found === undefined) found = detect()
  return found
}

/**
 * Whether `glass` draws real Liquid Glass in this build. Never throws. When
 * the answer is yes, a person can still have turned on "Reduce Transparency"
 * in the phone's accessibility settings. The phone then draws the glass more
 * solid by itself.
 */
export const isLiquidGlassAvailable = (): boolean => resolved().isAvailable

/** Why Liquid Glass is not available, in plain words. Empty when it is. */
export const liquidGlassUnavailableReason = (): string => resolved().reason

/**
 * Whether the phone has the class that draws glass, as the native module
 * reports it. False where there is no module. Never throws.
 */
export const isGlassEffectAPIAvailable = (): boolean => {
  try {
    const module = expoGlobal()?.modules?.[GLASS_MODULE] as GlassModule | null | undefined
    return module?.isGlassEffectAPIAvailable === true
  } catch {
    return false
  }
}

/** One line for a screen: "Liquid Glass: available" or why not. */
export const liquidGlassStatus = (): string =>
  isLiquidGlassAvailable()
    ? 'Liquid Glass: available'
    : `Liquid Glass: not available (${liquidGlassUnavailableReason()})`
