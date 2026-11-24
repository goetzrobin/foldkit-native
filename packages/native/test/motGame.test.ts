/**
 * The object tracking demo on the simulated phone, drawn both ways: with
 * Skia (a recording stand-in, see `support/skia.ts`) and with plain views.
 *
 * The simulated phone cannot show movement or timing. These tests check what
 * the phone was asked to draw, frame by frame, on a clock the test turns by
 * hand.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_COLORS } from '../src/foldkit/game/arena.js'
import { type TrialSpec, drawnPositions, isTarget, stateAt } from '../src/game/index.js'
import { type NativeSurface, createNativeSurface, registerNavigation } from '../src/index.js'
import { configureMotion, stopMotion } from '../src/motion/index.js'
import {
  configureSkia,
  isSkiaAvailable,
  registerSkia,
  resetSkia,
  skiaUnavailableReason,
} from '../src/skia/index.js'
import { DOT_RADIUS, makeDemo } from './demos/mot.js'
import { byTestId, flatten, hasTestId, press, settle, textOf } from './support/phone.js'
import { type Op, makeSkia } from './support/skia.js'

const SEED = 4242
const ARENA = 300
/** A whole number of milliseconds, so the cue and the trial end exactly on a frame. */
const FRAME_MS = 16

/** The trial the demo plays with its first settings, this seed and this arena. */
const SPEC: TrialSpec = {
  seed: SEED,
  dotCount: 8,
  targetCount: 3,
  speed: 140,
  durationMs: 8000,
  dotRadius: DOT_RADIUS,
  width: ARENA,
  height: ARENA,
  collide: false,
}

