/**
 * The object tracking game's arena: the part that owns the dots' positions
 * and draws them every frame.
 *
 *   motArena(h, {
 *     id: 'arena',
 *     trial, runId, phase, picks,       // from the Model
 *     onCueEnded, onMovementEnded, onPicked, onMeasured,
 *   }, [style({ ... })])
 *
 * The Model does not know where any dot is. It holds the trial's settings,
 * the phase and the picks. The loop here runs the simulation (`mot.ts`),
 * draws it on a canvas (`../skia/canvas.ts`), and sends a Message only when
 * something worth knowing happens:
 *
 * - the targets have been shown long enough and the dots start moving,
 * - the dots have stopped (with what the frame clock did meanwhile),
 * - a tap landed on a dot (with which dot),
 * - the phone reported the arena's size.
 *
 * A new `runId` starts a trial from the beginning. The loop keeps time for
 * the cue and the movement itself, frame by frame, so neither waits on a
 * Message going round the program.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { type CanvasSurface, type Renderer, type Scene, canvas } from '../skia/canvas.js'
import type { Pen, Size } from '../skia/draw.js'
import {
  type MotState,
  type Point,
  type Timing,
  type TrialSpec,
  dotAt,
  drawnPositions,
  initialState,
  isFinished,
  isTarget,
  stateAt,
  step,
  straightDistances,
  summarise,
} from './mot.js'

export type Phase = 'Ready' | 'Cueing' | 'Moving' | 'Answering' | 'Feedback'

export type ArenaColors = Readonly<{
  arena: string
  dot: string
  /** The targets while they are shown, and a missed target's ring afterwards. */
  target: string
  /** The ring round a dot the player has picked. */
  picked: string
  correct: string
  wrong: string
}>

export const DEFAULT_COLORS: ArenaColors = {
  arena: '#101418',
  dot: '#ffffff',
  target: '#f59e0b',
  picked: '#38bdf8',
  correct: '#22c55e',
  wrong: '#ef4444',
}

type ArenaProps = Readonly<{
  trial: TrialSpec | undefined
  runId: number
  phase: Phase
  picks: ReadonlyArray<number>
  cueMs: number
  hitSlop: number
  colors: ArenaColors
}>

export type MovementEnded = Readonly<{ runId: number; timing: Timing }>

export type MotArena<Message> = Readonly<{
  id: string
  /** The trial to show, or undefined for an empty arena. */
  trial: TrialSpec | undefined
  /** Give each new trial (and each replay) a new number. */
  runId: number
  phase: Phase
  /** The dots picked so far, by index. */
  picks: ReadonlyArray<number>
  /** How long the targets are shown. 2000 if left out. */
  cueMs?: number
  /** How far outside a dot a tap still counts, in points. 12 if left out. */
  hitSlop?: number
  colors?: ArenaColors
  renderer?: Renderer | 'auto'
  onCueEnded: (runId: number) => Message
  onMovementEnded: (ended: MovementEnded) => Message
  onPicked: (picked: Readonly<{ runId: number; index: number }>) => Message
  /** The arena's size in points, once the phone has said. Use it for the next trial. */
  onMeasured?: (size: Size) => Message
}>

/** The targets blink while they are shown: this long lit, then this long plain. */
const BLINK_ON_MS = 350
const BLINK_OFF_MS = 150
const RING_GAP = 4
const RING_WIDTH = 3

type Stage = 'cueing' | 'moving' | 'stopped'

type Run = {
  readonly runId: number
  readonly spec: TrialSpec
  stage: Stage
  state: MotState
  drawn: ReadonlyArray<Point>
  cueStart: number
  actualCueMs: number
  moveStart: number
  lastFrame: number
  /** Milliseconds between each frame and the one before, while moving. */
  gaps: Array<number>
  /** Distance drawn, and the time it took, summed over dots moving straight. */
  measuredPoints: number
  measuredMs: number
}

