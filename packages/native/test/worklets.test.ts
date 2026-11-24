/**
 * Worklets on the simulated phone.
 *
 * There is no UI thread here, so `support/worklets.ts` stands in for it: a
 * queue the test drains, a frame clock the test steps, and records of what
 * was asked of Reanimated's and gesture-handler's native code. These tests
 * check the logic: what is found and what is said when it is not, what is
 * sent to the UI thread and when, and that every missing piece leaves the
 * program running.
 *
 * They cannot show that a real phone's UI thread runs any of it.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  Phone as PhoneFeatures,
  registerNavigation,
  style,
  text,
  view as box,
} from '../src/index.js'
import {
  PAN_ACTIVE,
  PAN_END,
  type PanEvent,
  type Shared,
  configureWorklets,
  gestureRoot,
  gesturesCheck,
  isWorkletsAvailable,
  onUiMessage,
  readShared,
  requireCompiledWorklets,
  resetWorklets,
  runOnUi,
  runOnUiSync,
  sendMessage,
  shared,
  springTo,
  stopAnimation,
  uiChannel,
  uiRuntimeCheck,
  uiThread,
  viewUpdatesCheck,
  workletsStatus,
  workletsUnavailableReason,
  writeShared,
} from '../src/worklets/index.js'
import { addOnUi } from '../src/worklets/ui.js'
import { makeDemos } from './demos/index.js'
import { BAR_WANTED, TRAVEL, makeDemo } from './demos/worklets.js'
import { byTestId, hasTestId, press, settle, startPhone, textOf } from './support/phone.js'
import { type FakeWorklets, makeWorklets } from './support/worklets.js'

let ui: FakeWorklets | undefined

/** A phone whose build has the UI thread's pieces, or lacks some of them. */
const withWorklets = (options: Parameters<typeof makeWorklets>[0] = {}): FakeWorklets => {
  ui = makeWorklets(options)
  configureWorklets(ui.config)
  return ui
}

beforeEach(() => {
  resetWorklets()
  // No Babel plugin runs here, so worklets are ordinary functions.
  requireCompiledWorklets(false)
})

afterEach(() => {
  ui?.uninstall()
  ui = undefined
  resetWorklets()
  requireCompiledWorklets(true)
  registerPlatformComponents('ios')
})

describe('finding the UI thread', () => {
  it('is not there until the app has said how to load worklets', () => {
    expect(isWorkletsAvailable()).toBe(false)
    expect(workletsUnavailableReason()).toBe('the app did not call configureWorklets()')
  })

  it('says why when the package throws while loading', () => {
    configureWorklets({
      load: () => {
        throw new Error("[Worklets] Native part of Worklets doesn't seem to be initialized.\nSee the docs")
      },
    })
    expect(uiRuntimeCheck()).toEqual({
      ok: false,
      reason:
        "react-native-worklets did not start ([Worklets] Native part of Worklets doesn't seem to be initialized.)",
    })
  })

  it('says why when the package loads but left no native code behind', () => {
    const fake = makeWorklets()
    configureWorklets({ load: () => fake.pkg })
    expect(uiRuntimeCheck().reason).toBe(
      'the worklets package loaded but its native code is not in this build',
    )
  })

  it('can be switched off by the app', () => {
    configureWorklets({ load: null })
    expect(workletsUnavailableReason()).toBe('switched off by the app')
  })

  it('answers yes to everything on a phone that has all three pieces', () => {
    const fake = withWorklets()
    const yes = { ok: true, reason: '' }
    expect(workletsStatus()).toEqual({
      uiRuntime: yes,
      ranOnUi: yes,
      sharedRoundTrip: yes,
      viewUpdates: yes,
      gestures: yes,
    })
    // Reanimated's native code was started once, and handed the UI engine.
    viewUpdatesCheck()
    expect(fake.reanimatedStarts()).toBe(1)
    const host = globalThis as Record<string, unknown>
    expect(host['__UI_WORKLET_RUNTIME_HOLDER']).toBeUndefined()
    expect(host['__UI_SCHEDULER_HOLDER']).toBeUndefined()
  })

  it('runs worklets but cannot move views without Reanimated, and says so', () => {
    withWorklets({ reanimated: false })
    const status = workletsStatus()
    expect(status.ranOnUi.ok).toBe(true)
    expect(status.sharedRoundTrip.ok).toBe(true)
    expect(status.viewUpdates).toEqual({
      ok: false,
      reason: "Reanimated's native code is not in this build",
    })
    // A gesture's events reach a worklet through Reanimated.
    expect(status.gestures.reason).toBe("Reanimated's native code is not in this build")
  })

  it('says so when only gesture-handler is missing', () => {
    withWorklets({ gestures: false })
    expect(viewUpdatesCheck().ok).toBe(true)
    expect(gesturesCheck()).toEqual({
      ok: false,
      reason: "gesture-handler's native code is not in this build",
    })
  })

  it('refuses a function the build did not turn into a worklet', () => {
    withWorklets()
    requireCompiledWorklets(true)
    const plain = (): number => 1
    expect(runOnUi(plain).ok).toBe(false)
    expect(runOnUi(plain).reason).toContain('did not turn this function into a worklet')
    const compiled = Object.assign((): number => 1, { __workletHash: 1 })
    expect(runOnUi(compiled).ok).toBe(true)
  })
})

