/**
 * What a finger does in a scrolling list. The four cases of the Touch tests
 * screen, on the simulated phone.
 *
 * Run it against the engine the apps install as well, where the scroll bug
 * is (see docs/upstream/ng-native-scroll-ignore.md):
 *   FABRIC_ENTRY=$PWD/node_modules/@ng-native/fabric/dist/index.js
 */
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import * as Look from '../playground/look.js'
import { Touch } from '../playground/touch.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const HOLD_MS = 60

const start = () => NativeTest.mount(Touch, { hasReadout: false }, { longPressMs: HOLD_MS })

const counts = (app: { root: { model: () => any } }) => {
  const model = app.root.model()
  return { rows: model.rowPresses, holds: model.rowHolds, buttons: model.buttonPresses }
}

describe('touch in a scrolling list', () => {
  it('a press on a row counts once', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.press('touch-row-3')
        expect(counts(app)).toEqual({ rows: 1, holds: 0, buttons: 0 })
        expect(app.text('touch-last')).toBe('Last: pressed row 4')
      }),
    ))

  it('the pressed style shows while the finger is down, with no Message', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        const dispatched = app.stats.dispatched
        yield* app.touchStart('touch-row-1')
        expect((app.byTestId('touch-row-1').props['backgroundColor'] as unknown) ?? undefined).toBeDefined()
        const pressed = JSON.stringify(app.byTestId('touch-row-1').props)
        expect(app.stats.dispatched).toBe(dispatched)
        yield* app.touchEnd('touch-row-1')
        expect(JSON.stringify(app.byTestId('touch-row-1').props)).not.toBe(pressed)
        expect(app.stats.dispatched).toBe(dispatched + 1)
        void Look
      }),
    ))

  it('a finger that drifts more than ten points is not a press', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.touchStart('touch-row-2', { x: 100, y: 100 })
        yield* app.touchMove('touch-row-2', { x: 100, y: 106 })
        yield* app.touchMove('touch-row-2', { x: 100, y: 130 })
        yield* app.touchEnd('touch-row-2', { x: 100, y: 130 })
        expect(counts(app).rows).toBe(0)
        expect(app.stats.cancelled).toBe(1)
        // A small drift is still a press.
        yield* app.touchStart('touch-row-2', { x: 100, y: 100 })
        yield* app.touchMove('touch-row-2', { x: 104, y: 105 })
        yield* app.touchEnd('touch-row-2', { x: 104, y: 105 })
        expect(counts(app).rows).toBe(1)
      }),
    ))

  it('a scroll a finger makes calls the press off', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.touchStart('touch-row-2')
        yield* app.emit('touch-list', 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } })
        yield* app.scroll('touch-list', { y: 30, byUser: true })
        yield* app.touchEnd('touch-row-2')
        expect(counts(app)).toEqual({ rows: 0, holds: 0, buttons: 0 })
      }),
    ))

  it('a hold counts as a hold, and the lift after it is not a press', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.touchStart('touch-row-5')
        yield* app.wait(HOLD_MS + 40)
        expect(counts(app)).toEqual({ rows: 0, holds: 1, buttons: 0 })
        yield* app.touchEnd('touch-row-5')
        expect(counts(app)).toEqual({ rows: 0, holds: 1, buttons: 0 })
        // A touch shorter than a hold is a press.
        yield* app.press('touch-row-5')
        expect(counts(app)).toEqual({ rows: 1, holds: 1, buttons: 0 })
      }),
    ))

  it('a button inside a pressable row takes the press, and the row does not', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.press('touch-button-7')
        expect(counts(app)).toEqual({ rows: 0, holds: 0, buttons: 1 })
        expect(app.text('touch-last')).toBe('Last: pressed the button in row 8')
        yield* app.press('touch-row-7')
        expect(counts(app)).toEqual({ rows: 1, holds: 0, buttons: 1 })
      }),
    ))

  it('a press survives scrolls the program made', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.touchStart('touch-row-4')
        yield* app.scroll('touch-list', { y: 12, byUser: false })
        yield* app.scroll('touch-list', { y: 24, byUser: false })
        yield* app.touchEnd('touch-row-4')
        expect(counts(app)).toEqual({ rows: 1, holds: 0, buttons: 0 })
        // On the engine with the bug, the host's workaround is what kept it.
        if (process.env['FABRIC_ENTRY'] !== undefined) expect(app.stats.keptThroughScroll).toBe(1)
        else expect(app.stats.keptThroughScroll).toBe(0)
      }),
    ))

  it('a hold survives scrolls the program made', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.touchStart('touch-row-4')
        yield* app.scroll('touch-list', { y: 12, byUser: false })
        yield* app.wait(HOLD_MS + 40)
        yield* app.scroll('touch-list', { y: 24, byUser: false })
        expect(counts(app)).toEqual({ rows: 0, holds: 1, buttons: 0 })
        yield* app.touchEnd('touch-row-4')
        expect(counts(app)).toEqual({ rows: 0, holds: 1, buttons: 0 })
      }),
    ))

  it('after a program scroll, a finger that drifts or a touch the phone cancels still ends the press', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.touchStart('touch-row-4', { x: 50, y: 50 })
        yield* app.scroll('touch-list', { y: 12, byUser: false })
        yield* app.touchMove('touch-row-4', { x: 50, y: 90 })
        yield* app.touchEnd('touch-row-4', { x: 50, y: 90 })
        expect(counts(app).rows).toBe(0)
        yield* app.touchStart('touch-row-4')
        yield* app.scroll('touch-list', { y: 24, byUser: false })
        yield* app.touchCancel('touch-row-4')
        expect(counts(app).rows).toBe(0)
      }),
    ))

  it('the auto scroll button scrolls the list by Command, and a press during it counts', () =>
    run(
      Effect.gen(function* () {
        const app = yield* start()
        yield* app.press('touch-auto')
        yield* app.wait(350)
        const scrolls = app.commands().filter(command => command.name === 'scrollTo')
        expect(scrolls.length).toBeGreaterThanOrEqual(2)
        expect(scrolls[0]?.viewName).toContain('ScrollView')
        yield* app.touchStart('touch-row-1')
        // The phone reports the program's scroll while the finger is down.
        yield* app.scroll('touch-list', { y: 36, byUser: false })
        yield* app.touchEnd('touch-row-1')
        expect(counts(app).rows).toBe(1)
        yield* app.press('touch-auto')
      }),
    ))
})
