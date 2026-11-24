/**
 * The Worklets demo: code on the phone's UI thread, with no React.
 *
 * A phone app has two threads that matter. JavaScript runs on one. The
 * screen is drawn and fingers are read on the other, the UI thread. Anything
 * JavaScript moves stops when JavaScript is busy. A "worklet" is a small
 * function that is copied to the UI thread and keeps running there.
 *
 * What is on the screen:
 *
 * 1. Six status lines. Each says yes or no, and why not. They are the point
 *    of the demo: they say which pieces this build of the app has.
 * 2. A grey bar. JavaScript draws it 20 points wide. The UI thread widens it
 *    to 77 and then measures it, which is how line 4 gets its answer.
 * 3. Two boxes that move from side to side. The orange one is moved by a
 *    worklet. The blue one is moved by JavaScript, as the rest of this
 *    project's motion is. "Block JavaScript for 2 seconds" keeps JavaScript
 *    busy: the blue box should stop and the orange box should keep going.
 * 4. A card to drag. A worklet follows the finger. Let go more than 100
 *    points from where it started and Foldkit hears one Message.
 *
 * Every part that cannot work in this build shows "not available" with the
 * reason and leaves the rest alone.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  header,
  prop,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  text,
  title,
  view as box,
} from '../../src/index.js'
import { transition } from '../../src/motion/index.js'
import {
  type Check,
  PAN_ACTIVE,
  PAN_END,
  type PanEvent,
  bounceBetween,
  gestureRoot,
  onUiMessage,
  probeView,
  runOnUi,
  sendMessage,
  shared,
  springTo,
  stopAnimation,
  uiChannel,
  uiRef,
  uiThread,
  workletsStatus,
} from '../../src/worklets/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

export type WorkletsDemoOptions = Readonly<{
  /** How long "Block JavaScript" keeps JavaScript busy. Default 2000. */
  blockMs?: number
  /** How long the blue box waits between moves. Default 1100. */
  jsMoveEveryMs?: number
}>

/** How far the two boxes travel, in points. */
export const TRAVEL = 180
/** How wide JavaScript draws the grey bar, and how wide the UI thread makes it. */
export const BAR_DRAWN = 20
export const BAR_WANTED = 77
/** How far the card must be from its start, on release, for a Message. */
export const RELEASE_PAST = 100

// MODEL

/** One status line. `waiting` is for an answer that comes back from the UI thread. */
const Line = Schema.Struct({
  answer: Schema.Literals(['waiting', 'yes', 'no']),
  reason: Schema.String,
})
type Line = typeof Line.Type

export const Model = Schema.Struct({
  uiRuntime: Line,
  ranOnUi: Line,
  sharedRoundTrip: Line,
  propReachedView: Line,
  messageCameBack: Line,
  gestures: Line,
  /** Whether a worklet can change a view at all. Decides if the orange box is drawn. */
  viewUpdates: Line,
  isJavaScriptBlocked: Schema.Boolean,
  /** How long the last block really lasted, in milliseconds. 0 before the first. */
  lastBlockMs: Schema.Number,
  /** Which side JavaScript's box is on. */
  isJsBoxRight: Schema.Boolean,
  /** How many times the card was let go past the line. */
  releases: Schema.Number,
  /** How far from its start the card was the last time, in points. */
  lastReleaseDx: Schema.Number,
})
export type Model = typeof Model.Type

const WAITING: Line = { answer: 'waiting', reason: '' }
const lineOf = (check: Check): Line => ({ answer: check.ok ? 'yes' : 'no', reason: check.reason })

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  CheckedBuild: {
    uiRuntime: Line,
    ranOnUi: Line,
    sharedRoundTrip: Line,
    viewUpdates: Line,
    gestures: Line,
    /** Whether the two questions that answer later were asked. */
    askedUiThread: Schema.Boolean,
  },
  HeardFromUiThread: {},
  /** `width` is -1 when the UI thread could not find the bar. */
  MeasuredBar: { width: Schema.Number, frames: Schema.Number },
  WaitedForUiThread: {},
  PressedBlock: {},
  CompletedBlock: { ms: Schema.Number },
  MovedJsBox: {},
  ReleasedCard: { dx: Schema.Number },
})
export type Message = typeof Message.Type