describe('the object tracking demo', () => {
  let fabric: FakeFabric
  let surface: NativeSurface
  let handle: { dispose: () => void } | undefined
  let skia: ReturnType<typeof makeSkia>
  let now = 0
  let frames: Array<() => void> = []
  let seeds: Array<number> = []
  let exits = 0

  /** One frame: the clock moves on and everything waiting for a frame runs. */
  const frame = (ms: number = FRAME_MS): number => {
    now += ms
    const due = frames.splice(0)
    for (const run of due) run()
    return due.length
  }
  /** Frames of 16 ms (or `frameMs`) until `ms` have gone by. */
  const play = async (ms: number, frameMs: number = FRAME_MS): Promise<void> => {
    const end = now + ms
    while (now < end - 1e-6) frame(Math.min(frameMs, end - now))
    await settle()
  }

  const all = (): Array<FakeFabricNode> => flatten(fabric.committed)
  const arena = (): FakeFabricNode => byTestId(fabric, 'arena')
  const label = (id: string): string => textOf(byTestId(fabric, id))
  const skiaViews = (): Array<FakeFabricNode> =>
    all().filter(node => node.viewName === 'SkiaPictureView')
  const skiaId = (): number => Number(skiaViews()[0]?.props['nativeID'])
  /** What the Skia view on screen was last handed. */
  const picture = (): ReadonlyArray<Op> => {
    const shown = skia.shown.get(skiaId())
    if (shown === undefined || shown === null) throw new Error('The Skia view has no picture')
    return shown.ops
  }
  const circles = (): Array<Extract<Op, { op: 'circle' }>> =>
    picture().filter((op): op is Extract<Op, { op: 'circle' }> => op.op === 'circle')
  /** The dots, without the rings drawn round some of them. */
  const dots = () => circles().filter(circle => circle.stroke === undefined)
  const rings = () => circles().filter(circle => circle.stroke !== undefined)

  const tapAt = async (x: number, y: number): Promise<void> => {
    const node = arena()
    const point = {
      identifier: 0,
      target: node.reactTag,
      pageX: x,
      pageY: y,
      locationX: x,
      locationY: y,
      timestamp: now,
    }
    fabric.emit(node, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] })
    fabric.emit(node, 'topTouchEnd', { ...point, touches: [], changedTouches: [point] })
    await settle()
  }

  const start = async (
    renderer: 'skia' | 'views',
    platform: 'ios' | 'android' = 'ios',
  ): Promise<void> => {
    exits = 0
    now = 10_000
    frames = []
    seeds = [SEED, SEED + 1, SEED + 2]
    registerNavigation()
    registerPlatformComponents(platform)
    registerSkia()
    skia = makeSkia()
    configureSkia({ host: renderer === 'skia' ? skia.host : null, now: () => now })
    fabric = createFakeFabric()
    surface = createNativeSurface(fabric, 1, { dev: false, now: () => now })
    configureMotion(surface, { requestFrame: run => frames.push(run) })
    handle = Runtime.embed(
      makeDemo(
        surface.container,
        {
          device: { platform, osVersion: 26 },
          exit: () => {
            exits += 1
          },
        },
        { nextSeed: () => seeds.shift() ?? 1 },
      ),
    )
    await settle()
    // The phone reports the arena's size once it has laid it out.
    fabric.emit(arena(), 'topLayout', { layout: { x: 12, y: 150, width: ARENA, height: ARENA } })
    await settle()
  }

  /** Start a trial and run it to the moment the dots stop. */
  const playTrial = async (): Promise<void> => {
    await press(fabric, 'start')
    await play(2000)
    await play(8000)
  }

  afterEach(() => {
    handle?.dispose()
    handle = undefined
    if (surface !== undefined) stopMotion(surface)
    resetSkia()
  })

  describe('drawn with Skia', () => {
    it('says so, and puts one Skia view in the arena with a number for its name', async () => {
      await start('skia')
      expect(label('renderer')).toBe('Drawing with: Skia')
      expect(skiaViews()).toHaveLength(1)
      expect(arena().children).toEqual(skiaViews())
      expect(Number.isInteger(skiaId())).toBe(true)
      // The arena takes the touches, the Skia view none.
      expect(arena().props['pointerEvents']).toBe('box-only')
      expect(skiaViews()[0]?.props['pointerEvents']).toBe('none')
      // An empty arena is an empty picture, not a missing one.
      expect(picture()).toEqual([])
    })

    it('records the dots as circles and hands the picture to that view', async () => {
      await start('skia')
      await press(fabric, 'start')
      expect(label('status')).toBe('Remember the 3 orange dots.')
      const first = drawnPositions(stateAt(SPEC, 0), SPEC)
      expect(dots()).toHaveLength(8)
      dots().forEach((dot, index) => {
        expect(dot.cx).toBeCloseTo(first[index]!.x, 9)
        expect(dot.cy).toBeCloseTo(first[index]!.y, 9)
        expect(dot.r).toBe(DOT_RADIUS)
        // The targets are lit as the cue begins.
        expect(dot.color).toBe(isTarget(SPEC, index) ? DEFAULT_COLORS.target : DEFAULT_COLORS.dot)
      })
      const shown = skia.shown.get(skiaId())
      expect(shown?.bounds).toEqual({ x: 0, y: 0, width: ARENA, height: ARENA })
      expect(skia.redraws.get(skiaId())).toBeGreaterThan(0)
    })

    it('blinks the targets during the cue and shows none once the dots move', async () => {
      await start('skia')
      await press(fabric, 'start')
      const litAt = (): boolean => dots().some(dot => dot.color === DEFAULT_COLORS.target)
      const seen = new Set<boolean>()
      for (let count = 0; count < 100; count++) {
        frame()
        seen.add(litAt())
        // The dots stay where they are while the targets are shown.
        expect(dots()[0]!.cx).toBeCloseTo(drawnPositions(stateAt(SPEC, 0), SPEC)[0]!.x, 9)
      }
      expect(seen).toEqual(new Set([true, false]))
      await play(2000 - 100 * FRAME_MS + FRAME_MS)
      expect(label('status')).toBe('Keep track of them.')
      for (let count = 0; count < 30; count++) {
        frame()
        expect(litAt()).toBe(false)
      }
    })

    it('draws a new picture every frame, with the dots where the simulation has them', async () => {
      await start('skia')
      await press(fabric, 'start')
      await play(2000)
      const movingSince = now
      const before = skia.pictures.length
      for (let count = 1; count <= 120; count++) {
        frame()
        const expected = drawnPositions(stateAt(SPEC, now - movingSince), SPEC)
        dots().forEach((dot, index) => {
          expect(dot.cx).toBeCloseTo(expected[index]!.x, 5)
          expect(dot.cy).toBeCloseTo(expected[index]!.y, 5)
        })
      }
      expect(skia.pictures.length - before).toBe(120)
      // Each picture is let go of once the next one is on the view.
      const live = skia.pictures.filter(each => !each.isDisposed)
      expect(live).toHaveLength(1)
      expect(live[0]).toBe(skia.shown.get(skiaId()))
      // A paint is made once per color, not once per frame.
      expect(skia.paintsMade()).toBeLessThanOrEqual(4)
    })

    it('sends no Message and runs no view while the dots move', async () => {
      await start('skia')
      await press(fabric, 'start')
      await play(2000 + FRAME_MS)
      expect(label('status')).toBe('Keep track of them.')
      const commits = fabric.calls.completeRoot
      for (let count = 0; count < 200; count++) frame()
      await settle()
      // Skia draws without the phone's view tree changing at all.
      expect(fabric.calls.completeRoot).toBe(commits)
    })

    it('plays a whole trial: stop, pick, feedback, score and the timing readout', async () => {
      await start('skia')
      await playTrial()
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 0 of 3.')
      // No frame is asked for while the dots stand still.
      expect(frame()).toBe(0)

      const end = drawnPositions(stateAt(SPEC, SPEC.durationMs), SPEC)
      dots().forEach((dot, index) => {
        expect(dot.cx).toBeCloseTo(end[index]!.x, 9)
        expect(dot.cy).toBeCloseTo(end[index]!.y, 9)
        expect(dot.color).toBe(DEFAULT_COLORS.dot)
      })

      // Two targets and one dot that was not a target.
      await tapAt(end[0]!.x, end[0]!.y)
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 1 of 3.')
      expect(rings()).toHaveLength(1)
      expect(rings()[0]).toMatchObject({ color: DEFAULT_COLORS.picked })
      expect(rings()[0]!.cx).toBeCloseTo(end[0]!.x, 9)
      await tapAt(end[1]!.x + 3, end[1]!.y - 3)
      await tapAt(end[5]!.x, end[5]!.y)

      expect(label('status')).toContain('You found 2 of 3.')
      const colors = dots().map(dot => dot.color)
      expect(colors[0]).toBe(DEFAULT_COLORS.correct)
      expect(colors[1]).toBe(DEFAULT_COLORS.correct)
      expect(colors[5]).toBe(DEFAULT_COLORS.wrong)
      expect(colors[2]).toBe(DEFAULT_COLORS.dot)
      // The missed target gets a ring in the target color.
      expect(rings()).toHaveLength(1)
      expect(rings()[0]).toMatchObject({ color: DEFAULT_COLORS.target })
      expect(rings()[0]!.cx).toBeCloseTo(end[2]!.x, 9)
      expect(label('score')).toBe('Score: 2 of 3 targets found in 1 trial. All found in 0.')

      expect(label('timing-frames')).toBe('Frames drawn: 500')
      expect(label('timing-dropped')).toBe('Late frames (over 1.5 times the usual gap): 0')
      expect(label('timing-frame-ms')).toBe('Frame time: usual 16.0 ms, worst 16.0 ms')
      expect(label('timing-speed')).toMatch(/^Dot speed: measured 140\.0, set 140 points a second$/)
      expect(label('timing-duration')).toBe('Moving time: measured 8000 ms, set 8000 ms')
      expect(label('timing-cue')).toBe('Targets shown for: 2000 ms')
      expect(label('trial-seed')).toBe(`Trial seed: ${SEED}`)
    })

    it('reports late frames when the clock stutters', async () => {
      await start('skia')
      await press(fabric, 'start')
      await play(2000)
      // Every 20th frame takes three times as long.
      for (let count = 1; now < 10_000 + 2000 + 8000 + 100; count++) {
        frame(count % 20 === 0 ? 3 * FRAME_MS : FRAME_MS)
      }
      await settle()
      const end = drawnPositions(stateAt(SPEC, SPEC.durationMs), SPEC)
      for (const index of [0, 1, 2]) await tapAt(end[index]!.x, end[index]!.y)
      const dropped = Number(label('timing-dropped').split(': ')[1])
      expect(dropped).toBeGreaterThan(15)
      expect(label('timing-frame-ms')).toBe('Frame time: usual 16.0 ms, worst 48.0 ms')
      // Late frames do not change where the dots end up or how fast they went.
      expect(label('status')).toContain('You found 3 of 3.')
      expect(label('timing-speed')).toMatch(/measured 140\.0, set 140/)
    })

    it('ignores taps that are not near a dot, and taps while the dots move', async () => {
      await start('skia')
      await press(fabric, 'start')
      await play(2000 + 500)
      const moving = dots()[0]!
      await tapAt(moving.cx, moving.cy)
      await play(7500)
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 0 of 3.')

      const end = drawnPositions(stateAt(SPEC, SPEC.durationMs), SPEC)
      // The spot in the arena furthest from every dot.
      let empty = { x: 0, y: 0, clear: -1 }
      for (let x = 0; x <= ARENA; x += 5) {
        for (let y = 0; y <= ARENA; y += 5) {
          const clear = Math.min(...end.map(dot => Math.hypot(dot.x - x, dot.y - y)))
          if (clear > empty.clear) empty = { x, y, clear }
        }
      }
      expect(empty.clear).toBeGreaterThan(DOT_RADIUS + 12)
      await tapAt(empty.x, empty.y)
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 0 of 3.')

      // Just outside a dot still counts. A second tap takes the pick back.
      const dot = end[4]!
      const toward = Math.atan2(empty.y - dot.y, empty.x - dot.x)
      const near = { x: dot.x + Math.cos(toward) * (DOT_RADIUS + 8), y: dot.y + Math.sin(toward) * (DOT_RADIUS + 8) }
      const others = end.filter((_, index) => index !== 4)
      if (others.every(other => Math.hypot(other.x - near.x, other.y - near.y) > Math.hypot(dot.x - near.x, dot.y - near.y))) {
        await tapAt(near.x, near.y)
        expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 1 of 3.')
        await tapAt(dot.x, dot.y)
        expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 0 of 3.')
      }
    })

    it('replays the same trial: same seed, same path', async () => {
      await start('skia')
      await playTrial()
      const firstEnd = dots().map(dot => [dot.cx, dot.cy])
      const end = drawnPositions(stateAt(SPEC, SPEC.durationMs), SPEC)
      for (const index of [0, 1, 2]) await tapAt(end[index]!.x, end[index]!.y)
      expect(label('score')).toBe('Score: 3 of 3 targets found in 1 trial. All found in 1.')

      await press(fabric, 'replay')
      expect(label('status')).toBe('Remember the 3 orange dots.')
      const first = drawnPositions(stateAt(SPEC, 0), SPEC)
      expect(dots()[0]!.cx).toBeCloseTo(first[0]!.x, 9)
      // Replayed at another frame rate, the dots still end where they did.
      await play(2000, 8)
      await play(8000, 8)
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 0 of 3.')
      expect(dots().map(dot => [dot.cx, dot.cy])).toEqual(firstEnd)

      // "Next trial" is another trial.
      for (const index of [0, 1, 2]) await tapAt(end[index]!.x, end[index]!.y)
      await press(fabric, 'start')
      await play(2000)
      await play(8000)
      expect(dots().map(dot => [dot.cx, dot.cy])).not.toEqual(firstEnd)
      await press(fabric, 'stop')
      expect(label('trial-seed')).toBe(`Trial seed: ${SEED + 1}`)
    })

    it('uses the settings: more dots, more targets, faster, shorter', async () => {
      await start('skia')
      for (const id of ['more-dotCount', 'more-dotCount', 'more-targetCount', 'more-speed', 'less-durationSeconds']) {
        await press(fabric, id)
      }
      expect(label('value-dotCount')).toBe('10')
      expect(label('value-targetCount')).toBe('4')
      expect(label('value-speed')).toBe('160 points a second')
      expect(label('value-durationSeconds')).toBe('7 seconds')
      await press(fabric, 'toggle-collide')
      expect(textOf(byTestId(fabric, 'toggle-collide'))).toBe('Dots bounce off each other: on')

      await press(fabric, 'start')
      expect(label('status')).toBe('Remember the 4 orange dots.')
      expect(dots()).toHaveLength(10)
      expect(dots().filter(dot => dot.color === DEFAULT_COLORS.target)).toHaveLength(4)
      await play(2000)
      await play(7000)
      const spec = { ...SPEC, dotCount: 10, targetCount: 4, speed: 160, durationMs: 7000, collide: true }
      const end = drawnPositions(stateAt(spec, 7000), spec)
      expect(dots()[9]!.cx).toBeCloseTo(end[9]!.x, 9)
      expect(label('status')).toBe('Tap the 4 dots you tracked. Picked 0 of 4.')
    })

    it('stops a trial part of the way through and empties the arena', async () => {
      await start('skia')
      await press(fabric, 'start')
      await play(2000 + 1000)
      await press(fabric, 'stop')
      expect(label('status')).toBe('Set up a trial below, then press Start.')
      expect(picture()).toEqual([])
      const made = skia.pictures.length
      for (let count = 0; count < 10; count++) frame()
      expect(skia.pictures.length).toBe(made)
      expect(frames).toHaveLength(0)
    })

    it('draws the arena to fit when the view is another size than the trial was made for', async () => {
      await start('skia')
      await playTrial()
      // The phone was turned, say, and the arena is now half the size.
      fabric.emit(arena(), 'topLayout', { layout: { x: 0, y: 0, width: 150, height: 150 } })
      await settle()
      const end = drawnPositions(stateAt(SPEC, SPEC.durationMs), SPEC)
      expect(dots()[3]!.cx).toBeCloseTo(end[3]!.x / 2, 9)
      expect(dots()[3]!.r).toBe(DOT_RADIUS / 2)
      // A tap is read at that size too.
      await tapAt(end[3]!.x / 2, end[3]!.y / 2)
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 1 of 3.')
    })

    it('stops drawing and asks for no more frames once the demo is gone', async () => {
      await start('skia')
      await press(fabric, 'start')
      await play(2000 + 1000)
      const id = skiaId()
      handle?.dispose()
      handle = undefined
      const made = skia.pictures.length
      for (let count = 0; count < 10; count++) frame()
      expect(skia.pictures.length).toBe(made)
      expect(frames).toHaveLength(0)
      // The view was handed nothing in place of its last picture.
      expect(skia.shown.get(id)).toBeNull()
    })

    it('leaves through Exit', async () => {
      await start('skia')
      await press(fabric, 'exit')
      expect(exits).toBe(1)
    })

    it('switches to plain views and back with the button', async () => {
      await start('skia')
      expect(hasTestId(fabric, 'switch-renderer')).toBe(true)
      await press(fabric, 'switch-renderer')
      expect(label('renderer')).toBe('Drawing with: plain views (switched here)')
      expect(skiaViews()).toHaveLength(0)
      await press(fabric, 'start')
      expect(arena().children).toHaveLength(8)
      await press(fabric, 'stop')
      await press(fabric, 'switch-renderer')
      expect(label('renderer')).toBe('Drawing with: Skia')
      expect(skiaViews()).toHaveLength(1)
      expect(arena().children).toEqual(skiaViews())
    })
  })

  describe('drawn with plain views, where Skia is missing', () => {
    type Style = {
      width?: number
      height?: number
      borderRadius?: number
      backgroundColor?: unknown
      borderColor?: unknown
      borderWidth?: number
      display?: string
      transform?: ReadonlyArray<{ translateX?: number; translateY?: number }>
    }
    const styleOf = (node: FakeFabricNode): Style => node.props as Style
    const isShown = (node: FakeFabricNode): boolean => styleOf(node).display !== 'none'
    const isRing = (node: FakeFabricNode): boolean => styleOf(node).borderWidth !== undefined && styleOf(node).borderWidth !== 0
    const dotViews = (): Array<FakeFabricNode> =>
      arena().children.filter(node => isShown(node) && !isRing(node))
    const centre = (node: FakeFabricNode): { x: number; y: number } => {
      const style = styleOf(node)
      const x = style.transform?.find(each => each.translateX !== undefined)?.translateX ?? 0
      const y = style.transform?.find(each => each.translateY !== undefined)?.translateY ?? 0
      return { x: x + (style.width ?? 0) / 2, y: y + (style.height ?? 0) / 2 }
    }

    it('says so and why, shows no switch, and makes no Skia view', async () => {
      await start('views')
      expect(label('renderer')).toBe('Drawing with: plain views (Skia was switched off by the app)')
      expect(hasTestId(fabric, 'switch-renderer')).toBe(false)
      expect(skiaViews()).toHaveLength(0)
      expect(skia.pictures).toHaveLength(0)
    })

    it('makes one round view per dot, where the simulation has them', async () => {
      await start('views')
      await press(fabric, 'start')
      const first = drawnPositions(stateAt(SPEC, 0), SPEC)
      expect(dotViews()).toHaveLength(8)
      dotViews().forEach((node, index) => {
        expect(styleOf(node).width).toBe(2 * DOT_RADIUS)
        expect(styleOf(node).borderRadius).toBe(DOT_RADIUS)
        expect(node.props['pointerEvents']).toBe('none')
        expect(centre(node).x).toBeCloseTo(first[index]!.x, 9)
        expect(centre(node).y).toBeCloseTo(first[index]!.y, 9)
      })
    })

    it('moves the same views every frame and makes no new ones', async () => {
      await start('views')
      await press(fabric, 'start')
      await play(2000)
      const movingSince = now
      const tags = dotViews().map(node => node.reactTag)
      const commits = fabric.calls.completeRoot
      for (let count = 1; count <= 60; count++) {
        frame()
        const expected = drawnPositions(stateAt(SPEC, now - movingSince), SPEC)
        expect(dotViews().map(node => node.reactTag)).toEqual(tags)
        dotViews().forEach((node, index) => {
          expect(centre(node).x).toBeCloseTo(expected[index]!.x, 5)
          expect(centre(node).y).toBeCloseTo(expected[index]!.y, 5)
        })
      }
      // One commit per frame carries all the dots.
      expect(fabric.calls.completeRoot - commits).toBe(60)
    })

    it('plays a whole trial with the same rules and the same readout', async () => {
      await start('views')
      await playTrial()
      expect(label('status')).toBe('Tap the 3 dots you tracked. Picked 0 of 3.')
      expect(frame()).toBe(0)
      const end = drawnPositions(stateAt(SPEC, SPEC.durationMs), SPEC)
      expect(centre(dotViews()[7]!).x).toBeCloseTo(end[7]!.x, 9)
      await tapAt(end[0]!.x, end[0]!.y)
      // A ring round the picked dot: a ninth view, with a border and no fill.
      expect(arena().children.filter(node => isShown(node) && isRing(node))).toHaveLength(1)
      await tapAt(end[6]!.x, end[6]!.y)
      await tapAt(end[2]!.x, end[2]!.y)
      expect(label('status')).toContain('You found 2 of 3.')
      expect(label('timing-frames')).toBe('Frames drawn: 500')
      expect(label('timing-speed')).toMatch(/measured 140\.0, set 140/)
      // Back to settings: no dot is left on screen.
      await press(fabric, 'done')
      expect(arena().children.filter(isShown)).toHaveLength(0)
      // And the next trial shows them again.
      await press(fabric, 'start')
      expect(dotViews()).toHaveLength(8)
    })

    it('stops moving views once the demo is gone', async () => {
      await start('views')
      await press(fabric, 'start')
      await play(2000 + 1000)
      handle?.dispose()
      handle = undefined
      const commits = fabric.calls.completeRoot
      for (let count = 0; count < 10; count++) frame()
      expect(fabric.calls.completeRoot).toBe(commits)
      expect(frames).toHaveLength(0)
    })

    it('works the same on Android', async () => {
      await start('views', 'android')
      await press(fabric, 'start')
      expect(dotViews()).toHaveLength(8)
      await play(2000 + 500)
      expect(label('status')).toBe('Keep track of them.')
    })
  })
})

