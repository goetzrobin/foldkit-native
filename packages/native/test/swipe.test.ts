/**
 * Swipe actions on the simulated phone.
 *
 * Every behaviour is tested twice: once with the JavaScript driver, where a
 * finger is a series of touch events, and once with the UI thread driver,
 * where a finger is what gesture-handler's native code would report to a
 * worklet. `support/worklets.ts` stands in for the UI thread.
 *
 * These tests check the rules: what opens, what closes, what is triggered
 * and how often. They cannot show how any of it looks or feels on a phone.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { Phone as PhoneFeatures, registerNavigation } from '../src/index.js'
import { configureMotion } from '../src/motion/index.js'
import {
  type SwipeStyle,
  armedSide,
  closeAllSwipes,
  closeSwipe,
  decide,
  dragTo,
  info,
  openSwipeCount,
  registerSwipeDriver,
  resolveSwipeDriver,
  strip,
  swipeDrivers,
  swipeStageCount,
  swipeStyle,
  tiles,
  unregisterSwipeDriver,
} from '../src/swipe/index.js'
import {
  PAN_ACTIVE,
  PAN_BEGAN,
  PAN_CANCELLED,
  PAN_END,
  PAN_FAILED,
  configureWorklets,
  gestureTag,
  readShared,
  requireCompiledWorklets,
  resetWorklets,
  runOnUi,
  shared,
  springTo,
  stopAnimation,
} from '../src/worklets/index.js'
import { makeDemos } from './demos/index.js'
import { makeDemo } from './demos/swipe.js'
import { type SwipeFixtureOptions, makeSwipeFixture } from './swipe.js'
import { type Phone, byTestId, hasTestId, press, settle, startPhone, textOf } from './support/phone.js'
import { type FakeWorklets, makeWorklets } from './support/worklets.js'

type Kind = 'javascript' | 'ui-thread'

const ROW_WIDTH = 320
/** Two tiles of the `tiles` style: how far a row rests open on its trailing side. */
const TRAILING_OPEN = 160
/** One tile: the leading side. */
const LEADING_OPEN = 80

type Stage = {
  kind: Kind
  phone: Phone
  ui: FakeWorklets | undefined
  frames: Array<() => void>
  handle: { dispose: () => void }
}

let stage: Stage | undefined

const start = async (kind: Kind, options: SwipeFixtureOptions = {}): Promise<Stage> => {
  resetWorklets()
  // No Babel plugin runs here, so worklets are ordinary functions.
  requireCompiledWorklets(false)
  let ui: FakeWorklets | undefined
  if (kind === 'ui-thread') {
    ui = makeWorklets()
    configureWorklets(ui.config)
  }
  const phone = startPhone()
  const frames: Array<() => void> = []
  configureMotion(phone.surface, { requestFrame: run => frames.push(run) })
  const handle = Runtime.embed(makeSwipeFixture(phone.surface.container, { driver: kind, ...options }))
  await settle()
  stage = { kind, phone, ui, frames, handle }
  if (options.inList === true) {
    phone.fabric.emit(byTestId(phone.fabric, 'scroll'), 'topLayout', {
      layout: { x: 0, y: 0, width: ROW_WIDTH, height: 600 },
    })
    await settle()
  }
  for (const id of options.inList === true ? ['r0', 'r1'] : ['a', 'b', 'c']) layOut(id)
  await rest()
  return stage
}

afterEach(async () => {
  held = undefined
  if (stage !== undefined) {
    stage.handle.dispose()
    await settle()
    stage.phone.surface.dispose()
    stage.ui?.uninstall()
    stage = undefined
  }
  resetWorklets()
  requireCompiledWorklets(true)
  registerPlatformComponents('ios')
})

const at = (): Stage => {
  if (stage === undefined) throw new Error('No program is running')
  return stage
}

const node = (id: string): FakeFabricNode => byTestId(at().phone.fabric, id)

/** The phone tells the row how big it is. */
const layOut = (id: string): void => {
  at().phone.fabric.emit(node(id), 'topLayout', {
    layout: { x: 0, y: 0, width: ROW_WIDTH, height: 72 },
  })
}

/** Lets every spring run to its end, on whichever thread it runs. */
const rest = async (): Promise<void> => {
  const { ui, frames } = at()
  for (let round = 0; round < 3; round++) {
    ui?.flushUi()
    for (let turn = 0; turn < 3000 && (ui?.framesAsked() ?? 0) > 0; turn++) ui?.frame(16)
    for (let turn = 0; turn < 3000 && frames.length > 0; turn++) frames.shift()!()
    await settle()
  }
}

type TouchPhase = 'Start' | 'Move' | 'End' | 'Cancel'

