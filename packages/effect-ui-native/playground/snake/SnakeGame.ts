/**
 * Snake on the phone: Effect UI's Snake example on native views.
 *
 * The rules of the game are the files in `./domain` and `./constants.ts`,
 * copied from the browser example as they are. The terminal example uses the
 * same files. This file is the third screen for them. Its Model, Messages
 * and `update` follow the two originals (`examples/snake/src/SnakeGame.ts`
 * and `examples/snake-tui/src/SnakeGame.ts`): the same seven fields, the
 * same three Messages, the same clock with the same speed rule.
 *
 * What a phone needs on top:
 * - A keypad on screen in place of a keyboard. 2, 4, 6 and 8 steer. 5 starts,
 *   pauses and goes on. 0 starts a new game. Every key gives a light tap.
 * - A swipe on the green screen steers too (`./swipe.ts`).
 * - The board is sized from the room the phone reports.
 * - A line of numbers under the handset: how long JavaScript frames take and
 *   how long the last tick took.
 *
 * Left out: the page title (`head`). A phone has no document.
 *
 * How the board is drawn: 20 rows, each a small component that gets its 20
 * cells as one short text. A tick changes two cells, so at most two rows run
 * their view again, and two native views get a new colour. See
 * `test/snakeNumbers.test.ts`.
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Array, Duration, Effect, Schema, Stream } from 'effect'

import { Native, Phone } from '../../src/index.js'
import { makeFrameMeter } from '../frameMeter.js'
import { GAME, GAME_SPEED } from './constants.js'
import * as Apple from './domain/apple.js'
import * as Direction from './domain/direction.js'
import * as Position from './domain/position.js'
import * as Snake from './domain/snake.js'
import * as Look from './look.js'
import { swipeDirection } from './swipe.js'
import { makeTickMeter } from './tickMeter.js'

export const GameState = Schema.Literals(['NotStarted', 'Playing', 'Paused', 'GameOver'])
export type GameState = typeof GameState.Type

const Readout = Schema.Struct({
  /** JavaScript frames in the last half second: the average and the longest, in ms. */
  frameMs: Schema.Number,
  worstFrameMs: Schema.Number,
  /** JavaScript time of the last tick of the game clock, and the longest so far, in ms. */
  tickMs: Schema.Number,
  worstTickMs: Schema.Number,
})
type Readout = typeof Readout.Type

export const SnakeGameModel = Schema.Struct({
  // The same seven fields as the browser and terminal versions.
  snake: Snake.Snake,
  apple: Position.Position,
  direction: Direction.Direction,
  nextDirection: Direction.Direction,
  gameState: GameState,
  points: Schema.Number,
  highScore: Schema.Number,
  // For the phone.
  /** The room the phone gives the screen, in points. */
  space: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  /** Where a finger went down on the board, while it is down. */
  touch: Schema.NullOr(Position.Position),
  showsNumbers: Schema.Boolean,
  readout: Readout,
})
export type SnakeGameModel = typeof SnakeGameModel.Type

export const SnakeGameMessage = UiSchema.TaggedEnum({
  // As in the originals.
  TickedClock: {},
  PressedKey: { key: Schema.String },
  CompletedGenerateApplePosition: { position: Position.Position },
  // For the phone.
  TouchedBoard: { x: Schema.Number, y: Schema.Number },
  ReleasedBoard: { x: Schema.Number, y: Schema.Number },
  MeasuredScreen: { width: Schema.Number, height: Schema.Number },
  PressedNumbers: {},
  UpdatedReadout: { readout: Readout },
})

export const SnakeGameProps = Schema.Struct({
  /** The line of numbers, which draws twice a second. Off in tests that count draws. */
  hasReadout: Schema.Boolean,
})

export const GenerateApplePosition = Command.make(
  'GenerateApplePosition',
  { args: { snake: Snake.Snake } },
  ({ snake }) => Apple.generatePosition(snake),
)

