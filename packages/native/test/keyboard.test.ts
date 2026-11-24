/**
 * The keyboard dock on the simulated phone, in both of its modes.
 *
 * Native mode: the right native views exist and the phone is told to move
 * the bar, and the content above it, by the keyboard's height.
 *
 * Fallback mode: none of those views exist, and the bar is padded up by the
 * height the program was told, eased over a few frames.
 *
 * The simulated phone cannot show where anything ends up on screen. These
 * tests check what the phone was asked to do.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type NativeSurface,
  Phone,
  createNativeSurface,
  prop,
  registerNavigation,
  text,
  textInput,
  view as box,
} from '../src/index.js'
import { DOCK_CONTENT_ID } from '../src/keyboard/dock.js'
import {
  configureKeyboardDock,
  forceKeyboardDockFallback,
  keyboardDock,
  keyboardDockFallbackReason,
  keyboardDockMode,
} from '../src/keyboard/index.js'
import { configureMotion, stopMotion } from '../src/motion/index.js'
import { makeDemo } from './demos/keyboard.js'
import { makeNativeAnimated } from './support/nativeAnimated.js'
import { byTestId, flatten, hasTestId, press, settle, textOf } from './support/phone.js'

type Setup = Readonly<{
  platform?: 'ios' | 'android'
  /** Whether the build has react-native-keyboard-controller's native views. */
  hasController: boolean
  /**
   * Who was handed React Native's animation module: the dock alone, the
   * whole engine, or nobody.
   */
  animated: 'dock' | 'engine' | 'none'
}>

const NATIVE: Setup = { hasController: true, animated: 'dock' }
const NATIVE_BY_ENGINE: Setup = { hasController: true, animated: 'engine' }
const WITHOUT_VIEWS: Setup = { hasController: false, animated: 'dock' }

/** An iPhone's window, and a bar whose content ends 34 points above its bottom. */
const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
const CONTENT = { x: 0, y: 784, width: 402, height: 56 }
const HOME_INDICATOR = 34
const KEYBOARD = 336

