/**
 * The styling demo on the simulated phone.
 *
 * The stylesheet is `fixtures/styling-sheet.json`: the demo's Tailwind
 * classes compiled by the real build step (Tailwind's CLI, then ng-native's
 * CSS compiler, both as `apps/styled` installs them from npm). It is not
 * written by hand. `apps/styled/write-test-sheet.mjs` writes it again.
 */
import { type StyleSheet, registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { type NativeSurface, createNativeSurface, registerNavigation } from '../src/index.js'
import {
  type StyledEngine,
  currentConditions,
  stylingOptions,
  watchStyling,
} from '../src/styling/index.js'
import { makeDemo, viewRunCount } from './demos/styling.js'
import compiled from './fixtures/styling-sheet.json'
import { type FakeDevice, makeFakeDevice } from './support/fakeDevice.js'
import { byTestId, flatten, hasTestId, press, settle, textOf } from './support/phone.js'

const sheet = compiled as unknown as StyleSheet

const WHITE = 'rgb(255, 255, 255)'
const NEAR_BLACK = 'rgb(10, 10, 10)'
const SKY = 'rgb(0, 132, 209)'
const EMERALD = 'rgb(0, 153, 102)'
const ROSE = 'rgb(255, 32, 86)'
const TEAL = 'rgb(0, 187, 167)'

type Started = Readonly<{
  fabric: FakeFabric
  surface: NativeSurface
  device: FakeDevice
  stop: () => void
  exits: () => number
}>

let cleanUp: (() => Promise<void>) | undefined

/** The app's start-up, as `apps/styled/index.ts` does it. */
const startDemo = async (
  start: Parameters<typeof makeFakeDevice>[0] = {},
): Promise<Started> => {
  const platform = start.platform ?? 'ios'
  registerPlatformComponents(platform)
  registerNavigation()
  const fabric = createFakeFabric()
  const device = makeFakeDevice(start)
  const surface = createNativeSurface(fabric, 1, {
    ...stylingOptions(sheet, device.sources),
    dev: false,
  })
  const stop = watchStyling(surface.engine, device.sources)
  let exits = 0
  const handle = Runtime.embed(
    makeDemo(surface.container, {
      device: { platform, osVersion: 26 },
      exit: () => {
        exits += 1
      },
    }),
  )
  await settle()
  cleanUp = async () => {
    stop()
    handle.dispose()
    await settle()
    surface.dispose()
  }
  return { fabric, surface, device, stop, exits: () => exits }
}

const page = (fabric: FakeFabric): FakeFabricNode => byTestId(fabric, 'page')
const runsShown = (fabric: FakeFabric): string => textOf(byTestId(fabric, 'view-runs'))

/** Everything the phone was last told to draw, as text. */
const snapshot = (fabric: FakeFabric): string => fabric.render({ props: true })

afterEach(async () => {
  await cleanUp?.()
  cleanUp = undefined
})

describe('Tailwind classes on the simulated phone', () => {
  it('turns a class into native style props', async () => {
    const { fabric } = await startDemo()
    // `flex-1 bg-white dark:bg-neutral-950`
    expect(page(fabric).props).toMatchObject({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: '0%',
      backgroundColor: WHITE,
    })
    // `gap-4 p-4`, on the view inside the scroll view's content view.
    const padded = page(fabric).children[0]?.children[0]?.children[0]
    expect(padded?.props).toMatchObject({
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      rowGap: 16,
    })
  })

  it('styles text: size, weight, color, letter case', async () => {
    const { fabric } = await startDemo()
    expect(byTestId(fabric, 'view-runs').props).toMatchObject({
      fontSize: 24,
      fontWeight: '700',
      color: 'rgb(23, 23, 23)',
    })
    const capitals = flatten(fabric.committed).find(
      node => node.props['textTransform'] === 'uppercase',
    )
    expect(capitals?.props).toMatchObject({ fontSize: 14, letterSpacing: 1.4 })
  })

  it('styles borders and corners', async () => {
    const { fabric } = await startDemo()
    const pill = flatten(fabric.committed).find(
      node => node.viewName === 'View' && textOf(node) === 'pill',
    )
    expect(pill?.props).toMatchObject({
      borderTopWidth: 2,
      borderTopColor: EMERALD,
      borderTopLeftRadius: 9999,
    })
  })

  it('draws a hairline as thin as the phone says it can', async () => {
    const { fabric } = await startDemo()
    const widths = flatten(fabric.committed).map(node => node.props['borderBottomWidth'])
    expect(widths).toContain(1 / 3)
  })

  it('applies the ios: variant on an iPhone and not the android: one', async () => {
    const { fabric } = await startDemo({ platform: 'ios' })
    const box = byTestId(fabric, 'platform-box')
    expect(box.props['backgroundColor']).toBe(SKY)
    expect(textOf(box)).toBe('This is an iPhone, so this box is blue.')
  })

  it('applies the android: variant on Android', async () => {
    const { fabric } = await startDemo({ platform: 'android' })
    const box = byTestId(fabric, 'platform-box')
    expect(box.props['backgroundColor']).toBe(EMERALD)
    expect(textOf(box)).toBe('This is an Android phone, so this box is green.')
  })

  it('dims a button while a finger is on it, without a Message', async () => {
    const { fabric } = await startDemo()
    const button = byTestId(fabric, 'redraw')
    const point = { identifier: 0, target: button.reactTag, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 }
    fabric.emit(button, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] })
    await settle()
    expect(byTestId(fabric, 'redraw').props['opacity']).toBe(0.6)
    expect(viewRunCount()).toBe(1)
    fabric.emit(byTestId(fabric, 'redraw'), 'topTouchCancel', { ...point, touches: [], changedTouches: [point] })
    await settle()
  })
})