const generateApplePosition = (snake: Snake.Snake) =>
  GenerateApplePosition.make({ snake }).pipe(
    Command.map(position => SnakeGameMessage.CompletedGenerateApplePosition({ position })),
  )

const NEW_GAME = {
  snake: Snake.create(GAME.INITIAL_POSITION),
  direction: GAME.INITIAL_DIRECTION,
  nextDirection: GAME.INITIAL_DIRECTION,
  gameState: 'NotStarted',
  points: 0,
} satisfies Partial<SnakeGameModel>

/** The keypad's steering keys, laid out as on an old phone: 2 is up, 8 is down. */
const MOVE_DIRECTIONS: ReadonlyMap<string, Direction.Direction> = new Map([
  ['2', 'Up'],
  ['8', 'Down'],
  ['4', 'Left'],
  ['6', 'Right'],
])

/** Starts, pauses and goes on: the space bar of the originals. */
export const PAUSE_KEY = '5'
/** A new game: the R key of the originals. */
export const RESTART_KEY = '0'

const NEXT_ON_PAUSE_KEY: Record<GameState, GameState> = {
  NotStarted: 'Playing',
  Playing: 'Paused',
  Paused: 'Playing',
  GameOver: 'GameOver',
}

export const tickInterval = (points: number): number =>
  Math.max(GAME_SPEED.MIN_INTERVAL, GAME_SPEED.BASE_INTERVAL - points)

export const GAME_STATE_TEXT: Record<GameState, string> = {
  NotStarted: 'PRESS 5',
  Playing: '',
  Paused: 'PAUSED',
  GameOver: 'GAME OVER',
}

const EMPTY_READOUT: Readout = { frameMs: 0, worstFrameMs: 0, tickMs: 0, worstTickMs: 0 }

/** What a screen reader says for the screen, since the words on it are few. */
const GAME_STATE_SAYS: Record<GameState, string> = {
  NotStarted: 'Not started. 5 starts the game.',
  Playing: 'Playing. 5 pauses.',
  Paused: 'Paused. 5 goes on.',
  GameOver: 'Game over. 0 starts a new game.',
}

/** How many times each view has run, for the numbers test. */
export const viewRuns = { game: 0, rows: 0, digits: 0, keypad: 0 }

export const tickMeter = makeTickMeter()
const frameMeter = makeFrameMeter()

const round = (value: number): number => Math.round(value * 10) / 10

/** Twice a second: the frame meter and the tick meter, as one Message. */
const readoutTicks = Subscription.make(
  'Snake/readout',
  Stream.suspend(() => {
    frameMeter.start()
    return Stream.tick('500 millis').pipe(
      Stream.map(() => {
        const frame = frameMeter.read()
        const tick = tickMeter.read()
        return SnakeGameMessage.UpdatedReadout({
          readout: {
            frameMs: round(frame.averageMs),
            worstFrameMs: round(frame.worstMs),
            tickMs: round(tick.lastMs),
            worstTickMs: round(tick.worstMs),
          },
        })
      }),
      Stream.ensuring(Effect.sync(() => frameMeter.stop())),
    )
  }),
)

/** A light tap for a key press. The answer is not needed. */
const keyTap = Phone.Impact.make({ style: 'light' }).pipe(Command.asNoop)

/** The board as 20 short texts, one per row, one letter per cell. */
export const boardRows = (model: Pick<SnakeGameModel, 'snake' | 'apple'>): ReadonlyArray<string> => {
  const rows = Array.makeBy(Position.GRID_SIZE, () => Array.makeBy(Position.GRID_SIZE, () => Look.CELL_OFF))
  const mark = (cell: Position.Position, kind: string): void => {
    const row = rows[cell.y]
    if (row !== undefined && cell.x >= 0 && cell.x < row.length) row[cell.x] = kind
  }
  // The snake is marked last: where the two meet, the snake shows, as in the originals.
  mark(model.apple, Look.CELL_APPLE)
  for (const segment of model.snake) mark(segment, Look.CELL_SNAKE)
  return rows.map(row => row.join(''))
}

