/**
 * Which phone this is, for Legend's core.
 *
 * Legend reads `Platform.OS` from React Native. This adapter does not import
 * React Native, so the app says which platform it is on (the `platform`
 * option of `legendList`) and that is written here before the list starts.
 * A phone has one platform, so one value for the whole program is right.
 */
export type LegendPlatform = 'ios' | 'android'

export const Platform: { OS: 'ios' | 'android' | 'web' } = { OS: 'ios' }

/**
 * Android cannot take a scroll correction in the middle of an animated
 * scroll, so Legend holds corrections back there until the scroll ends.
 * Legend's core imports this by name, and the importing side sees a new
 * value when it is assigned here.
 */
export let PlatformAdjustBreaksScroll = false

export const setLegendPlatform = (os: LegendPlatform): void => {
  Platform.OS = os
  PlatformAdjustBreaksScroll = os === 'android'
}
