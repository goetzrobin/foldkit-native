/**
 * The size of the screen, which Legend uses as a first guess for the list's
 * own size on the old architecture only. On Fabric it waits for the list's
 * real layout, so this is never the source of a drawn size. The numbers are
 * a common phone's.
 */
export const getWindowSize = (): { height: number; width: number } => ({ height: 800, width: 390 })
