/**
 * The crash screen on the simulated phone.
 *
 * A small program breaks in each of the three ways the brief names: `update`
 * throws, `view` throws, a Command dies. Each time the phone must show the
 * crash screen with the error's message, and not a blank screen. Then the
 * two apps: the playground's Crash buttons, and Effect Chat starting again
 * with its saved chats still listed.
 *
 * The simulated phone draws no pixels. So the tests check the shape of what
 * is drawn: every word inside a text view, sizes and line heights in points,
 * the details in a scroll view that takes the room left.
 */
import { Command, UiSchema } from '@effect/ui'
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect, Layer, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App as Playground } from '../playground/app.js'
import { playgroundCrash, playgroundServices } from '../playground/start.js'
import { chatCrash } from '../chat/start.js'
import { Menus, Native, NativeCrash, NativeViews, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { HOLD_MS, REQUEST, listed, pressBarButton, seeded, start as startChat } from './chatSupport.js'
import { provideForTest, run } from './support.js'

vi.setConfig({ testTimeout: 30000 })

const LONG = 'broken on purpose: ' + 'a very long reason that has to wrap over many lines '.repeat(8).trim()

const BreakMessage = UiSchema.TaggedEnum({
  PressedAdd: {},
  PressedThrow: {},
  PressedBadView: {},
  PressedDie: {},
  Died: {},
})

/** A Command that dies with a defect: an error nobody declared. */
const Die = Command.make('Die', { args: {} }, () => Effect.die(new Error(LONG)))

/** A child that can break in three ways. A press on Add shows it works. */
const Breakable = Native.component({
  name: 'Breakable',
  model: Schema.Struct({ count: Schema.Number, isViewBad: Schema.Boolean }),
  message: BreakMessage,
}).make({
  init: () => ({ count: 0, isViewBad: false }),
  update: {
    PressedAdd: $ => $.evolve({ count: n => n + 1 }),
    PressedThrow: () => {
      throw new TypeError(LONG)
    },
    PressedBadView: $ => $.evolve({ isViewBad: true }),
    PressedDie: $ => $.run(Die.make({}).pipe(Command.as(BreakMessage.Died()))),
    Died: $ => $.model,
  },
  view: (h, model) => {
    if (model.isViewBad) throw new Error(LONG)
    const button = (id: string, message: typeof BreakMessage.Type) =>
      h.pressable.testId(id).on('press', message).children(h.text.children(id))
    return h.view.testId('first-screen').children(
      h.text.testId('count').children(String(model.count)),
      button('add', BreakMessage.PressedAdd()),
      button('throw', BreakMessage.PressedThrow()),
      button('bad-view', BreakMessage.PressedBadView()),
      button('die', BreakMessage.PressedDie()),
    )
  },
})

/** The app around it. The part that breaks is a child, not the root. */
const Shell = Native.component({ name: 'Shell', model: Schema.Null, message: Schema.Never }).make({
  init: () => null,
  update: $ => $.model,
  view: h => h.view.testId('shell').style({ flex: 1 }).children(Breakable(h, { key: 'breakable' })),
})

const startShell = (hint = 'Nothing was lost.') =>
  Effect.gen(function* () {
    const device = Phone.Device.makeTest()
    const layer = Layer.provideMerge(Phone.layer, device.layer)
    const app = yield* NativeTest.mount(Shell, {}, { crash: NativeCrash.screen({ hint }) }).pipe(provideForTest(layer))
    return { app, device }
  })

/** Each node with its parent, below `root`. */
const withParents = (root: FakeFabricNode): ReadonlyArray<{ node: FakeFabricNode; parent: FakeFabricNode }> =>
  root.children.flatMap(child => [{ node: child, parent: root }, ...withParents(child)])

beforeEach(() => {
  // Effect UI logs every failure as an error. These tests cause them on purpose.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMarkdownSetup()
})

describe('the crash screen', () => {
  it('a throw in update shows the screen, with the message and where it happened', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startShell()
        yield* app.press('add')
        expect(app.text('count')).toBe('1')
        yield* app.press('throw')
        yield* app.wait(20)

        expect(app.has('first-screen')).toBe(false)
        // The whole app is off the screen, not only the part that broke.
        expect(app.has('shell')).toBe(false)
        expect(app.has('crash-screen')).toBe(true)
        expect(app.text('crash-title')).toBe('Something went wrong')
        expect(app.text('crash-what')).toBe('The app stopped while it was handling something you did.')
        expect(app.text('crash-message')).toBe(`TypeError: ${LONG}`)
        expect(app.text('crash-where')).toBe('/Shell/Breakable[breakable] failed in update, handling PressedThrow')
        expect(app.text('crash-hint')).toBe('Nothing was lost.')
        const stack = app.text('crash-stack').split('\n')
        expect(stack.length).toBeGreaterThan(1)
        expect(stack.length).toBeLessThanOrEqual(NativeCrash.STACK_LINES)
        expect(stack[0]).toMatch(/^at /)
      }),
    ))

  it('is one column of readable text: sizes and line heights in points, details that scroll', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startShell()
        yield* app.press('throw')
        yield* app.wait(20)

        const screen = app.byTestId('crash-screen')
        expect(screen.props['flexDirection']).toBe('column')
        // Every word is inside a text view, so it wraps and takes its own line.
        const words = withParents(screen).filter(each => each.node.viewName === 'RawText')
        expect(words.length).toBeGreaterThanOrEqual(6)
        for (const each of words) expect(each.parent.viewName).toBe('Paragraph')
        // Nothing is placed by hand: no view sits on top of another.
        for (const node of NativeTest.flatten([screen])) expect(node.props['position']).not.toBe('absolute')
        // A line is at least as tall as its letters, and at most twice as
        // tall. A web line height of 1.5 read as points fails the first.
        const paragraphs = NativeTest.flatten([screen]).filter(each => each.viewName === 'Paragraph')
        for (const node of paragraphs) {
          const fontSize = node.props['fontSize'] as number
          const lineHeight = node.props['lineHeight'] as number
          expect(fontSize).toBeGreaterThanOrEqual(12)
          expect(lineHeight).toBeGreaterThanOrEqual(fontSize + 4)
          expect(lineHeight).toBeLessThanOrEqual(fontSize * 2)
        }
        // Title, what happened, the details that take the room left, the hint, the buttons.
        expect(screen.children.map(child => child.props['testID'])).toEqual([
          'crash-title',
          'crash-what',
          'crash-details',
          'crash-hint',
          'crash-buttons',
        ])
        const details = app.byTestId('crash-details')
        expect(details.viewName).toBe('ScrollView')
        expect(details.props['flex']).toBe(1)
        const inside = NativeTest.flatten([details]).map(node => node.props['testID'])
        expect(inside).toEqual(expect.arrayContaining(['crash-message', 'crash-where', 'crash-stack']))
      }),
    ))

  it('a throw in view shows the screen', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startShell()
        yield* app.press('bad-view')
        yield* app.wait(20)
        expect(app.has('crash-screen')).toBe(true)
        expect(app.text('crash-what')).toBe('The app stopped while it was drawing the screen.')
        expect(app.text('crash-message')).toBe(`Error: ${LONG}`)
        expect(app.text('crash-where')).toBe('/Shell/Breakable[breakable] failed in view')
      }),
    ))

  it('a Command that dies shows the screen', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startShell()
        yield* app.press('die')
        yield* app.wait(20)
        expect(app.has('crash-screen')).toBe(true)
        expect(app.text('crash-what')).toBe('The app stopped while it was working on something.')
        expect(app.text('crash-message')).toBe(`Error: ${LONG}`)
        expect(app.text('crash-where')).toBe('/Shell/Breakable[breakable] failed in command, running Die')
      }),
    ))

  it('Copy puts the whole report on the clipboard and says Copied for a moment', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* startShell()
        yield* app.press('throw')
        yield* app.wait(20)
        expect(app.text('crash-copy')).toBe('Copy')
        yield* app.press('crash-copy')
        yield* app.wait(20)

        const copied = device.clipboard.contents()
        const lines = copied.split('\n')
        expect(lines[0]).toBe(`TypeError: ${LONG}`)
        expect(lines[1]).toBe('/Shell/Breakable[breakable] failed in update, handling PressedThrow')
        // The whole stack, not only the lines the screen shows.
        expect(lines.slice(2).every(line => line.startsWith('at '))).toBe(true)
        expect(lines.length).toBeGreaterThan(3)
        expect(device.clipboard.calls.filter(call => call.startsWith('copy:'))).toHaveLength(1)
        expect(app.text('crash-copy')).toBe('Copied')
        yield* app.wait(NativeCrash.COPIED_MS + 100)
        expect(app.text('crash-copy')).toBe('Copy')
      }),
    ))

  it('Start again brings back the first screen with a new Model, and a second crash is caught too', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startShell()
        yield* app.press('add')
        yield* app.press('add')
        expect(app.root.model()).toBe(null)
        yield* app.press('throw')
        yield* app.wait(20)
        expect(app.has('crash-screen')).toBe(true)
        expect(app.root.model()).toBeUndefined()

        yield* app.press('crash-restart')
        yield* app.wait(20)
        expect(app.has('crash-screen')).toBe(false)
        expect(app.has('first-screen')).toBe(true)
        expect(app.text('count')).toBe('0')
        expect(app.root.model()).toBe(null)
        // The new program works.
        yield* app.press('add')
        expect(app.text('count')).toBe('1')
        // And it is watched as the first one was.
        yield* app.press('die')
        yield* app.wait(20)
        expect(app.has('crash-screen')).toBe(true)
        expect(app.text('crash-where')).toBe('/Shell/Breakable[breakable] failed in command, running Die')
        yield* app.press('crash-restart')
        yield* app.wait(20)
        expect(app.text('count')).toBe('0')
      }),
    ))

  it('follows the phone into dark mode', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* startShell()
        yield* app.press('throw')
        yield* app.wait(20)
        expect(app.byTestId('crash-screen').props['backgroundColor']).toBe('#FFFFFF')
        device.colorScheme.set('dark')
        yield* app.wait(20)
        expect(app.byTestId('crash-screen').props['backgroundColor']).toBe('#0B0B0C')
      }),
    ))

  it('without the crash option, the part that broke goes blank and nothing else is shown', () =>
    run(
      Effect.gen(function* () {
        const device = Phone.Device.makeTest()
        const layer = Layer.provideMerge(Phone.layer, device.layer)
        const app = yield* NativeTest.mount(Shell, {}).pipe(provideForTest(layer))
        yield* app.press('throw')
        yield* app.wait(20)
        expect(app.has('first-screen')).toBe(false)
        expect(app.has('shell')).toBe(true)
        expect(app.has('crash-screen')).toBe(false)
      }),
    ))
})

