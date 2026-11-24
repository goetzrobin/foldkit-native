/**
 * Fold Chat's icons. Where the build has Expo UI (SwiftUI), the arrows are
 * the phone's own SF Symbols. Elsewhere they are drawn from rounded bars,
 * some of them turned. These tests work out where each turned bar really
 * is and check that it stays inside its icon, and that bars meant to meet
 * in a point (an arrow's tip, a tick's corner) meet there exactly. The
 * scroll-to-end arrow's tip was drawn as two rounded ends side by side,
 * which looked like a point cut off.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { afterEach, describe, expect, it } from 'vitest'

import { configureExpoUi, registerExpoUi, resetExpoUi } from '../../src/controls/index.js'
import { arrowDown, arrowUp, cross, regenerateIcon, shareIcon, tick } from '../../flagship/ui.js'
import { expoWith } from '../support/expoUi.js'

type VNode = Readonly<{ sel?: string; data?: { props?: Record<string, any> }; children?: ReadonlyArray<VNode> }>

type Point = Readonly<{ x: number; y: number }>
/** A bar as the phone draws it: a line between two points, `radius` thick on each side. */
type Capsule = Readonly<{ ends: readonly [Point, Point]; radius: number }>

/** The bar with its rounded ends, turned about its centre as React Native turns a view. */
const capsuleOf = (style: Record<string, any>): Capsule | undefined => {
  const { left, top, width, height, borderRadius } = style
  if (style.borderWidth !== undefined || typeof borderRadius !== 'number') return undefined
  const radius = Math.min(width, height) / 2
  if (Math.abs(borderRadius - radius) > 0.01) return undefined
  const rotate = (style.transform as Array<{ rotate?: string }> | undefined)?.find(each => each.rotate !== undefined)?.rotate
  const angle = ((rotate === undefined ? 0 : Number.parseFloat(rotate)) * Math.PI) / 180
  const center = { x: left + width / 2, y: top + height / 2 }
  const half = Math.max(width, height) / 2 - radius
  // Along the bar's long side, turned clockwise by `angle` (y points down).
  const along = width >= height ? { x: 1, y: 0 } : { x: 0, y: 1 }
  const turned = {
    x: along.x * Math.cos(angle) - along.y * Math.sin(angle),
    y: along.x * Math.sin(angle) + along.y * Math.cos(angle),
  }
  return {
    radius,
    ends: [
      { x: center.x - turned.x * half, y: center.y - turned.y * half },
      { x: center.x + turned.x * half, y: center.y + turned.y * half },
    ],
  }
}

/** The icon's box and every rounded bar in it. */
const barsOf = (icon: VNode): { width: number; height: number; bars: Array<Capsule> } => {
  const box = icon.data?.props?.['style'] as { width: number; height: number }
  const bars = (icon.children ?? [])
    .map(child => capsuleOf((child.data?.props?.['style'] ?? {}) as Record<string, any>))
    .filter((each): each is Capsule => each !== undefined)
  return { width: box.width, height: box.height, bars }
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/** Whether one end of `a` and one end of `b` are the same point. */
const meet = (a: Capsule, b: Capsule): boolean =>
  a.ends.some(one => b.ends.some(other => distance(one, other) < 0.05))

const allInside = (icon: VNode): Array<string> => {
  const { width, height, bars } = barsOf(icon)
  const outside: Array<string> = []
  bars.forEach((bar, index) => {
    for (const end of bar.ends) {
      const reach = [end.x - bar.radius, end.y - bar.radius, end.x + bar.radius, end.y + bar.radius]
      if (reach[0]! < -0.02 || reach[1]! < -0.02 || reach[2]! > width + 0.02 || reach[3]! > height + 0.02) {
        outside.push(`bar ${index} reaches ${reach.map(each => each.toFixed(2)).join(', ')}`)
      }
    }
  })
  return outside
}

afterEach(() => {
  resetExpoUi()
  registerPlatformComponents('ios')
})

describe('the icons drawn from bars', () => {
  it('keep every bar inside the icon', () => {
    for (const [name, icon] of [
      ['arrow', arrowUp('#000')],
      ['share', shareIcon('#000')],
      ['tick', tick('#000')],
      ['cross', cross('#000')],
      ['regenerate', regenerateIcon('#000')],
    ] as const) {
      expect([name, allInside(icon as VNode)]).toEqual([name, []])
    }
  })

  it('draw the arrow with a sharp tip: both sides of the head end where the stem ends', () => {
    const [stem, left, right] = barsOf(arrowUp('#000') as VNode).bars
    expect(stem && left && meet(stem, left)).toBe(true)
    expect(stem && right && meet(stem, right)).toBe(true)
  })

  it('draw the share arrow the same way', () => {
    const [stem, left, right] = barsOf(shareIcon('#000') as VNode).bars
    expect(stem && left && meet(stem, left)).toBe(true)
    expect(stem && right && meet(stem, right)).toBe(true)
  })

  it('close the corners of the tick and of the regenerate arrow', () => {
    const [short, long] = barsOf(tick('#000') as VNode).bars
    expect(short && long && meet(short, long)).toBe(true)
    const [, down, across] = [undefined, ...barsOf(regenerateIcon('#000') as VNode).bars]
    expect(down && across && meet(down, across)).toBe(true)
  })

  it('turn the whole arrow over for the scroll-to-end button, with nothing to clip it', () => {
    const down = arrowDown('#000') as VNode
    expect(down.data?.props?.['style']).toMatchObject({ width: 16, height: 16, transform: [{ rotate: '180deg' }] })
    expect(down.data?.props?.['style']?.overflow).toBeUndefined()
  })
})

describe('the arrows where the build has SwiftUI', () => {
  const find = (node: VNode, sel: string): Array<VNode> => [
    ...(node.sel === sel ? [node] : []),
    ...(node.children ?? []).flatMap(child => find(child, sel)),
  ]

  it('are the phone\'s own SF Symbols, in the colour asked for', () => {
    registerPlatformComponents('ios')
    resetExpoUi()
    configureExpoUi({ expo: expoWith() })
    registerExpoUi()
    for (const [icon, symbol] of [
      [arrowDown('#112233'), 'arrow.down'],
      [arrowUp('#112233'), 'arrow.up'],
    ] as const) {
      const images = find(icon as VNode, 'fk-ui-x-imageview')
      expect(images).toHaveLength(1)
      expect(images[0]?.data?.props?.['systemName']).toBe(symbol)
      expect(images[0]?.data?.props?.['modifiers']).toContainEqual({ $type: 'foregroundStyle', style: { type: 'color', color: '#112233' } })
      // The button takes the touch, not the SwiftUI view inside it.
      expect((icon as VNode).data?.props?.['pointerEvents']).toBe('none')
    }
  })

  it('are drawn from bars where there is no SwiftUI', () => {
    registerPlatformComponents('android')
    resetExpoUi()
    configureExpoUi({ expo: expoWith() })
    registerExpoUi()
    expect(find(arrowDown('#000') as VNode, 'fk-ui-x-imageview')).toEqual([])
  })
})
