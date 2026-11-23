/**
 * Builds the options the engine needs to style views from CSS classes.
 *
 *   const surface = createNativeSurface(fabric, rootTag, {
 *     ...stylingOptions(sheet, sources),
 *     processColor,
 *   })
 *   watchStyling(surface.engine, sources)
 *
 * `sheet` is a stylesheet compiled at build time. In an app it is the module
 * the Metro step writes from the app's Tailwind classes (see
 * `apps/styled/metro.config.js`). After this, `h.Class('p-4 bg-white')` in a
 * view styles the native view.
 */
import type { EngineOptions, StyleSheet } from '@ng-native/fabric'

import { type DeviceSources, currentConditions, deviceTokens } from './device'

export type StylingOptions = Required<
  Pick<EngineOptions, 'globalStyles' | 'conditions' | 'tokens'>
>

export const stylingOptions = (
  sheet: StyleSheet,
  sources: DeviceSources,
): StylingOptions => ({
  globalStyles: sheet,
  conditions: currentConditions(sources),
  tokens: deviceTokens(sources),
})
