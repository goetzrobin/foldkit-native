/**
 * Liquid Glass views: the see-through material of iOS 26 and later.
 *
 *   glass(
 *     [
 *       glassOptions({ glassStyle: 'regular', isInteractive: true }),
 *       style({ borderRadius: 24, padding: 12 }),
 *       onPress(PressedPlay()),
 *     ],
 *     [text([], ['Play'])],
 *   )
 *
 *   glassContainer([glassContainerOptions({ spacing: 16 })], [glass(...), glass(...)])
 *
 * `glass` is a box made of glass. Whatever is behind it shows through, bent
 * and blurred. Its children are drawn on the glass. `glassContainer` is a
 * box around several glass views: those that come within `spacing` points of
 * each other flow into one shape.
 *
 * Where Liquid Glass is not available (Android, iOS before 26, a build
 * without the native code) both draw a plain view instead, with the same
 * layout. A `glass` then gets a pale see-through background, or the
 * `fallbackStyle` it was given. See `detect.ts` for what decides it.
 *
 * The native views are Expo's, from `expo-glass-effect` 58. None of the
 * package's JavaScript is used: it is two React components that pass their
 * props straight to the native views, which this file does without React.
 * The props below are the ones the native view reads (see the package's
 * `ios/GlassEffectModule.swift`). Expo Go includes the native code.
 *
 * The corners are the view's own `borderRadius`, in `style`. The native
 * view reads it and rounds the glass to match.
 */
import { registerViewName } from '@ng-native/fabric'
import type { Html } from 'foldkit/html'
import { element } from 'foldkit/renderTarget'

import { type Color, type NativeStyle, prop } from '../attributes.js'
import {
  GLASS_CONTAINER_VIEW,
  GLASS_MODULE,
  GLASS_VIEW,
  expoGlobal,
  isLiquidGlassAvailable,
  noteRegistered,
} from '../../host/glass/detect.js'

const el = element<any>()

/** The element names the engine knows the two native views by. */
export const GLASS_TAG = 'glass'
export const GLASS_CONTAINER_TAG = 'glass-container'

/** `regular` is the usual glass. `clear` lets more through. `none` draws no glass. */
export type GlassStyle = 'regular' | 'clear' | 'none'

/** Light or dark glass, where it should not follow the phone's setting. */
export type GlassColorScheme = 'auto' | 'light' | 'dark'

export type GlassSettings = Readonly<{
  /** `regular` unless said. */
  glassStyle?: GlassStyle
  /** Whether a change of `glassStyle` fades from one to the other. */
  isStyleAnimated?: boolean
  /** How long that fade takes, in seconds. The phone's own time, unless said. */
  styleAnimationSeconds?: number
  /** A colour the glass is tinted with. */
  tintColor?: Color
  /**
   * Whether the glass reacts to a finger: it swells and shines where it is
   * touched, as the phone's own glass buttons do.
   */
  isInteractive?: boolean
  /** `auto` unless said. */
  colorScheme?: GlassColorScheme
  /**
   * Styles for the plain view drawn where Liquid Glass is not available.
   * Laid over `style`, and over the pale background a fallback gets by itself.
   */
  fallbackStyle?: NativeStyle
  /** Draws the fallback even where Liquid Glass is available. For comparing the two. */
  isFallbackForced?: boolean
}>

export type GlassContainerSettings = Readonly<{
  /**
   * How close two glass views inside must come, in points, before they
   * start to flow into one shape.
   */
  spacing?: number
  /** Styles for the plain view drawn where Liquid Glass is not available. */
  fallbackStyle?: NativeStyle
  /** Draws the fallback even where Liquid Glass is available. */
  isFallbackForced?: boolean
}>

const SETTINGS = 'glassSettings'
const CONTAINER_SETTINGS = 'glassContainerSettings'

/** How a glass view looks and behaves. One of a `glass`'s attributes. */
export const glassOptions = (settings: GlassSettings) => prop(SETTINGS, settings)

/** One of a `glassContainer`'s attributes. */
export const glassContainerOptions = (settings: GlassContainerSettings) =>
  prop(CONTAINER_SETTINGS, settings)

/**
 * What a fallback looks like when it is told nothing else: pale, a little
 * see-through, with a thin light edge.
 */
export const FALLBACK_LOOK: NativeStyle = {
  backgroundColor: 'rgba(246, 246, 246, 0.82)',
  borderWidth: 1,
  borderColor: 'rgba(255, 255, 255, 0.7)',
}

/**
 * The name the phone knows one of the module's views by. It is the name
 * Expo's own JavaScript works out (`requireNativeView` in
 * `expo-modules-core`). Expo Go runs many projects in one app, so it adds
 * the running project's name to every view name. An app built on its own
 * has no such addition.
 */
export const expoViewName = (moduleName: string, viewName: string): string => {
  let identifier = ''
  try {
    identifier = expoGlobal()?.__expo_app_identifier__ ?? ''
  } catch {
    identifier = ''
  }
  return `ViewManagerAdapter_${moduleName}_${viewName}${identifier === '' ? '' : `_${identifier}`}`
}