const touch = (id: string, phase: TouchPhase, x: number, y: number, ms: number): void => {
  const target = node(id)
  const point = { identifier: 0, target: target.reactTag, pageX: x, pageY: y, locationX: x, locationY: y, timestamp: ms }
  const isDown = phase === 'Start' || phase === 'Move'
  at().phone.fabric.emit(target, `topTouch${phase}`, {
    ...point,
    touches: isDown ? [point] : [],
    changedTouches: [point],
  })
}

type DragOptions = Readonly<{
  /** How long each leg takes, in milliseconds. 2000 is slow, 60 is a flick. */
  ms?: number
  /** How far the finger also moves down, over the first leg. */
  dy?: number
  /** How the touch ends. `hold` leaves the finger down. */
  end?: 'lift' | 'cancel' | 'hold'
  /** The view the finger lands on. Default the row's content. */
  on?: string
}>

const STEPS = 8
const X0 = 160
const Y0 = 100

/** The finger that `end: 'hold'` left down, for `lift`. */
let held: { id: string; on: string; dx: number; dy: number; clock: number } | undefined

const dragWithTouches = (id: string, legs: ReadonlyArray<number>, options: DragOptions): void => {
  const on = options.on ?? `${id}-content`
  const ms = options.ms ?? 2000
  let clock = 0
  let from = 0
  touch(on, 'Start', X0, Y0, clock)
  legs.forEach((to, leg) => {
    for (let step = 1; step <= STEPS; step++) {
      clock += ms / STEPS
      const dx = from + ((to - from) * step) / STEPS
      const dy = leg === 0 ? ((options.dy ?? 0) * step) / STEPS : (options.dy ?? 0)
      touch(on, 'Move', X0 + dx, Y0 + dy, clock)
    }
    from = to
  })
  if (options.end === 'hold') {
    held = { id, on, dx: from, dy: options.dy ?? 0, clock }
    return
  }
  touch(on, options.end === 'cancel' ? 'Cancel' : 'End', X0 + from, Y0 + (options.dy ?? 0), clock + 1)
}

/** The distance gesture-handler waits for before a pan counts. See `PAN_CONFIG` in `src/swipe/row.ts`. */
const ACTIVATES_AT = 12

const dragWithGesture = (id: string, legs: ReadonlyArray<number>, options: DragOptions): void => {
  const { ui } = at()
  if (ui === undefined) throw new Error('No UI thread')
  const tag = node(`${id}-body`).reactTag
  const ms = options.ms ?? 2000
  const event = (translationX: number, velocityX = 0) => ({
    translationX,
    translationY: 0,
    velocityX,
    velocityY: 0,
  })
  const first = legs[0] ?? 0
  // JavaScript is told of the touch as well, as it is on a phone.
  const on = options.on ?? `${id}-content`
  touch(on, 'Start', X0, Y0, 0)
  if (Math.abs(options.dy ?? 0) > Math.abs(first)) {
    // A finger that goes up or down first: the native gesture gives up.
    ui.emit(tag, 'onGestureHandlerStateChange', { ...event(0), state: PAN_BEGAN, oldState: 0 })
    ui.emit(tag, 'onGestureHandlerStateChange', { ...event(0), state: PAN_FAILED, oldState: PAN_BEGAN })
    return
  }
  ui.emit(tag, 'onGestureHandlerStateChange', {
    ...event(Math.sign(first) * ACTIVATES_AT),
    state: PAN_ACTIVE,
    oldState: PAN_BEGAN,
  })
  // The native gesture has the touch now, so the phone takes it from JavaScript.
  touch(on, 'Cancel', X0 + Math.sign(first) * ACTIVATES_AT, Y0, 10)
  let from = Math.sign(first) * ACTIVATES_AT
  for (const to of legs) {
    for (let step = 1; step <= STEPS; step++) {
      ui.emit(tag, 'onGestureHandlerEvent', {
        ...event(from + ((to - from) * step) / STEPS),
        state: PAN_ACTIVE,
      })
    }
    from = to
  }
  if (options.end === 'hold') {
    held = { id, on, dx: from, dy: 0, clock: 0 }
    return
  }
  const last = legs[legs.length - 1] ?? 0
  const before = legs[legs.length - 2] ?? 0
  ui.emit(tag, 'onGestureHandlerStateChange', {
    ...event(last, ((last - before) * 1000) / ms),
    state: options.end === 'cancel' ? PAN_CANCELLED : PAN_END,
    oldState: PAN_ACTIVE,
  })
}

/**
 * A finger on row `id` moving sideways through `legs` (points from where it
 * went down, negative is left). Then every spring runs to its end.
 */
const drag = async (id: string, legs: ReadonlyArray<number>, options: DragOptions = {}): Promise<void> => {
  // What JavaScript last told the UI thread has long arrived by the time a finger moves.
  at().ui?.flushUi()
  if (at().kind === 'javascript') dragWithTouches(id, legs, options)
  else dragWithGesture(id, legs, options)
  if (options.end === 'hold') {
    at().ui?.flushUi()
    await settle()
    return
  }
  await rest()
}

