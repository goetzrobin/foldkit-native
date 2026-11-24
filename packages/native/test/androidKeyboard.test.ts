/**
 * Android and the keyboard: who makes the room.
 *
 * Most Android apps, Expo Go among them, have the system make the app's
 * window shorter when the keyboard opens. An app that then also raises its
 * composer by the keyboard's height leaves a gap as tall as the keyboard and
 * squeezes the messages out. So the keyboard service finds out on the phone
 * whether the window got shorter, and reports how much of the window the
 * keyboard really covers. Until it knows, it reports none.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { Keyboard } from '../src/device/index.js'
import { type NativeSurface, createNativeSurface, registerNavigation } from '../src/index.js'
import { DOCK_CONTENT_ID } from '../src/foldkit/keyboard/dock.js'
import { configureKeyboardDock, measureAppWindow } from '../src/keyboard/index.js'
import { configureMotion, stopMotion } from '../src/motion/index.js'
import { makeDemo as makeAiChat } from './demos/aiChat.js'
import { makeDemo as makeChat } from './demos/chat.js'
import { makeDemo as makeLegendChat } from './demos/legendChat.js'
import { byTestId, flatten, press, settle } from './support/phone.js'

const KEYBOARD = 300
const WINDOW = 800

const listeners = () => {
  const byEvent = new Map<string, Set<(payload: unknown) => void>>()
  return {
    add: (event: string, listener: (payload: unknown) => void) => {
      const set = byEvent.get(event) ?? new Set()
      byEvent.set(event, set)
      set.add(listener)
      return { remove: () => void set.delete(listener) }
    },
    emit: (event: string, payload?: unknown) => {
      for (const listener of [...(byEvent.get(event) ?? [])]) listener(payload)
    },
  }
}

const serviceOf = (layer: unknown): Promise<Keyboard.KeyboardService> =>
  Effect.runPromise(
    Effect.provide(
      (Keyboard.Keyboard as unknown as { use: (f: (service: unknown) => unknown) => never }).use(
        service => Effect.succeed(service),
      ),
      layer as never,
    ) as never,
  )

/** Longer than the service waits before it measures the window. */
const windowSettles = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 220))

describe('the keyboard service on Android', () => {
  /** A phone whose window is `height()` tall right now. */
  const listen = async (
    platform: string,
    windowHeight: (() => number) | undefined,
  ): Promise<{
    native: ReturnType<typeof listeners>
    frames: Array<Keyboard.KeyboardFrame>
    heights: Array<number>
    stop: () => void
  }> => {
    const native = listeners()
    const service = await serviceOf(
      Keyboard.live(
        { addListener: native.add, dismiss: () => {} },
        {
          platform,
          ...(windowHeight === undefined
            ? {}
            : { measureWindow: (use: (height: number) => void) => use(windowHeight()) }),
        },
      ),
    )
    const frames: Array<Keyboard.KeyboardFrame> = []
    const heights: Array<number> = []
    const stops = [
      service.frames.subscribe(frame => frames.push(frame)),
      service.heights.subscribe(height => heights.push(height)),
    ]
    return { native, frames, heights, stop: () => stops.forEach(stop => stop()) }
  }

  it('reports no cover when the window made itself shorter', async () => {
    let window = WINDOW
    const phone = await listen('android', () => window)
    await windowSettles()
    window = WINDOW - KEYBOARD
    phone.native.emit('keyboardDidShow', { endCoordinates: { height: KEYBOARD } })
    await windowSettles()
    window = WINDOW
    phone.native.emit('keyboardDidHide', {})
    await windowSettles()
    expect(phone.frames).toEqual([
      { height: 0, covers: 0 },
      { height: KEYBOARD, covers: 0 },
      { height: 0, covers: 0 },
    ])
    // The keyboard's own height is still told, for "is the keyboard up".
    expect(phone.heights).toEqual([0, KEYBOARD, 0])
    phone.stop()
  })

  it('reports the whole keyboard once it has seen that the window did not change', async () => {
    const phone = await listen('android', () => WINDOW)
    await windowSettles()
    phone.native.emit('keyboardDidShow', { endCoordinates: { height: KEYBOARD } })
    // Not known yet: no room is made.
    expect(phone.frames.at(-1)).toEqual({ height: KEYBOARD, covers: 0 })
    await windowSettles()
    expect(phone.frames.at(-1)).toEqual({ height: KEYBOARD, covers: KEYBOARD })
    phone.native.emit('keyboardDidHide', {})
    // From now on it is known, and told with the first report.
    phone.native.emit('keyboardDidShow', { endCoordinates: { height: KEYBOARD } })
    expect(phone.frames.at(-1)).toEqual({ height: KEYBOARD, covers: KEYBOARD })
    expect(phone.heights).toEqual([0, KEYBOARD, 0, KEYBOARD])
    phone.stop()
  })

  it('reports no cover when it cannot measure the window', async () => {
    const phone = await listen('android', undefined)
    phone.native.emit('keyboardDidShow', { endCoordinates: { height: KEYBOARD } })
    await windowSettles()
    expect(phone.frames.at(-1)).toEqual({ height: KEYBOARD, covers: 0 })
    phone.stop()
  })

  it('reports the whole keyboard on iOS, where the window never changes', async () => {
    const phone = await listen('ios', () => WINDOW)
    phone.native.emit('keyboardWillShow', { endCoordinates: { height: KEYBOARD } })
    expect(phone.frames.at(-1)).toEqual({ height: KEYBOARD, covers: KEYBOARD })
    phone.stop()
  })

  it('stops measuring when nobody listens any more', async () => {
    let measured = 0
    const native = listeners()
    const service = await serviceOf(
      Keyboard.live(
        { addListener: native.add, dismiss: () => {} },
        {
          platform: 'android',
          measureWindow: use => {
            measured += 1
            use(WINDOW)
          },
        },
      ),
    )
    const stop = service.frames.subscribe(() => {})
    native.emit('keyboardDidShow', { endCoordinates: { height: KEYBOARD } })
    stop()
    const before = measured
    await windowSettles()
    expect(measured).toBe(before)
  })
})