describe('dark mode on the simulated phone', () => {
  it('starts light when the phone is light', async () => {
    const { fabric } = await startDemo({ colorScheme: 'light' })
    expect(page(fabric).props['backgroundColor']).toBe(WHITE)
    expect(hasTestId(fabric, 'badge-light')).toBe(true)
    expect(hasTestId(fabric, 'badge-dark')).toBe(false)
  })

  it('starts dark when the phone is dark', async () => {
    const { fabric } = await startDemo({ colorScheme: 'dark' })
    expect(page(fabric).props['backgroundColor']).toBe(NEAR_BLACK)
    expect(hasTestId(fabric, 'badge-light')).toBe(false)
    expect(hasTestId(fabric, 'badge-dark')).toBe(true)
  })

  it('changes the committed colors when the phone goes dark', async () => {
    const { fabric, device } = await startDemo()
    device.setColorScheme('dark')
    // No waiting: the engine commits in the same turn it is told.
    expect(page(fabric).props['backgroundColor']).toBe(NEAR_BLACK)
    expect(byTestId(fabric, 'view-runs').props['color']).toBe('rgb(250, 250, 250)')
    expect(hasTestId(fabric, 'badge-light')).toBe(false)
    expect(textOf(byTestId(fabric, 'badge-dark'))).toBe('The phone is in DARK mode')
  })

  it('does not run the Foldkit view for that change', async () => {
    const { fabric, device } = await startDemo()
    expect(viewRunCount()).toBe(1)
    expect(runsShown(fabric)).toBe('View runs: 1')
    device.setColorScheme('dark')
    await settle()
    expect(page(fabric).props['backgroundColor']).toBe(NEAR_BLACK)
    expect(viewRunCount()).toBe(1)
    expect(runsShown(fabric)).toBe('View runs: 1')
  })

  it('goes back to light, still without running the view', async () => {
    const { fabric, device } = await startDemo()
    const light = snapshot(fabric)
    device.setColorScheme('dark')
    expect(snapshot(fabric)).not.toBe(light)
    device.setColorScheme('light')
    await settle()
    expect(snapshot(fabric)).toBe(light)
    expect(viewRunCount()).toBe(1)
  })

  it('stays dark when the view does run again', async () => {
    const { fabric, device } = await startDemo()
    device.setColorScheme('dark')
    await press(fabric, 'redraw')
    // The count is live: a Message does run the view.
    expect(runsShown(fabric)).toBe('View runs: 2')
    expect(page(fabric).props['backgroundColor']).toBe(NEAR_BLACK)
    expect(byTestId(fabric, 'view-runs').props['color']).toBe('rgb(250, 250, 250)')
  })
})