/** Lifts the finger that `end: 'hold'` left down, without moving it. */
const lift = async (): Promise<void> => {
  const finger = held
  held = undefined
  if (finger === undefined) throw new Error('No finger is down')
  if (at().kind === 'javascript') {
    touch(finger.on, 'End', X0 + finger.dx, Y0 + finger.dy, finger.clock + 500)
  } else {
    at().ui?.emit(node(`${finger.id}-body`).reactTag, 'onGestureHandlerStateChange', {
      translationX: finger.dx,
      translationY: 0,
      velocityX: 0,
      velocityY: 0,
      state: PAN_END,
      oldState: PAN_ACTIVE,
    })
  }
  await rest()
}

type Placed = Readonly<{ x: number; width: number; opacity: number }>

/** Where a moving view is now, from whichever thread put it there. */
const placed = (id: string): Placed => {
  const view = node(id)
  const props =
    at().kind === 'ui-thread' ? (at().ui?.styles.get(view.reactTag) ?? {}) : view.props
  const transform = props['transform'] as ReadonlyArray<{ translateX?: number }> | undefined
  return {
    x: transform?.find(each => each.translateX !== undefined)?.translateX ?? 0,
    width: (props['width'] as number | undefined) ?? 0,
    opacity: (props['opacity'] as number | undefined) ?? 0,
  }
}

const offsetOf = (id: string): number => placed(`${id}-content`).x
const log = (): string => textOf(node('log'))
const presses = (): string => textOf(node('presses'))

describe('the rules of a swipe', () => {
  const limits = {
    leadingOpen: 80,
    trailingOpen: 160,
    leadingFull: false,
    trailingFull: true,
    leadingPassive: false,
    trailingPassive: false,
    leadingAway: false,
    trailingAway: true,
    rowWidth: 320,
    rowHeight: 72,
    dir: 1,
    reduceMotion: false,
  }

  it('lets a side be pulled freely to its open width, then stretches like rubber', () => {
    expect(dragTo(60, limits)).toBe(60)
    expect(dragTo(80, limits)).toBe(80)
    const past = dragTo(180, limits)
    expect(past).toBeGreaterThan(80)
    expect(past).toBeLessThan(140)
    // The further the pull, the less each point adds.
    expect(dragTo(280, limits) - past).toBeLessThan(past - 80)
  })

  it('lets a side with a full swipe be pulled the width of the row', () => {
    expect(dragTo(-300, limits)).toBe(-300)
    expect(dragTo(-400, limits)).toBeGreaterThan(-400)
  })

  it('decides by position when the finger is slow', () => {
    expect(decide(-100, 0, limits)).toEqual({ rest: -1, isFullSwipe: false })
    expect(decide(-60, 0, limits)).toEqual({ rest: 0, isFullSwipe: false })
  })

  it('decides by direction when the finger is fast', () => {
    expect(decide(-20, -900, limits)).toEqual({ rest: -1, isFullSwipe: false })
    expect(decide(-150, 900, limits)).toEqual({ rest: 0, isFullSwipe: false })
  })

  it('arms a full swipe only on a side that allows one, past the line', () => {
    expect(armedSide(-200, limits)).toBe(0)
    expect(armedSide(-220, limits)).toBe(-1)
    expect(armedSide(220, limits)).toBe(0)
    expect(decide(-220, 0, limits)).toEqual({ rest: -1, isFullSwipe: true })
  })
})

describe('the drivers', () => {
  it('lists the two that ship, and says why the UI thread one cannot run here', () => {
    resetWorklets()
    const drivers = swipeDrivers()
    expect(drivers.map(driver => driver.name)).toEqual(['ui-thread', 'javascript'])
    expect(drivers[0]).toMatchObject({ label: 'UI thread', ok: false })
    expect(drivers[0]?.reason).toBe('the app did not call configureWorklets()')
    expect(drivers[1]).toMatchObject({ label: 'JavaScript', ok: true, reason: '' })
  })

  it('falls back to JavaScript when the UI thread is asked for and missing, and says so', () => {
    resetWorklets()
    const resolved = resolveSwipeDriver('ui-thread')
    expect(resolved.name).toBe('javascript')
    expect(resolved.why).toBe('UI thread cannot run: the app did not call configureWorklets()')
    expect(resolveSwipeDriver('auto').name).toBe('javascript')
  })

  it('chooses the UI thread by itself when its pieces are there', async () => {
    await start('ui-thread')
    expect(resolveSwipeDriver('auto')).toMatchObject({ name: 'ui-thread', why: 'first that can run' })
    expect(resolveSwipeDriver('javascript')).toMatchObject({ name: 'javascript', why: 'asked for' })
  })

  it('takes a driver from another folder through the same door', async () => {
    let drawn = 0
    registerSwipeDriver('native', {
      label: 'Native',
      check: () => ({ ok: false, reason: 'needs the prebuilt app' }),
      row: (_h, _spec, _children) => null,
    })
    try {
      expect(swipeDrivers().find(driver => driver.name === 'native')).toEqual({
        name: 'native',
        label: 'Native',
        ok: false,
        reason: 'needs the prebuilt app',
      })
      expect(resolveSwipeDriver('native').name).toBe('javascript')
      registerSwipeDriver('native', {
        label: 'Native',
        check: () => ({ ok: true, reason: '' }),
        row: (h, _spec, _children) => {
          drawn += 1
          return h.empty as never
        },
      })
      const phone = startPhone()
      const handle = Runtime.embed(makeSwipeFixture(phone.surface.container, { driver: 'native' }))
      await settle()
      expect(drawn).toBe(3)
      handle.dispose()
      await settle()
      phone.surface.dispose()
      // Left out of the automatic choice unless the app puts it in the order.
      expect(resolveSwipeDriver('auto').name).toBe('javascript')
    } finally {
      unregisterSwipeDriver('native')
    }
  })
})

