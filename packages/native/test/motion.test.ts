/**
 * Motion on the simulated phone: a style that eases, elements that fade in
 * and out, and a box that is dragged.
 *
 * Time is faked. The engine reads the clock from `now`, and frames run only
 * when the test calls `frame()`, so each test can look at the screen part of
 * the way through an animation.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type NativeSurface, createNativeSurface, style, text, view as box } from '../src/index.js'
import {
  animated,
  configureMotion,
  draggable,
  stopMotion,
  transition,
} from '../src/motion/index.js'
import { byTestId, hasTestId, press, settle, textOf } from './support/phone.js'

const Model = Schema.Struct({
  isShown: Schema.Boolean,
  chips: Schema.Array(Schema.Number),
  nextChip: Schema.Number,
  drops: Schema.Array(Schema.String),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedToggle: {},
  PressedAddChip: {},
  PressedRemoveChip: {},
  DroppedCard: { dx: Schema.Number, dy: Schema.Number },
})
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedToggle: () => ({ model: modifyFields(model, { isShown: isShown => !isShown }) }),
    PressedAddChip: () => ({
      model: modifyFields(model, {
        chips: chips => [...chips, model.nextChip],
        nextChip: nextChip => nextChip + 1,
      }),
    }),
    PressedRemoveChip: () => ({
      model: modifyFields(model, { chips: chips => chips.slice(1) }),
    }),
    DroppedCard: ({ dx, dy }) => ({
      model: modifyFields(model, { drops: drops => [...drops, `${dx},${dy}`] }),
    }),
  })

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { isShown: true, chips: [1], nextChip: 2, drops: [] },
})

let viewRuns = 0

const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  viewRuns += 1
  return box(
    [],
    [
      text([h.Attribute('testID', 'drops')], [`drops:${model.drops.join(' ')}`]),
      box([h.Attribute('testID', 'toggle'), h.OnClick(Message.PressedToggle())], []),
      box([h.Attribute('testID', 'add'), h.OnClick(Message.PressedAddChip())], []),
      box([h.Attribute('testID', 'remove'), h.OnClick(Message.PressedRemoveChip())], []),
      box(
        [
          h.Attribute('testID', 'fader'),
          transition({ opacity: { duration: 200, easing: 'linear' }, transform: 200 }),
          style({
            opacity: model.isShown ? 1 : 0,
            transform: [{ translateX: model.isShown ? 0 : 100 }] as never,
          }),
        ],
        [],
      ),
      box(
        [h.Attribute('testID', 'chips')],
        model.chips.map(chip =>
          animated(
            {
              enter: { from: { opacity: 0 }, duration: 100, easing: 'linear' },
              exit: { to: { opacity: 0 }, duration: 100, easing: 'linear' },
            },
            box(
              [h.Key(String(chip)), h.Attribute('testID', `chip-${chip}`), style({ opacity: 1 })],
              [],
            ),
          ),
        ),
      ),
      draggable<Message>(
        { onRelease: drag => Message.DroppedCard(drag), release: { duration: 100, easing: 'linear' } },
        [h.Attribute('testID', 'card'), style({ width: 100, height: 100 })],
        [],
      ),
    ],
  )
}

describe('motion on the simulated phone', () => {
  let fabric: FakeFabric
  let surface: NativeSurface
  let handle: { dispose: () => void }
  let now = 0
  let frames: Array<() => void> = []

  /** One frame of the phone's clock, `ms` later. */
  const frame = (ms = 16): boolean => {
    now += ms
    const run = frames.shift()
    run?.()
    return run !== undefined
  }

  const finishFrames = (): number => {
    let count = 0
    while (frame(50) && count < 100) count += 1
    return count
  }

  beforeEach(async () => {
    viewRuns = 0
    now = 1000
    frames = []
    registerPlatformComponents('ios')
    fabric = createFakeFabric()
    surface = createNativeSurface(fabric, 1, { dev: false, now: () => now })
    configureMotion(surface, { requestFrame: run => frames.push(run) })
    handle = Runtime.embed(
      Runtime.makeElement({ Model, init, update, view, container: surface.container }),
    )
    await settle()
    finishFrames()
  })

  afterEach(async () => {
    stopMotion(surface)
    handle.dispose()
    await settle()
    surface.dispose()
  })

  const opacityOf = (id: string): unknown => byTestId(fabric, id).props['opacity']

  it('does not ask for frames while nothing moves', () => {
    expect(frames).toHaveLength(0)
    expect(opacityOf('fader')).toBe(1)
  })

  it('eases opacity over its duration when the Model changes it', async () => {
    await press(fabric, 'toggle')
    // The draw alone does not jump to the end, and it asked for a frame.
    expect(opacityOf('fader')).toBe(1)
    expect(frames).toHaveLength(1)
    frame(50)
    expect(opacityOf('fader')).toBeCloseTo(0.75, 5)
    frame(50)
    expect(opacityOf('fader')).toBeCloseTo(0.5, 5)
    frame(100)
    expect(opacityOf('fader')).toBe(0)
    // Finished: no more frames are asked for.
    finishFrames()
    expect(frames).toHaveLength(0)
  })

  it('eases a transform, one commit per frame, without running the view', async () => {
    await press(fabric, 'toggle')
    const viewRunsBefore = viewRuns
    const commitsBefore = fabric.calls.completeRoot
    frame(100)
    const transform = byTestId(fabric, 'fader').props['transform'] as Array<{ translateX: number }>
    expect(transform[0]?.translateX).toBeGreaterThan(0)
    expect(transform[0]?.translateX).toBeLessThan(100)
    expect(fabric.calls.completeRoot).toBe(commitsBefore + 1)
    frame(100)
    expect(byTestId(fabric, 'fader').props['transform']).toEqual([{ translateX: 100 }])
    expect(viewRuns).toBe(viewRunsBefore)
  })

  it('turns back from where it has got to when toggled again half way', async () => {
    await press(fabric, 'toggle')
    frame(100)
    expect(opacityOf('fader')).toBeCloseTo(0.5, 5)
    await press(fabric, 'toggle')
    frame(50)
    expect(Number(opacityOf('fader'))).toBeGreaterThan(0.5)
    finishFrames()
    expect(opacityOf('fader')).toBe(1)
  })

  it('fades in an element the Model adds', async () => {
    await press(fabric, 'add')
    expect(opacityOf('chip-2')).toBe(0)
    frame(50)
    expect(opacityOf('chip-2')).toBeCloseTo(0.5, 5)
    frame(50)
    expect(opacityOf('chip-2')).toBe(1)
  })

  it('keeps an element the Model removed until it has faded out', async () => {
    await press(fabric, 'remove')
    // Gone from the Model, still on screen, and no longer touchable.
    expect(hasTestId(fabric, 'chip-1')).toBe(true)
    expect(byTestId(fabric, 'chip-1').props['pointerEvents']).toBe('none')
    frame(50)
    expect(opacityOf('chip-1')).toBeCloseTo(0.5, 5)
    frame(50)
    finishFrames()
    expect(hasTestId(fabric, 'chip-1')).toBe(false)
  })

  it('adds a new element after one that is still leaving', async () => {
    await press(fabric, 'remove')
    await press(fabric, 'add')
    const ids = (): unknown[] =>
      byTestId(fabric, 'chips').children.map(child => child.props['testID'])
    expect(ids()).toEqual(['chip-1', 'chip-2'])
    finishFrames()
    expect(ids()).toEqual(['chip-2'])
    expect(opacityOf('chip-2')).toBe(1)
  })

  const touch = (node: FakeFabricNode, x: number, y: number, isDown: boolean) => {
    const point = { identifier: 0, target: node.reactTag, pageX: x, pageY: y, locationX: 0, locationY: 0, timestamp: now }
    return { ...point, touches: isDown ? [point] : [], changedTouches: [point] }
  }

  it('moves a dragged box with the finger and tells the program once, at the end', async () => {
    const card = (): FakeFabricNode => byTestId(fabric, 'card')
    const viewRunsBefore = viewRuns
    fabric.emit(card(), 'topTouchStart', touch(card(), 10, 10, true))
    fabric.emit(card(), 'topTouchMove', touch(card(), 40, 25, true))
    expect(card().props['transform']).toEqual([{ translateX: 30 }, { translateY: 15 }])
    fabric.emit(card(), 'topTouchMove', touch(card(), 70, 50, true))
    expect(card().props['transform']).toEqual([{ translateX: 60 }, { translateY: 40 }])
    await settle()
    // Two moves, two commits, and the program has heard nothing yet.
    expect(viewRuns).toBe(viewRunsBefore)
    expect(textOf(byTestId(fabric, 'drops'))).toBe('drops:')

    fabric.emit(card(), 'topTouchEnd', touch(card(), 70, 50, false))
    await settle()
    expect(textOf(byTestId(fabric, 'drops'))).toBe('drops:60,40')
    // It eases back to where it started.
    frame(50)
    const back = card().props['transform'] as Array<Record<string, number>>
    expect(back[0]?.['translateX']).toBeCloseTo(30, 5)
    expect(back[1]?.['translateY']).toBeCloseTo(20, 5)
    finishFrames()
    expect(card().props['transform']).toEqual([{ translateX: 0 }, { translateY: 0 }])
  })
})

