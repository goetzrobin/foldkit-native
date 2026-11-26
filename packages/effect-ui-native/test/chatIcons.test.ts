/**
 * The arrow on Send and on the button that scrolls to the end. It is drawn
 * from three rounded bars. These tests work out where each bar really is,
 * turned as the phone turns a view, and check that the bars stay inside the
 * icon and that the two sides of the head end exactly where the stem ends.
 * Drawn side by side, the ends looked like a point cut off.
 */
import { describe, expect, it } from 'vitest'

import { ARROW_BARS, ARROW_SIZE, type Bar } from '../chat/icons.js'

type Point = Readonly<{ x: number; y: number }>
/** A bar as the phone draws it: a line between two points, `radius` thick on each side. */
type Capsule = Readonly<{ ends: readonly [Point, Point]; radius: number }>

/** The bar with its rounded ends, turned about its centre as React Native turns a view. */
const capsuleOf = (bar: Bar): Capsule => {
  const radius = Math.min(bar.width, bar.height) / 2
  const angle = ((bar.turn ?? 0) * Math.PI) / 180
  const centre = { x: bar.left + bar.width / 2, y: bar.top + bar.height / 2 }
  const half = Math.max(bar.width, bar.height) / 2 - radius
  // Along the bar's long side, turned clockwise by `angle` (y points down).
  const along = bar.width >= bar.height ? { x: 1, y: 0 } : { x: 0, y: 1 }
  const turned = {
    x: along.x * Math.cos(angle) - along.y * Math.sin(angle),
    y: along.x * Math.sin(angle) + along.y * Math.cos(angle),
  }
  return {
    radius,
    ends: [
      { x: centre.x - turned.x * half, y: centre.y - turned.y * half },
      { x: centre.x + turned.x * half, y: centre.y + turned.y * half },
    ],
  }
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const meet = (a: Capsule, b: Capsule): boolean => a.ends.some(one => b.ends.some(other => distance(one, other) < 0.05))

describe('the drawn arrow', () => {
  const [stem, left, right] = ARROW_BARS.map(capsuleOf) as [Capsule, Capsule, Capsule]

  it('every bar is a full capsule: its corners are half its width', () => {
    for (const bar of ARROW_BARS) expect(bar.borderRadius).toBe(Math.min(bar.width, bar.height) / 2)
  })

  it('keeps every bar inside the icon, so nothing cuts the point off', () => {
    for (const bar of [stem, left, right]) {
      for (const end of bar.ends) {
        expect(end.x - bar.radius).toBeGreaterThanOrEqual(-0.02)
        expect(end.y - bar.radius).toBeGreaterThanOrEqual(-0.02)
        expect(end.x + bar.radius).toBeLessThanOrEqual(ARROW_SIZE + 0.02)
        expect(end.y + bar.radius).toBeLessThanOrEqual(ARROW_SIZE + 0.02)
      }
    }
  })

  it('has a sharp tip: both sides of the head end where the stem ends, at the top', () => {
    expect(meet(stem, left)).toBe(true)
    expect(meet(stem, right)).toBe(true)
    const tip = stem.ends[0].y < stem.ends[1].y ? stem.ends[0] : stem.ends[1]
    expect(tip.x).toBeCloseTo(ARROW_SIZE / 2, 5)
    expect(tip.y).toBeLessThan(4)
  })
})
