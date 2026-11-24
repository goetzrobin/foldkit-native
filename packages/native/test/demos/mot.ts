/**
 * The object tracking demo: a Multiple Object Tracking (MOT) game.
 *
 * Some white dots sit in a dark arena. A few blink orange for two seconds:
 * those are the targets. Then all dots turn white and move. When they stop,
 * tap the ones you think were the targets. Right picks turn green, wrong
 * picks red, and a target you missed gets an orange ring.
 *
 * The Model here holds the settings, the phase, the picks and the results.
 * It never holds a dot's position. The arena (`src/game/arena.ts`) owns
 * those and draws every frame by itself, with Skia where the build has it
 * and with plain views where it does not. A line on screen says which.
 *
 * After each trial the screen shows what the frame clock did: frames drawn,
 * frames that came late, and the dots' measured speed and moving time
 * against what was set. A laptop test cannot show those. A phone can.
 */
import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { type Phase, type TrialSpec, motArena, scoreTrial } from '../../src/game/index.js'
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
import { isSkiaAvailable, rendererFor, skiaUnavailableReason } from '../../src/skia/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

export type DemoOptions = Readonly<{
  /** Picks each trial's seed. Tests pass their own. The default uses the clock and chance. */
  nextSeed?: () => number
  /** How long the targets are shown. 2000 if left out. */
  cueMs?: number
}>

export const DOT_RADIUS = 14
export const CUE_MS = 2000
/** The arena assumed until the phone has reported its real size. */
const ASSUMED_ARENA = 320

export const LIMITS = {
  dotCount: { min: 4, max: 20, step: 1 },
  targetCount: { min: 1, max: 8, step: 1 },
  speed: { min: 40, max: 400, step: 20 },
  durationSeconds: { min: 2, max: 30, step: 1 },
} as const

const SettingName = Schema.Literals(['dotCount', 'targetCount', 'speed', 'durationSeconds'])
type SettingName = typeof SettingName.Type

const Settings = Schema.Struct({
  dotCount: Schema.Number,
  targetCount: Schema.Number,
  /** Points per second. */
  speed: Schema.Number,
  durationSeconds: Schema.Number,
  /** Whether dots bounce off each other as well as the walls. */
  collide: Schema.Boolean,
})
type Settings = typeof Settings.Type

const Trial = Schema.Struct({
  seed: Schema.Number,
  dotCount: Schema.Number,
  targetCount: Schema.Number,
  speed: Schema.Number,
  durationMs: Schema.Number,
  dotRadius: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  collide: Schema.Boolean,
})

const Timing = Schema.Struct({
  frames: Schema.Number,
  dropped: Schema.Number,
  medianFrameMs: Schema.Number,
  worstFrameMs: Schema.Number,
  measuredSpeed: Schema.Number,
  actualDurationMs: Schema.Number,
  actualCueMs: Schema.Number,
})
type Timing = typeof Timing.Type

const Score = Schema.Struct({
  /** Trials answered. */
  trials: Schema.Number,
  /** Targets found, over all trials. */
  found: Schema.Number,
  /** Targets there were to find, over all trials. */
  targets: Schema.Number,
  /** Trials with every target found. */
  perfect: Schema.Number,
})

export const Model = Schema.Struct({
  settings: Settings,
  phase: Schema.Literals(['Ready', 'Cueing', 'Moving', 'Answering', 'Feedback']),
  /** The trial on the arena now, or the last one played. */
  maybeTrial: Schema.Option(Trial),
  /** A new number for every start and every replay. The arena starts over when it changes. */
  runId: Schema.Number,
  /** The dots picked so far, by index. */
  picks: Schema.Array(Schema.Number),
  /** What the frame clock did in the last trial. */
  maybeTiming: Schema.Option(Timing),
  score: Score,
  /** The arena's size in points, once the phone has reported it. */
  arena: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  /** The demo's own switch: draw with plain views even where Skia is there. */
  usesPlainViews: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  PressedChangeSetting: { name: SettingName, by: Schema.Number },
  PressedToggleCollide: {},
  PressedSwitchRenderer: {},
  PressedStart: {},
  PickedSeed: { seed: Schema.Number },
  PressedReplay: {},
  PressedStop: {},
  PressedDone: {},
  EndedCue: { runId: Schema.Number },
  EndedMovement: { runId: Schema.Number, timing: Timing },
  PickedDot: { runId: Schema.Number, index: Schema.Number },
  MeasuredArena: { width: Schema.Number, height: Schema.Number },
})
export type Message = typeof Message.Type

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** There is always at least one dot that is not a target. */
const fitTargets = (settings: Settings): Settings => ({
  ...settings,
  targetCount: clamp(
    settings.targetCount,
    LIMITS.targetCount.min,
    Math.min(LIMITS.targetCount.max, settings.dotCount - 1),
  ),
})

