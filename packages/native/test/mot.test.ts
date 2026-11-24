/**
 * The object tracking game's simulation and its trial flow through the
 * Model. No phone is involved: these are pure functions.
 */
import { Option } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  STEP_MS,
  type TrialSpec,
  dotAt,
  drawnPositions,
  initialState,
  isFinished,
  makeRandom,
  scoreTrial,
  stateAt,
  step,
  straightDistances,
  summarise,
} from '../src/game/index.js'
import { Message, type Model, initialModel, makeUpdateForTest } from './demos/mot.js'

const SPEC: TrialSpec = {
  seed: 12345,
  dotCount: 10,
  targetCount: 3,
  speed: 160,
  durationMs: 6000,
  dotRadius: 14,
  width: 360,
  height: 360,
  collide: false,
}

/** Runs a whole trial in frames of the given lengths, repeated in turn. */
const runInFrames = (spec: TrialSpec, frameMs: ReadonlyArray<number>) => {
  let state = initialState(spec)
  for (let turn = 0; !isFinished(state, spec); turn++) {
    state = step(state, frameMs[turn % frameMs.length] as number, spec)
  }
  return state
}

describe('the seeded random numbers', () => {
  it('gives the same numbers for the same seed and others for another', () => {
    const a = makeRandom(7)
    const b = makeRandom(7)
    const c = makeRandom(8)
    const first = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(first)
    expect([c(), c(), c()]).not.toEqual(first)
    expect(first.every(value => value >= 0 && value < 1)).toBe(true)
  })
})

describe('where the dots start', () => {
  it('is the same for the same seed and different for another', () => {
    expect(initialState(SPEC)).toEqual(initialState(SPEC))
    expect(initialState({ ...SPEC, seed: 54321 }).dots).not.toEqual(initialState(SPEC).dots)
  })

  it('never has two dots overlapping, for many seeds and the most dots', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const spec = { ...SPEC, seed, dotCount: 20, width: 320, height: 320 }
      const { dots } = initialState(spec)
      expect(dots).toHaveLength(20)
      for (let a = 0; a < dots.length; a++) {
        for (let b = a + 1; b < dots.length; b++) {
          const one = dots[a]!
          const two = dots[b]!
          expect(Math.hypot(one.x - two.x, one.y - two.y)).toBeGreaterThanOrEqual(2 * spec.dotRadius)
        }
      }
    }
  })

  it('still places every dot apart when the arena is too crowded for chance', () => {
    const spec = { ...SPEC, dotCount: 16, width: 130, height: 130 }
    const { dots } = initialState(spec)
    expect(dots).toHaveLength(16)
    for (let a = 0; a < dots.length; a++) {
      for (let b = a + 1; b < dots.length; b++) {
        expect(Math.hypot(dots[a]!.x - dots[b]!.x, dots[a]!.y - dots[b]!.y)).toBeGreaterThan(2 * 14)
      }
    }
  })

  it('has every dot inside the arena and moving at the set speed', () => {
    for (const dot of initialState(SPEC).dots) {
      expect(dot.x).toBeGreaterThanOrEqual(SPEC.dotRadius)
      expect(dot.x).toBeLessThanOrEqual(SPEC.width - SPEC.dotRadius)
      expect(dot.y).toBeGreaterThanOrEqual(SPEC.dotRadius)
      expect(dot.y).toBeLessThanOrEqual(SPEC.height - SPEC.dotRadius)
      expect(Math.hypot(dot.vx, dot.vy)).toBeCloseTo(SPEC.speed, 9)
    }
  })
})