describe('the two threads', () => {
  it('runs a scheduled worklet later, on the UI thread', () => {
    const fake = withWorklets()
    const seen: Array<unknown> = []
    const look = (): void => {
      seen.push((globalThis as { __RUNTIME_KIND?: number }).__RUNTIME_KIND)
    }
    expect(runOnUi(look).ok).toBe(true)
    expect(seen).toEqual([])
    fake.flushUi()
    expect(seen).toEqual([2])
    // Nothing of the UI thread is left on the JavaScript thread's global.
    expect((globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame).toBeUndefined()
  })

  it('keeps a shared value on the UI thread and lets JavaScript read and write it', () => {
    const fake = withWorklets()
    const count = shared(5)
    expect(readShared(count)).toBe(5)
    // On a phone `.value` is not there on the JavaScript thread.
    expect(() => count.value).toThrow('JavaScript thread')
    writeShared(count, 9)
    expect(readShared(count)).toBe(5)
    fake.flushUi()
    expect(readShared(count)).toBe(9)
    expect(runOnUiSync(addOnUi, count, 1)).toEqual({ ok: true, value: 10 })
  })

  it('answers no, and throws nothing, where there is no UI thread', () => {
    const count = shared(1)
    expect(runOnUi(addOnUi, count, 1)).toEqual({
      ok: false,
      reason: 'the app did not call configureWorklets()',
    })
    expect(runOnUiSync(addOnUi, count, 1).ok).toBe(false)
    // The value is an ordinary box, so a program still works on one thread.
    writeShared(count, 4)
    expect(readShared(count)).toBe(4)
  })

  it('springs a value to rest exactly on its target, a step per frame', () => {
    const fake = withWorklets()
    const x = shared(0)
    let finished = 0
    runOnUi(springTo, x, 100, { stiffness: 170, damping: 22 }, () => {
      finished += 1
    })
    fake.flushUi()
    fake.frame()
    fake.frame()
    const early = readShared(x)
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(100)
    for (let frame = 0; frame < 200; frame++) fake.frame()
    expect(readShared(x)).toBe(100)
    expect(finished).toBe(1)
    // At rest it asks for no more frames.
    expect(fake.framesAsked()).toBe(0)
  })

  it('lets a newer spring, or a stop, take a value over', () => {
    const fake = withWorklets()
    const x = shared(0)
    runOnUi(springTo, x, 100)
    fake.flushUi()
    for (let frame = 0; frame < 5; frame++) fake.frame()
    runOnUi(springTo, x, -50)
    fake.flushUi()
    for (let frame = 0; frame < 200; frame++) fake.frame()
    expect(readShared(x)).toBe(-50)
    runOnUi(springTo, x, 100)
    fake.flushUi()
    fake.frame()
    fake.frame()
    runOnUi(stopAnimation, x)
    fake.flushUi()
    const stoppedAt = readShared(x)
    for (let frame = 0; frame < 20; frame++) fake.frame()
    expect(readShared(x)).toBe(stoppedAt)
  })
})

// A small program: a box whose place is a shared value, a card that can be
// dragged, and a count of what the UI thread sent back.

const Model = Schema.Struct({
  label: Schema.String,
  hasBox: Schema.Boolean,
  heard: Schema.Number,
  lastDx: Schema.Number,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedRename: {},
  PressedRemove: {},
  Released: { dx: Schema.Number },
})
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedRename: () => ({ model: modifyFields(model, { label: label => label + '!' }) }),
    PressedRemove: () => ({ model: modifyFields(model, { hasBox: () => false }) }),
    Released: ({ dx }) => ({
      model: modifyFields(model, { heard: heard => heard + 1, lastDx: () => dx }),
    }),
  })

