/**
 * Snake's `update`, step by step, with no phone: the tests of the browser
 * example's `SnakeGame.story.test.ts`, with the phone's keys in place of the
 * keyboard's. `Story` is Effect UI's own test tool. It keeps Commands as
 * data, so a test names each one the game asked for.
 */
import { Story } from '@effect/ui/testing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { Phone } from '../src/index.js'
import * as Snake from '../playground/snake/domain/snake.js'
import { FIRST_SPACE } from '../playground/snake/look.js'
import { GenerateApplePosition, SnakeGame, SnakeGameMessage, type SnakeGameModel } from '../playground/snake/SnakeGame.js'
import { run } from './support.js'

const initialSnake = Snake.create({ x: 10, y: 10 })

const playingModel: SnakeGameModel = {
  snake: initialSnake,
  apple: { x: 15, y: 15 },
  direction: 'Right',
  nextDirection: 'Right',
  gameState: 'Playing',
  points: 0,
  highScore: 0,
  space: FIRST_SPACE,
  touch: null,
  showsNumbers: true,
  readout: { frameMs: 0, worstFrameMs: 0, tickMs: 0, worstTickMs: 0 },
}
const notStartedModel: SnakeGameModel = { ...playingModel, gameState: 'NotStarted' }

const gameClock = 'gameClock:150'
const pressedKey = (key: string) => SnakeGameMessage.PressedKey({ key })
const keyTap = Phone.Impact.make({ style: 'light' })

/** A story with the first apple placed, so nothing is left open. */
const story = () =>
  Effect.gen(function* () {
    const made = yield* Story.make(SnakeGame, { hasReadout: false })
    made.resolve(GenerateApplePosition, { x: 15, y: 15 })
    return made
  })

