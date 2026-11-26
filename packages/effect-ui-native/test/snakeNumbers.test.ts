/**
 * The numbers for how the Snake board is drawn: JavaScript time per tick and
 * how many native operations one tick sends to the phone.
 *
 * Way 1, the one the screen uses: one native view per cell, 400 of them, and
 * a tick gives two of them a new colour. Measured on the real screen.
 *
 * Way 2, for comparison: a canvas through `NativeViews.makeCanvas`. The
 * playground app has no Skia in it, so a canvas there is drawn with plain
 * views, one per shape. That is what is measured here. With Skia a tick
 * would be one picture, whatever is on it.
 *
 * Time here is Node on a laptop. Hermes on a phone has no JIT and is several
 * times slower. The counts are exact everywhere.
 */
import { appendFileSync } from 'node:fs'

import { UiSchema } from '@effect/ui'
import { Effect, Layer, Random, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from 'vitest'

import * as Position from '../playground/snake/domain/position.js'
import * as Snake from '../playground/snake/domain/snake.js'
import * as Look from '../playground/snake/look.js'
import { SnakeGame, SnakeGameMessage, viewRuns } from '../playground/snake/SnakeGame.js'
import { Native, NativeViews, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { cellsOf } from './snakeSupport.js'
import { provideForTest, run } from './support.js'

const TICKS = 300

const drain = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve()
}

type Calls = Readonly<{ createNode: number; cloneWithChildren: number; cloneWithProps: number; cloneWithChildrenAndProps: number; completeRoot: number }>

const round = (value: number): number => Math.round(value * 100) / 100

/** Sends `ticks` ticks one after another and says what each cost. Only microtasks run in between, so no timer gets in. */
const measure = (label: string, app: NativeTest.MountedApp<any, any>, tick: () => void, ticks = TICKS) =>
  Effect.promise(async () => {
    // Warm up, so the first compile of the code is not in the numbers.
    for (let warm = 0; warm < 30; warm++) {
      tick()
      await drain()
    }
    const times: Array<number> = []
    const before: Calls = { ...app.fabric.calls }
    const made = app.stats.created
    for (let at = 0; at < ticks; at++) {
      const started = performance.now()
      tick()
      await drain()
      times.push(performance.now() - started)
    }
    const after: Calls = app.fabric.calls
    const sorted = [...times].sort((a, b) => a - b)
    const per = (name: keyof Calls): number => round((after[name] - before[name]) / ticks)
    const result = {
      label,
      ticks,
      msPerTick: {
        mean: round(times.reduce((sum, each) => sum + each, 0) / ticks),
        p95: round(sorted[Math.floor(ticks * 0.95)] ?? 0),
        max: round(sorted[ticks - 1] ?? 0),
      },
      perTick: {
        viewsWithNewProps: round(per('cloneWithProps') + per('cloneWithChildrenAndProps')),
        ancestorsCopied: per('cloneWithChildren'),
        viewsMade: round((app.stats.created - made) / ticks),
        commits: per('completeRoot'),
      },
    }
    appendFileSync(process.env['EUI_SNAKE_NUMBERS'] ?? '/tmp/eui-snake-numbers.jsonl', JSON.stringify(result) + '\n')
    return result
  })

// WAY 2, for comparison: the same board on a canvas.

const CELL = 14

const DrawBoard = NativeViews.makeCanvas(
  'DrawSnakeBoard',
  { snake: Snake.Snake, apple: Position.Position },
  (pen, _size, { snake, apple }) => {
    pen.circle(apple.x * CELL + CELL / 2, apple.y * CELL + CELL / 2, CELL / 2 - 1, { color: Look.LCD_ON })
    for (const segment of snake) pen.rect(segment.x * CELL, segment.y * CELL, CELL - 1, CELL - 1, { color: Look.LCD_ON })
  },
)

const CanvasMessage = UiSchema.TaggedEnum({ TickedClock: {} })

const CanvasBoard = Native.component({
  name: 'CanvasBoard',
  props: Schema.Struct({ length: Schema.Number }),
  model: Schema.Struct({ snake: Snake.Snake, apple: Position.Position }),
  message: CanvasMessage,
}).make({
  init: $ => {
    // A snake of the asked length, folded into rows so it fits the board.
    const cells = Array.from({ length: $.props.length }, (_, at) => {
      const row = Math.floor(at / 18)
      return { x: row % 2 === 0 ? 18 - (at % 18) : 1 + (at % 18), y: 2 + row }
    })
    return { snake: cells as never, apple: { x: 0, y: 0 } }
  },
  update: { TickedClock: $ => $.evolve({ snake: snake => Snake.move(snake, 'Up') }) },
  view: (h, model) =>
    h.view
      .testId('canvas')
      .style({ width: CELL * 20, height: CELL * 20, backgroundColor: Look.LCD })
      .onMount(DrawBoard({ snake: model.snake, apple: model.apple })),
})

const services = () => {
  const device = Phone.Device.makeTest()
  return Layer.provideMerge(Phone.layer, device.layer)
}

describe('Snake: what a tick costs', () => {
  it('way 1, a view per cell: a tick gives two views a new colour, copies their ancestors and makes no view', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(SnakeGame, { hasReadout: false }).pipe(provideForTest(services()))
        yield* app.press('snake-key-5')
        const runs = { ...viewRuns }
        const result = yield* measure('way 1: a native view per cell', app, () => app.root.send(SnakeGameMessage.TickedClock()))
        const views = {
          game: (viewRuns.game - runs.game) / (TICKS + 30),
          rows: (viewRuns.rows - runs.rows) / (TICKS + 30),
          digits: viewRuns.digits - runs.digits,
          keypad: viewRuns.keypad - runs.keypad,
        }
        console.log(JSON.stringify({ ...result, viewRunsPerTick: views }))
        // The snake ran along its row the whole time, and is still three cells long.
        expect(cellsOf(app, '#')).toHaveLength(3)
        expect(result.perTick.viewsWithNewProps).toBe(2)
        expect(result.perTick.viewsMade).toBe(0)
        expect(result.perTick.commits).toBe(1)
        // The two cells are in one row here. Its ancestors are copied once, up to the top of the screen.
        expect(result.perTick.ancestorsCopied).toBeLessThanOrEqual(12)
        expect(views).toEqual({ game: 1, rows: 1, digits: 0, keypad: 0 })
        // Generous: a laptop does this in well under a millisecond.
        expect(result.msPerTick.mean).toBeLessThan(8)
      }).pipe(Effect.provide(TestClock.layer()), Random.withSeed('e')),
    ))

  it('way 2 without Skia, a view per shape: every piece of the snake gets a new place on every tick', () =>
    run(
      Effect.gen(function* () {
        const lengths = [3, 30, 100]
        const changed: Array<number> = []
        for (const length of lengths) {
          const app = yield* NativeTest.mount(CanvasBoard, { length })
          yield* app.emit('canvas', 'topLayout', { layout: { x: 0, y: 0, width: CELL * 20, height: CELL * 20 } })
          const result = yield* measure(`way 2 on plain views, snake of ${length}`, app, () => app.root.send(CanvasMessage.TickedClock()), 100)
          console.log(JSON.stringify(result))
          changed.push(result.perTick.viewsWithNewProps)
        }
        expect(NativeViews.canvasStatus()).toContain('plain views')
        // It grows with the snake. Way 1 stays at two.
        expect(changed).toEqual(lengths)
      }),
    ))
})