const startProgram = async (platform: 'ios' | 'android' = 'ios') => {
  const phone = startPhone(platform)
  registerNavigation()
  const channel = uiChannel()
  const x: Shared<number> = shared(10)
  const cardX: Shared<number> = shared(0)
  let viewRuns = 0
  const slide = () => {
    'worklet'
    return { transform: [{ translateX: x.value }] }
  }
  const cardStyle = () => {
    'worklet'
    return { transform: [{ translateX: cardX.value }] }
  }
  const follow = (event: PanEvent): void => {
    'worklet'
    if (event.state === PAN_ACTIVE) {
      cardX.value = event.translationX
      return
    }
    if (event.oldState === PAN_ACTIVE && event.state === PAN_END) {
      sendMessage(channel, 'released', { dx: event.translationX })
    }
  }
  const view = (model: Model, h: HtmlBuilder<Message>): Html => {
    viewRuns += 1
    return box(
      [style({ flex: 1 })],
      [
        text([h.Attribute('testID', 'label')], [`${model.label} ${model.heard} ${model.lastDx}`]),
        box([h.Attribute('testID', 'rename'), h.OnClick(Message.PressedRename())], []),
        box([h.Attribute('testID', 'remove'), h.OnClick(Message.PressedRemove())], []),
        ...(model.hasBox
          ? [
              uiThread(
                { style: slide, inputs: [x] },
                box([h.Key('moving'), h.Attribute('testID', 'moving'), style({ width: 40, height: 40 })], []),
              ),
            ]
          : []),
        gestureRoot(
          [h.Attribute('testID', 'root')],
          [
            uiThread(
              { style: cardStyle, inputs: [cardX], pan: follow, channel },
              box(
                [
                  h.Attribute('testID', 'card'),
                  onUiMessage('released', (detail: { dx: number }) => Message.Released({ dx: detail.dx })),
                  style({ width: 80, height: 40 }),
                ],
                [],
              ),
            ),
          ],
        ),
      ],
    )
  }
  const running = Runtime.embed(
    Runtime.makeElement({
      Model,
      init: () => ({ model: { label: 'box', hasBox: true, heard: 0, lastDx: 0 } }),
      update,
      view,
      container: phone.surface.container,
    }),
  )
  await settle()
  return { phone, running, x, cardX, channel, viewRuns: () => viewRuns }
}

describe('an element tied to the UI thread', () => {
  it('gets its style from the worklet once it is on the phone', async () => {
    const fake = withWorklets()
    const { phone, running } = await startProgram()
    const moving = byTestId(phone.fabric, 'moving')
    // It is kept as a real view: one folded into its parent has nothing to move.
    expect(moving.props['collapsable']).toBe(false)
    expect(fake.styles.get(moving.reactTag)).toBeUndefined()
    fake.flushUi()
    expect(fake.styles.get(moving.reactTag)).toEqual({ transform: [{ translateX: 10 }] })
    running.dispose()
  })

  it('moves when the shared value changes, with no draw from JavaScript', async () => {
    const fake = withWorklets()
    const { phone, running, x, viewRuns } = await startProgram()
    fake.flushUi()
    const tag = byTestId(phone.fabric, 'moving').reactTag
    const [commits, views] = [phone.fabric.calls.completeRoot, viewRuns()]
    runOnUi(addOnUi, x, 25)
    fake.flushUi()
    expect(fake.styles.get(tag)).toEqual({ transform: [{ translateX: 35 }] })
    await settle()
    expect(phone.fabric.calls.completeRoot).toBe(commits)
    expect(viewRuns()).toBe(views)
    running.dispose()
  })

  it('stays tied through later Foldkit draws without being tied again', async () => {
    const fake = withWorklets()
    const { phone, running, x } = await startProgram()
    fake.flushUi()
    const tag = byTestId(phone.fabric, 'moving').reactTag
    const before = fake.updates.length
    await press(phone.fabric, 'rename')
    fake.flushUi()
    expect(textOf(byTestId(phone.fabric, 'label'))).toBe('box! 0 0')
    expect(byTestId(phone.fabric, 'moving').reactTag).toBe(tag)
    expect(fake.updates.length).toBe(before)
    runOnUi(addOnUi, x, 1)
    fake.flushUi()
    // One change, one update: the worklet is listening once.
    expect(fake.updates.length).toBe(before + 1)
    running.dispose()
  })

  it('is let go when the element is removed', async () => {
    const fake = withWorklets()
    const { phone, running, x } = await startProgram()
    fake.flushUi()
    const before = fake.updates.length
    await press(phone.fabric, 'remove')
    fake.flushUi()
    expect(hasTestId(phone.fabric, 'moving')).toBe(false)
    runOnUi(addOnUi, x, 50)
    fake.flushUi()
    expect(fake.updates.length).toBe(before)
    expect(fake.removable.length).toBe(1)
    running.dispose()
  })

  it('is drawn as the view drew it where views cannot be moved', async () => {
    const fake = withWorklets({ reanimated: false })
    const { phone, running } = await startProgram()
    fake.flushUi()
    expect(hasTestId(phone.fabric, 'moving')).toBe(true)
    expect(fake.updates).toEqual([])
    running.dispose()
  })

  it('is drawn as the view drew it where there is no UI thread at all', async () => {
    const { phone, running } = await startProgram()
    expect(hasTestId(phone.fabric, 'moving')).toBe(true)
    expect(hasTestId(phone.fabric, 'card')).toBe(true)
    await press(phone.fabric, 'rename')
    expect(textOf(byTestId(phone.fabric, 'label'))).toBe('box! 0 0')
    running.dispose()
  })
})

