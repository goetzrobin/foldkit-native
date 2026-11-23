/**
 * The arithmetic of a long list: how tall each row is, where each row starts,
 * and which rows are near the screen. Nothing here touches the phone, so it
 * can be tested with plain numbers.
 *
 * Written for this project. The ideas (a draw-ahead margin, heights that
 * start as an estimate and are corrected as rows are measured) are the ones
 * ng-native's virtual list and Legend List use. No code is copied from either.
 */

/**
 * Row heights with fast sums. Asking "where does row 4,000 start" or "which
 * row is 90,000 points down" must not add up thousands of heights on every
 * scroll event, so the heights are kept in a Fenwick tree: each question and
 * each change costs about log2(count) steps.
 */
export class Heights {
  private readonly values: Float64Array
  private readonly tree: Float64Array
  /** The largest power of two that is not above the count. */
  private readonly top: number

  constructor(heights: ReadonlyArray<number>) {
    const count = heights.length
    this.values = Float64Array.from(heights)
    this.tree = new Float64Array(count + 1)
    for (let at = 1; at <= count; at++) {
      this.tree[at] = (this.tree[at] ?? 0) + (heights[at - 1] ?? 0)
      const parent = at + (at & -at)
      if (parent <= count) this.tree[parent] = (this.tree[parent] ?? 0) + (this.tree[at] ?? 0)
    }
    let top = 1
    while (top * 2 <= count) top *= 2
    this.top = count === 0 ? 0 : top
  }

  get count(): number {
    return this.values.length
  }

  heightOf(index: number): number {
    return this.values[index] ?? 0
  }

  set(index: number, height: number): void {
    if (index < 0 || index >= this.values.length) return
    const change = height - (this.values[index] ?? 0)
    if (change === 0) return
    this.values[index] = height
    for (let at = index + 1; at <= this.values.length; at += at & -at) {
      this.tree[at] = (this.tree[at] ?? 0) + change
    }
  }

  /** How far down row `index` starts: the heights of all rows before it. */
  offsetOf(index: number): number {
    let sum = 0
    for (let at = Math.min(Math.max(index, 0), this.values.length); at > 0; at -= at & -at) {
      sum += this.tree[at] ?? 0
    }
    return sum
  }

  total(): number {
    return this.offsetOf(this.values.length)
  }

  /** The row that covers the point `offset` down the list. */
  indexAt(offset: number): number {
    const count = this.values.length
    if (count === 0 || offset <= 0) return 0
    let at = 0
    let left = offset
    for (let step = this.top; step > 0; step = Math.floor(step / 2)) {
      const next = at + step
      const sum = this.tree[next]
      if (next <= count && sum !== undefined && sum <= left) {
        at = next
        left -= sum
      }
    }
    return Math.min(at, count - 1)
  }
}

/** Rows `first` up to but not including `end`. */
export type Range = Readonly<{ first: number; end: number }>

export const EMPTY_RANGE: Range = { first: 0, end: 0 }

/** The rows that cover the points from `from` to `to` down the list. */
export const rowsBetween = (heights: Heights, from: number, to: number): Range => {
  if (heights.count === 0) return EMPTY_RANGE
  const first = heights.indexAt(Math.max(0, from))
  const last = heights.indexAt(Math.max(0, to))
  return { first, end: last + 1 }
}

const covers = (outer: Range, inner: Range): boolean =>
  outer.first <= inner.first && outer.end >= inner.end

/**
 * Which rows should exist as views.
 *
 * The rows on screen plus `margin` points before and after are wanted. To
 * keep from redrawing on every scroll event, the rows drawn now are kept for
 * as long as they still cover the screen plus half the margin. Only when the
 * scroll has eaten half the margin is a new set chosen.
 */
export const chooseWindow = (
  heights: Heights,
  offset: number,
  viewport: number,
  margin: number,
  drawn: Range,
): Range => {
  if (heights.count === 0) return EMPTY_RANGE
  const needed = rowsBetween(heights, offset - margin / 2, offset + viewport + margin / 2)
  if (drawn.end > drawn.first && drawn.end <= heights.count && covers(drawn, needed)) return drawn
  return rowsBetween(heights, offset - margin, offset + viewport + margin)
}