describe('the playground', () => {
  const start = () =>
    Effect.gen(function* () {
      registerNavigation()
      const device = Phone.Device.makeTest()
      const layer = Layer.provideMerge(playgroundServices(device.layer, { serverDelayMs: 20 }), device.layer)
      const app = yield* NativeTest.mount(Playground, { platform: 'ios', hasReadout: false }, { crash: playgroundCrash }).pipe(
        provideForTest(layer),
      )
      return { app, device }
    })

  for (const [button, where] of [
    ['crash-update', 'failed in update, handling PressedCrash'],
    ['crash-view', 'failed in view'],
    ['crash-command', 'failed in command, running Playground/Break'],
  ] as const) {
    it(`${button} on the Phone screen shows the crash screen, and Start again shows the menu`, () =>
      run(
        Effect.gen(function* () {
          const { app } = yield* start()
          yield* app.press('menu-Phone')
          yield* app.press(button)
          yield* app.wait(20)
          expect(app.has('crash-screen')).toBe(true)
          expect(app.text('crash-message')).toBe('Error: This crash was made on purpose.')
          expect(app.text('crash-where')).toContain(where)
          yield* app.press('crash-restart')
          yield* app.wait(20)
          expect(app.has('crash-screen')).toBe(false)
          expect(app.has('menu')).toBe(true)
          expect(app.root.model()?.screens.map(screen => screen._tag)).toEqual(['Menu'])
        }),
      ))
  }
})