// The demo's live things. They are not data, so they are not in the Model.
// One set per program, made in `makeDemo`.
const makeStage = () => {
  const channel = uiChannel()
  const boxX = shared(0)
  const barWidth = shared(BAR_DRAWN)
  const barRef = uiRef()
  const cardX = shared(0)

  const boxStyle = () => {
    'worklet'
    return { transform: [{ translateX: boxX.value }] }
  }
  const barStyle = () => {
    'worklet'
    return { width: barWidth.value }
  }
  const cardStyle = () => {
    'worklet'
    return { transform: [{ translateX: cardX.value }] }
  }
  /** Runs on the UI thread for every movement of a finger on the card. */
  const followFinger = (event: PanEvent): void => {
    'worklet'
    if (event.state === PAN_ACTIVE) {
      // The finger has the card now, whatever was moving it before.
      stopAnimation(cardX)
      cardX.value = event.translationX
      return
    }
    if (event.oldState !== PAN_ACTIVE) return
    const dx = Math.round(event.translationX)
    if (event.state === PAN_END && Math.abs(dx) > RELEASE_PAST) {
      sendMessage(channel, 'released', { dx })
    }
    springTo(cardX, 0, { stiffness: 220, damping: 20 })
  }

  return { channel, boxX, barWidth, barRef, cardX, boxStyle, barStyle, cardStyle, followFinger }
}
type Stage = ReturnType<typeof makeStage>

// INIT

const makeCommands = (env: DemoEnv, stage: Stage, options: WorkletsDemoOptions) => {
  // Leaving the demo is a side effect, so it runs as a Command.
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      // The orange box's worklet would bounce on for ever with nobody watching.
      runOnUi(stopAnimation, stage.boxX)
      runOnUi(stopAnimation, stage.cardX)
      env.exit()
      return Message.CompletedExit()
    }),
  })
  /**
   * Asks the build what it has, then starts everything that lives on the UI
   * thread. Waits a moment first so the first draw is on the phone:
   * Reanimated's native code cannot start before there is a screen.
   */
  const CheckBuild = Command.define('CheckBuild', {
    messages: [Message.CheckedBuild],
    execute: Effect.sleep(50).pipe(
      Effect.map(() => {
        const status = workletsStatus()
        let askedUiThread = false
        if (status.ranOnUi.ok) {
          askedUiThread = runOnUi(sendMessage, stage.channel, 'hello').ok
          runOnUi(bounceBetween, stage.boxX, 0, TRAVEL, { stiffness: 60, damping: 9 })
          if (status.viewUpdates.ok) {
            runOnUi(probeView, stage.barRef, stage.barWidth, BAR_WANTED, stage.channel)
          }
        }
        return Message.CheckedBuild({
          uiRuntime: lineOf(status.uiRuntime),
          ranOnUi: lineOf(status.ranOnUi),
          sharedRoundTrip: lineOf(status.sharedRoundTrip),
          viewUpdates: lineOf(status.viewUpdates),
          gestures: lineOf(status.gestures),
          askedUiThread,
        })
      }),
    ),
  })
  /** If the UI thread has not answered by now, the waiting lines say so. */
  const WaitForUiThread = Command.define('WaitForUiThread', {
    messages: [Message.WaitedForUiThread],
    execute: Effect.sleep(3000).pipe(Effect.as(Message.WaitedForUiThread())),
  })
  /** Keeps JavaScript busy, the way slow code in `update` or `view` would. */
  const BlockJavaScript = Command.define('BlockJavaScript', {
    messages: [Message.CompletedBlock],
    // The short wait lets "JavaScript is blocked" reach the screen first.
    execute: Effect.sleep(80).pipe(
      Effect.map(() => {
        const started = Date.now()
        const until = started + (options.blockMs ?? 2000)
        while (Date.now() < until) {
          // Busy on purpose.
        }
        return Message.CompletedBlock({ ms: Date.now() - started })
      }),
    ),
  })
  const WaitToMoveJsBox = Command.define('WaitToMoveJsBox', {
    messages: [Message.MovedJsBox],
    execute: Effect.sleep(options.jsMoveEveryMs ?? 1100).pipe(Effect.as(Message.MovedJsBox())),
  })
  return { Exit, CheckBuild, WaitForUiThread, BlockJavaScript, WaitToMoveJsBox }
}

