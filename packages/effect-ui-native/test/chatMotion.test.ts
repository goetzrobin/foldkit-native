/**
 * Effect Chat's animations, on the simulated phone with a stand-in for the
 * UI thread: a new message rising, "Thinking" fading in, Send and Stop
 * taking each other's place, the notice lines, and what the numbers strip
 * says. The round button is with the rest of the chat screen's mechanics
 * (`chatMechanics.test.ts`, 9b).
 *
 * The tests read which view the phone's own thread was told to change, and
 * with which values. They cannot show the movement.
 */
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Timing } from '../../native/src/host/aiChat/server.js'
import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { configureWorklets, resetWorklets } from '../../native/src/host/worklets/host.js'
import { requireCompiledWorklets } from '../../native/src/host/worklets/run.js'
import { type FakeWorklets, makeWorklets } from '../../native/test/support/worklets.js'
import { RISE_WINDOW_MS } from '../chat/parts/chatScreen.js'
import { Motion, NativeHost, NativeViews } from '../src/index.js'
import { FAST, REPLY, REQUEST, type TestApp, ids, pressBarButton, seeded, send, start, until } from './chatSupport.js'
import { run } from './support.js'

/** A server that thinks for a while before its first word. */
const SLOW_START: Timing = { ...FAST, firstTokenMs: 900 }

let ui: FakeWorklets | undefined

beforeEach(() => {
  NativeViews.configureMarkdown({ native: true })
})
afterEach(() => {
  ui?.uninstall()
  ui = undefined
  resetWorklets()
  requireCompiledWorklets(true)
  Motion.reset()
  NativeHost.resetHoldReport()
  resetMarkdownSetup()
  delete (globalThis as { __effectUiMotion?: unknown }).__effectUiMotion
})

const useWorklets = (): FakeWorklets => {
  const made = makeWorklets()
  ui = made
  requireCompiledWorklets(false)
  configureWorklets(made.config)
  return made
}

type Look = Readonly<{ opacity?: number; translateY?: number; scale?: number }>

const lookOf = (style: Readonly<Record<string, unknown>>): Look => {
  const transform = (style['transform'] as ReadonlyArray<Record<string, number>> | undefined) ?? []
  const find = (name: string): number | undefined => transform.find(each => name in each)?.[name]
  return {
    ...(typeof style['opacity'] === 'number' ? { opacity: style['opacity'] } : {}),
    ...(find('translateY') === undefined ? {} : { translateY: find('translateY') as number }),
    ...(find('scale') === undefined ? {} : { scale: find('scale') as number }),
  }
}

const sentTo = (worklets: FakeWorklets, tag: number): ReadonlyArray<Look> =>
  worklets.updates.filter(update => update.tag === tag).map(update => lookOf(update.style))

const openChat = (app: TestApp, id = 'c4') => Effect.andThen(app.press(`chat-row-${id}`), app.wait(REQUEST))

/** The id of the row of the message sent just now. */
const newMessage = (app: TestApp): string => {
  const id = ids(app).find(each => each.startsWith('message-local-'))
  if (id === undefined) throw new Error('No new message on screen')
  return id
}

