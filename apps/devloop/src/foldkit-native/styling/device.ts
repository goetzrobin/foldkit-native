/**
 * What the styling code needs to know about the phone, and where it reads it.
 *
 * The engine answers CSS questions such as "is the phone in dark mode?" and
 * "how wide is the window?" from a record called its conditions. This file
 * builds that record.
 *
 * On a phone the facts come from React Native's `Appearance`, `Dimensions`
 * and `PixelRatio`. The adapter must not import `react-native` (Node cannot
 * load it, so the tests could not run). The app passes those modules in:
 *
 *   import { Appearance, AppState, Dimensions, I18nManager, PixelRatio,
 *     Platform, StyleSheet } from 'react-native'
 *   const sources = { Appearance, AppState, Dimensions, I18nManager,
 *     PixelRatio, Platform, StyleSheet }
 *
 * A test passes fakes of the same shape.
 *
 * Ported from ng-native's `packages/device/src/conditions.ts` and the small
 * files it reads (`color-scheme.ts`, `screen.ts`, `accessibility.ts`,
 * `direction.ts`), with the Angular parts left out.
 */
import type { Conditions, TokenValue } from '@ng-native/fabric'

export type Subscription = Readonly<{ remove: () => void }>

export type WindowSize = Readonly<{ width: number; height: number }>

/**
 * The parts of React Native the styling code reads. The names match React
 * Native's exports, so an app can pass the modules as they are.
 */
export type DeviceSources = Readonly<{
  /** Light or dark. */
  Appearance: {
    getColorScheme(): string | null | undefined
    addChangeListener(listener: () => void): Subscription
  }
  /** The window's size in points. Changes when the phone is rotated. */
  Dimensions: {
    get(dimension: 'window'): WindowSize
    addEventListener(
      type: 'change',
      listener: (sizes: Readonly<{ window: WindowSize }>) => void,
    ): Subscription
  }
  /** Pixels in a point, and the user's text size as a multiplier. */
  PixelRatio: {
    get(): number
    getFontScale(): number
  }
  /** `ios` or `android`. Feeds the `ios:` and `android:` class variants. */
  Platform?: { readonly OS: string }
  /** Whether the phone lays out right to left. Fixed until the app restarts. */
  I18nManager?: { readonly isRTL: boolean }
  /** For the thinnest line the screen can draw (`border-hairline`). */
  StyleSheet?: { readonly hairlineWidth: number }
  /**
   * Tells when the app comes back to the front. The text size can only be
   * changed in Settings, so that is when it is read again.
   */
  AppState?: {
    addEventListener(type: 'change', listener: (state: string) => void): Subscription
  }
}>

/** `null` from the phone means it has no preference, which is light. */
export const colorSchemeOf = (sources: DeviceSources): 'light' | 'dark' =>
  sources.Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'

/** The conditions as the phone reports them right now. */
export const currentConditions = (sources: DeviceSources): Conditions => {
  const { width, height } = sources.Dimensions.get('window')
  return {
    width,
    height,
    colorScheme: colorSchemeOf(sources),
    fontScale: sources.PixelRatio.getFontScale(),
    pixelRatio: sources.PixelRatio.get(),
    direction: sources.I18nManager?.isRTL === true ? 'rtl' : 'ltr',
  }
}

/**
 * The thinnest line a screen with `pixelRatio` pixels to the point draws,
 * worked out the way React Native works out `StyleSheet.hairlineWidth`.
 */
export const hairlineAt = (pixelRatio: number): number =>
  Math.round(0.4 * pixelRatio) / pixelRatio || 1 / pixelRatio

/**
 * CSS custom properties only the phone knows. Today that is `--hairline`,
 * which the `border-hairline` and `h-hairline` utilities read.
 */
export const deviceTokens = (sources: DeviceSources): Record<string, TokenValue> =>
  sources.StyleSheet === undefined
    ? {}
    : { '--hairline': { length: sources.StyleSheet.hairlineWidth } }