describe('the keyboard dock', () => {
  let fabric: FakeFabric
  let surface: NativeSurface
  let handle: { dispose: () => void } | undefined
  let animated: ReturnType<typeof makeNativeAnimated>
  let device: ReturnType<typeof Phone.makeTest>
  let now = 0
  let frames: Array<() => void> = []
  let exits = 0

  const frame = (ms: number): boolean => {
    now += ms
    const run = frames.shift()
    run?.()
    return run !== undefined
  }
  const finishFrames = (): void => {
    for (let count = 0; count < 100 && frame(50); count++);
  }

  const all = (): Array<FakeFabricNode> => flatten(fabric.committed)
  const named = (viewName: string): Array<FakeFabricNode> =>
    all().filter(node => node.viewName === viewName)
  const parentOf = (child: FakeFabricNode): FakeFabricNode => {
    const parent = all().find(node => node.children.includes(child))
    if (parent === undefined) throw new Error('That view has no parent')
    return parent
  }
  const content = (): FakeFabricNode => {
    const found = all().find(node => node.props['nativeID'] === DOCK_CONTENT_ID)
    if (found === undefined) throw new Error('No dock on screen')
    return found
  }
  /** The view that is moved: around the safe area view around the content. */
  const bar = (): FakeFabricNode => parentOf(parentOf(content()))
  /** The view that is padded: around the bar. */
  const seat = (): FakeFabricNode => parentOf(bar())

  const prepare = (setup: Setup, measures: boolean): void => {
    exits = 0
    now = 1000
    frames = []
    registerNavigation()
    registerPlatformComponents(setup.platform ?? 'ios')
    animated = makeNativeAnimated()
    configureKeyboardDock({
      controller: setup.hasController,
      nativeAnimated: setup.animated === 'dock' ? animated.native : null,
    })
    fabric = createFakeFabric()
    if (measures) {
      fabric.frames.set('View', WINDOW)
      fabric.frames.set(DOCK_CONTENT_ID, CONTENT)
    }
    surface = createNativeSurface(fabric, 1, {
      dev: false,
      now: () => now,
      ...(setup.animated === 'engine' ? { nativeAnimated: animated.native } : {}),
    })
    configureMotion(surface, { requestFrame: run => frames.push(run) })
    device = Phone.makeTest()
  }

  const startDemo = async (setup: Setup, measures = false): Promise<void> => {
    prepare(setup, measures)
    handle = Runtime.embed(
      makeDemo(
        surface.container,
        {
          device: { platform: setup.platform ?? 'ios', osVersion: 26 },
          exit: () => {
            exits += 1
          },
        },
        device.layer,
      ),
    )
    await settle()
    finishFrames()
  }

  const stop = async (): Promise<void> => {
    stopMotion(surface)
    handle?.dispose()
    handle = undefined
    await settle()
  }

  afterEach(async () => {
    await stop()
    surface.dispose()
    configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
    forceKeyboardDockFallback(false)
    registerPlatformComponents('ios')
  })

  describe.each([
    ['the dock was handed the animation module', NATIVE],
    ['the whole engine was handed the animation module', NATIVE_BY_ENGINE],
  ])('with react-native-keyboard-controller in the build, on iOS, when %s', (_name, NATIVE) => {
    it('says on screen that it follows the keyboard natively', async () => {
      await startDemo(NATIVE)
      expect(keyboardDockMode()).toBe('native')
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        'Mode: following the keyboard natively',
      )
    })

    it('draws the view that reports the keyboard, switched on', async () => {
      await startDemo(NATIVE)
      const [controller] = named('KeyboardControllerView')
      expect(named('KeyboardControllerView')).toHaveLength(1)
      expect(controller?.props['enabled']).toBe(true)
      // Out of the way of the layout.
      expect(controller?.props['position']).toBe('absolute')
    })

    it('has the phone move the bar by every frame of the keyboard, a drag included', async () => {
      await startDemo(NATIVE)
      const controller = named('KeyboardControllerView')[0] as FakeFabricNode
      // Fed by nothing but that view's three events. The middle one is the drag.
      expect([...new Set(animated.events().map(([tag, name]) => `${tag} ${name}`))]).toEqual([
        `${controller.reactTag} onKeyboardMove`,
        `${controller.reactTag} onKeyboardMoveInteractive`,
        `${controller.reactTag} onKeyboardMoveEnd`,
      ])
      expect(animated.translateY(bar().reactTag, 0)).toBe(0)
      expect(animated.translateY(bar().reactTag, 150)).toBe(-150)
      expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-KEYBOARD)
    })

    it('raises the bar by the keyboard less the room it already stands above', async () => {
      await startDemo(NATIVE, true)
      // The keyboard first has to cover the home indicator's strip.
      expect(animated.translateY(bar().reactTag, 20)).toBe(0)
      expect(animated.translateY(bar().reactTag, HOME_INDICATOR)).toBe(0)
      expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-(KEYBOARD - HOME_INDICATOR))
    })

    it('moves the content above the bar by the same amount', async () => {
      await startDemo(NATIVE, true)
      const lift = parentOf(byTestId(fabric, 'lines'))
      expect(animated.translateY(lift.reactTag, KEYBOARD)).toBe(-(KEYBOARD - HOME_INDICATOR))
      // Its parent cuts off what rises past the top.
      expect(parentOf(lift).props['overflow']).toBe('hidden')
    })

    it('makes the content above shorter once the phone says where the keyboard is going', async () => {
      await startDemo(NATIVE, true)
      const controller = named('KeyboardControllerView')[0] as FakeFabricNode
      const covered = KEYBOARD - HOME_INDICATOR
      fabric.emit(controller, 'topKeyboardMoveStart', { height: KEYBOARD })
      await settle()
      const lift = parentOf(byTestId(fabric, 'lines'))
      expect(lift.props['paddingBottom']).toBe(covered)
      // Shorter by the covered height and moved back down by as much: with
      // the keyboard still down it is drawn where it was, and with the
      // keyboard up it sits unmoved in its new, shorter place.
      expect(animated.translateY(lift.reactTag, 0)).toBe(covered)
      expect(animated.translateY(lift.reactTag, KEYBOARD)).toBe(0)
      // The bar is not part of that: it moves by the keyboard alone.
      expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-covered)
      expect(seat().props['paddingBottom'] ?? 0).toBe(0)

      fabric.emit(controller, 'topKeyboardMoveStart', { height: 0 })
      await settle()
      expect(parentOf(byTestId(fabric, 'lines')).props['paddingBottom']).toBe(0)
      expect(animated.translateY(lift.reactTag, KEYBOARD)).toBe(-covered)
    })

    it('tells the drag area which field is in the bar and how tall the bar is', async () => {
      await startDemo(NATIVE)
      const field = byTestId(fabric, 'draft')
      const [area] = named('KeyboardGestureArea')
      expect(typeof field.props['nativeID']).toBe('string')
      expect(area?.props['textInputNativeID']).toBe(field.props['nativeID'])
      fabric.emit(content(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: 56 } })
      await settle()
      expect(named('KeyboardGestureArea')[0]?.props['offset']).toBe(56)
    })

    it('lets a drag on the list pull the keyboard down', async () => {
      await startDemo(NATIVE)
      expect(byTestId(fabric, 'lines').props['keyboardDismissMode']).toBe('interactive')
    })

    it('does not pad the bar when the program hears the keyboard height', async () => {
      await startDemo(NATIVE)
      device.keyboard.show(KEYBOARD)
      await settle()
      finishFrames()
      expect(textOf(byTestId(fabric, 'keyboard-height'))).toContain('336 points tall')
      expect(seat().props['paddingBottom'] ?? 0).toBe(0)
    })

    it('lets go of every view when the program stops', async () => {
      await startDemo(NATIVE)
      expect(animated.drivenViews().length).toBe(2)
      await stop()
      expect(animated.drivenViews()).toEqual([])
      expect(animated.events()).toEqual([])
      expect(device.keyboard.listenerCount()).toBe(0)
    })
  })

  describe('without it', () => {
    it('says on screen that it is the fallback, and why', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(keyboardDockMode()).toBe('fallback')
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        'Mode: fallback (react-native-keyboard-controller is not in this build)',
      )
    })

    it('draws none of the native keyboard views and asks the phone to move nothing', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(named('KeyboardControllerView')).toHaveLength(0)
      expect(named('KeyboardGestureArea')).toHaveLength(0)
      expect(animated.drivenViews()).toEqual([])
      expect(animated.events()).toEqual([])
    })

    it('eases the bar up by the keyboard height the program was told', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(seat().props['paddingBottom'] ?? 0).toBe(0)
      device.keyboard.show(KEYBOARD)
      await settle()
      // Not there at once...
      frame(100)
      const partWay = seat().props['paddingBottom'] as number
      expect(partWay).toBeGreaterThan(0)
      expect(partWay).toBeLessThan(KEYBOARD)
      // ...and there a quarter of a second later.
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(KEYBOARD)
      expect(frames).toHaveLength(0)
    })

    it('rises less by the room it already stands above', async () => {
      await startDemo(WITHOUT_VIEWS, true)
      device.keyboard.show(KEYBOARD)
      await settle()
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(KEYBOARD - HOME_INDICATOR)
    })

    it('eases back down when the keyboard hides', async () => {
      await startDemo(WITHOUT_VIEWS)
      device.keyboard.show(KEYBOARD)
      await settle()
      finishFrames()
      device.keyboard.hide()
      await settle()
      frame(100)
      expect(seat().props['paddingBottom']).toBeGreaterThan(0)
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(0)
    })

    it('puts the keyboard away as a drag on the list starts', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(byTestId(fabric, 'lines').props['keyboardDismissMode']).toBe('on-drag')
    })

    it('stops listening when the program stops', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(device.keyboard.listenerCount()).toBe(1)
      await stop()
      expect(device.keyboard.listenerCount()).toBe(0)
      // A keyboard that moves afterwards reaches nothing and breaks nothing.
      device.keyboard.show(KEYBOARD)
      await settle()
    })

    it('is the fallback on Android even with the native views in the build', async () => {
      await startDemo({ platform: 'android', hasController: true, animated: 'dock' })
      expect(keyboardDockFallbackReason()).toBe('native following is built for iOS only')
      expect(named('KeyboardControllerView')).toHaveLength(0)
      device.keyboard.show(300)
      await settle()
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(300)
    })

    it('is the fallback when nobody was handed the animation module', async () => {
      await startDemo({ hasController: true, animated: 'none' })
      expect(keyboardDockFallbackReason()).toBe(
        'the app did not pass nativeAnimated to configureKeyboardDock',
      )
      expect(named('KeyboardControllerView')).toHaveLength(0)
      device.keyboard.show(KEYBOARD)
      await settle()
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(KEYBOARD)
    })
  })

  describe('the demo, where both modes are possible', () => {
    it('switches to the fallback and back with a button', async () => {
      await startDemo(NATIVE)
      await press(fabric, 'switch-mode')
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        'Mode: fallback (switched to the fallback by the app)',
      )
      expect(named('KeyboardControllerView')).toHaveLength(0)
      expect(animated.drivenViews()).toEqual([])
      device.keyboard.show(KEYBOARD)
      await settle()
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(KEYBOARD)

      await press(fabric, 'switch-mode')
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        'Mode: following the keyboard natively',
      )
      expect(named('KeyboardControllerView')).toHaveLength(1)
      expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-KEYBOARD)
      expect(seat().props['paddingBottom'] ?? 0).toBe(0)
    })

    it('gives the rest of the app its dock back on Exit', async () => {
      await startDemo(NATIVE)
      await press(fabric, 'switch-mode')
      expect(keyboardDockMode()).toBe('fallback')
      await press(fabric, 'exit')
      expect(keyboardDockMode()).toBe('native')
    })

    it('has no switch where only the fallback is possible', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(hasTestId(fabric, 'switch-mode')).toBe(false)
    })
  })

  describe('the demo', () => {
    it('adds a sent line at the top and clears the field', async () => {
      await startDemo(WITHOUT_VIEWS)
      expect(textOf(byTestId(fabric, 'line-30'))).toBe('Line 30')
      fabric.emit(byTestId(fabric, 'draft'), 'topChange', { text: 'Hello', eventCount: 1 })
      await settle()
      await press(fabric, 'send')
      expect(textOf(byTestId(fabric, 'line-31'))).toBe('Hello')
      expect(hasTestId(fabric, 'line-32')).toBe(false)
    })

    it('leaves when Exit is pressed', async () => {
      await startDemo(WITHOUT_VIEWS)
      await press(fabric, 'exit')
      expect(exits).toBe(1)
    })
  })

  describe('a bar with nothing given as the content above it', () => {
    const Model = Schema.Struct({ keyboardHeight: Schema.Number, offset: Schema.Number })
    type Model = typeof Model.Type
    const Message = defineMessageUnion({ PressedMore: {} })
    type Message = typeof Message.Type
    const update = (model: Model, message: Message) =>
      Message.match<Update.Return<Model, Message>>(message, {
        PressedMore: () => ({
          model: modifyFields(model, { keyboardHeight: () => 300, offset: () => 50 }),
        }),
      })
    const init: Runtime.ElementInit<Model, Message> = () => ({
      model: { keyboardHeight: 0, offset: 20 },
    })
    const view = (model: Model, h: HtmlBuilder<Message>): Html =>
      box(
        [],
        [
          box([prop('testID', 'more'), h.OnClick(Message.PressedMore())], []),
          box([prop('testID', 'above')], [text([], ['content'])]),
          keyboardDock(h, {
            keyboardHeight: model.keyboardHeight,
            offset: model.offset,
            children: [textInput([prop('testID', 'field'), prop('nativeID', 'my-field')], [])],
          }),
        ],
      )

    const startBar = async (setup: Setup): Promise<void> => {
      prepare(setup, true)
      handle = Runtime.embed(
        Runtime.makeElement({ Model, init, update, view, container: surface.container }),
      )
      await settle()
      finishFrames()
    }

    it('uses the offset it is given instead of measuring', async () => {
      await startBar(NATIVE)
      expect(animated.translateY(bar().reactTag, 300)).toBe(-280)
      await press(fabric, 'more')
      expect(animated.translateY(bar().reactTag, 300)).toBe(-250)
    })

    it('keeps the name a field already has', async () => {
      await startBar(NATIVE)
      expect(named('KeyboardGestureArea')[0]?.props['textInputNativeID']).toBe('my-field')
      expect(byTestId(fabric, 'field').props['nativeID']).toBe('my-field')
    })

    it('grows under the bar so the content above gets shorter, and leaves the bar where it was', async () => {
      await startBar(NATIVE)
      const controller = named('KeyboardControllerView')[0] as FakeFabricNode
      fabric.emit(controller, 'topKeyboardMoveEnd', { height: 300 })
      await settle()
      // Taller by the covered height, and drawn lower by the same amount.
      expect(seat().props['paddingBottom']).toBe(280)
      expect(seat().props['top']).toBe(280)
      expect(animated.translateY(bar().reactTag, 300)).toBe(-280)
    })

    it('pads the bar from the Model in fallback mode', async () => {
      await startBar(WITHOUT_VIEWS)
      await press(fabric, 'more')
      finishFrames()
      expect(seat().props['paddingBottom']).toBe(250)
    })
  })
})
