/** Skia's native view, by tag. Only its native code is used. */
import { registerViewName } from '@ng-native/fabric'

export const SKIA_TAG = 'skia-view'

let isRegistered = false

/**
 * Names Skia's native view for the engine. Call once at startup. Naming a
 * view does not need it to exist: only drawing one does, and a canvas draws
 * one in Skia mode alone.
 */
export const registerSkia = (): void => {
  if (isRegistered) return
  isRegistered = true
  registerViewName(SKIA_TAG, 'SkiaPictureView')
}