describe.each<Kind>(['javascript', 'ui-thread'])('a swipe row moved by the %s driver', kind => {
  it('uses the driver it was asked for', async () => {
    await start(kind)
    const calls = at().ui?.gestureCalls ?? []
    expect(calls.filter(call => call[0] === 'create').length).toBe(kind === 'ui-thread' ? 3 : 0)
  })

  it('opens when dragged more than half way and let go slowly', async () => {
    await start(kind)
    await drag('a', [-140])
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    expect(log()).toBe('opened a trailing')
    expect(openSwipeCount()).toBe(1)
  })

  it('stays closed when dragged less than half way and let go slowly', async () => {
    await start(kind)
    await drag('a', [-60])
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('')
  })

  it('opens on a short, fast flick', async () => {
    await start(kind)
    await drag('a', [-40], { ms: 50 })
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    expect(log()).toBe('opened a trailing')
  })

  it('closes an open row on a short, fast flick back', async () => {
    await start(kind)
    await drag('a', [-140])
    await drag('a', [40], { ms: 50 })
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('opened a trailing | closed a')
  })

  it('opens the leading side when dragged the other way', async () => {
    await start(kind)
    await drag('a', [70])
    expect(offsetOf('a')).toBe(LEADING_OPEN)
    expect(log()).toBe('opened a leading')
  })

  it('is cancelled by dragging back before letting go', async () => {
    await start(kind)
    await drag('a', [-150, -10])
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('')
  })

  it('goes back to where it rested when the phone takes the touch away', async () => {
    await start(kind)
    await drag('a', [-150], { end: 'cancel' })
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('')
    await drag('a', [-140])
    await drag('a', [100], { end: 'cancel' })
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    expect(log()).toBe('opened a trailing')
  })

  it('follows the finger while it is down, and spreads the tiles', async () => {
    await start(kind)
    await drag('a', [-100], { end: 'hold' })
    const moved = offsetOf('a')
    expect(moved).toBeLessThan(-80)
    expect(moved).toBeGreaterThanOrEqual(-100)
    const flag = placed('a-trailing-flag')
    const remove = placed('a-trailing-delete')
    expect(flag.opacity).toBeGreaterThan(0)
    expect(flag.width).toBe(72)
    // The tile next to the row is further in than the one at the edge.
    expect(flag.x).toBeLessThan(remove.x)
    await lift()
  })

  it('stretches like rubber when pulled past the end', async () => {
    await start(kind)
    await drag('a', [-300], { end: 'hold' })
    expect(offsetOf('a')).toBeLessThan(-TRAILING_OPEN)
    expect(offsetOf('a')).toBeGreaterThan(-250)
    expect(log()).toBe('')
  })

  it('triggers the first action once on a full swipe, after the row has slid away', async () => {
    await start(kind, { allowsFullSwipe: true })
    await drag('a', [-300], { end: 'hold' })
    expect(log()).toBe('armed a')
    // The tile at the edge has grown over the others.
    expect(placed('a-trailing-delete').width).toBeGreaterThan(72)
    await lift()
    expect(log()).toBe('armed a | triggered a delete')
    // The program removed the row.
    expect(hasTestId(at().phone.fabric, 'a')).toBe(false)
  })

  it('says when a drag crosses the full swipe line and when it comes back', async () => {
    await start(kind, { allowsFullSwipe: true })
    await drag('a', [-300, -30])
    expect(log()).toBe('armed a | disarmed a')
    expect(offsetOf('a')).toBe(0)
  })

  it('closes after a full swipe on an action that removes nothing', async () => {
    await start(kind, { allowsFullSwipe: true })
    await drag('a', [300])
    expect(log()).toBe('armed a | triggered a read')
    expect(offsetOf('a')).toBe(0)
    expect(openSwipeCount()).toBe(0)
  })

  it('does not trigger on a long pull when full swipe is off', async () => {
    await start(kind)
    await drag('a', [-310])
    expect(log()).toBe('opened a trailing')
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
  })

  it('keeps only one row open at a time', async () => {
    await start(kind)
    await drag('a', [-140])
    await drag('b', [-140])
    expect(offsetOf('a')).toBe(0)
    expect(offsetOf('b')).toBe(-TRAILING_OPEN)
    expect(log()).toBe('opened a trailing | closed a | opened b trailing')
    expect(openSwipeCount()).toBe(1)
  })

  it('closes the open row as soon as a finger starts on another', async () => {
    await start(kind)
    await drag('a', [-140])
    await drag('b', [-40], { end: 'hold' })
    expect(log()).toBe('opened a trailing | closed a')
    await lift()
  })

  it('lets rows in different groups be open together', async () => {
    await start(kind, { separateGroups: true })
    await drag('a', [-140])
    await drag('b', [-140])
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    expect(offsetOf('b')).toBe(-TRAILING_OPEN)
  })

  it('closes when the list starts to scroll', async () => {
    await start(kind)
    await drag('a', [-140])
    at().phone.fabric.emit(node('scroll'), 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } })
    await rest()
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('opened a trailing | closed a')
  })

  it('closes when the list has scrolled a little, and not when it only reports where it is', async () => {
    await start(kind)
    await drag('a', [-140])
    const scrolled = (y: number) =>
      at().phone.fabric.emit(node('scroll'), 'topScroll', { contentOffset: { x: 0, y } })
    scrolled(100)
    scrolled(101)
    await rest()
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    scrolled(130)
    await rest()
    expect(offsetOf('a')).toBe(0)
  })

  it('closes on a tap somewhere else', async () => {
    await start(kind)
    await drag('a', [-140])
    await press(at().phone.fabric, 'outside')
    await rest()
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('opened a trailing | closed a')
  })

  it('closes on a tap on the open row itself, without pressing what is inside', async () => {
    await start(kind)
    await drag('a', [-140])
    await press(at().phone.fabric, 'a-button')
    await rest()
    expect(offsetOf('a')).toBe(0)
    expect(presses()).toBe('0')
  })

  it('still presses a button inside a closed row', async () => {
    await start(kind)
    await press(at().phone.fabric, 'a-button')
    expect(presses()).toBe('1')
    expect(offsetOf('a')).toBe(0)
  })

  it('calls the button press off when the finger moves sideways on it', async () => {
    await start(kind)
    if (kind === 'javascript') {
      // The same finger then swipes the row.
      await drag('a', [-140], { on: 'a-button' })
      expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    } else {
      touch('a-button', 'Start', X0, Y0, 0)
      touch('a-button', 'Move', X0 - 30, Y0, 50)
      touch('a-button', 'End', X0 - 30, Y0, 100)
      await settle()
    }
    expect(presses()).toBe('0')
  })

  it('does not open when the finger goes up or down', async () => {
    await start(kind)
    await drag('a', [-6], { dy: 90 })
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('')
    expect(openSwipeCount()).toBe(0)
  })

  it('triggers an action when its tile is pressed, and closes', async () => {
    await start(kind)
    await drag('a', [-140])
    await press(at().phone.fabric, 'a-trailing-flag')
    await rest()
    expect(log()).toBe('opened a trailing | triggered a flag | closed a')
    expect(offsetOf('a')).toBe(0)
  })

  it('flips the sides when the app reads right to left', async () => {
    await start(kind, { rightToLeft: true })
    // Leading is on the right now, so dragging left shows it.
    await drag('a', [-70])
    expect(log()).toBe('opened a leading')
    expect(offsetOf('a')).toBe(-LEADING_OPEN)
    expect(node('a-leading-read').props['right']).toBe(0)
    expect(node('a-trailing-delete').props['left']).toBe(0)
    await drag('b', [140])
    expect(log()).toBe('opened a leading | closed a | opened b trailing')
    expect(offsetOf('b')).toBe(TRAILING_OPEN)
  })

  it('shows information with the info style, springs back, and triggers nothing', async () => {
    await start(kind, { style: info, trailingInfo: true, allowsFullSwipe: true })
    await drag('a', [-70], { end: 'hold' })
    expect(placed('a-trailing-info').opacity).toBeGreaterThan(0.5)
    expect(offsetOf('a')).toBeLessThan(-40)
    await lift()
    expect(offsetOf('a')).toBe(0)
    await drag('a', [300])
    expect(offsetOf('a')).toBe(0)
    expect(log()).toBe('')
    expect(openSwipeCount()).toBe(0)
    // A passive style offers a screen reader nothing to do.
    expect(node('a').props['accessibilityActions']).toBeUndefined()
    expect(node('a-leading-read').props['pointerEvents']).toBe('none')
  })

  it('lays the strip style out as equal parts of what shows', async () => {
    await start(kind, { style: strip })
    await drag('a', [-120], { end: 'hold' })
    const shown = -offsetOf('a')
    expect(placed('a-trailing-delete').width).toBeCloseTo(shown / 2 + 0.5, 5)
    expect(placed('a-trailing-flag').width).toBeCloseTo(shown / 2 + 0.5, 5)
    await lift()
    expect(offsetOf('a')).toBe(-148)
  })

  it('takes a style written by someone else', async () => {
    const wide: SwipeStyle = swipeStyle(tiles, {
      name: 'wide',
      openWidth: count => {
        'worklet'
        return count * 100
      },
    })
    await start(kind, { style: wide })
    await drag('a', [-180])
    expect(offsetOf('a')).toBe(-200)
  })

  it('offers each action to a screen reader, and triggers the one it picks', async () => {
    await start(kind)
    const row = node('a')
    expect(row.props['accessible']).toBe(true)
    expect(row.props['accessibilityLabel']).toBe('Row a')
    expect(row.props['accessibilityActions']).toEqual([
      { name: 'read', label: 'Read' },
      { name: 'delete', label: 'Delete' },
      { name: 'flag', label: 'Flag' },
    ])
    // Fabric only sends the event to a view that says it listens.
    expect(row.props['onAccessibilityAction']).toBe(true)
    expect(node('a-trailing-flag').props['accessibilityLabel']).toBe('Flag')
    expect(node('a-trailing-flag').props['accessibilityRole']).toBe('button')
    at().phone.fabric.emit(row, 'topAccessibilityAction', { actionName: 'flag' })
    await rest()
    expect(log()).toBe('triggered a flag')
    expect(offsetOf('a')).toBe(0)
  })

  it('jumps in place of springing when the user asked for less motion', async () => {
    await start(kind, { reduceMotion: true })
    const { ui, frames } = at()
    if (kind === 'javascript') dragWithTouches('a', [-140], {})
    else dragWithGesture('a', [-140], {})
    ui?.flushUi()
    // There already, with no frame run.
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
    expect(frames.length).toBe(0)
    expect(ui?.framesAsked() ?? 0).toBe(0)
    await settle()
    expect(log()).toBe('opened a trailing')
  })

  it('closes from a Command', async () => {
    await start(kind, { separateGroups: true })
    await drag('a', [-140])
    await drag('b', [-140])
    Effect.runSync(closeSwipe('a', { group: 'a' }))
    await rest()
    expect(offsetOf('a')).toBe(0)
    expect(offsetOf('b')).toBe(-TRAILING_OPEN)
    Effect.runSync(closeAllSwipes())
    await rest()
    expect(offsetOf('b')).toBe(0)
    expect(log()).toBe('opened a trailing | opened b trailing | closed a | closed b')
  })

  it('starts closed again when its view was removed while open and drawn again', async () => {
    await start(kind, { separateGroups: true })
    await drag('a', [-140])
    expect(swipeStageCount()).toBe(3)
    // Not `press`: that is a tap elsewhere, which would close the row first.
    touch('hide', 'Start', 0, 0, 0)
    touch('hide', 'End', 0, 0, 10)
    await settle()
    expect(hasTestId(at().phone.fabric, 'a')).toBe(false)
    expect(swipeStageCount()).toBe(0)
    expect(openSwipeCount('a')).toBe(0)
    touch('hide', 'Start', 0, 0, 20)
    touch('hide', 'End', 0, 0, 30)
    await settle()
    layOut('a')
    await rest()
    expect(offsetOf('a')).toBe(0)
    // And it works as new.
    await drag('a', [-140])
    expect(offsetOf('a')).toBe(-TRAILING_OPEN)
  })

  it('works in the virtualised list, and a row that scrolled away comes back closed', async () => {
    await start(kind, { inList: true })
    await drag('r0', [-140])
    expect(offsetOf('r0')).toBe(-TRAILING_OPEN)
    const drawn = swipeStageCount()
    expect(drawn).toBeLessThan(60)
    const scrollTo = async (y: number) => {
      at().phone.fabric.emit(node('scroll'), 'topScroll', {
        contentOffset: { x: 0, y },
        layoutMeasurement: { width: ROW_WIDTH, height: 600 },
        contentSize: { width: ROW_WIDTH, height: 200 * 72 },
      })
      await rest()
    }
    await scrollTo(0)
    await scrollTo(9000)
    expect(hasTestId(at().phone.fabric, 'r0')).toBe(false)
    expect(openSwipeCount()).toBe(0)
    expect(swipeStageCount()).toBeLessThan(60)
    await scrollTo(0)
    layOut('r0')
    await rest()
    expect(offsetOf('r0')).toBe(0)
    await drag('r0', [70])
    expect(offsetOf('r0')).toBe(LEADING_OPEN)
  })

  it('leaves nothing behind when the program is disposed', async () => {
    const { ui, phone, handle } = await start(kind)
    await drag('a', [-140])
    handle.dispose()
    await settle()
    phone.surface.dispose()
    expect(swipeStageCount()).toBe(0)
    expect(openSwipeCount()).toBe(0)
    if (ui !== undefined) {
      const made = ui.gestureCalls.filter(call => call[0] === 'create').map(call => call[2])
      const dropped = ui.gestureCalls.filter(call => call[0] === 'drop').map(call => call[1])
      expect(dropped.sort()).toEqual(made.sort())
      expect(ui.eventHandlers.length).toBe(0)
    }
    stage = undefined
    ui?.uninstall()
  })
})

