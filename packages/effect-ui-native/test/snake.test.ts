/**
 * Snake end to end on the simulated phone: opened from the playground's
 * menu, played with the keypad and with a swipe.
 *
 * The clock is Effect's test clock, as in the browser example's
 * `SnakeGame.play.test.ts`: a test moves time on by hand. The apple comes
 * from a seeded random number, as there. The tests read the board off the
 * phone: the colour and shape of each of the 400 committed cells.
 */
import { Effect, Layer, Random } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../playground/app.js'
import * as Look from '../playground/snake/look.js'
import { type SnakeGameModel, SnakeGame, tickInterval, tickMeter, viewRuns } from '../playground/snake/SnakeGame.js'
import { playgroundServices } from '../playground/start.js'
import { Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { boardOf, cellsOf, digitsOf } from './snakeSupport.js'
import { provideForTest, run } from './support.js'

const services = () => {
  const device = Phone.Device.makeTest()
  return { device, layer: Layer.provideMerge(playgroundServices(device.layer, { serverDelayMs: 20 }), device.layer) }
}

/** The playground with the Snake screen open. */
const start = () =>
  Effect.gen(function* () {
    registerNavigation()
    const { device, layer } = services()
    const app = yield* NativeTest.mount(App, { platform: 'ios', hasReadout: false }).pipe(provideForTest(layer))
    yield* app.press('menu-Snake')
    return { app, device }
  })

/** The Snake screen alone, so a test can read its Model. */
const startAlone = (hasReadout = false) =>
  Effect.gen(function* () {
    const { device, layer } = services()
    const app = yield* NativeTest.mount(SnakeGame, { hasReadout }).pipe(provideForTest(layer))
    const model = (): SnakeGameModel => app.root.model() as SnakeGameModel
    return { app, device, model }
  })

/** The seed "e" puts the first apple one row up from the snake and six cells to its right, as in the browser test. */
const played = <A>(test: Effect.Effect<A, never, any>): Promise<A> =>
  run(test.pipe(Effect.provide(TestClock.layer()), Random.withSeed('e')))

const pass = (app: { settle: Effect.Effect<void> }, ms: number) => Effect.andThen(TestClock.adjust(ms), app.settle)

const key = (name: string): string => `snake-key-${name}`

describe('Snake on the phone', () => {
  it('opens from the menu: the title bar, the handset, the first board and the words PRESS 5', () =>
    played(
      Effect.gen(function* () {
        const { app } = yield* start()
        const headers = NativeTest.flatten(app.fabric.committed).filter(node => node.viewName === 'RNSScreenStackHeaderConfig')
        expect(headers.map(header => header.props['title'])).toEqual(['Effect UI Native', 'Snake'])
        expect(app.text('snake-status')).toBe('PRESS 5')
        expect(app.allText()).toContain('EFFECT UI NATIVE')
        // Twenty rows of twenty cells, nothing unknown on it.
        expect(boardOf(app)).toHaveLength(20)
        expect(boardOf(app).join('')).toMatch(/^[.#o]{400}$/)
        expect(cellsOf(app, '#')).toEqual(['8,10', '9,10', '10,10'])
        expect(cellsOf(app, 'o')).toEqual(['16,9'])
        expect(digitsOf(app, 'snake-score')).toBe('0000')
        expect(digitsOf(app, 'snake-high')).toBe('0000')
        // Twelve keys, in the order of a phone's keypad.
        const keys = NativeTest.flatten([app.byTestId('snake-keypad')])
          .map(node => String(node.props['testID'] ?? ''))
          .filter(id => id.startsWith('snake-key-'))
        expect(keys.map(id => id.slice(10))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'star', '0', 'hash'])
        expect(app.byTestId(key('2')).props['accessibilityLabel']).toBe('Up')
      }),
    ))

  it('steers to the apple with the keypad, eats it and pauses', () =>
    played(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press(key('5'))
        expect(app.has('snake-status')).toBe(false)
        yield* app.press(key('2'))
        yield* pass(app, 150)
        expect(cellsOf(app, '#')).toEqual(['10,9', '9,10', '10,10'])
        yield* app.press(key('6'))
        yield* pass(app, 750)
        // One cell short of the apple.
        expect(cellsOf(app, '#')).toEqual(['13,9', '14,9', '15,9'])
        expect(digitsOf(app, 'snake-score')).toBe('0000')
        yield* pass(app, 150)
        // Eaten: one cell longer, ten points, and a new apple somewhere else.
        expect(cellsOf(app, '#')).toEqual(['13,9', '14,9', '15,9', '16,9'])
        expect(digitsOf(app, 'snake-score')).toBe('0010')
        expect(app.byTestId('snake-score').props['accessibilityLabel']).toBe('Score 10')
        expect(cellsOf(app, 'o')).toHaveLength(1)
        expect(cellsOf(app, 'o')).not.toEqual(['16,9'])
        // Pause stops the clock.
        yield* app.press(key('5'))
        const paused = boardOf(app)
        yield* pass(app, 10_000)
        expect(app.text('snake-status')).toBe('PAUSED')
        expect(boardOf(app)).toEqual(paused)
        // And 5 goes on.
        yield* app.press(key('5'))
        yield* pass(app, 140)
        expect(cellsOf(app, '#')).toEqual(['14,9', '15,9', '16,9', '17,9'])
      }),
    ))

  it('every key gives one light tap, also a key with no job', () =>
    played(
      Effect.gen(function* () {
        const { app, device } = yield* start()
        yield* app.press(key('5'))
        yield* app.press(key('2'))
        yield* app.press(key('7'))
        yield* app.press(key('hash'))
        expect(device.haptics.calls).toEqual(['impact:light', 'impact:light', 'impact:light', 'impact:light'])
        yield* pass(app, 150)
        expect(cellsOf(app, '#')).toEqual(['10,9', '9,10', '10,10'])
      }),
    ))

  it('a swipe on the green screen steers: the finger goes down and drifts, and the snake turns at the next tick', () =>
    played(
      Effect.gen(function* () {
        const { app, device } = yield* start()
        yield* app.press(key('5'))
        // Down, then eleven points up: the host ends the touch there, while the finger is still on the glass.
        yield* app.touchStart('snake-lcd', { x: 120, y: 300 })
        yield* app.touchMove('snake-lcd', { x: 121, y: 289 })
        yield* pass(app, 150)
        expect(cellsOf(app, '#')).toEqual(['10,9', '9,10', '10,10'])
        yield* app.touchEnd('snake-lcd', { x: 121, y: 280 })
        // A new touch that ends to the left: the snake is going up, so left is a real turn.
        yield* app.touchStart('snake-lcd', { x: 200, y: 300 })
        yield* app.touchMove('snake-lcd', { x: 160, y: 304 })
        yield* app.touchEnd('snake-lcd', { x: 160, y: 304 })
        yield* pass(app, 150)
        expect(cellsOf(app, '#')).toEqual(['9,9', '10,9', '10,10'])
        // A tap that does not move steers nothing, and a swipe gives no tap under the finger.
        yield* app.touchStart('snake-lcd', { x: 200, y: 300 })
        yield* app.touchEnd('snake-lcd', { x: 202, y: 301 })
        yield* pass(app, 150)
        expect(cellsOf(app, '#')).toEqual(['8,9', '9,9', '10,9'])
        expect(device.haptics.calls).toEqual(['impact:light'])
      }),
    ))

  it('a tick changes two cells on the phone and nothing else', () =>
    played(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press(key('5'))
        yield* pass(app, 150)
        const cell = (x: number, y: number) => app.byTestId('snake-board').children[y]?.children[x]
        const before = boardOf(app)
        const calls = { ...app.fabric.calls }
        const runs = { ...viewRuns }
        const untouchedRow = app.byTestId('snake-board').children[3]
        const keypad = app.byTestId('snake-keypad')
        yield* pass(app, 150)
        const after = boardOf(app)
        const changed = after.flatMap((row, y) => [...row].flatMap((letter, x) => (letter === before[y]?.charAt(x) ? [] : [`${x},${y}`])))
        // The new head and the cell the tail left.
        expect(changed).toEqual(['9,10', '12,10'])
        expect(cell(12, 10)?.props['backgroundColor']).toBe(Look.LCD_ON)
        expect(cell(9, 10)?.props['backgroundColor']).toBe(Look.LCD_OFF)
        // What the phone was sent: two views with new props, no view made, one commit.
        expect(app.fabric.calls.cloneWithProps - calls.cloneWithProps).toBe(2)
        expect(app.fabric.calls.createNode - calls.createNode).toBe(0)
        expect(app.fabric.calls.completeRoot - calls.completeRoot).toBe(1)
        // A row with no change and the keypad are the very same views as before.
        expect(app.byTestId('snake-board').children[3]).toBe(untouchedRow)
        expect(app.byTestId('snake-keypad')).toBe(keypad)
        // One row's view ran, and no digit's or key's.
        expect(viewRuns.rows - runs.rows).toBe(1)
        expect(viewRuns.digits - runs.digits).toBe(0)
        expect(viewRuns.keypad - runs.keypad).toBe(0)
      }),
    ))

  it('a whole game: two apples, the clock gets faster, the snake runs into itself, and 0 starts again with the high score kept', () =>
    played(
      Effect.gen(function* () {
        const { app, model } = yield* startAlone()
        yield* app.press(key('5'))
        // Steers by the rules alone: get onto the apple's row, then run along it. The board has no walls.
        const steerToApple = Effect.gen(function* () {
          const { snake, apple, direction } = model()
          const isOnRow = snake[0].y === apple.y
          if (!isOnRow && (direction === 'Left' || direction === 'Right')) yield* app.press(key('8'))
          if (isOnRow && (direction === 'Up' || direction === 'Down')) yield* app.press(key('6'))
        })
        let ticks = 0
        while (model().points < 20 && ticks < 200) {
          yield* steerToApple
          yield* pass(app, tickInterval(model().points))
          ticks++
        }
        expect(model().points).toBe(20)
        expect(digitsOf(app, 'snake-score')).toBe('0020')
        expect(cellsOf(app, '#')).toHaveLength(5)
        expect([...cellsOf(app, '#')].sort()).toEqual(model().snake.map(each => `${each.x},${each.y}`).sort())

        // The speed rule: at 20 points a tick is 130 ms, not 150.
        const head = () => model().snake[0]
        const at = head()
        yield* pass(app, 129)
        expect(head()).toEqual(at)
        yield* pass(app, 1)
        expect(head()).not.toEqual(at)

        // Round in a small square: the fourth turn meets the tail.
        const order = { Right: ['8', '4', '2'], Left: ['8', '6', '2'], Up: ['6', '8', '4'], Down: ['6', '2', '4'] } as const
        for (const turn of order[model().direction]) {
          yield* app.press(key(turn))
          yield* pass(app, 130)
        }
        expect(model().gameState).toBe('GameOver')
        expect(app.text('snake-status')).toBe('GAME OVER')
        expect(digitsOf(app, 'snake-high')).toBe('0020')
        // The clock has stopped, and 5 does nothing now.
        const over = boardOf(app)
        yield* app.press(key('5'))
        yield* pass(app, 1000)
        expect(boardOf(app)).toEqual(over)

        // 0: a new game, with the high score kept.
        yield* app.press(key('0'))
        expect(app.text('snake-status')).toBe('PRESS 5')
        expect(digitsOf(app, 'snake-score')).toBe('0000')
        expect(digitsOf(app, 'snake-high')).toBe('0020')
        expect(cellsOf(app, '#')).toEqual(['8,10', '9,10', '10,10'])
        expect(cellsOf(app, 'o')).toHaveLength(1)
      }),
    ))

  it('the board is sized from the room the phone reports, in whole points', () =>
    played(
      Effect.gen(function* () {
        const { app } = yield* startAlone()
        const sizes = () => {
          const board = app.byTestId('snake-board')
          return { board: board.props['width'], cell: board.children[0]?.children[0]?.props['width'], key: app.byTestId(key('5')).props['height'] }
        }
        const report = (width: number, height: number) =>
          app.emit('snake-screen', 'topLayout', { layout: { x: 0, y: 0, width, height } })
        // A large iPhone: the width sets the board.
        yield* report(430, 795)
        expect(sizes()).toEqual({ board: 17 * 20 + 8, cell: 16, key: 54 })
        // A small one: the height does, and the keys stay big enough to press.
        yield* report(375, 603)
        expect(sizes()).toEqual({ board: 11 * 20 + 8, cell: 10, key: 41 })
        // Whatever the phone, the handset fits: board, keypad and the rest are no taller than the room.
        for (const [width, height] of [[320, 504], [375, 603], [390, 700], [412, 780], [430, 795]] as const) {
          const made = Look.sizesFor({ width, height })
          expect(made.field + 4 * made.keyHeight + 209).toBeLessThanOrEqual(height)
          expect(made.field + 88 - 8).toBeLessThanOrEqual(width)
        }
      }),
    ))

  it('the line of numbers shows the two times, and its switch hides it and stops it', () =>
    played(
      Effect.gen(function* () {
        tickMeter.reset()
        const { app } = yield* startAlone(true)
        yield* app.press(key('5'))
        yield* pass(app, 150)
        yield* pass(app, 150)
        expect(tickMeter.read().ticks).toBe(2)
        expect(tickMeter.read().lastMs).toBeGreaterThan(0)
        yield* pass(app, 500)
        expect(app.text('snake-numbers')).toMatch(
          /^JS frame: [\d.]+ ms average, [\d.]+ ms longest\. Last tick: [\d.]+ ms in JS, longest [\d.]+ ms$/,
        )
        expect(app.text('snake-numbers')).not.toContain('Last tick: 0 ms')
        yield* app.press('snake-numbers-switch')
        expect(app.text('snake-numbers')).toBe('')
        expect(app.allText()).toContain('Numbers: off')
        // Hidden: the numbers are not read any more, so the game's view does not run for them.
        yield* app.press(key('5'))
        const runs = viewRuns.game
        yield* app.wait(40)
        yield* pass(app, 2000)
        expect(viewRuns.game).toBe(runs)
      }),
    ))
})