const cellKind = (letter: string): typeof Look.CELL_OFF | typeof Look.CELL_SNAKE | typeof Look.CELL_APPLE =>
  letter === Look.CELL_SNAKE ? Look.CELL_SNAKE : letter === Look.CELL_APPLE ? Look.CELL_APPLE : Look.CELL_OFF

/** One row of the board. Drawn from props only, so it draws again only when one of its cells changed. */
const BoardRow = Native.component({
  name: 'SnakeBoardRow',
  props: Schema.Struct({ cells: Schema.String, size: Schema.Number }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: $ => $.model,
  view: h => {
    viewRuns.rows++
    const { cells, size } = h.props
    const styles = Look.cellStyles(size)
    return h.view.style(styles.row).children(
      Array.makeBy(cells.length, x => h.view.key(String(x)).style(styles[cellKind(cells.charAt(x))])),
    )
  },
})

/** One digit of a score: five rows of three squares. */
const Digit = Native.component({
  name: 'SnakeDigit',
  props: Schema.Struct({ digit: Schema.Number }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: $ => $.model,
  view: h => {
    viewRuns.digits++
    const styles = Look.dots
    const rows = Look.DIGITS[h.props.digit] ?? Look.DIGITS[0] ?? []
    return h.view.style(styles.digit).children(
      rows.map((row, y) =>
        h.view
          .key(String(y))
          .style(styles.row)
          .children(Array.makeBy(row.length, x => h.view.key(String(x)).style(row.charAt(x) === '#' ? styles.on : styles.off))),
      ),
    )
  },
})

/** How many digits a score is shown with. The highest score there can be has four. */
export const SCORE_DIGITS = 4

const KEYS: ReadonlyArray<ReadonlyArray<string>> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
]

const KEY_WORDS: Readonly<Record<string, string>> = { [PAUSE_KEY]: 'pause', [RESTART_KEY]: 'new' }
const KEY_NAMES: Readonly<Record<string, string>> = { '*': 'star', '#': 'hash' }
const KEY_SAYS: Readonly<Record<string, string>> = {
  '2': 'Up',
  '8': 'Down',
  '4': 'Left',
  '6': 'Right',
  [PAUSE_KEY]: 'Start or pause',
  [RESTART_KEY]: 'New game',
}

/** The name tests find a key by: `snake-key-2`, `snake-key-star`. */
export const keyTestId = (key: string): string => `snake-key-${KEY_NAMES[key] ?? key}`

const KeypadMessage = UiSchema.TaggedEnum({ PressedKey: { key: Schema.String } })
const KeypadEvents = UiSchema.TaggedEnum({ PressedKey: { key: Schema.String } })

/**
 * The twelve keys. A component of its own, so a tick of the game does not
 * run its view: its only prop is the height of a key.
 */
const Keypad = Native.component({
  name: 'SnakeKeypad',
  props: Schema.Struct({ keyHeight: Schema.Number }),
  model: Schema.Null,
  message: KeypadMessage,
  events: KeypadEvents,
}).make({
  init: () => null,
  update: { PressedKey: ($, { key }) => $.emit(KeypadEvents.PressedKey({ key })) },
  view: h => {
    viewRuns.keypad++
    return h.view.testId('snake-keypad').style(Look.keypad).children(
      KEYS.map((row, y) =>
        h.view
          .key(String(y))
          .style(Look.keyRow)
          .children(
            row.map(key => {
              const direction = MOVE_DIRECTIONS.get(key)
              const word = KEY_WORDS[key]
              return h.pressable
                .key(key)
                .testId(keyTestId(key))
                .set({ accessibilityRole: 'button', accessibilityLabel: KEY_SAYS[key] ?? key })
                .style(Look.key(h.props.keyHeight))
                .pressedStyle(Look.keyPressed)
                .on('press', KeypadMessage.PressedKey({ key }))
                .children(
                  h.text.style(Look.keyDigit).children(key),
                  direction !== undefined && h.view.style(Look.arrow[direction]),
                  word !== undefined && h.text.style(Look.keyWord).children(word),
                )
            }),
          ),
      ),
    )
  },
})

const digitsOf = (points: number): ReadonlyArray<number> =>
  [...String(Math.max(0, Math.floor(points))).padStart(SCORE_DIGITS, '0').slice(-SCORE_DIGITS)].map(Number)

export const SnakeGame = Native.component({
  name: 'SnakeGameNative',
  props: SnakeGameProps,
  model: SnakeGameModel,
  message: SnakeGameMessage,
}).make({
  init: $ =>
    $.set({
      ...NEW_GAME,
      apple: { x: 15, y: 15 },
      highScore: 0,
      space: Look.FIRST_SPACE,
      touch: null,
      showsNumbers: true,
      readout: EMPTY_READOUT,
    }).run(generateApplePosition(NEW_GAME.snake)),
  update: {
    PressedKey: ($, { key }) => {
      const direction = MOVE_DIRECTIONS.get(key)
      if (direction !== undefined) {
        return $.model.gameState === 'Playing' ? $.evolve({ nextDirection: direction }).run(keyTap) : $.run(keyTap)
      }
      if (key === PAUSE_KEY) {
        return $.evolve({ gameState: gameState => NEXT_ON_PAUSE_KEY[gameState] }).run(keyTap)
      }
      if (key === RESTART_KEY) {
        return $.evolve(NEW_GAME).run(keyTap, generateApplePosition(NEW_GAME.snake))
      }
      return $.run(keyTap)
    },

    TickedClock: $ => {
      if ($.model.gameState !== 'Playing') return $.model
      tickMeter.begin()

      const direction = Direction.isOpposite($.model.direction, $.model.nextDirection)
        ? $.model.direction
        : $.model.nextDirection
      const willEatApple = Position.equivalence(Position.move($.model.snake[0], direction), $.model.apple)
      const snake = willEatApple ? Snake.grow($.model.snake, direction) : Snake.move($.model.snake, direction)

      if (Snake.hasCollision(snake)) {
        return $.evolve({
          gameState: 'GameOver',
          highScore: Math.max($.model.points, $.model.highScore),
        })
      }

      const next: SnakeGameModel = {
        ...$.model,
        snake,
        direction,
        points: willEatApple ? $.model.points + GAME.POINTS_PER_APPLE : $.model.points,
      }
      return willEatApple ? $.set(next).run(generateApplePosition(snake)) : next
    },

    CompletedGenerateApplePosition: ($, { position }) => $.evolve({ apple: position }),

    TouchedBoard: ($, { x, y }) => $.evolve({ touch: { x, y } }),

    // The touch is over. If the finger went far enough, that is a swipe, and
    // it steers just as a key does.
    ReleasedBoard: ($, { x, y }) => {
      const from = $.model.touch
      if (from === null) return $.model
      const direction = swipeDirection(from, { x, y })
      return direction !== undefined && $.model.gameState === 'Playing'
        ? $.evolve({ touch: null, nextDirection: direction })
        : $.evolve({ touch: null })
    },

    MeasuredScreen: ($, { width, height }) =>
      width === $.model.space.width && height === $.model.space.height ? $.model : $.evolve({ space: { width, height } }),

    PressedNumbers: $ => $.evolve({ showsNumbers: shows => !shows }),

    // The same numbers as before: the same Model, and no draw.
    UpdatedReadout: ($, { readout }) => {
      const now = $.model.readout
      return readout.frameMs === now.frameMs &&
        readout.worstFrameMs === now.worstFrameMs &&
        readout.tickMs === now.tickMs &&
        readout.worstTickMs === now.worstTickMs
        ? $.model
        : $.evolve({ readout })
    },
  },
  subscriptions: ({ model, props }) => [
    model.gameState === 'Playing' &&
      Subscription.make('gameClock', tickInterval(model.points), interval =>
        Stream.tick(Duration.millis(interval)).pipe(Stream.drop(1), Stream.as(SnakeGameMessage.TickedClock())),
      ),
    props.hasReadout && model.showsNumbers && readoutTicks,
  ],
  view: (h, model) => {
    viewRuns.game++
    tickMeter.drawn()
    const sizes = Look.sizesFor(model.space)
    const { readout } = model
    const score = (id: string, says: string, points: number) =>
      h.view
        .testId(id)
        .set({ accessible: true, accessibilityLabel: `${says} ${points}` })
        .style(Look.scoreGroup)
        .children(digitsOf(points).map((digit, at) => Digit(h, { key: `${id}-${at}`, props: { digit } })))
    const banner = GAME_STATE_TEXT[model.gameState]
    // The crown before the high score. The same styles every time, so it is never drawn twice.
    const crown = h.view.style(Look.crown).children(
      Look.CROWN.map((row, y) =>
        h.view
          .key(String(y))
          .style(Look.dots.row)
          .children(Array.makeBy(row.length, x => h.view.key(String(x)).style(row.charAt(x) === '#' ? Look.dots.on : Look.crownOff))),
      ),
    )
    return h.view
      .testId('snake-screen')
      .style(Look.backdrop)
      .on('layout', ({ width, height }) => SnakeGameMessage.MeasuredScreen({ width, height }))
      .children(
        h.view.testId('snake-handset').style(Look.shell).children(
          h.view.children(
            h.view.style(Look.ear),
            h.view.style(Look.bezel).children(
              // A finger anywhere on the green screen: where it went down, and where it was when the touch ended.
              h.pressable
                .testId('snake-lcd')
                .style(Look.lcd)
                .on('pressIn', ({ x, y }) => SnakeGameMessage.TouchedBoard({ x, y }))
                .on('pressOut', ({ x, y }) => SnakeGameMessage.ReleasedBoard({ x, y }))
                .children(
                  h.view.style(Look.strip).children(
                    score('snake-score', 'Score', model.points),
                    h.view.style(Look.scoreGroup).children(crown, score('snake-high', 'High score', model.highScore)),
                  ),
                  h.view
                    .testId('snake-board')
                    .set({ accessible: true, accessibilityLabel: GAME_STATE_SAYS[model.gameState] })
                    .style(Look.field(sizes))
                    .children(
                      boardRows(model).map((cells, y) =>
                        BoardRow(h, { key: `row-${y}`, props: { cells, size: sizes.cell } }),
                      ),
                      banner !== '' &&
                        h.view
                          .key('banner')
                          .set({ pointerEvents: 'none' })
                          .style(Look.bannerLayer)
                          .children(
                            h.view.style(Look.bannerBox).children(h.text.testId('snake-status').style(Look.bannerText).children(banner)),
                          ),
                    ),
                ),
            ),
            h.text.style(Look.engraved).set({ numberOfLines: 1 }).children('EFFECT UI NATIVE'),
          ),
          Keypad(h, {
            key: 'keypad',
            props: { keyHeight: sizes.keyHeight },
            onEmit: { PressedKey: ({ key }) => SnakeGameMessage.PressedKey({ key }) },
          }),
        ),
        h.view.style(Look.numbersRow).children(
          h.text
            .testId('snake-numbers')
            .style(Look.numbersText)
            .set({ numberOfLines: 2 })
            .children(
              model.showsNumbers
                ? `JS frame: ${readout.frameMs} ms average, ${readout.worstFrameMs} ms longest. Last tick: ${readout.tickMs} ms in JS, longest ${readout.worstTickMs} ms`
                : '',
            ),
          h.pressable
            .testId('snake-numbers-switch')
            .set({ hitSlop: 10, accessibilityRole: 'button' })
            .style(Look.numbersSwitch)
            .pressedStyle(Look.keyPressed)
            .on('press', SnakeGameMessage.PressedNumbers())
            .children(h.text.style(Look.numbersSwitchText).children(model.showsNumbers ? 'Numbers: on' : 'Numbers: off')),
        ),
      )
  },
})