describe('a gesture on the UI thread', () => {
  it('asks gesture-handler for a pan on the view, sent to a worklet', async () => {
    const fake = withWorklets()
    const { phone, running } = await startProgram()
    const tag = byTestId(phone.fabric, 'card').reactTag
    const [create, attach, flush] = fake.gestureCalls
    expect(create?.slice(0, 2)).toEqual(['create', 'PanGestureHandler'])
    const handlerTag = create?.[2]
    // 1 is gesture-handler's code for "send the events to a Reanimated worklet".
    expect(attach).toEqual(['attach', handlerTag, tag, 1])
    expect(flush).toEqual(['flush'])
    expect(fake.eventHandlers.map(handler => [handler.name, handler.tag])).toEqual([
      ['onGestureHandlerEvent', tag],
      ['onGestureHandlerStateChange', tag],
    ])
    running.dispose()
  })

  it('follows the finger on the UI thread and tells Foldkit once, at the end', async () => {
    const fake = withWorklets()
    const { phone, running, viewRuns } = await startProgram()
    fake.flushUi()
    const tag = byTestId(phone.fabric, 'card').reactTag
    const views = viewRuns()
    const pan = (translationX: number) => ({ state: PAN_ACTIVE, translationX, translationY: 0, velocityX: 0, velocityY: 0 })
    fake.emit(tag, 'onGestureHandlerStateChange', { ...pan(0), oldState: 2 })
    fake.emit(tag, 'onGestureHandlerEvent', pan(40))
    fake.emit(tag, 'onGestureHandlerEvent', pan(130))
    expect(fake.styles.get(tag)).toEqual({ transform: [{ translateX: 130 }] })
    await settle()
    expect(viewRuns()).toBe(views)
    fake.emit(tag, 'onGestureHandlerStateChange', { ...pan(130), state: PAN_END, oldState: PAN_ACTIVE })
    await settle()
    expect(textOf(byTestId(phone.fabric, 'label'))).toBe('box 1 130')
    running.dispose()
  })

  it('drops the gesture when the program goes away', async () => {
    const fake = withWorklets()
    const { running } = await startProgram()
    const handlerTag = fake.gestureCalls[0]?.[2]
    running.dispose()
    await settle()
    expect(fake.gestureCalls).toContainEqual(['drop', handlerTag])
    expect(fake.eventHandlers).toEqual([])
  })

  it("wraps the gestures in gesture-handler's own view on Android, a plain view on iOS", async () => {
    withWorklets()
    const ios = await startProgram('ios')
    expect(byTestId(ios.phone.fabric, 'root').viewName).not.toBe('RNGestureHandlerRootView')
    ios.running.dispose()
    // Asked again: the answer depends on the platform.
    const android = await startProgram('android')
    const root = byTestId(android.phone.fabric, 'root')
    expect(root.viewName).toBe('RNGestureHandlerRootView')
    expect(root.props['moduleId']).toBe(0)
    android.running.dispose()
  })

  it('leaves the card a plain view where gestures are missing', async () => {
    const fake = withWorklets({ gestures: false })
    const { phone, running } = await startProgram('android')
    fake.flushUi()
    expect(byTestId(phone.fabric, 'root').viewName).not.toBe('RNGestureHandlerRootView')
    expect(fake.gestureCalls).toEqual([])
    // The card's style is still tied: that needs only Reanimated.
    expect(fake.styles.get(byTestId(phone.fabric, 'card').reactTag)).toEqual({
      transform: [{ translateX: 0 }],
    })
    running.dispose()
  })
})