const changed = (settings: Settings, name: SettingName, by: number): Settings => {
  const limit = LIMITS[name]
  return fitTargets({
    ...settings,
    [name]: clamp(settings[name] + by * limit.step, limit.min, limit.max),
  })
}

const trialFor = (model: Model, seed: number): TrialSpec => ({
  seed,
  dotCount: model.settings.dotCount,
  targetCount: model.settings.targetCount,
  speed: model.settings.speed,
  durationMs: model.settings.durationSeconds * 1000,
  dotRadius: DOT_RADIUS,
  width: model.arena.width > 0 ? model.arena.width : ASSUMED_ARENA,
  height: model.arena.height > 0 ? model.arena.height : ASSUMED_ARENA,
  collide: model.settings.collide,
})

const begun = (model: Model, trial: TrialSpec): Model =>
  modifyFields(model, {
    phase: () => 'Cueing' as const,
    maybeTrial: () => Option.some(trial),
    runId: runId => runId + 1,
    picks: () => [],
    maybeTiming: () => Option.none(),
  })

const makeUpdate = (env: DemoEnv, options: DemoOptions) => {
  const nextSeed =
    options.nextSeed ?? (() => (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0)

  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => env.exit()).pipe(Effect.as(Message.CompletedExit())),
  })
  // Chance is a side effect, so the seed is picked in a Command.
  const PickSeed = Command.define('PickSeed', {
    messages: [Message.PickedSeed],
    execute: Effect.sync(() => Message.PickedSeed({ seed: nextSeed() })),
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      PressedChangeSetting: ({ name, by }) => ({
        model: modifyFields(model, { settings: settings => changed(settings, name, by) }),
      }),
      PressedToggleCollide: () => ({
        model: modifyFields(model, {
          settings: settings => ({ ...settings, collide: !settings.collide }),
        }),
      }),
      PressedSwitchRenderer: () => ({
        model: modifyFields(model, { usesPlainViews: uses => !uses }),
      }),
      PressedStart: () => ({ model, commands: [PickSeed()] }),
      PickedSeed: ({ seed }) => ({ model: begun(model, trialFor(model, seed)) }),
      // The same trial again: same seed, same settings, same arena size.
      PressedReplay: () => ({
        model: Option.match(model.maybeTrial, {
          onNone: () => model,
          onSome: trial => begun(model, trial),
        }),
      }),
      PressedStop: () => ({
        model: modifyFields(model, { phase: () => 'Ready' as const, picks: () => [] }),
      }),
      PressedDone: () => ({
        model: modifyFields(model, { phase: () => 'Ready' as const, picks: () => [] }),
      }),
      EndedCue: ({ runId }) => ({
        model:
          runId === model.runId && model.phase === 'Cueing'
            ? modifyFields(model, { phase: () => 'Moving' as const })
            : model,
      }),
      EndedMovement: ({ runId, timing }) => ({
        model:
          runId === model.runId && (model.phase === 'Moving' || model.phase === 'Cueing')
            ? modifyFields(model, {
                phase: () => 'Answering' as const,
                maybeTiming: () => Option.some(timing),
              })
            : model,
      }),
      PickedDot: ({ runId, index }) => {
        const trial = Option.getOrUndefined(model.maybeTrial)
        if (trial === undefined || runId !== model.runId || model.phase !== 'Answering') {
          return { model }
        }
        // A second tap on a picked dot takes the pick back.
        const picks = model.picks.includes(index)
          ? model.picks.filter(each => each !== index)
          : [...model.picks, index]
        if (picks.length < trial.targetCount) {
          return { model: modifyFields(model, { picks: () => picks }) }
        }
        const found = scoreTrial(trial, picks).correct.length
        return {
          model: modifyFields(model, {
            picks: () => picks,
            phase: () => 'Feedback' as const,
            score: score => ({
              trials: score.trials + 1,
              found: score.found + found,
              targets: score.targets + trial.targetCount,
              perfect: score.perfect + (found === trial.targetCount ? 1 : 0),
            }),
          }),
        }
      },
      MeasuredArena: ({ width, height }) => ({
        model: modifyFields(model, { arena: () => ({ width, height }) }),
      }),
    })
}

