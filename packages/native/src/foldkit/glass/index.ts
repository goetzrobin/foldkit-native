/**
 * Liquid Glass, with no React.
 *
 *   registerGlass()                 once at startup: names the native views
 *   glass(attributes, children)     a box made of glass
 *   glassContainer(attributes, ...) glass views inside flow into one shape
 *   glassOptions({...})             style, tint, touch reaction, fallback look
 *   isLiquidGlassAvailable()        whether this build draws real glass
 *
 * `detect.ts` explains how the answer is found, `glass.ts` the views.
 */
export {
  FALLBACK_LOOK,
  GLASS_CONTAINER_TAG,
  GLASS_TAG,
  expoViewName,
  glass,
  glassContainer,
  glassContainerOptions,
  glassOptions,
  registerGlass,
} from './glass.js'
export type {
  GlassColorScheme,
  GlassContainerSettings,
  GlassSettings,
  GlassStyle,
} from './glass.js'
export {
  configureGlass,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  liquidGlassStatus,
  liquidGlassUnavailableReason,
  resetGlass,
} from '../../host/glass/detect.js'
export type { ExpoGlobal, GlassOptions } from '../../host/glass/detect.js'