describe('the UI thread driver and gesture-handler', () => {
  it('asks for a pan that starts sideways and gives up on up or down, so a list scrolls', async () => {
    const { ui } = await start('ui-thread')
    const made = ui?.gestureCalls.find(call => call[0] === 'create')
    expect(made?.[1]).toBe('PanGestureHandler')
    expect(made?.[3]).toEqual({
      activeOffsetXStart: -12,
      activeOffsetXEnd: 12,
      failOffsetYStart: -10,
      failOffsetYEnd: 10,
    })
  })

  it('can make the scroll view wait for the swipe, when the program names its gesture', async () => {
    const scrollGesture = gestureTag()
    const { ui } = await start('ui-thread', { scrollGesture })
    const calls = ui?.gestureCalls ?? []
    expect(calls).toContainEqual(['create', 'NativeViewGestureHandler', scrollGesture.handlerTag, {}])
    expect(calls).toContainEqual(['attach', scrollGesture.handlerTag, node('scroll').reactTag, 1])
    const related = calls.filter(call => call[0] === 'relations')
    expect(related.length).toBe(3)
    expect(related[0]?.[2]).toEqual({
      simultaneousHandlers: [],
      waitFor: [],
      blocksHandlers: [scrollGesture.handlerTag],
    })
  })

  it('starts a spring at the speed the finger had', async () => {
    const { ui } = await start('ui-thread')
    const still = shared(0)
    const moving = shared(0)
    runOnUi(springTo, still, 100, { stiffness: 260, damping: 28 })
    runOnUi(springTo, moving, 100, { stiffness: 260, damping: 28, velocity: 2000 })
    ui?.flushUi()
    ui?.frame(16)
    ui?.frame(16)
    expect(readShared(moving)).toBeGreaterThan(readShared(still) + 20)
    runOnUi(stopAnimation, still)
    runOnUi(stopAnimation, moving)
    ui?.flushUi()
  })

  it('moves the row with no draw from JavaScript', async () => {
    const { ui, phone } = await start('ui-thread')
    const before = JSON.stringify(node('a-content').props)
    const commits = phone.fabric.commitCount
    await drag('a', [-100], { end: 'hold' })
    expect(offsetOf('a')).toBeLessThan(-80)
    expect(JSON.stringify(node('a-content').props)).toBe(before)
    expect(phone.fabric.commitCount).toBe(commits)
    expect(ui?.updates.length).toBeGreaterThan(0)
    await lift()
  })
})