describe('the Worklets demo', () => {
  const env = () => ({ device: { platform: 'ios' as const, osVersion: 27 }, exit: () => {} })

  const line = (phone: ReturnType<typeof startPhone>, id: string): string =>
    textOf(byTestId(phone.fabric, `worklets-${id}`))

  /** Starts the demo and lets its first check, 50 ms after the first draw, finish. */
  const open = async (options: Parameters<typeof makeDemo>[2] = { jsMoveEveryMs: 100_000 }) => {
    const phone = startPhone()
    registerNavigation()
    const running = Runtime.embed(makeDemo(phone.surface.container, env(), options))
    await settle()
    await settle()
    return { phone, running }
  }

  it('is on the menu', () => {
    const demos = makeDemos({ device: PhoneFeatures.makeTest().layer })
    expect(demos.map(demo => demo.title)).toContain('Worklets')
  })

  it('says yes on every line when the build has everything', async () => {
    const fake = withWorklets()
    const { phone, running } = await open()
    expect(line(phone, 'ui-runtime')).toBe('UI runtime present: yes')
    expect(line(phone, 'ran-on-ui')).toBe('Worklet ran on the UI thread: yes')
    expect(line(phone, 'shared')).toBe('Shared value round trip: yes')
    expect(line(phone, 'gestures')).toBe('Gestures on the UI thread: yes')
    // These two wait for the UI thread to answer.
    expect(line(phone, 'prop')).toBe('UI-thread prop update reached a view: waiting')
    expect(line(phone, 'message')).toBe('Message came back: waiting')
    fake.flushUi()
    for (let frame = 0; frame < 3; frame++) fake.frame()
    await settle()
    expect(line(phone, 'message')).toBe('Message came back: yes')
    expect(line(phone, 'prop')).toMatch(
      new RegExp(`^UI-thread prop update reached a view: yes \\(the bar measured ${BAR_WANTED} wide after \\d+ frames\\)$`),
    )
    expect(fake.styles.get(byTestId(phone.fabric, 'worklets-bar').reactTag)).toEqual({ width: BAR_WANTED })
    running.dispose()
  })

  it('keeps the orange box moving while JavaScript hears nothing', async () => {
    const fake = withWorklets()
    const { phone, running } = await open()
    fake.flushUi()
    await settle()
    fake.flushUi()
    const tag = byTestId(phone.fabric, 'worklets-ui-box').reactTag
    const commits = phone.fabric.calls.completeRoot
    const places = new Set<number>()
    // Frames on the UI thread alone: nothing is handed to JavaScript.
    for (let frame = 0; frame < 400; frame++) {
      fake.frame(16, { deliver: false })
      const at = (fake.styles.get(tag)?.['transform'] as Array<{ translateX: number }> | undefined)?.[0]
      if (at !== undefined) places.add(Math.round(at.translateX))
    }
    expect(phone.fabric.calls.completeRoot).toBe(commits)
    // It went most of the way across and came back.
    expect(Math.max(...places)).toBeGreaterThan(TRAVEL * 0.9)
    expect(places.size).toBeGreaterThan(50)
    running.dispose()
  })

  it('blocks JavaScript for the time asked and says how long it was', async () => {
    withWorklets()
    const { phone, running } = await open({ blockMs: 120, jsMoveEveryMs: 100_000 })
    await press(phone.fabric, 'worklets-block')
    await settle()
    await settle()
    expect(textOf(byTestId(phone.fabric, 'worklets-block-result'))).toMatch(
      /^JavaScript was blocked for 1[2-9]\d ms\./,
    )
    running.dispose()
  })

  it('moves the blue box with a draw from JavaScript', async () => {
    withWorklets()
    const { phone, running } = await open({ jsMoveEveryMs: 60 })
    const commits = phone.fabric.calls.completeRoot
    await settle()
    expect(phone.fabric.calls.completeRoot).toBeGreaterThan(commits)
    running.dispose()
  })

  it('says why on every line, and still runs, in a build with none of it', async () => {
    const { phone, running } = await open()
    const why = 'no (the app did not call configureWorklets())'
    expect(line(phone, 'ui-runtime')).toBe(`UI runtime present: ${why}`)
    expect(line(phone, 'ran-on-ui')).toBe(`Worklet ran on the UI thread: ${why}`)
    expect(line(phone, 'shared')).toBe(`Shared value round trip: ${why}`)
    expect(line(phone, 'prop')).toBe(`UI-thread prop update reached a view: ${why}`)
    expect(line(phone, 'message')).toBe(`Message came back: ${why}`)
    expect(line(phone, 'gestures')).toBe(`Gestures on the UI thread: ${why}`)
    expect(textOf(byTestId(phone.fabric, 'worklets-ui-box-missing'))).toBe(
      'Not available: the app did not call configureWorklets()',
    )
    expect(textOf(byTestId(phone.fabric, 'worklets-card-missing'))).toBe(
      'Not available: the app did not call configureWorklets()',
    )
    // The blue box and the bar are plain views and are still there.
    expect(hasTestId(phone.fabric, 'worklets-js-box')).toBe(true)
    expect(hasTestId(phone.fabric, 'worklets-bar')).toBe(true)
    running.dispose()
  })

  it('shows the moving box but no card where only gestures are missing', async () => {
    const fake = withWorklets({ gestures: false })
    const { phone, running } = await open()
    fake.flushUi()
    await settle()
    expect(hasTestId(phone.fabric, 'worklets-ui-box')).toBe(true)
    expect(textOf(byTestId(phone.fabric, 'worklets-card-missing'))).toBe(
      "Not available: gesture-handler's native code is not in this build",
    )
    running.dispose()
  })

  it('counts one Message for a card let go past the line, none for a short drag', async () => {
    const fake = withWorklets()
    const { phone, running } = await open()
    fake.flushUi()
    await settle()
    fake.flushUi()
    const tag = byTestId(phone.fabric, 'worklets-card').reactTag
    const pan = (translationX: number, state: number = PAN_ACTIVE, oldState?: number) => ({
      state,
      ...(oldState === undefined ? {} : { oldState }),
      translationX,
      translationY: 0,
      velocityX: 0,
      velocityY: 0,
    })
    fake.emit(tag, 'onGestureHandlerEvent', pan(60))
    expect(fake.styles.get(tag)).toEqual({ transform: [{ translateX: 60 }] })
    fake.emit(tag, 'onGestureHandlerStateChange', pan(60, PAN_END, PAN_ACTIVE))
    await settle()
    expect(textOf(byTestId(phone.fabric, 'worklets-releases'))).toMatch(/^Let go more than 100 points/)
    fake.emit(tag, 'onGestureHandlerEvent', pan(-140))
    fake.emit(tag, 'onGestureHandlerStateChange', pan(-140, PAN_END, PAN_ACTIVE))
    await settle()
    expect(textOf(byTestId(phone.fabric, 'worklets-releases'))).toBe(
      'Messages from releases: 1. Last one was -140 points from the middle.',
    )
    // It springs back to the middle on the UI thread.
    for (let frame = 0; frame < 300; frame++) fake.frame()
    expect(fake.styles.get(tag)).toEqual({ transform: [{ translateX: 0 }] })
    running.dispose()
  })

  it('stops its worklets when it is left', async () => {
    const fake = withWorklets()
    const { phone, running } = await open()
    fake.flushUi()
    fake.frame()
    expect(fake.framesAsked()).toBeGreaterThan(0)
    await press(phone.fabric, 'exit')
    fake.flushUi()
    for (let frame = 0; frame < 40; frame++) fake.frame()
    expect(fake.framesAsked()).toBe(0)
    running.dispose()
  })

  it('leaves through its Exit button', async () => {
    let exits = 0
    const phone = startPhone()
    registerNavigation()
    const running = Runtime.embed(
      makeDemo(phone.surface.container, { ...env(), exit: () => (exits += 1) }, { jsMoveEveryMs: 100_000 }),
    )
    await settle()
    await press(phone.fabric, 'exit')
    expect(exits).toBe(1)
    running.dispose()
  })
})