describe('the window size on the simulated phone', () => {
  it('restyles when the phone is rotated, without running the view', async () => {
    const { fabric, device } = await startDemo({ window: { width: 390, height: 844 } })
    expect(byTestId(fabric, 'rotation-bar').props['backgroundColor']).toBe(ROSE)
    device.setWindow({ width: 844, height: 390 })
    expect(byTestId(fabric, 'rotation-bar').props['backgroundColor']).toBe(TEAL)
    await settle()
    expect(viewRunCount()).toBe(1)
    expect(runsShown(fabric)).toBe('View runs: 1')
  })
})

describe('the watcher', () => {
  it('stops listening when stopped', async () => {
    const { fabric, device, stop } = await startDemo()
    expect(device.listenerCount()).toBe(3)
    stop()
    expect(device.listenerCount()).toBe(0)
    device.setColorScheme('dark')
    await settle()
    expect(page(fabric).props['backgroundColor']).toBe(WHITE)
  })

  it('leaves the dark class alone when the app asks to manage it', async () => {
    registerPlatformComponents('ios')
    registerNavigation()
    const fabric = createFakeFabric()
    const device = makeFakeDevice()
    const surface = createNativeSurface(fabric, 1, {
      ...stylingOptions(sheet, device.sources),
      dev: false,
    })
    const stop = watchStyling(surface.engine, device.sources, { darkClass: false })
    const handle = Runtime.embed(
      makeDemo(surface.container, { device: { platform: 'ios', osVersion: 26 }, exit: () => {} }),
    )
    await settle()
    cleanUp = async () => {
      stop()
      handle.dispose()
      await settle()
      surface.dispose()
    }
    device.setColorScheme('dark')
    await settle()
    expect(page(fabric).props['backgroundColor']).toBe(WHITE)
    // The engine was still told, for `@media (prefers-color-scheme: dark)`.
    expect(surface.engine.conditions?.colorScheme).toBe('dark')
  })

  /** An engine that only writes down what it is told. */
  const recorder = () => {
    const calls: Array<string> = []
    const engine: StyledEngine<string> = {
      root: 'root',
      updateConditions: conditions =>
        calls.push(
          `conditions ${conditions.colorScheme} ${conditions.width}x${conditions.height} text x${conditions.fontScale}`,
        ),
      addClass: (_node, name) => calls.push(`add ${name}`),
      removeClass: (_node, name) => calls.push(`remove ${name}`),
      remeasureText: () => calls.push('remeasure text'),
      updateTokens: tokens => calls.push(`tokens ${Object.keys(tokens).join(' ')}`),
    }
    return { engine, calls }
  }

  it('tells the engine the platform once, at the start', () => {
    const { engine, calls } = recorder()
    const device = makeFakeDevice({ platform: 'android' })
    const stop = watchStyling(engine, device.sources)
    expect(calls).toEqual(['add platform-android', 'remove dark', 'conditions light 390x844 text x1'])
    stop()
  })

  it('tells the engine each color scheme once', () => {
    const { engine, calls } = recorder()
    const device = makeFakeDevice()
    const stop = watchStyling(engine, device.sources)
    calls.length = 0
    device.setColorScheme('dark')
    // The phone can report the same scheme again.
    device.setColorScheme('dark')
    expect(calls).toEqual(['add dark', 'conditions dark 390x844 text x1'])
    stop()
  })

  it('measures text again when the text size changes', () => {
    const { engine, calls } = recorder()
    const device = makeFakeDevice()
    const stop = watchStyling(engine, device.sources)
    calls.length = 0
    device.setFontScale(1.5)
    expect(calls).toEqual(['remove dark', 'conditions light 390x844 text x1.5', 'remeasure text'])
    // Coming back to the app with nothing changed does nothing.
    calls.length = 0
    device.setFontScale(1.5)
    expect(calls).toEqual([])
    stop()
  })

  it('reads the phone into conditions', () => {
    const device = makeFakeDevice({ colorScheme: 'dark', window: { width: 800, height: 600 } })
    expect(currentConditions(device.sources)).toEqual({
      width: 800,
      height: 600,
      colorScheme: 'dark',
      fontScale: 1,
      pixelRatio: 3,
      direction: 'ltr',
    })
  })
})

describe('leaving the demo', () => {
  it('calls exit when Exit is pressed', async () => {
    const { fabric, exits } = await startDemo()
    expect(exits()).toBe(0)
    await press(fabric, 'exit')
    expect(exits()).toBe(1)
  })
})