describe('Effect Chat', () => {
  /** The phone's list of choices breaks: holding a chat runs a Command that dies. */
  const brokenMenus = Menus.Show.toLayer(() => Effect.die(new Error('The list of choices broke.'))) as Layer.Layer<any>

  it('Start again shows the list of chats, and the saved chats are still in it', () =>
    run(
      Effect.gen(function* () {
        NativeViews.configureMarkdown({ native: true })
        const { app, device } = yield* startChat({ disk: seeded(), override: brokenMenus, crash: chatCrash })
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
        // A new chat is made and saved before the crash.
        yield* pressBarButton(app, 'bar-chats', 'new-chat')
        yield* app.wait(REQUEST)
        yield* Effect.sync(() => app.fabric.emit(app.byTestId('screen-chat'), 'topDismissed', { dismissCount: 1 }))
        yield* app.wait(REQUEST)
        const before = listed(app)
        expect(before).toHaveLength(4)

        // A finger rests on a chat. The list of choices opens under it, and breaks.
        yield* app.touchStart('chat-row-c1')
        yield* app.wait(HOLD_MS + REQUEST)
        expect(app.has('crash-screen')).toBe(true)
        expect(app.has('stack')).toBe(false)
        expect(app.text('crash-message')).toBe('Error: The list of choices broke.')
        expect(app.text('crash-hint')).toBe('Your chats are saved. Start again to go back to them.')
        yield* app.press('crash-copy')
        yield* app.wait(20)
        expect(device.clipboard.contents()).toMatch(/^Error: The list of choices broke\.\n/)

        yield* app.press('crash-restart')
        yield* app.wait(REQUEST * 2)
        expect(app.has('crash-screen')).toBe(false)
        expect(app.has('screen-chats')).toBe(true)
        expect(listed(app)).toEqual(before)
        // The new program works: a chat opens and shows its saved messages.
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST * 2)
        expect(app.has('screen-chat')).toBe(true)
        expect(app.allText().join(' ')).toContain('How long does bread prove?')
      }),
    ))
})