type Named = { name: string; undo: unknown }
const named = new Map<string, Named>()

/** Names one element, again if Expo's project name has changed since. */
const name = (tag: string, viewName: string): void => {
  const wanted = expoViewName(GLASS_MODULE, viewName)
  const current = named.get(tag)
  if (current?.name === wanted) return
  if (typeof current?.undo === 'function') current.undo()
  // Android never draws these (see `detect.ts`). Should one be drawn there
  // anyway, it is a plain view and not a view the phone has never heard of.
  named.set(tag, {
    name: wanted,
    undo: registerViewName(tag, { ios: wanted, android: 'View' }),
  })
}

const nameBoth = (): void => {
  name(GLASS_TAG, GLASS_VIEW)
  name(GLASS_CONTAINER_TAG, GLASS_CONTAINER_VIEW)
}

/**
 * Call once at startup, before the first draw, and after `import 'expo'`.
 * It only names the two native views. It does not need them to exist: a
 * build without them draws the fallback.
 */
export const registerGlass = (): void => {
  try {
    nameBoth()
    noteRegistered()
  } catch {
    // Not registered means every glass view is its fallback.
  }
}

type PropAttribute = Readonly<{ _tag: 'Prop'; key: string; value: unknown }>

const isProp = (attribute: unknown): attribute is PropAttribute =>
  typeof attribute === 'object' &&
  attribute !== null &&
  (attribute as { _tag?: unknown })._tag === 'Prop'

/** The attributes with the settings and the styles taken out and put together. */
const split = <Settings extends object>(
  attributes: ReadonlyArray<unknown>,
  settingsKey: string,
): { settings: Settings; styles: NativeStyle | undefined; rest: Array<unknown> } => {
  let settings = {} as Settings
  let styles: NativeStyle | undefined
  const rest: Array<unknown> = []
  for (const attribute of attributes) {
    if (isProp(attribute) && attribute.key === settingsKey) {
      settings = { ...settings, ...(attribute.value as Settings) }
    } else if (isProp(attribute) && attribute.key === 'style') {
      styles = { ...styles, ...(attribute.value as NativeStyle) }
    } else {
      rest.push(attribute)
    }
  }
  return { settings, styles, rest }
}

const styled = (styles: NativeStyle | undefined): Array<unknown> =>
  styles === undefined ? [] : [prop('style', styles)]

/** Whether a view with these settings is drawn as real glass. */
const drawsGlass = (settings: { isFallbackForced?: boolean }): boolean => {
  if (settings.isFallbackForced === true || !isLiquidGlassAvailable()) return false
  try {
    // In Expo Go the views' names hold the project's name, which Expo may
    // only have known after `registerGlass` ran.
    nameBoth()
    return true
  } catch {
    return false
  }
}

/** See the top of this file. */
export const glass = (attributes: ReadonlyArray<any>, children: ReadonlyArray<any>): Html => {
  const { settings, styles, rest } = split<GlassSettings>(attributes, SETTINGS)
  const glassStyle = settings.glassStyle ?? 'regular'
  if (!drawsGlass(settings)) {
    // `none` asks for no glass, so its fallback has no background either.
    const look =
      glassStyle === 'none' ? styles : { ...FALLBACK_LOOK, ...styles, ...settings.fallbackStyle }
    return el('view')([...styled(look), ...rest] as never, children as never)
  }
  const isAnimated = settings.isStyleAnimated === true
  return el(GLASS_TAG)(
    [
      // Every prop is sent every time, so one that was set and is then left
      // out goes back to its usual value on the phone.
      prop(
        'glassEffectStyle',
        isAnimated
          ? {
              style: glassStyle,
              animate: true,
              ...(settings.styleAnimationSeconds === undefined
                ? {}
                : { animationDuration: settings.styleAnimationSeconds }),
            }
          : glassStyle,
      ),
      prop('tintColor', settings.tintColor ?? null),
      prop('isInteractive', settings.isInteractive ?? false),
      prop('colorScheme', settings.colorScheme ?? 'auto'),
      ...styled(styles),
      ...rest,
    ] as never,
    children as never,
  )
}

/** See the top of this file. */
export const glassContainer = (
  attributes: ReadonlyArray<any>,
  children: ReadonlyArray<any>,
): Html => {
  const { settings, styles, rest } = split<GlassContainerSettings>(attributes, CONTAINER_SETTINGS)
  if (!drawsGlass(settings)) {
    const look = settings.fallbackStyle === undefined ? styles : { ...styles, ...settings.fallbackStyle }
    return el('view')([...styled(look), ...rest] as never, children as never)
  }
  return el(GLASS_CONTAINER_TAG)(
    [prop('spacing', settings.spacing ?? null), ...styled(styles), ...rest] as never,
    children as never,
  )
}
