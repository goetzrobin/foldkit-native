/**
 * Step 3's additions to the binding, each on its own: the phone's list of
 * choices, a view that fades in and out, the title bar's buttons, and the
 * speech recognition service over its native module.
 */
import { Command, UiSchema } from '@effect/ui'
import { Effect, Layer, Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { Menus, Native, NativeMount, NativeViews, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { provideForTest, run } from './support.js'

const Speech = Phone.Device.Speech

const Message = UiSchema.TaggedEnum({
  PressedMenu: {},
  Answered: { answer: Menus.Answer },
  PressedToggle: {},
  PressedBar: { id: Schema.String },
  ChoseBarMenu: { key: Schema.String },
})

const Demo = Native.component({
  name: 'MenusDemo',
  model: Schema.Struct({ answer: Schema.String, isShown: Schema.Boolean, bar: Schema.String }),
  message: Message,
}).make({
  init: () => ({ answer: 'none', isShown: false, bar: '' }),
  update: {
    PressedMenu: $ =>
      $.run(
        Menus.Show.make({
          title: 'A reply',
          items: [
            { key: 'copy', title: 'Copy', isDestructive: false },
            { key: 'delete', title: 'Delete', isDestructive: true },
          ],
        }).pipe(Command.map(answer => Message.Answered({ answer }))),
      ),
    Answered: ($, { answer }) =>
      $.evolve({ answer: answer._tag === 'Selected' ? answer.key : answer._tag === 'Failed' ? `failed: ${answer.reason}` : 'dismissed' }),
    PressedToggle: $ => $.evolve({ isShown: on => !on }),
    PressedBar: ($, { id }) => $.evolve({ bar: `pressed ${id}` }),
    ChoseBarMenu: ($, { key }) => $.evolve({ bar: `chose ${key}` }),
  },
  view: (h, model) =>
    h.stack.children(
      h.screen.key('main').children(
        NativeViews.barButtons(h.header.testId('bar').set({ title: 'Demo' }) as never, {
          left: [{ id: 'gear', label: 'Settings', symbol: 'gearshape' }],
          right: [
            {
              id: 'more',
              label: 'More',
              symbol: 'ellipsis',
              menu: [{ key: 'rename', title: 'Rename' }, { section: [{ key: 'delete', title: 'Delete', isDestructive: true }] }],
            },
          ],
          onPress: (id): typeof Message.Type => Message.PressedBar({ id }),
          onMenu: (key): typeof Message.Type => Message.ChoseBarMenu({ key }),
        }) as never,
        h.pressable.testId('menu').on('press', Message.PressedMenu()).children(h.text('menu')),
        h.text.testId('answer').children(model.answer),
        h.text.testId('bar-said').children(model.bar),
        h.pressable.testId('toggle').on('press', Message.PressedToggle()).children(h.text('toggle')),
        h.view
          .testId('fader')
          .set({ collapsable: false })
          .onMount(NativeMount.Fade({ isShown: model.isShown, ms: 80 }))
          .children(h.text('now you see me')),
      ),
    ),
})

afterEach(() => {
  Menus.configure({ nativeModule: 'global' })
})

const mount = (platform: 'ios' | 'android' = 'ios') => {
  registerNavigation()
  return NativeTest.mount(Demo, {}, { platform }).pipe(provideForTest(Layer.provide(Menus.layer, Menus.live)))
}

describe('Menus: the phone’s own list of choices', () => {
  it('iPhone: the action sheet gets the titles, a Cancel line and which line is red, and answers with the key', () =>
    run(
      Effect.gen(function* () {
        const asked: Array<Record<string, unknown>> = []
        let choose = (_index: number): void => {}
        Menus.configure({
          nativeModule: name =>
            name === 'ActionSheetManager'
              ? {
                  showActionSheetWithOptions: (options: Record<string, unknown>, done: (index: number) => void) => {
                    asked.push(options)
                    choose = done
                  },
                }
              : undefined,
        })
        const app = yield* mount()
        yield* app.press('menu')
        expect(asked).toEqual([
          { title: 'A reply', options: ['Copy', 'Delete', 'Cancel'], cancelButtonIndex: 2, destructiveButtonIndices: [1], disabledButtonIndices: [] },
        ])
        // Still open: nothing has been answered.
        expect(app.text('answer')).toBe('none')
        choose(1)
        yield* app.settle
        expect(app.text('answer')).toBe('delete')
        // Cancel is not a choice.
        yield* app.press('menu')
        choose(2)
        yield* app.settle
        expect(app.text('answer')).toBe('dismissed')
      }),
    ))

  it('a build without the native module answers Failed with the reason, and the app carries on', () =>
    run(
      Effect.gen(function* () {
        Menus.configure({ nativeModule: () => undefined })
        const app = yield* mount()
        yield* app.press('menu')
        expect(app.text('answer')).toBe("failed: React Native's ActionSheetManager is not in this build")
      }),
    ))
})

describe('the title bar’s buttons', () => {
  it('are the iPhone’s own, made from data. A button with a menu carries the menu and no press of its own', () =>
    run(
      Effect.gen(function* () {
        const app = yield* mount()
        const bar = app.byTestId('bar')
        expect(bar.props['headerLeftBarButtonItems']).toEqual([{ buttonId: 'gear', index: 0, title: 'Settings', sfSymbolName: 'gearshape' }])
        const right = bar.props['headerRightBarButtonItems'] as Array<Record<string, unknown>>
        expect(right[0]?.['buttonId']).toBeUndefined()
        expect(right[0]?.['menu']).toEqual({
          items: [
            { type: 'action', menuId: 'rename', title: 'Rename' },
            { type: 'submenu', title: '', displayInline: true, items: [{ type: 'action', menuId: 'delete', title: 'Delete', destructive: true }] },
          ],
        })
        yield* app.emit('bar', 'topPressHeaderBarButtonItem', { buttonId: 'gear' })
        expect(app.text('bar-said')).toBe('pressed gear')
        yield* app.emit('bar', 'topPressHeaderBarButtonMenuItem', { menuId: 'delete' })
        expect(app.text('bar-said')).toBe('chose delete')
      }),
    ))
})

describe('NativeMount.Fade', () => {
  it('starts away, see-through and out of reach, then fades and grows in over its time, and out again', () =>
    run(
      Effect.gen(function* () {
        const app = yield* mount()
        const look = () => {
          const props = app.byTestId('fader').props
          const scale = (props['transform'] as Array<{ scale?: number }> | undefined)?.[0]?.scale
          return { opacity: props['opacity'] as number, scale, touch: props['pointerEvents'] }
        }
        expect(look()).toEqual({ opacity: 0, scale: NativeMount.FADE_SCALE, touch: 'none' })
        yield* app.press('toggle')
        // On its way: partly there, and neither end yet.
        const seen: Array<number> = []
        for (let step = 0; step < 12; step++) {
          yield* app.wait(12)
          seen.push(look().opacity)
        }
        expect(seen.some(opacity => opacity > 0 && opacity < 1)).toBe(true)
        // It only ever grows on the way in.
        expect([...seen].sort((a, b) => a - b)).toEqual(seen)
        yield* app.wait(150)
        expect(look()).toEqual({ opacity: 1, scale: 1, touch: 'box-none' })
        yield* app.press('toggle')
        yield* app.wait(250)
        expect(look()).toEqual({ opacity: 0, scale: NativeMount.FADE_SCALE, touch: 'none' })
        // The view was there all along: what is in it was never taken away.
        expect(app.allText()).toContain('now you see me')
      }),
    ))
})

/** A pretend `ExpoSpeechRecognitionModule`, as bare as the real one's surface. */
const pretendModule = (answers: Readonly<{ granted: boolean; canAskAgain: boolean }> = { granted: true, canAskAgain: true }) => {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const started: Array<Record<string, unknown>> = []
  const calls: Array<string> = []
  const module: Phone.Device.Speech.SpeechModule = {
    start: options => {
      calls.push('start')
      started.push(options)
    },
    stop: () => void calls.push('stop'),
    abort: () => void calls.push('abort'),
    requestPermissionsAsync: () => Promise.resolve(answers),
    addListener: (name, listener) => {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return { remove: () => void set.delete(listener) }
    },
  }
  return {
    module,
    started,
    calls,
    emit: (name: string, event: unknown) => {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(event)
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
}

describe('speech recognition over its native module', () => {
  afterEach(() => {
    delete (globalThis as { expo?: unknown }).expo
  })

  it('finds the module by name on the global, and takes nothing that lacks its two calls', () => {
    expect(Speech.moduleFromGlobal()).toBeNull()
    ;(globalThis as { expo?: unknown }).expo = { modules: { ExpoSpeechRecognition: { start: () => {} } } }
    expect(Speech.moduleFromGlobal()).toBeNull()
    const pretend = pretendModule()
    ;(globalThis as { expo?: unknown }).expo = { modules: { ExpoSpeechRecognition: pretend.module } }
    expect(Speech.moduleFromGlobal()).toBe(pretend.module)
  })

  it('a build without it fails every call with a reason that names the package, and hears nothing', () =>
    run(
      Effect.orDie(Effect.gen(function* () {
        const service = Speech.unavailable(Speech.NO_SPEECH_MODULE)
        const error = yield* Effect.flip(service.start({}))
        expect(error.reason).toContain('expo-speech-recognition')
        expect(yield* service.isAvailable).toBe(false)
        expect((yield* Effect.flip(service.requestPermission)).capability).toBe('speech')
        const stop = service.events.subscribe(() => {
          throw new Error('nothing should be heard')
        })
        stop()
      })),
    ))

  it('tells granted from refused, and refused for good', () =>
    run(
      Effect.orDie(Effect.gen(function* () {
        expect(yield* Speech.make(pretendModule({ granted: true, canAskAgain: true }).module).requestPermission).toBe('granted')
        expect(yield* Speech.make(pretendModule({ granted: false, canAskAgain: true }).module).requestPermission).toBe('denied')
        expect(yield* Speech.make(pretendModule({ granted: false, canAskAgain: false }).module).requestPermission).toBe('blocked')
      })),
    ))

  it('starts with words as they are spoken, and reads a file when given one', () =>
    run(
      Effect.orDie(Effect.gen(function* () {
        const pretend = pretendModule()
        const service = Speech.make(pretend.module)
        yield* service.start({ lang: 'de-DE' })
        yield* service.start({ audioUri: 'file:///note.m4a' })
        expect(pretend.started).toEqual([
          { lang: 'de-DE', interimResults: true, continuous: true, addsPunctuation: true },
          { interimResults: true, continuous: true, addsPunctuation: true, audioSource: { uri: 'file:///note.m4a' } },
        ])
        yield* service.stop
        yield* service.abort
        expect(pretend.calls).toEqual(['start', 'start', 'stop', 'abort'])
      })),
    ))

  it('a native call that throws is a failure with its words, not a crash', () =>
    run(
      Effect.orDie(Effect.gen(function* () {
        const pretend = pretendModule()
        const service = Speech.make({
          ...pretend.module,
          start: () => {
            throw new Error('Missing permissions')
          },
        })
        expect((yield* Effect.flip(service.start({}))).reason).toBe('Missing permissions')
      })),
    ))

  it('turns the module’s four events into plain ones, and stops listening when asked', () => {
    const pretend = pretendModule()
    const service = Speech.make(pretend.module)
    const heard: Array<unknown> = []
    const stop = service.events.subscribe(event => heard.push(event))
    expect(pretend.listening()).toBe(4)
    pretend.emit('start', null)
    pretend.emit('result', { isFinal: false, results: [{ transcript: 'hello', confidence: 0.9 }, { transcript: 'hallo' }] })
    pretend.emit('result', { isFinal: true, results: [{ transcript: 'hello there' }] })
    // A result with nothing in it, as the phone sends for silence.
    pretend.emit('result', { isFinal: true, results: [] })
    pretend.emit('error', { error: 'no-speech', message: 'No speech was detected.' })
    pretend.emit('error', null)
    pretend.emit('end', null)
    expect(heard).toEqual([
      { _tag: 'Started' },
      { _tag: 'Result', text: 'hello', isFinal: false },
      { _tag: 'Result', text: 'hello there', isFinal: true },
      { _tag: 'Result', text: '', isFinal: true },
      { _tag: 'Failed', code: 'no-speech', reason: 'No speech was detected.' },
      { _tag: 'Failed', code: 'unknown', reason: 'unknown' },
      { _tag: 'Ended' },
    ])
    stop()
    expect(pretend.listening()).toBe(0)
    pretend.emit('result', { isFinal: true, results: [{ transcript: 'late' }] })
    expect(heard).toHaveLength(7)
  })
})
