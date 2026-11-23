/**
 * The arithmetic of a list that lives at its end, as a chat does: how much
 * blank space to keep under the last row, how far the list can scroll, and
 * whether the user is at the end. Plain numbers only, so it can be tested
 * without a phone.
 *
 * The behaviour follows Legend List's chat options (`anchoredEndSpace`,
 * `maintainScrollAtEnd`). Written for this project; no code is copied.
 */
import type { Heights } from './window.js'

/**
 * Blank space under the last row, sized so that one row can sit at the top
 * of the screen even when little comes after it.
 *
 * An AI chat uses it: the message the user just sent goes to the top, and
 * the reply streams into the space below. While the reply grows the space
 * shrinks by the same amount, so the list is exactly as long as before and
 * nothing on screen moves.
 */
export type AnchoredEndSpace = Readonly<{
  /** The row that should be able to reach the top of the screen. */
  anchorIndex: number
  /**
   * The most of the anchored row to keep on screen. A very long message then
   * shows only its last part, and the reply still has room. Default: all of it.
   */
  anchorMaxSize?: number
  /** A gap to leave between the top of the screen and the anchored row. */
  anchorOffset?: number
  /** Whether the list glides to the anchored row or jumps. Default true. */
  animated?: boolean
}>

/**
 * How tall the blank space must be: the screen, less the gap, less the
 * anchored row and every row after it.
 */
export const endSpaceFor = (
  heights: Heights,
  viewport: number,
  anchored: AnchoredEndSpace | undefined,
): number => {
  if (anchored === undefined || viewport <= 0) return 0
  const { anchorIndex, anchorMaxSize, anchorOffset = 0 } = anchored
  if (anchorIndex < 0 || anchorIndex >= heights.count) return 0
  const anchorHeight = heights.heightOf(anchorIndex)
  const shown =
    anchorMaxSize === undefined ? anchorHeight : Math.min(anchorHeight, Math.max(0, anchorMaxSize))
  const after = heights.total() - heights.offsetOf(anchorIndex + 1)
  return Math.max(0, viewport - anchorOffset - shown - after)
}

/** The scroll position that shows the very end of the content. */
export const endOffset = (contentHeight: number, viewport: number): number =>
  Math.max(0, contentHeight - viewport)

/**
 * Whether the end of the content is on screen, or within `threshold` points
 * of it. Content shorter than the screen is always at its end.
 */
export const isAtEnd = (
  contentHeight: number,
  offset: number,
  viewport: number,
  threshold: number,
): boolean => contentHeight - (Math.max(0, offset) + viewport) <= threshold