export const initialModel: Model = {
  settings: { dotCount: 8, targetCount: 3, speed: 140, durationSeconds: 8, collide: false },
  phase: 'Ready',
  maybeTrial: Option.none(),
  runId: 0,
  picks: [],
  maybeTiming: Option.none(),
  score: { trials: 0, found: 0, targets: 0, perfect: 0 },
  arena: { width: 0, height: 0 },
  usesPlainViews: false,
}

const init: Runtime.ElementInit<Model, Message> = () => ({ model: initialModel })

const INK = '#111111'
const PAPER = '#ffffff'
const MUTED = '#5f6368'
const LINE = '#e3e3e3'
const ACCENT = '#b45309'

const button = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  message: Message,
  look: 'solid' | 'outline' = 'solid',
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: INK,
        backgroundColor: look === 'solid' ? INK : PAPER,
        alignItems: 'center',
        justifyContent: 'center',
      }),
    ],
    [
      text(
        [style({ color: look === 'solid' ? PAPER : INK, fontSize: 15, fontWeight: '600' })],
        [label],
      ),
    ],
  )

const line = (id: string, value: string, color: string = MUTED): Html =>
  text([prop('testID', id), style({ color, fontSize: 14 })], [value])

/** One setting: its name and value, with a minus and a plus button. */
const stepper = (
  h: HtmlBuilder<Message>,
  name: SettingName,
  label: string,
  value: string,
): Html =>
  box(
    [style({ flexDirection: 'row', alignItems: 'center', gap: 8 })],
    [
      box(
        [style({ flex: 1 })],
        [
          text([style({ color: MUTED, fontSize: 13 })], [label]),
          text(
            [prop('testID', `value-${name}`), style({ color: INK, fontSize: 17, fontWeight: '600' })],
            [value],
          ),
        ],
      ),
      button(h, `less-${name}`, '-', Message.PressedChangeSetting({ name, by: -1 }), 'outline'),
      button(h, `more-${name}`, '+', Message.PressedChangeSetting({ name, by: 1 }), 'outline'),
    ],
  )

const rendererOf = (model: Model) => rendererFor(model.usesPlainViews ? 'views' : 'auto')

const rendererLine = (model: Model): string => {
  if (rendererOf(model) === 'skia') return 'Drawing with: Skia'
  return isSkiaAvailable()
    ? 'Drawing with: plain views (switched here)'
    : `Drawing with: plain views (${skiaUnavailableReason()})`
}

const statusLine = (model: Model): string => {
  const targets = Option.match(model.maybeTrial, {
    onNone: () => model.settings.targetCount,
    onSome: trial => trial.targetCount,
  })
  const dots = targets === 1 ? 'dot' : 'dots'
  switch (model.phase) {
    case 'Ready':
      return 'Set up a trial below, then press Start.'
    case 'Cueing':
      return `Remember the ${targets} orange ${dots}.`
    case 'Moving':
      return 'Keep track of them.'
    case 'Answering':
      return `Tap the ${targets} ${dots} you tracked. Picked ${model.picks.length} of ${targets}.`
    case 'Feedback': {
      const found = Option.match(model.maybeTrial, {
        onNone: () => 0,
        onSome: trial => scoreTrial(trial, model.picks).correct.length,
      })
      return `You found ${found} of ${targets}. Green is right, red is wrong, an orange ring is one you missed.`
    }
  }
}

const one = (value: number): string => value.toFixed(1)

const timingLines = (model: Model): ReadonlyArray<Html> => {
  const trial = Option.getOrUndefined(model.maybeTrial)
  const timing = Option.getOrUndefined(model.maybeTiming)
  if (trial === undefined || timing === undefined) return []
  return [
    text([style({ color: INK, fontSize: 15, fontWeight: '600' })], ['Timing of the last trial']),
    line('timing-frames', `Frames drawn: ${timing.frames}`),
    line('timing-dropped', `Late frames (over 1.5 times the usual gap): ${timing.dropped}`),
    line(
      'timing-frame-ms',
      `Frame time: usual ${one(timing.medianFrameMs)} ms, worst ${one(timing.worstFrameMs)} ms`,
    ),
    line(
      'timing-speed',
      `Dot speed: measured ${one(timing.measuredSpeed)}, set ${trial.speed} points a second`,
    ),
    line(
      'timing-duration',
      `Moving time: measured ${Math.round(timing.actualDurationMs)} ms, set ${trial.durationMs} ms`,
    ),
    line('timing-cue', `Targets shown for: ${Math.round(timing.actualCueMs)} ms`),
    line('trial-seed', `Trial seed: ${trial.seed}`),
  ]
}

const scoreLine = (model: Model): string =>
  model.score.trials === 0
    ? 'Score: no trials yet.'
    : `Score: ${model.score.found} of ${model.score.targets} targets found in ` +
      `${model.score.trials} ${model.score.trials === 1 ? 'trial' : 'trials'}. ` +
      `All found in ${model.score.perfect}.`