const NO_ANSWER = 'the UI thread did not answer within 3 seconds'

// UPDATE

const makeUpdate = (commands: ReturnType<typeof makeCommands>) => {
  const { Exit, WaitForUiThread, BlockJavaScript, WaitToMoveJsBox } = commands
  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      CheckedBuild: checked => {
        const cannotAsk: Line = {
          answer: 'no',
          reason: checked.ranOnUi.answer === 'no' ? checked.ranOnUi.reason : 'the UI thread refused the question',
        }
        return {
          model: modifyFields(model, {
            uiRuntime: () => checked.uiRuntime,
            ranOnUi: () => checked.ranOnUi,
            sharedRoundTrip: () => checked.sharedRoundTrip,
            gestures: () => checked.gestures,
            viewUpdates: () => checked.viewUpdates,
            messageCameBack: before =>
              before.answer !== 'waiting' ? before : checked.askedUiThread ? WAITING : cannotAsk,
            propReachedView: before =>
              before.answer !== 'waiting'
                ? before
                : checked.viewUpdates.answer === 'no'
                  ? checked.viewUpdates
                  : checked.askedUiThread
                    ? WAITING
                    : cannotAsk,
          }),
          commands: checked.askedUiThread ? [WaitForUiThread()] : [],
        }
      },
      HeardFromUiThread: () => ({
        model: modifyFields(model, { messageCameBack: () => ({ answer: 'yes', reason: '' }) }),
      }),
      MeasuredBar: ({ width, frames }) => ({
        model: modifyFields(model, {
          messageCameBack: () => ({ answer: 'yes', reason: '' }),
          propReachedView: () =>
            Math.abs(width - BAR_WANTED) < 0.5
              ? { answer: 'yes', reason: `the bar measured ${BAR_WANTED} wide after ${frames} frames` }
              : {
                  answer: 'no',
                  reason:
                    width < 0
                      ? 'the UI thread could not find the bar to measure it'
                      : `the bar still measured ${Math.round(width)} wide after ${frames} frames`,
                },
        }),
      }),
      WaitedForUiThread: () => ({
        model: modifyFields(model, {
          messageCameBack: before =>
            before.answer === 'waiting' ? { answer: 'no', reason: NO_ANSWER } : before,
          propReachedView: before =>
            before.answer === 'waiting' ? { answer: 'no', reason: NO_ANSWER } : before,
        }),
      }),
      PressedBlock: () =>
        model.isJavaScriptBlocked
          ? { model }
          : {
              model: modifyFields(model, { isJavaScriptBlocked: () => true }),
              commands: [BlockJavaScript()],
            },
      CompletedBlock: ({ ms }) => ({
        model: modifyFields(model, { isJavaScriptBlocked: () => false, lastBlockMs: () => ms }),
      }),
      MovedJsBox: () => ({
        model: modifyFields(model, { isJsBoxRight: isRight => !isRight }),
        commands: [WaitToMoveJsBox()],
      }),
      ReleasedCard: ({ dx }) => ({
        model: modifyFields(model, {
          releases: count => count + 1,
          lastReleaseDx: () => dx,
        }),
      }),
    })
}

// VIEW

const INK = '#111111'
const MUTED = '#6b6b6b'
const LINE_COLOR = '#e3e3e3'
const PAPER = '#ffffff'
const TRACK = '#f1f1f1'
const UI_COLOR = '#e8590c'
const JS_COLOR = '#0a66d8'
const GOOD = '#1b7f3b'
const BAD = '#c62828'
const BOX = 44

const button = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  color: string,
  message: Message,
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 17, fontWeight: '600' })], [label])],
  )

const hint = (words: string): Html => text([style({ color: MUTED, fontSize: 13 })], [words])
const heading = (words: string): Html =>
  text([style({ color: INK, fontSize: 17, fontWeight: '600' })], [words])