const start = (surface: CanvasSurface, first: ArenaProps) => {
  let props = first
  let run: Run | undefined
  let isStopped = false

  /** The arena is drawn to fit the canvas if the two are not the same size. */
  const scaleOf = (spec: TrialSpec): number => {
    const size = surface.size()
    if (size.width <= 0 || size.height <= 0) return 1
    return Math.min(size.width / spec.width, size.height / spec.height)
  }

  const paint = (pen: Pen): void => {
    if (run === undefined) return
    const { spec, drawn, stage } = run
    const scale = scaleOf(spec)
    const radius = spec.dotRadius * scale
    const isBlinkOn =
      stage === 'cueing' &&
      (surface.now() - run.cueStart) % (BLINK_ON_MS + BLINK_OFF_MS) < BLINK_ON_MS
    const isFeedback = stage === 'stopped' && props.phase === 'Feedback'
    const isAnswering = stage === 'stopped' && props.phase !== 'Feedback'
    drawn.forEach((dot, index) => {
      const x = dot.x * scale
      const y = dot.y * scale
      const isPicked = props.picks.includes(index)
      const target = isTarget(spec, index)
      let fill = props.colors.dot
      let ring: string | undefined
      if (stage === 'cueing' && target && isBlinkOn) fill = props.colors.target
      if (isAnswering && isPicked) ring = props.colors.picked
      if (isFeedback && isPicked) fill = target ? props.colors.correct : props.colors.wrong
      if (isFeedback && !isPicked && target) ring = props.colors.target
      pen.circle(x, y, radius, { color: fill })
      if (ring !== undefined) {
        pen.circle(x, y, radius + RING_GAP, { color: ring, stroke: RING_WIDTH })
      }
    })
  }

  const draw = (): void => surface.draw(paint)

  const tick = (now: number): void => {
    if (isStopped || run === undefined || run.stage === 'stopped') return
    if (run.stage === 'cueing') {
      if (now - run.cueStart >= props.cueMs) {
        run.stage = 'moving'
        run.actualCueMs = now - run.cueStart
        run.moveStart = now
        run.lastFrame = now
        surface.emit('cueEnded', run.runId)
      }
      draw()
      surface.frame(tick)
      return
    }
    const gap = now - run.lastFrame
    run.lastFrame = now
    run.gaps.push(gap)
    const before = run.state
    run.state = step(before, gap, run.spec)
    run.drawn = drawnPositions(run.state, run.spec)
    if (!isFinished(run.state, run.spec)) {
      // The last frame is left out: the dots stop part of the way through it.
      for (const distance of straightDistances(before, run.state, run.spec)) {
        if (distance === undefined) continue
        run.measuredPoints += distance
        run.measuredMs += gap
      }
      draw()
      surface.frame(tick)
      return
    }
    run.stage = 'stopped'
    draw()
    surface.emit('movementEnded', {
      runId: run.runId,
      timing: summarise(
        run.gaps,
        run.measuredMs > 0 ? run.measuredPoints / (run.measuredMs / 1000) : 0,
        now - run.moveStart,
        run.actualCueMs,
      ),
    } satisfies MovementEnded)
  }

  const begin = (spec: TrialSpec, runId: number): void => {
    const state = initialState(spec)
    run = {
      runId,
      spec,
      stage: 'cueing',
      state,
      drawn: drawnPositions(state, spec),
      cueStart: surface.now(),
      actualCueMs: 0,
      moveStart: 0,
      lastFrame: 0,
      gaps: [],
      measuredPoints: 0,
      measuredMs: 0,
    }
    draw()
    surface.frame(tick)
  }

  /** A trial the Model says is already over: the dots where they stopped. */
  const showStopped = (spec: TrialSpec, runId: number): void => {
    const state = stateAt(spec, spec.durationMs)
    run = {
      runId,
      spec,
      stage: 'stopped',
      state,
      drawn: drawnPositions(state, spec),
      cueStart: 0,
      actualCueMs: 0,
      moveStart: 0,
      lastFrame: 0,
      gaps: [],
      measuredPoints: 0,
      measuredMs: 0,
    }
    draw()
  }

  const apply = (): void => {
    const { trial, runId, phase } = props
    if (trial === undefined || phase === 'Ready') {
      run = undefined
      draw()
      return
    }
    if (run === undefined || run.runId !== runId) {
      if (phase === 'Answering' || phase === 'Feedback') showStopped(trial, runId)
      else begin(trial, runId)
      return
    }
    // The same trial: only what is drawn over the dots may have changed. A
    // moving trial draws on the next frame anyway.
    if (run.stage === 'stopped') draw()
  }

  apply()

  return {
    update: (next: ArenaProps): void => {
      props = next
      apply()
    },
    tap: (x: number, y: number): void => {
      if (run === undefined || run.stage !== 'stopped' || props.phase !== 'Answering') return
      const scale = scaleOf(run.spec)
      const index = dotAt(run.drawn, x / scale, y / scale, run.spec.dotRadius, props.hitSlop / scale)
      if (index >= 0) surface.emit('picked', { runId: run.runId, index })
    },
    resize: (size: Size): void => {
      surface.emit('measured', size)
      // Drawn again to fit, unless a frame is about to do that.
      if (run === undefined || run.stage === 'stopped') draw()
    },
    stop: (): void => {
      isStopped = true
      run = undefined
    },
  }
}

/** One scene object for every arena, so a redraw never restarts a trial. */
const scene: Scene<ArenaProps> = { start }

/** See the top of this file. */
export const motArena = <Message>(
  h: HtmlBuilder<Message>,
  config: MotArena<Message>,
  attributes: ReadonlyArray<any> = [],
): Html => {
  const colors = config.colors ?? DEFAULT_COLORS
  const onMeasured = config.onMeasured
  return canvas(
    h,
    {
      id: config.id,
      scene,
      props: {
        trial: config.trial,
        runId: config.runId,
        phase: config.phase,
        picks: config.picks,
        cueMs: config.cueMs ?? 2000,
        hitSlop: config.hitSlop ?? 12,
        colors,
      },
      ...(config.renderer === undefined ? {} : { renderer: config.renderer }),
      background: colors.arena,
      on: {
        cueEnded: (runId: number) => config.onCueEnded(runId),
        movementEnded: (ended: MovementEnded) => config.onMovementEnded(ended),
        picked: (picked: { runId: number; index: number }) => config.onPicked(picked),
        ...(onMeasured === undefined ? {} : { measured: (size: Size) => onMeasured(size) }),
      },
    },
    attributes,
  )
}
