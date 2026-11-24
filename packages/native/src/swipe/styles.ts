/**
 * The styles that ship: `tiles`, `strip` and `info`.
 *
 * A style is a value, like a button style. Its heart is `tile`: a function
 * from how far the row has moved to where one tile is. It is asked on every
 * frame of a swipe, for each tile. Writing a new style is writing that
 * function, or changing a few fields of a style that exists:
 *
 *   const mine = swipeStyle(tiles, {
 *     name: 'mine',
 *     tileStyle: ({ role }) => ({
 *       borderRadius: 8,
 *       backgroundColor: role === 'destructive' ? '#B3261E' : '#2F3B45',
 *     }),
 *   })
 *
 * `tile` and `openWidth` start with the line `'worklet'` so the UI thread
 * driver can run them. They may read numbers from outside themselves and
 * nothing else.
 */
import type { SwipeStyle, SwipeTileInput, SwipeTileLayout, SwipeTileLook } from './types.js'

const mix = (from: number, to: number, amount: number): number => {
  'worklet'
  return from + (to - from) * amount
}

const clamp01 = (value: number): number => {
  'worklet'
  return value < 0 ? 0 : value > 1 ? 1 : value
}

const TILE_WIDTH = 72
const TILE_GAP = 8

/**
 * Separate rounded tiles. They start stacked under the edge of the row and
 * spread out as the row moves, the way cards fan out of a hand. On a full
 * swipe the tile at the outer edge grows to fill the space and the others
 * fade.
 */
const tilesLayout = (input: SwipeTileInput): SwipeTileLayout => {
  'worklet'
  const { index, count, reveal, openWidth, full } = input
  const spread = clamp01(input.progress)
  // Pulled past open, every tile grows by an equal share.
  const width = TILE_WIDTH + Math.max(0, reveal - openWidth) / count
  /** How many tiles sit between this one and the row. */
  const behind = count - 1 - index
  // The tile's inner edge. Closed, it is tucked half under the row. Open,
  // it is one gap away from the row, with the tiles behind it beside it.
  const inner =
    reveal - spread * TILE_GAP - behind * (width + TILE_GAP) * spread + (1 - spread) * TILE_WIDTH * 0.5
  const offset = inner - width
  const opacity = clamp01(spread * 2.5 - behind * 0.3)
  const scale = 0.92 + 0.08 * spread
  if (input.isFullSwipeAction) {
    return {
      offset: mix(offset, 0, full),
      width: mix(width, Math.max(width, reveal - TILE_GAP), full),
      opacity: mix(opacity, 1, full),
      scale: mix(scale, 1, full),
    }
  }
  return { offset, width, opacity: opacity * (1 - full), scale: mix(scale, 0.8, full) }
}

const ROLE_COLOR: Readonly<Record<string, string>> = {
  normal: '#3A3F47',
  destructive: '#D64533',
  cancel: '#6B7280',
}

const colorOf = (look: SwipeTileLook): string => look.tint ?? ROLE_COLOR[look.role] ?? '#3A3F47'

const LABEL = { color: '#FFFFFF', fontSize: 13, fontWeight: '600', textAlign: 'center' } as const

export const tiles: SwipeStyle = {
  name: 'tiles',
  passive: false,
  openWidth: count => {
    'worklet'
    return count * (TILE_WIDTH + TILE_GAP)
  },
  tile: tilesLayout,
  tileInset: 4,
  tileStyle: look => ({ backgroundColor: colorOf(look), borderRadius: 22 }),
  labelStyle: () => LABEL,
  contentStyle: { borderRadius: 26 },
}

const STRIP_WIDTH = 74

/**
 * The classic look: one flat coloured strip the full height of the row,
 * split evenly between the actions. On a full swipe the outer action
 * spreads over the others.
 */
const stripLayout = (input: SwipeTileInput): SwipeTileLayout => {
  'worklet'
  const { index, count, reveal, full } = input
  const slot = reveal / count
  if (input.isFullSwipeAction) {
    // Half a point wider than its slot so no line of background shows between two.
    return { offset: 0, width: mix(slot, reveal, full) + 0.5, opacity: 1, scale: 1 }
  }
  return { offset: mix(index * slot, reveal, full), width: slot + 0.5, opacity: 1, scale: 1 }
}

export const strip: SwipeStyle = {
  name: 'strip',
  passive: false,
  openWidth: count => {
    'worklet'
    return count * STRIP_WIDTH
  },
  tile: stripLayout,
  tileInset: 0,
  tileStyle: look => ({ backgroundColor: colorOf(look) }),
  labelStyle: () => LABEL,
  contentStyle: {},
}

/**
 * Shows something passive behind the row, such as the time a message was
 * sent. It slides in from the edge as the row moves, the row springs back
 * when let go, and nothing is triggered.
 */
const infoLayout = (input: SwipeTileInput): SwipeTileLayout => {
  'worklet'
  const { reveal, openWidth } = input
  const past = Math.max(0, reveal - openWidth)
  return {
    offset: past > 0 ? past / 2 : reveal - openWidth,
    width: openWidth,
    opacity: clamp01(input.progress),
    scale: 1,
  }
}

export const info: SwipeStyle = {
  name: 'info',
  passive: true,
  openWidth: count => {
    'worklet'
    return count * TILE_WIDTH
  },
  tile: infoLayout,
  tileInset: 0,
  tileStyle: () => ({}),
  labelStyle: () => ({ color: '#6B7280', fontSize: 12, textAlign: 'center' }),
  contentStyle: {},
}

/** A style like `base` with some fields changed. */
export const swipeStyle = (base: SwipeStyle, changes: Partial<SwipeStyle>): SwipeStyle => ({
  ...base,
  ...changes,
})
