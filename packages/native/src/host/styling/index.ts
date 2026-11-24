/**
 * Styling with CSS classes: Tailwind utilities, dark mode, `ios:` and
 * `android:` variants, and media queries that follow the phone without the
 * Foldkit view running again.
 *
 *   const sources = { Appearance, AppState, Dimensions, I18nManager,
 *     PixelRatio, Platform, StyleSheet }            // from 'react-native'
 *   const surface = createNativeSurface(fabric, rootTag, {
 *     ...stylingOptions(sheet, sources),             // sheet: compiled CSS
 *   })
 *   const stop = watchStyling(surface.engine, sources)
 *
 * Views then use `h.Class('flex-1 bg-white dark:bg-black p-4')`.
 */
export { stylingOptions } from './options.js'
export type { StylingOptions } from './options.js'
export { watchStyling } from './watch.js'
export type { StyledEngine, WatchStylingOptions } from './watch.js'
export { colorSchemeOf, currentConditions, deviceTokens, hairlineAt } from './device.js'
export type { DeviceSources, Subscription, WindowSize } from './device.js'