describe('the movement', () => {
  it('ends in exactly the same place at 60, 120 and 30 frames a second, and with uneven frames', () => {
    const at60 = runInFrames(SPEC, [1000 / 60])
    expect(runInFrames(SPEC, [1000 / 120])).toEqual(at60)
    expect(runInFrames(SPEC, [1000 / 30])).toEqual(at60)
    expect(runInFrames(SPEC, [16, 17, 33, 8, 50, 16.7, 4, 120])).toEqual(at60)
    expect(stateAt(SPEC, SPEC.durationMs)).toEqual(at60)
    expect(at60.elapsedMs).toBe(SPEC.durationMs)
    expect(at60.steps).toBe(Math.round(SPEC.durationMs / STEP_MS))
  })

  it('is on the same path part of the way through, whatever the frame rate', () => {
    // 3 seconds in, by 180 frames of a 60th and by 360 frames of a 120th.
    let slow = initialState(SPEC)
    for (let frame = 0; frame < 180; frame++) slow = step(slow, 1000 / 60, SPEC)
    let fast = initialState(SPEC)
    for (let frame = 0; frame < 360; frame++) fast = step(fast, 1000 / 120, SPEC)
    const a = drawnPositions(slow, SPEC)
    const b = drawnPositions(fast, SPEC)
    a.forEach((dot, index) => {
      expect(dot.x).toBeCloseTo(b[index]!.x, 6)
      expect(dot.y).toBeCloseTo(b[index]!.y, 6)
    })
  })

  it('differs for another seed', () => {
    expect(stateAt({ ...SPEC, seed: 999 }, 3000).dots).not.toEqual(stateAt(SPEC, 3000).dots)
  })

  it('keeps every dot inside the arena, with and without dots bouncing off each other', () => {
    for (const collide of [false, true]) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const spec = { ...SPEC, seed, collide, dotCount: 20, speed: 400, durationMs: 10_000 }
        let state = initialState(spec)
        while (!isFinished(state, spec)) {
          state = step(state, 16.7, spec)
          for (const dot of [...state.dots, ...drawnPositions(state, spec)]) {
            expect(dot.x).toBeGreaterThanOrEqual(spec.dotRadius - 1e-9)
            expect(dot.x).toBeLessThanOrEqual(spec.width - spec.dotRadius + 1e-9)
            expect(dot.y).toBeGreaterThanOrEqual(spec.dotRadius - 1e-9)
            expect(dot.y).toBeLessThanOrEqual(spec.height - spec.dotRadius + 1e-9)
          }
        }
      }
    }
  })

  it('keeps every dot at the set speed, also after bouncing off walls and each other', () => {
    for (const collide of [false, true]) {
      const spec = { ...SPEC, collide, dotCount: 20, speed: 220 }
      let state = initialState(spec)
      while (!isFinished(state, spec)) {
        state = step(state, 16.7, spec)
        for (const dot of state.dots) expect(Math.hypot(dot.vx, dot.vy)).toBeCloseTo(220, 6)
      }
    }
  })

  it('moves each dot as far as its speed says', () => {
    // The path a dot travels in 6 seconds at 160 points a second is 960 points.
    let state = initialState(SPEC)
    const travelled = state.dots.map(() => 0)
    while (!isFinished(state, SPEC)) {
      const next = step(state, STEP_MS, SPEC)
      next.dots.forEach((dot, index) => {
        const before = state.dots[index]!
        travelled[index]! += Math.hypot(dot.x - before.x, dot.y - before.y)
      })
      state = next
    }
    // Measured corner to corner, a step that holds a bounce comes out a
    // hair short, so the sum may be up to a point or two under.
    for (const distance of travelled) {
      expect(distance).toBeLessThanOrEqual(960 + 1e-6)
      expect(distance).toBeGreaterThan(958)
    }
  })

  it('measures the set speed on screen at any frame rate, leaving out dots that bounced', () => {
    for (const frameMs of [16, 1000 / 60, 1000 / 120, 33.4]) {
      let state = initialState(SPEC)
      let points = 0
      let ms = 0
      let skipped = 0
      for (let frame = 0; frame < 150; frame++) {
        const next = step(state, frameMs, SPEC)
        for (const distance of straightDistances(state, next, SPEC)) {
          if (distance === undefined) skipped += 1
          else {
            points += distance
            ms += frameMs
          }
        }
        state = next
      }
      expect(points / (ms / 1000)).toBeCloseTo(SPEC.speed, 6)
      expect(skipped).toBeGreaterThan(0)
    }
  })

  it('makes dots that bounce off each other go other ways than dots that do not', () => {
    const spec = { ...SPEC, dotCount: 20, durationMs: 10_000 }
    expect(stateAt({ ...spec, collide: true }, 10_000).dots).not.toEqual(
      stateAt(spec, 10_000).dots,
    )
  })

  it('does not move the dots past the end of the trial', () => {
    const end = stateAt(SPEC, SPEC.durationMs)
    expect(step(end, 5000, SPEC)).toEqual(end)
    expect(stateAt(SPEC, SPEC.durationMs + 5000)).toEqual(end)
  })

  it('does not change the state it is given', () => {
    const start = initialState(SPEC)
    const copy = JSON.parse(JSON.stringify(start)) as unknown
    step(start, 500, SPEC)
    expect(JSON.parse(JSON.stringify(start))).toEqual(copy)
  })
})