describe('motion handed to the phone\'s own animation driver', () => {
  it('starts a fade natively and asks for no frames when the app passes NativeAnimated', async () => {
    registerPlatformComponents('ios')
    const fabric = createFakeFabric()
    // Stands in for React Native's NativeAnimatedHelper: records what it is asked.
    const asked: string[] = []
    const ends: Array<(result: { finished: boolean }) => void> = []
    let nextTag = 100
    const API = new Proxy(
      {},
      {
        get:
          (_target, name: string) =>
          (...args: unknown[]) => {
            asked.push(name)
            if (name === 'startAnimatingNode') {
              ends.push(args[3] as (result: { finished: boolean }) => void)
            }
          },
      },
    )
    const frames: Array<() => void> = []
    const surface = createNativeSurface(fabric, 1, {
      dev: false,
      nativeAnimated: {
        generateNewNodeTag: () => ++nextTag,
        generateNewAnimationId: () => ++nextTag,
        API,
      } as never,
    })
    configureMotion(surface, { requestFrame: run => frames.push(run) })
    const handle = Runtime.embed(
      Runtime.makeElement({ Model, init, update, view, container: surface.container }),
    )
    await settle()

    await press(fabric, 'toggle')
    expect(asked).toContain('connectAnimatedNodeToView')
    expect(asked.filter(name => name === 'startAnimatingNode').length).toBeGreaterThan(0)
    // The phone plays it. JavaScript commits nothing per frame.
    expect(frames).toHaveLength(0)
    expect(byTestId(fabric, 'fader').props['opacity']).toBe(1)

    for (const end of ends) end({ finished: true })
    await settle()
    expect(byTestId(fabric, 'fader').props['opacity']).toBe(0)

    stopMotion(surface)
    handle.dispose()
    await settle()
    surface.dispose()
  })
})