describe('finding Skia', () => {
  type Host = {
    SkiaApi?: unknown
    SkiaViewApi?: unknown
    __turboModuleProxy?: (name: string) => unknown
  }
  const host = globalThis as Host

  afterEach(() => {
    delete host.SkiaApi
    delete host.SkiaViewApi
    delete host.__turboModuleProxy
    resetSkia()
  })

  it('is not there in a build without the native module, and says so', () => {
    resetSkia()
    expect(isSkiaAvailable()).toBe(false)
    expect(skiaUnavailableReason()).toBe("Skia's native code is not in this build")
  })

  it('starts the native module by name and then uses the two global objects', () => {
    resetSkia()
    const skia = makeSkia()
    const asked: Array<string> = []
    let installs = 0
    configureSkia({
      nativeModule: name => {
        asked.push(name)
        return {
          install: () => {
            installs += 1
            host.SkiaApi = skia.host.api
            host.SkiaViewApi = skia.host.views
            return true
          },
        }
      },
    })
    expect(isSkiaAvailable()).toBe(true)
    expect(skiaUnavailableReason()).toBe('')
    expect(asked).toEqual(['RNSkiaModule'])
    // Asked once, however often the answer is read.
    isSkiaAvailable()
    expect(installs).toBe(1)
  })

  it('finds the module on the global when the app did not say how to ask', () => {
    resetSkia()
    const skia = makeSkia()
    host.__turboModuleProxy = name =>
      name === 'RNSkiaModule'
        ? {
            install: () => {
              host.SkiaApi = skia.host.api
              host.SkiaViewApi = skia.host.views
              return true
            },
          }
        : null
    expect(isSkiaAvailable()).toBe(true)
  })

  it('does not install again when something else already has', () => {
    resetSkia()
    const skia = makeSkia()
    host.SkiaApi = skia.host.api
    host.SkiaViewApi = skia.host.views
    configureSkia({
      nativeModule: () => {
        throw new Error('not asked for')
      },
    })
    expect(isSkiaAvailable()).toBe(true)
  })

  it('answers "not available" with the reason when starting fails or throws', () => {
    resetSkia()
    configureSkia({ nativeModule: () => ({ install: () => false }) })
    expect(isSkiaAvailable()).toBe(false)
    expect(skiaUnavailableReason()).toBe('Skia was found but did not start')

    resetSkia()
    configureSkia({
      nativeModule: () => ({
        install: () => {
          throw new Error('no runtime')
        },
      }),
    })
    expect(isSkiaAvailable()).toBe(false)
    expect(skiaUnavailableReason()).toBe('Skia failed to start (no runtime)')

    resetSkia()
    configureSkia({ nativeModule: () => ({ install: () => true }) })
    expect(isSkiaAvailable()).toBe(false)
    expect(skiaUnavailableReason()).toBe('Skia started but its drawing objects are missing')
  })
})
