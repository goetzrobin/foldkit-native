/**
 * The way the app starts on a phone: `startPlayground`, which launches the
 * mount Layer on the phone's Scheduler.
 *
 * The first screen must not wait for a timer or an animation frame: on a
 * first launch the phone's clock may not be running yet (docs/BRIEF.md).
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { createFakeFabric } from '@ng-native/testing/fake'
import { describe, expect, it } from 'vitest'

import { Effect, Layer } from 'effect'

import { Counter } from '../playground/counter.js'
import { startPlayground } from '../playground/start.js'
import { NativeHost, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'

const microtasks = async (): Promise<void> => {
  for (let turn = 0; turn < 200; turn++) await Promise.resolve()
}

describe('starting the app', () => {
  it('draws the first screen with microtasks alone, and stopping it leaves nothing behind', async () => {
    registerPlatformComponents('ios')
    const fabric = createFakeFabric()
    const device = Phone.Device.makeTest()
    let surface: NativeHost.NativeSurface | undefined
    const stop = startPlayground({
      fabric,
      rootTag: 1,
      platform: 'ios',
      device: device.layer,
      dev: false,
      hasReadout: false,
      onSurface: made => {
        surface = made
      },
    })
    // No timer has had a chance to fire: only microtasks are let through.
    await microtasks()
    const words = NativeTest.flatten(fabric.committed)
      .filter(node => node.viewName === 'RawText')
      .map(node => node.props['text'])
    expect(words).toContain('Long list')
    expect(fabric.find('RNSScreenStackHeaderConfig')?.props['title']).toBe('Effect UI Native')
    expect(surface?.stats.live).toBeGreaterThan(10)

    stop()
    await new Promise<void>(resolve => setTimeout(() => resolve(), 50))
    expect(surface?.stats.live).toBe(0)
    expect(surface?.stats.listeners).toBe(0)
    expect(surface?.stats.wired).toBe(0)
  })

  it('an app whose Layers yield before the mount still draws with microtasks alone', async () => {
    registerPlatformComponents('ios')
    const fabric = createFakeFabric()
    // A Layer that gives the turn away once, as one that reads storage or settings would.
    const slow = Layer.effectDiscard(Effect.yieldNow)
    const stop = NativeHost.run(
      NativeHost.mount(Counter, {}, { fabric, rootTag: 1, dev: false }).pipe(Layer.provide(slow)),
    )
    await microtasks()
    expect(NativeTest.flatten(fabric.committed).some(node => node.props['testID'] === 'counter-count')).toBe(true)
    stop()
    await new Promise<void>(resolve => setTimeout(() => resolve(), 20))
  })
})