describe('Effect Chat: a new message rises into place', () => {
  it('is drawn below its place and see-through, the phone takes that very row up, and older messages do not move', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        // A saved message is drawn where it belongs. Nothing animates it.
        expect(lookOf(app.byTestId('message-m5').props)).toEqual({})
        yield* send(app, 'And rye?')
        const row = newMessage(app)
        expect(lookOf(app.byTestId(row).props)).toEqual({ opacity: 0, translateY: 24, scale: 1 })
        const tag = app.byTestId(row).reactTag
        worklets.flushUi()
        expect(sentTo(worklets, tag)[0]).toEqual({ opacity: 0, translateY: 24, scale: 1 })
        worklets.frame(0)
        worklets.frame(100)
        // Fast at first: most of the way after a quarter of its 380 ms.
        const early = sentTo(worklets, tag).at(-1) as Look
        expect(early.opacity).toBeGreaterThan(0.7)
        expect(early.opacity).toBeLessThan(1)
        expect(early.translateY).toBeLessThan(8)
        expect(early.translateY).toBeGreaterThan(0)
        worklets.frame(280)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 1, translateY: 0, scale: 1 })
        // The phone was never told to move the older message.
        expect(sentTo(worklets, app.byTestId('message-m5').reactTag)).toEqual([])
      }),
    ))

  it('a little later the row is an ordinary row again, so scrolling it back into view would not move it', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        yield* send(app, 'And rye?')
        const row = newMessage(app)
        worklets.flushUi()
        for (let frame = 0; frame < 30; frame++) worklets.frame(16)
        yield* app.settle
        const tag = app.byTestId(row).reactTag
        // While it counts as new, JavaScript's copy of the row holds where the rise ended.
        expect(lookOf(app.byTestId(row).props)).toEqual({ opacity: 1, translateY: 0, scale: 1 })
        yield* app.wait(RISE_WINDOW_MS + 100)
        // The same native view, no longer animated, with its own style and nothing left over from the rise.
        expect(app.byTestId(row).reactTag).toBe(tag)
        expect(lookOf(app.byTestId(row).props)).toEqual({})
        expect(app.byTestId(row).props['paddingHorizontal']).toBe(20)
      }),
    ))

  it('with Reduce Motion on it does not rise: it is drawn in its place and only fades', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        Motion.configure({ reduceMotion: true })
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        yield* send(app, 'And rye?')
        const row = newMessage(app)
        expect(lookOf(app.byTestId(row).props)).toEqual({ opacity: 0, translateY: 0, scale: 1 })
        const tag = app.byTestId(row).reactTag
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(60)
        worklets.frame(60)
        const sent = sentTo(worklets, tag)
        expect(sent.every(look => look.translateY === 0)).toBe(true)
        expect(sent.at(-1)).toEqual({ opacity: 1, translateY: 0, scale: 1 })
      }),
    ))

  it('in a build without worklets it is simply there', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        yield* send(app, 'And rye?')
        expect(lookOf(app.byTestId(newMessage(app)).props)).toEqual({ opacity: 1, translateY: 0, scale: 1 })
      }),
    ))
})

describe('Effect Chat: "Thinking" fades in', () => {
  it('after 300 ms, over 200 ms, on the phone’s own thread', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        yield* send(app, 'And rye?')
        yield* until(app, () => ids(app).some(id => id.startsWith('reply-thinking-motion-')), 800, '"Thinking"')
        const id = ids(app).find(each => each.startsWith('reply-thinking-motion-')) as string
        expect(lookOf(app.byTestId(id).props)).toEqual({ opacity: 0 })
        const tag = app.byTestId(id).reactTag
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(290)
        // Still waiting for your message to have risen.
        expect(sentTo(worklets, tag)).toEqual([{ opacity: 0 }])
        worklets.frame(110)
        const middle = sentTo(worklets, tag).at(-1)?.opacity as number
        expect(middle).toBeGreaterThan(0)
        expect(middle).toBeLessThan(1)
        worklets.frame(100)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 1 })
        // The word itself is inside the view that fades.
        expect(ids(app).some(each => each.startsWith('reply-thinking-m'))).toBe(true)
      }),
    ))
})

