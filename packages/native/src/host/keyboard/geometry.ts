/**
 * Where a keyboard dock's bar is, in plain numbers, so that the arithmetic
 * can be checked with given values and read on a real phone.
 *
 * All values are in points, measured up from the bottom of the window
 * unless said otherwise.
 *
 * - `content`: the height of the bar's own content (a chat's composer).
 * - `rest`: the room under the content that the keyboard covers anyway,
 *   which is the home indicator's strip. The bar rises by the keyboard's
 *   height less this.
 * - `keyboard`: the keyboard's height, 0 while it is down.
 */

/**
 * The strip under the bar's content.
 *
 * `offset` is what the program said, and wins. Otherwise the strip is the
 * larger of two readings:
 *
 * - `measured`: how far the content's bottom is from the window's bottom,
 *   as the phone measured it. On an iPhone the first measurement can come
 *   before the safe area view has padded the bar, and then reads 0.
 * - `barHeight - contentHeight`: the bar's own padding under its content,
 *   which is the safe area view's. The bar's height comes from its layout
 *   event, which the phone sends again once the padding is there.
 *
 * Both are true lower bounds, so the larger is the better one.
 */
export const restUnderBar = (
  readings: Readonly<{
    offset: number | undefined
    measured: number | undefined
    barHeight: number | undefined
    contentHeight: number | undefined
  }>,
): number => {
  if (readings.offset !== undefined) return readings.offset
  const padded =
    readings.barHeight === undefined || readings.contentHeight === undefined
      ? 0
      : Math.round(readings.barHeight - readings.contentHeight)
  return Math.max(0, readings.measured ?? 0, padded)
}

/** Where the bar's content is, with the keyboard at `keyboard`. */
export type BarPlace = Readonly<{
  /** How much of the window the bar covers, from its bottom to the content's top. */
  covered: number
  /** How far the bar has risen from where it rests. */
  lift: number
  /** From the content's bottom down to the keyboard's top, or the rest strip with the keyboard down. */
  gap: number
}>

/**
 * The bar rests with its content `rest` above the window's bottom. A
 * keyboard lower than that leaves it where it is; a taller one lifts it by
 * the difference, so the content's bottom meets the keyboard's top.
 */
export const barPlace = (
  values: Readonly<{ content: number; rest: number; keyboard: number }>,
): BarPlace => {
  const keyboard = Math.max(0, values.keyboard)
  const bottom = Math.max(values.rest, keyboard)
  return {
    covered: bottom + values.content,
    lift: bottom - values.rest,
    gap: bottom - keyboard,
  }
}