describe('on an Android phone, the composers', () => {
  let fabric: FakeFabric
  let surface: NativeSurface
  let handle: { dispose: () => void } | undefined
  let keyboard: ReturnType<typeof Keyboard.makeTest>
  let frames: Array<() => void> = []
  let now = 1000

  const finishFrames = (): void => {
    for (let count = 0; count < 100; count++) {
      now += 50
      const run = frames.shift()
      if (run === undefined) return
      run()
    }
  }

  const start = async (demo: 'chat' | 'ai-chat' | 'legend'): Promise<void> => {
    registerNavigation()
    registerPlatformComponents('android')
    // Even with react-native-keyboard-controller in the build.
    configureKeyboardDock({ controller: true })
    fabric = createFakeFabric()
    fabric.frames.set('View', { x: 0, y: 0, width: 402, height: WINDOW })
    fabric.frames.set(DOCK_CONTENT_ID, { x: 0, y: WINDOW - 56, width: 402, height: 56 })
    frames = []
    surface = createNativeSurface(fabric, 1, { dev: false, now: () => now })
    configureMotion(surface, { requestFrame: run => frames.push(run) })
    keyboard = Keyboard.makeTest()
    const env = { device: { platform: 'android' as const, osVersion: 35 }, exit: () => {} }
    handle = Runtime.embed(
      demo === 'chat'
        ? makeChat(surface.container, env, keyboard.layer)
        : demo === 'ai-chat'
          ? makeAiChat(surface.container, env, keyboard.layer)
          : makeLegendChat(surface.container, env, keyboard.layer as never),
    )
    await settle()
    finishFrames()
  }

  afterEach(async () => {
    stopMotion(surface)
    handle?.dispose()
    handle = undefined
    await settle()
    surface.dispose()
    configureKeyboardDock({ controller: 'detect' })
    registerPlatformComponents('ios')
  })

  /** Every bottom padding or margin on screen that is as large as a keyboard. */
  const roomMade = (): Array<number> =>
    flatten(fabric.committed)
      .flatMap(node => [node.props['paddingBottom'], node.props['marginBottom']])
      .filter((value): value is number => typeof value === 'number' && value >= KEYBOARD / 2)

  const MODES = ['inset', 'following', 'simple'] as const

  it.each([
    ['the chat demo', 'chat'],
    ['the AI chat demo', 'ai-chat'],
  ] as const)(
    '%s: in every mode, make no room when the window made itself shorter, and all of it when not',
    async (_title, demo) => {
      await start(demo)
      for (const mode of MODES) {
        // The window is shorter already: the composer sits on the keyboard as it is.
        keyboard.show(KEYBOARD, 0)
        await settle()
        finishFrames()
        expect([mode, roomMade()]).toEqual([mode, []])
        // The field still knows the keyboard is up: a drag on the list puts it away.
        const dismissed = keyboard.dismissCount()
        fabric.emit(byTestId(fabric, 'messages'), 'topScrollBeginDrag', {})
        await settle()
        expect([mode, keyboard.dismissCount()]).toEqual([mode, dismissed + 1])
        finishFrames()

        // A window that stays as it is: the keyboard lies over the app.
        keyboard.show(KEYBOARD, KEYBOARD)
        await settle()
        finishFrames()
        expect([mode, roomMade()]).toEqual([mode, [KEYBOARD]])
        keyboard.hide()
        await settle()
        finishFrames()
        await press(fabric, 'dock-mode')
        finishFrames()
      }
    },
    30000,
  )

  it('the AI chat on Legend List: the same', async () => {
    await start('legend')
    const composer = (): FakeFabricNode => byTestId(fabric, 'composer')
    keyboard.show(KEYBOARD, 0)
    await settle()
    expect(composer().props['marginBottom'] ?? 0).toBe(0)
    keyboard.show(KEYBOARD, KEYBOARD)
    await settle()
    expect(composer().props['marginBottom']).toBe(KEYBOARD)
  })

  it('measures the window through the surface that is on screen', async () => {
    await start('chat')
    let measured: number | undefined
    measureAppWindow(height => {
      measured = height
    })
    await settle()
    expect(measured).toBe(WINDOW)
  })
})