describe('Effect Chat: Send and Stop take each other’s place', () => {
  it('Send fades in when there is something to send, and Stop fades in as a view of its own when the reply starts', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        expect(app.has('swap-send')).toBe(false)
        yield* app.typeText('draft', 'And rye?')
        expect(lookOf(app.byTestId('swap-send').props)).toEqual({ opacity: 0 })
        const sendTag = app.byTestId('swap-send').reactTag
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(60)
        const middle = sentTo(worklets, sendTag).at(-1)?.opacity as number
        expect(middle).toBeGreaterThan(0)
        expect(middle).toBeLessThan(1)
        worklets.frame(60)
        // 120 ms, and it is there.
        expect(sentTo(worklets, sendTag).at(-1)).toEqual({ opacity: 1 })
        yield* app.press('send')
        yield* until(app, () => app.has('swap-stop'), 800, 'Stop')
        expect(app.has('swap-send')).toBe(false)
        const stopTag = app.byTestId('swap-stop').reactTag
        expect(stopTag).not.toBe(sendTag)
        expect(lookOf(app.byTestId('swap-stop').props)).toEqual({ opacity: 0 })
        worklets.flushUi()
        expect(sentTo(worklets, stopTag)[0]).toEqual({ opacity: 0 })
        worklets.frame(0)
        worklets.frame(120)
        expect(sentTo(worklets, stopTag).at(-1)).toEqual({ opacity: 1 })
        // The button inside it is the real Stop.
        yield* app.press('stop')
        yield* until(app, () => !app.has('swap-stop'), REPLY, 'the reply to stop')
      }),
    ))
})

describe('Effect Chat: a notice line', () => {
  it('fades in above the composer, and fades out before it is taken away', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const { app } = yield* start({ disk: seeded() })
        yield* openChat(app)
        yield* app.press('reply-copy-m6')
        expect(app.text('chat-notice')).toBe('Copied')
        expect(lookOf(app.byTestId('chat-notice-motion').props)).toEqual({ opacity: 0 })
        const tag = app.byTestId('chat-notice-motion').reactTag
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(150)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 1 })
        yield* app.settle
        const before = sentTo(worklets, tag).length
        // The Model drops the line after 2.2 seconds. The view stays for its way out.
        yield* until(app, () => Motion.stats().leaving === 1, 3000, 'the notice to start leaving')
        expect(app.has('chat-notice-motion')).toBe(true)
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(75)
        const middle = sentTo(worklets, tag).at(-1)?.opacity as number
        expect(middle).toBeGreaterThan(0)
        expect(middle).toBeLessThan(1)
        worklets.frame(75)
        expect(sentTo(worklets, tag).length).toBeGreaterThan(before)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 0 })
        yield* app.settle
        expect(app.has('chat-notice-motion')).toBe(false)
      }),
    ))
})

describe('Effect Chat: the numbers strip says how animations run', () => {
  const openWithNumbers = (app: TestApp) =>
    Effect.gen(function* () {
      yield* pressBarButton(app, 'bar-chats', 'settings')
      yield* app.press('numbers-switch')
      yield* app.press('settings-done')
      yield* openChat(app)
    })

  it('on the phone’s own thread in a build with worklets', () =>
    run(
      Effect.gen(function* () {
        useWorklets()
        const { app } = yield* start({ disk: seeded() })
        yield* openWithNumbers(app)
        expect(app.text('numbers-motion')).toContain("motion: on the phone's own thread")
      }),
    ))

  it('set at once, with the reason, in a build without them', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* openWithNumbers(app)
        expect(app.text('numbers-motion')).toContain('motion: set at once, no movement (the app did not call configureWorklets())')
      }),
    ))
})

describe('Effect Chat: leaving a chat', () => {
  it('leaves no view animated and nothing running', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const { app } = yield* start({ disk: seeded(), timing: SLOW_START })
        yield* openChat(app)
        yield* send(app, 'And rye?')
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(50)
        expect(Motion.stats().attached).toBeGreaterThan(0)
        expect(Motion.stats().running).toBeGreaterThan(0)
        // The phone's swipe back, in the middle of the animations.
        yield* app.emit('screen-chat', 'topDismissed', { dismissCount: 1 })
        yield* app.wait(REQUEST)
        expect(app.has('screen-chat')).toBe(false)
        expect(Motion.stats()).toMatchObject({ attached: 0, running: 0, leaving: 0 })
      }),
    ))
})