/** The words of a status line, as the phone checklist quotes them. */
export const lineText = (label: string, line: Line): string =>
  line.answer === 'waiting'
    ? `${label}: waiting`
    : line.answer === 'yes'
      ? `${label}: yes${line.reason === '' ? '' : ` (${line.reason})`}`
      : `${label}: no (${line.reason})`

const statusLine = (h: HtmlBuilder<Message>, id: string, label: string, line: Line): Html =>
  text(
    [
      h.Attribute('testID', `worklets-${id}`),
      style({
        fontSize: 14,
        color: line.answer === 'yes' ? GOOD : line.answer === 'no' ? BAD : MUTED,
      }),
    ],
    [lineText(label, line)],
  )

const track = (children: ReadonlyArray<Html>): Html =>
  box(
    [
      style({
        width: TRAVEL + BOX,
        height: BOX,
        borderRadius: 10,
        backgroundColor: TRACK,
      }),
    ],
    children,
  )

const makeView =
  (env: DemoEnv, stage: Stage) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const gestures = model.gestures
    const moving = model.viewUpdates
    // What worklets send back is heard here, on a box that is always drawn.
    const hearUiThread = [
      onUiMessage('hello', () => Message.HeardFromUiThread()),
      onUiMessage('probed', (detail: { width: number | null; frames: number }) =>
        Message.MeasuredBar({ width: detail.width ?? -1, frames: detail.frames }),
      ),
    ]
    const notAvailable = (id: string, line: Line): Html =>
      text(
        [h.Attribute('testID', id), style({ color: line.answer === 'no' ? BAD : MUTED, fontSize: 14 })],
        [line.answer === 'no' ? `Not available: ${line.reason}` : 'Checking...'],
      )
    return stack(
      [h.Attribute('testID', 'stack')],
      [
        screen(
          [h.Key('worklets'), h.Attribute('testID', 'screen-worklets')],
          [
            header([title('Worklets')], []),
            safeArea(env.device, { hasHeader: true }, [
              scrollView(
                [h.Attribute('testID', 'worklets-scroll'), style({ flex: 1, backgroundColor: PAPER })],
                [
                  box(
                    [style({ padding: 16, gap: 14 })],
                    [
                      heading('1. What this build can do'),
                      uiThread(
                        { channel: stage.channel },
                        box(
                        [h.Attribute('testID', 'worklets-status'), ...hearUiThread, style({ gap: 4 })],
                        [
                          statusLine(h, 'ui-runtime', 'UI runtime present', model.uiRuntime),
                          statusLine(h, 'ran-on-ui', 'Worklet ran on the UI thread', model.ranOnUi),
                          statusLine(h, 'shared', 'Shared value round trip', model.sharedRoundTrip),
                          statusLine(
                            h,
                            'prop',
                            'UI-thread prop update reached a view',
                            model.propReachedView,
                          ),
                          statusLine(h, 'message', 'Message came back', model.messageCameBack),
                          statusLine(h, 'gestures', 'Gestures on the UI thread', model.gestures),
                        ],
                        ),
                      ),
                      hint(
                        `The grey bar is drawn ${BAR_DRAWN} points wide. The UI thread widens it to ${BAR_WANTED}.`,
                      ),
                      uiThread(
                        { style: stage.barStyle, inputs: [stage.barWidth], ref: stage.barRef },
                        box(
                          [
                            h.Attribute('testID', 'worklets-bar'),
                            style({
                              width: BAR_DRAWN,
                              height: 10,
                              borderRadius: 5,
                              backgroundColor: MUTED,
                            }),
                          ],
                          [],
                        ),
                      ),
                      box([style({ height: 1, backgroundColor: LINE_COLOR })], []),

                      heading('2. Block JavaScript'),
                      hint('Orange: moved by a worklet on the UI thread.'),
                      moving.answer === 'yes'
                        ? track([
                            uiThread(
                              { style: stage.boxStyle, inputs: [stage.boxX] },
                              box(
                                [
                                  h.Attribute('testID', 'worklets-ui-box'),
                                  style({
                                    width: BOX,
                                    height: BOX,
                                    borderRadius: 10,
                                    backgroundColor: UI_COLOR,
                                  }),
                                ],
                                [],
                              ),
                            ),
                          ])
                        : notAvailable('worklets-ui-box-missing', moving),
                      hint('Blue: moved by JavaScript, as the Lists and motion demo does.'),
                      track([
                        box(
                          [
                            h.Attribute('testID', 'worklets-js-box'),
                            transition({ transform: { duration: 900, easing: 'easeInOut' } }),
                            style({
                              width: BOX,
                              height: BOX,
                              borderRadius: 10,
                              backgroundColor: JS_COLOR,
                              transform: [{ translateX: model.isJsBoxRight ? TRAVEL : 0 }],
                            }),
                          ],
                          [],
                        ),
                      ]),
                      button(
                        h,
                        'worklets-block',
                        model.isJavaScriptBlocked
                          ? 'JavaScript is blocked...'
                          : 'Block JavaScript for 2 seconds',
                        model.isJavaScriptBlocked ? MUTED : INK,
                        Message.PressedBlock(),
                      ),
                      text(
                        [h.Attribute('testID', 'worklets-block-result'), style({ color: MUTED, fontSize: 13 })],
                        [
                          model.lastBlockMs === 0
                            ? 'While it is blocked, blue should stop and orange should keep moving.'
                            : `JavaScript was blocked for ${model.lastBlockMs} ms. Did orange keep moving?`,
                        ],
                      ),
                      box([style({ height: 1, backgroundColor: LINE_COLOR })], []),

                      heading('3. Drag the card'),
                      gestures.answer === 'yes'
                        ? gestureRoot(
                            [style({ height: 96, justifyContent: 'center', alignItems: 'center' })],
                            [
                              uiThread(
                                {
                                  style: stage.cardStyle,
                                  inputs: [stage.cardX],
                                  pan: stage.followFinger,
                                  channel: stage.channel,
                                },
                                box(
                                  [
                                    h.Attribute('testID', 'worklets-card'),
                                    onUiMessage('released', (detail: { dx: number }) =>
                                      Message.ReleasedCard({ dx: detail.dx }),
                                    ),
                                    prop('pointerEvents', 'box-only'),
                                    style({
                                      width: 150,
                                      height: 72,
                                      borderRadius: 14,
                                      backgroundColor: UI_COLOR,
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }),
                                  ],
                                  [text([style({ color: PAPER, fontSize: 15, fontWeight: '600' })], ['Drag me sideways'])],
                                ),
                              ),
                            ],
                          )
                        : notAvailable('worklets-card-missing', gestures),
                      text(
                        [h.Attribute('testID', 'worklets-releases'), style({ color: INK, fontSize: 15 })],
                        [
                          model.releases === 0
                            ? `Let go more than ${RELEASE_PAST} points from the middle: Foldkit hears one Message.`
                            : `Messages from releases: ${model.releases}. Last one was ${model.lastReleaseDx} points from the middle.`,
                        ],
                      ),
                      button(h, 'exit', 'Exit', INK, Message.PressedExit()),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )
  }

const NOT_ASKED: Line = { answer: 'waiting', reason: '' }

export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  options: WorkletsDemoOptions = {},
) => {
  const stage = makeStage()
  const commands = makeCommands(env, stage, options)
  const init: Runtime.ElementInit<Model, Message> = () => ({
    model: {
      uiRuntime: NOT_ASKED,
      ranOnUi: NOT_ASKED,
      sharedRoundTrip: NOT_ASKED,
      propReachedView: NOT_ASKED,
      messageCameBack: NOT_ASKED,
      gestures: NOT_ASKED,
      viewUpdates: NOT_ASKED,
      isJavaScriptBlocked: false,
      lastBlockMs: 0,
      isJsBoxRight: false,
      releases: 0,
      lastReleaseDx: 0,
    },
    commands: [commands.CheckBuild(), commands.WaitToMoveJsBox()],
  })
  return Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(commands),
    view: makeView(env, stage),
    container,
  })
}