describe.each<Kind>(['javascript', 'ui-thread'])('the Swipe actions demo with the %s driver', kind => {
  const open = async (options: Parameters<typeof makeDemo>[3] = {}) => {
    resetWorklets()
    requireCompiledWorklets(false)
    let ui: FakeWorklets | undefined
    if (kind === 'ui-thread') {
      ui = makeWorklets()
      configureWorklets(ui.config)
    }
    const phone = startPhone()
    registerNavigation()
    const frames: Array<() => void> = []
    configureMotion(phone.surface, { requestFrame: run => frames.push(run) })
    const device = PhoneFeatures.makeTest()
    let exits = 0
    const handle = Runtime.embed(
      makeDemo(
        phone.surface.container,
        { device: { platform: 'ios', osVersion: 26 } as never, exit: () => (exits += 1) },
        device.layer,
        options,
      ),
    )
    stage = { kind, phone, ui, frames, handle }
    await settle()
    await settle()
    for (const id of ['mail-1', 'mail-2', 'task-1', 'bubble-1']) layOut(id)
    await rest()
    return { device, exits: () => exits }
  }

  it('is on the menu', () => {
    const demos = makeDemos({ device: PhoneFeatures.makeTest().layer })
    expect(demos.find(demo => demo.id === 'swipe')?.title).toBe('Swipe actions')
  })

  it('says which driver is in use and why, and lists every driver', async () => {
    await open()
    if (kind === 'ui-thread') {
      expect(textOf(node('swipe-active'))).toBe('In use: UI thread (first that can run)')
      expect(hasTestId(at().phone.fabric, 'swipe-driver-ui-thread-reason')).toBe(false)
    } else {
      expect(textOf(node('swipe-active'))).toBe(
        'In use: JavaScript (UI thread cannot run: the app did not call configureWorklets())',
      )
      expect(textOf(node('swipe-driver-ui-thread-reason'))).toBe(
        'UI thread: not available. the app did not call configureWorklets()',
      )
    }
    expect(textOf(node('swipe-driver-ui-thread'))).toBe('UI thread')
    expect(textOf(node('swipe-driver-javascript'))).toBe('JavaScript')
  })

  it('lists a driver another folder registered, with why it cannot run', async () => {
    registerSwipeDriver('native', {
      label: 'Native',
      check: () => ({ ok: false, reason: 'needs the prebuilt app' }),
      row: () => null,
    })
    try {
      await open()
      expect(textOf(node('swipe-driver-native'))).toBe('Native')
      expect(textOf(node('swipe-driver-native-reason'))).toBe(
        'Native: not available. needs the prebuilt app',
      )
      await press(at().phone.fabric, 'swipe-driver-native')
      await settle()
      expect(textOf(node('swipe-active'))).toContain('Native cannot run: needs the prebuilt app')
    } finally {
      unregisterSwipeDriver('native')
    }
  })

  it('can be forced to the JavaScript driver, and the rows still swipe', async () => {
    await open()
    await press(at().phone.fabric, 'swipe-driver-javascript')
    await settle()
    expect(textOf(node('swipe-active'))).toBe('In use: JavaScript (asked for)')
    at().kind = 'javascript'
    layOut('mail-1')
    await drag('mail-1', [-140])
    expect(offsetOf('mail-1')).toBe(-TRAILING_OPEN)
    expect(textOf(node('swipe-last-event'))).toBe('Last event: opened mail-1 on its trailing side (1 so far)')
    at().kind = kind
  })

  it('deletes a mail on a full swipe, taps the phone at the line, and can undo', async () => {
    const { device } = await open()
    await drag('mail-1', [-300])
    expect(hasTestId(at().phone.fabric, 'mail-1')).toBe(false)
    expect(device.haptics.calls).toEqual(['impact:medium'])
    expect(textOf(node('swipe-deleted'))).toBe('Deleted "Notes from Tuesday".')
    expect(textOf(node('swipe-last-event'))).toBe('Last event: delete on mail-1 (2 so far)')
    await press(at().phone.fabric, 'swipe-undo')
    await settle()
    layOut('mail-1')
    await rest()
    expect(hasTestId(at().phone.fabric, 'swipe-undo')).toBe(false)
    // Back in its place, and closed.
    expect(offsetOf('mail-1')).toBe(0)
    const inbox = node('swipe-inbox').children.map(child => child.props['testID'])
    expect(inbox[0]).toBe('mail-1')
  })

  it('opens without triggering when full swipe is off', async () => {
    const { device } = await open()
    await press(at().phone.fabric, 'swipe-full')
    await settle()
    await drag('mail-1', [-300])
    expect(hasTestId(at().phone.fabric, 'mail-1')).toBe(true)
    expect(offsetOf('mail-1')).toBe(-TRAILING_OPEN)
    expect(device.haptics.calls).toEqual([])
  })

  it('marks a mail read from the leading side, and counts taps on the small button', async () => {
    await open()
    await drag('mail-1', [70])
    await press(at().phone.fabric, 'mail-1-leading-read')
    await rest()
    expect(textOf(node('mail-1-leading-read'))).toBe('Unread')
    await press(at().phone.fabric, 'mail-1-tap')
    expect(textOf(node('swipe-taps'))).toBe('Taps on the small buttons: 1')
  })

  it('changes the style of the inbox, and has three actions on a task', async () => {
    await open()
    await press(at().phone.fabric, 'swipe-style-strip')
    await settle()
    layOut('mail-1')
    await drag('mail-1', [-140])
    expect(offsetOf('mail-1')).toBe(-148)
    await drag('task-1', [-200])
    expect(offsetOf('task-1')).toBe(-222)
    await press(at().phone.fabric, 'task-1-trailing-rename')
    await rest()
    expect(textOf(node('task-1'))).toContain('Water the plants (renamed)')
  })

  it('shows a time behind a chat bubble and springs back', async () => {
    await open()
    await drag('bubble-1', [-80], { end: 'hold' })
    expect(placed('bubble-1-trailing-info').opacity).toBeGreaterThan(0.5)
    expect(textOf(node('bubble-1-trailing-info'))).toBe('09:41')
    await lift()
    expect(offsetOf('bubble-1')).toBe(0)
    expect(textOf(node('swipe-last-event'))).toBe('Last event: none yet')
  })

  it('flips the sides with right to left on', async () => {
    await open({ rightToLeft: true })
    expect(textOf(node('swipe-rtl'))).toBe('Right to left: on')
    await drag('mail-1', [140])
    expect(textOf(node('swipe-last-event'))).toBe('Last event: opened mail-1 on its trailing side (1 so far)')
  })

  it('leaves through its button', async () => {
    const { exits } = await open()
    await press(at().phone.fabric, 'swipe-exit')
    expect(exits()).toBe(1)
  })
})
