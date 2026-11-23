import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type NativeSurface, createNativeSurface } from '../src/index.js'
import { makeCounter } from './counter.js'

const ROOT_TAG = 1

/** Let Foldkit's runtime process what is queued and draw. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap(node => [node, ...flatten(node.children)])

const byTestId = (fabric: FakeFabric, id: string): FakeFabricNode => {
  const found = flatten(fabric.committed).find(node => node.props['testID'] === id)
  if (found === undefined) throw new Error(`No view with testID ${id}`)
  return found
}

const touch = (node: FakeFabricNode, phase: 'start' | 'end') => {
  const point = {
    identifier: 0,
    target: node.reactTag,
    pageX: 0,
    pageY: 0,
    locationX: 0,
    locationY: 0,
    timestamp: Date.now(),
  }
  return { ...point, touches: phase === 'start' ? [point] : [], changedTouches: [point] }
}

/** A finger going down and up on a view, as the phone reports it. */
const press = async (fabric: FakeFabric, id: string): Promise<void> => {
  fabric.emit(byTestId(fabric, id), 'topTouchStart', touch(byTestId(fabric, id), 'start'))
  fabric.emit(byTestId(fabric, id), 'topTouchEnd', touch(byTestId(fabric, id), 'end'))
  await settle()
}

const shownCount = (fabric: FakeFabric): string =>
  flatten([byTestId(fabric, 'count')])
    .map(node => node.props['text'])
    .filter(value => typeof value === 'string')
    .join('')

describe('a Foldkit counter on the simulated phone', () => {
  let fabric: FakeFabric
  let surface: NativeSurface
  let handle: { dispose: () => void; disposeAsync?: () => Promise<void> }

  beforeEach(async () => {
    // No animation-frame clock is provided: drawing must not depend on one.

    registerPlatformComponents('ios')
    fabric = createFakeFabric()
    surface = createNativeSurface(fabric, ROOT_TAG, { dev: false })
    handle = Runtime.embed(makeCounter(surface.container))
    await settle()
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    surface.dispose()
  })

  it('commits a full-screen view before the program draws anything', () => {
    const bare = createFakeFabric()
    const started = createNativeSurface(bare, ROOT_TAG, { dev: false })
    expect(bare.render({ props: true })).toBe('View {"height":"100%"}')
    started.dispose()
  })

  it('draws the first screen as native views', () => {
    expect(fabric.render({ props: true })).toBe(
      [
        'View {"height":"100%"}',
        '  View {"flex":1,"padding":24}',
        '    Paragraph {"ellipsizeMode":"clip","numberOfLines":1,"testID":"count"}',
        '      RawText "0"',
        '    View {"collapsable":false,"testID":"minus"}',
        '      Paragraph {"ellipsizeMode":"tail"}',
        '        RawText "-"',
        '    View {"collapsable":false,"testID":"plus"}',
        '      Paragraph {"ellipsizeMode":"clip","numberOfLines":1}',
        '        RawText "+"',
      ].join('\n'),
    )
    expect(shownCount(fabric)).toBe('0')
  })

  it('turns a press into a Message and shows the new count', async () => {
    await press(fabric, 'plus')
    expect(shownCount(fabric)).toBe('1')
    await press(fabric, 'plus')
    await press(fabric, 'plus')
    expect(shownCount(fabric)).toBe('3')
    await press(fabric, 'minus')
    expect(shownCount(fabric)).toBe('2')
  })

  it('sends the phone one update per press', async () => {
    const before = fabric.calls.completeRoot
    await press(fabric, 'plus')
    expect(fabric.calls.completeRoot - before).toBe(1)
  })

  it('creates no new views when only the number changes', async () => {
    const before = fabric.calls.createNode
    await press(fabric, 'plus')
    expect(fabric.calls.createNode - before).toBe(0)
  })

  it('clears the screen when the program is disposed', async () => {
    handle.dispose()
    await settle()
    expect(fabric.render()).toBe('View')
    // Start it again so afterEach has something to dispose.
    handle = Runtime.embed(makeCounter(surface.container))
    await settle()
  })
})