describe('which dot a tap means', () => {
  const dots = [
    { x: 50, y: 50 },
    { x: 100, y: 50 },
    { x: 300, y: 300 },
  ]

  it('is the dot under the finger', () => {
    expect(dotAt(dots, 52, 49, 14, 12)).toBe(0)
    expect(dotAt(dots, 300, 300, 14, 12)).toBe(2)
  })

  it('is the nearest dot when two are in reach', () => {
    expect(dotAt(dots, 70, 50, 14, 12)).toBe(0)
    expect(dotAt(dots, 80, 50, 14, 12)).toBe(1)
  })

  it('counts a tap just outside a dot, up to the slop, and none beyond it', () => {
    expect(dotAt(dots, 300 + 14 + 11, 300, 14, 12)).toBe(2)
    expect(dotAt(dots, 300 + 14 + 13, 300, 14, 12)).toBe(-1)
    expect(dotAt(dots, 200, 200, 14, 12)).toBe(-1)
  })
})

describe('scoring and the timing summary', () => {
  it('sorts picks into right, wrong and missed', () => {
    expect(scoreTrial(SPEC, [0, 5, 2])).toEqual({ correct: [0, 2], wrong: [5], missed: [1] })
  })

  it('counts frames, the usual and the worst gap, and late frames', () => {
    const gaps = [16, 17, 16, 16, 40, 16, 17, 16, 33, 16]
    const timing = summarise(gaps, 160, 6000, 2004)
    expect(timing.frames).toBe(10)
    expect(timing.medianFrameMs).toBe(16)
    expect(timing.worstFrameMs).toBe(40)
    // 40 and 33 are over 1.5 times 16.
    expect(timing.dropped).toBe(2)
    expect(timing.measuredSpeed).toBe(160)
    expect(timing.actualDurationMs).toBe(6000)
    expect(timing.actualCueMs).toBe(2004)
  })

  it('answers zeros for a trial with no frames', () => {
    expect(summarise([], 0, 0, 0)).toMatchObject({ frames: 0, dropped: 0, measuredSpeed: 0 })
  })
})