describe('Snake: the rules through update', () => {
  it('starts NotStarted and asks for the first apple', () =>
    run(
      Effect.gen(function* () {
        const s = yield* Story.make(SnakeGame, { hasReadout: false })
        expect(s.model.gameState).toBe('NotStarted')
        expect(s.model.snake).toEqual(initialSnake)
        s.expectExact(GenerateApplePosition.make({ snake: initialSnake })).resolve(GenerateApplePosition, { x: 3, y: 4 })
        expect(s.model.apple).toEqual({ x: 3, y: 4 })
      }),
    ))

  it('the clock runs only while playing', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given(notStartedModel)
        expect(s.subscriptions).toEqual([])
        s.given(playingModel)
        expect(s.subscriptions).toEqual([gameClock])
        s.given({ ...playingModel, gameState: 'Paused' })
        expect(s.subscriptions).toEqual([])
        s.given({ ...playingModel, gameState: 'GameOver' })
        expect(s.subscriptions).toEqual([])
      }),
    ))

  it('the clock speeds up as the score grows, down to the shortest interval', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given({ ...playingModel, points: 30 })
        expect(s.subscriptions).toEqual(['gameClock:120'])
        s.given({ ...playingModel, points: 70 })
        expect(s.subscriptions).toEqual(['gameClock:80'])
        s.given({ ...playingModel, points: 500 })
        expect(s.subscriptions).toEqual(['gameClock:80'])
      }),
    ))

  it('2, 4, 6 and 8 set nextDirection while playing, each with a light tap', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        for (const [key, direction] of [['2', 'Up'], ['4', 'Left'], ['6', 'Right'], ['8', 'Down']] as const) {
          s.given(playingModel).send(pressedKey(key)).expectExact(keyTap).resolve(Phone.Impact, { _tag: 'Done' })
          expect(s.model.nextDirection).toBe(direction)
        }
      }),
    ))

  it('steering keys are ignored while the game is paused', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given({ ...playingModel, gameState: 'Paused' }).send(pressedKey('8')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model.nextDirection).toBe('Right')
      }),
    ))

  it('5 starts the game, pauses it, goes on, and does nothing once the game is over', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given(notStartedModel).send(pressedKey('5')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model.gameState).toBe('Playing')
        s.send(pressedKey('5')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model.gameState).toBe('Paused')
        s.send(pressedKey('5')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model.gameState).toBe('Playing')
        s.given({ ...playingModel, gameState: 'GameOver' }).send(pressedKey('5')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model.gameState).toBe('GameOver')
      }),
    ))

  it('0 asks for a new apple, resets the snake and keeps the high score', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given({ ...playingModel, points: 100, highScore: 120, direction: 'Up' }).send(pressedKey('0'))
        expect(s.model.gameState).toBe('NotStarted')
        expect(s.model.points).toBe(0)
        expect(s.model.direction).toBe('Right')
        expect(s.model.highScore).toBe(120)
        s.expectExact(keyTap, GenerateApplePosition.make({ snake: initialSnake }))
          .resolve(Phone.Impact, { _tag: 'Done' })
          .resolve(GenerateApplePosition, { x: 5, y: 5 })
        expect(s.model.apple).toEqual({ x: 5, y: 5 })
      }),
    ))

  it('a key with no job changes nothing', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given(playingModel).send(pressedKey('7')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model).toEqual(playingModel)
      }),
    ))

  it('a tick moves the snake one cell while playing, and does nothing otherwise', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given(playingModel).subscription(gameClock, SnakeGameMessage.TickedClock())
        expect(s.model.snake).toEqual([{ x: 11, y: 10 }, { x: 10, y: 10 }, { x: 9, y: 10 }])
        s.given(notStartedModel).send(SnakeGameMessage.TickedClock())
        expect(s.model.snake).toEqual(initialSnake)
      }),
    ))

  it('a turn straight back is ignored at the tick: the snake keeps its way', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given(playingModel).send(pressedKey('4')).resolve(Phone.Impact, { _tag: 'Done' })
        expect(s.model.nextDirection).toBe('Left')
        s.subscription(gameClock, SnakeGameMessage.TickedClock())
        expect(s.model.direction).toBe('Right')
        expect(s.model.snake[0]).toEqual({ x: 11, y: 10 })
        expect(s.model.gameState).toBe('Playing')
      }),
    ))

  it('eating an apple grows the snake, adds ten points and asks for a new apple', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given({ ...playingModel, apple: { x: 11, y: 10 } })
          .subscription(gameClock, SnakeGameMessage.TickedClock())
          .resolve(GenerateApplePosition, { x: 5, y: 5 })
        expect(s.model.snake).toHaveLength(initialSnake.length + 1)
        expect(s.model.points).toBe(10)
        expect(s.model.apple).toEqual({ x: 5, y: 5 })
      }),
    ))

  it('the snake comes back in on the other side at a wall, as the shared rules say', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given({ ...playingModel, snake: [{ x: 19, y: 4 }, { x: 18, y: 4 }, { x: 17, y: 4 }] }).subscription(
          gameClock,
          SnakeGameMessage.TickedClock(),
        )
        expect(s.model.snake[0]).toEqual({ x: 0, y: 4 })
        expect(s.model.gameState).toBe('Playing')
      }),
    ))

  it('running into itself ends the game and keeps the best score', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        // Head at (5,5) going down, with its own body one cell below.
        const coiled = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }]
        s.given({ ...playingModel, snake: coiled as never, direction: 'Right', nextDirection: 'Down', points: 30, highScore: 20 })
          .subscription('gameClock:120', SnakeGameMessage.TickedClock())
        expect(s.model.gameState).toBe('GameOver')
        expect(s.model.highScore).toBe(30)
        expect(s.model.snake).toEqual(coiled)
        expect(s.subscriptions).toEqual([])
      }),
    ))

  it('a swipe steers while playing: the finger goes down, and ends more than a few points away', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.given(playingModel)
          .send(SnakeGameMessage.TouchedBoard({ x: 100, y: 200 }))
          .send(SnakeGameMessage.ReleasedBoard({ x: 103, y: 188 }))
        expect(s.model.nextDirection).toBe('Up')
        expect(s.model.touch).toBeNull()
        // A tap that hardly moved steers nothing.
        s.send(SnakeGameMessage.TouchedBoard({ x: 100, y: 200 })).send(SnakeGameMessage.ReleasedBoard({ x: 104, y: 203 }))
        expect(s.model.nextDirection).toBe('Up')
        // Not while paused.
        s.given({ ...playingModel, gameState: 'Paused' })
          .send(SnakeGameMessage.TouchedBoard({ x: 100, y: 200 }))
          .send(SnakeGameMessage.ReleasedBoard({ x: 60, y: 200 }))
        expect(s.model.nextDirection).toBe('Right')
      }),
    ))
})