const settingsPanel = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  box(
    [style({ flexDirection: 'row', gap: 8 })],
    [
      box([style({ flex: 1 })], [button(h, 'start', 'Start', Message.PressedStart())]),
      ...(Option.isSome(model.maybeTrial)
        ? [button(h, 'replay', 'Replay same trial', Message.PressedReplay(), 'outline')]
        : []),
    ],
  ),
  stepper(h, 'dotCount', 'Dots (4 to 20)', String(model.settings.dotCount)),
  stepper(h, 'targetCount', 'Targets (1 to 8)', String(model.settings.targetCount)),
  stepper(h, 'speed', 'Speed', `${model.settings.speed} points a second`),
  stepper(h, 'durationSeconds', 'Moving time', `${model.settings.durationSeconds} seconds`),
  button(
    h,
    'toggle-collide',
    model.settings.collide
      ? 'Dots bounce off each other: on'
      : 'Dots bounce off each other: off',
    Message.PressedToggleCollide(),
    'outline',
  ),
  // Only where there are two renderers to compare.
  ...(isSkiaAvailable()
    ? [
        button(
          h,
          'switch-renderer',
          model.usesPlainViews ? 'Draw with Skia' : 'Draw with plain views',
          Message.PressedSwitchRenderer(),
          'outline',
        ),
      ]
    : []),
  ...timingLines(model),
]

const feedbackPanel = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  box(
    [style({ flexDirection: 'row', gap: 8 })],
    [
      box([style({ flex: 1 })], [button(h, 'start', 'Next trial', Message.PressedStart())]),
      button(h, 'replay', 'Replay same trial', Message.PressedReplay(), 'outline'),
    ],
  ),
  button(h, 'done', 'Change settings', Message.PressedDone(), 'outline'),
  ...timingLines(model),
]

const runningPanel = (h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  button(h, 'stop', 'Stop this trial', Message.PressedStop(), 'outline'),
]

const makeView =
  (device: Device, options: DemoOptions) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [],
      [
        screen(
          [h.Key('mot'), h.Attribute('testID', 'screen-mot')],
          [
            header([title('Object tracking')], []),
            safeArea(device, { hasHeader: true }, [
              box(
                [style({ flex: 1, backgroundColor: PAPER })],
                [
                  box(
                    [style({ paddingHorizontal: 12, paddingTop: 8, gap: 4 })],
                    [
                      box(
                        [style({ flexDirection: 'row', alignItems: 'center', gap: 10 })],
                        [
                          button(h, 'exit', 'Exit', Message.PressedExit(), 'outline'),
                          box(
                            [style({ flex: 1 })],
                            [line('renderer', rendererLine(model), ACCENT)],
                          ),
                        ],
                      ),
                      // Two lines tall whatever it says, so the arena does not move.
                      box(
                        [style({ minHeight: 40, justifyContent: 'center' })],
                        [
                          text(
                            [prop('testID', 'status'), style({ color: INK, fontSize: 15 })],
                            [statusLine(model)],
                          ),
                        ],
                      ),
                    ],
                  ),
                  motArena(
                    h,
                    {
                      id: 'arena',
                      trial: Option.getOrUndefined(model.maybeTrial),
                      runId: model.runId,
                      phase: model.phase as Phase,
                      picks: model.picks,
                      cueMs: options.cueMs ?? CUE_MS,
                      renderer: model.usesPlainViews ? 'views' : 'auto',
                      onCueEnded: runId => Message.EndedCue({ runId }),
                      onMovementEnded: ended => Message.EndedMovement(ended),
                      onPicked: picked => Message.PickedDot(picked),
                      onMeasured: size => Message.MeasuredArena(size),
                    },
                    [style({ marginHorizontal: 12, aspectRatio: 1, borderRadius: 8 })],
                  ),
                  scrollView(
                    [prop('testID', 'panel'), style({ flex: 1 })],
                    [
                      box(
                        [style({ padding: 12, gap: 10 })],
                        [
                          line('score', scoreLine(model), INK),
                          ...(model.phase === 'Ready'
                            ? settingsPanel(model, h)
                            : model.phase === 'Feedback'
                              ? feedbackPanel(model, h)
                              : runningPanel(h)),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

export const makeDemo = (container: HTMLElement, env: DemoEnv, options: DemoOptions = {}) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env, options),
    view: makeView(env.device, options),
    container,
  })

/** The update function by itself, for tests of the trial flow through the Model. */
export const makeUpdateForTest = makeUpdate