describe('a trial through the Model', () => {
  const seeds = [111, 222]
  const update = makeUpdateForTest(
    { device: { platform: 'ios', osVersion: 26 }, exit: () => {} },
    { nextSeed: () => seeds.shift() ?? 0 },
  )
  const after = (model: Model, ...messages: ReadonlyArray<Message>): Model =>
    messages.reduce((at, message) => update(at, message).model, model)
  const timing = {
    frames: 480,
    dropped: 0,
    medianFrameMs: 16.7,
    worstFrameMs: 17,
    measuredSpeed: 140,
    actualDurationMs: 8010,
    actualCueMs: 2001,
  }

  it('goes Ready, Cueing, Moving, Answering, Feedback, and scores the picks', () => {
    let model = after(initialModel, Message.MeasuredArena({ width: 350, height: 350 }))
    expect(model.phase).toBe('Ready')

    // Start asks for a seed. The trial begins when the seed arrives.
    const started = update(model, Message.PressedStart())
    expect(started.model.phase).toBe('Ready')
    expect(started.commands).toHaveLength(1)

    model = after(model, Message.PickedSeed({ seed: 111 }))
    expect(model.phase).toBe('Cueing')
    expect(model.runId).toBe(1)
    expect(Option.getOrThrow(model.maybeTrial)).toEqual({
      seed: 111,
      dotCount: 8,
      targetCount: 3,
      speed: 140,
      durationMs: 8000,
      dotRadius: 14,
      width: 350,
      height: 350,
      collide: false,
    })

    model = after(model, Message.EndedCue({ runId: 1 }))
    expect(model.phase).toBe('Moving')
    model = after(model, Message.EndedMovement({ runId: 1, timing }))
    expect(model.phase).toBe('Answering')
    expect(Option.getOrThrow(model.maybeTiming)).toEqual(timing)

    model = after(model, Message.PickedDot({ runId: 1, index: 0 }))
    expect(model.picks).toEqual([0])
    expect(model.phase).toBe('Answering')
    // A second tap on the same dot takes the pick back.
    model = after(model, Message.PickedDot({ runId: 1, index: 0 }))
    expect(model.picks).toEqual([])
    model = after(
      model,
      Message.PickedDot({ runId: 1, index: 0 }),
      Message.PickedDot({ runId: 1, index: 6 }),
      Message.PickedDot({ runId: 1, index: 2 }),
    )
    expect(model.phase).toBe('Feedback')
    expect(model.picks).toEqual([0, 6, 2])
    expect(model.score).toEqual({ trials: 1, found: 2, targets: 3, perfect: 0 })
    // Picks after the last one change nothing.
    expect(after(model, Message.PickedDot({ runId: 1, index: 1 }))).toEqual(model)
  })

  it('replays the same trial with a new run number, and adds to the score', () => {
    let model = after(
      initialModel,
      Message.PickedSeed({ seed: 111 }),
      Message.EndedCue({ runId: 1 }),
      Message.EndedMovement({ runId: 1, timing }),
      Message.PickedDot({ runId: 1, index: 0 }),
      Message.PickedDot({ runId: 1, index: 1 }),
      Message.PickedDot({ runId: 1, index: 2 }),
    )
    expect(model.score).toEqual({ trials: 1, found: 3, targets: 3, perfect: 1 })
    const first = Option.getOrThrow(model.maybeTrial)

    // Settings changed since do not change the trial that is replayed.
    model = after(
      model,
      Message.PressedDone(),
      Message.PressedChangeSetting({ name: 'speed', by: 3 }),
      Message.PressedReplay(),
    )
    expect(model.phase).toBe('Cueing')
    expect(model.runId).toBe(2)
    expect(model.picks).toEqual([])
    expect(Option.getOrThrow(model.maybeTrial)).toEqual(first)

    // What the first run still had to say is not heard.
    expect(after(model, Message.EndedCue({ runId: 1 })).phase).toBe('Cueing')
    expect(after(model, Message.PickedDot({ runId: 1, index: 0 })).picks).toEqual([])
  })

  it('stops a trial and goes back to Ready', () => {
    const model = after(
      initialModel,
      Message.PickedSeed({ seed: 111 }),
      Message.EndedCue({ runId: 1 }),
      Message.PressedStop(),
    )
    expect(model.phase).toBe('Ready')
    expect(after(model, Message.EndedMovement({ runId: 1, timing })).phase).toBe('Ready')
  })

  it('keeps the settings inside their limits, with one dot that is not a target', () => {
    const many = (name: 'dotCount' | 'targetCount' | 'speed' | 'durationSeconds', by: number) =>
      Array.from({ length: 40 }, () => Message.PressedChangeSetting({ name, by }))
    let model = after(initialModel, ...many('dotCount', 1), ...many('targetCount', 1))
    expect(model.settings.dotCount).toBe(20)
    expect(model.settings.targetCount).toBe(8)
    model = after(model, ...many('dotCount', -1))
    expect(model.settings.dotCount).toBe(4)
    expect(model.settings.targetCount).toBe(3)
    model = after(model, ...many('targetCount', -1), ...many('speed', 1), ...many('durationSeconds', -1))
    expect(model.settings.targetCount).toBe(1)
    expect(model.settings.speed).toBe(400)
    expect(model.settings.durationSeconds).toBe(2)
    model = after(model, ...many('speed', -1), ...many('durationSeconds', 1), Message.PressedToggleCollide())
    expect(model.settings.speed).toBe(40)
    expect(model.settings.durationSeconds).toBe(30)
    expect(model.settings.collide).toBe(true)
  })
})
