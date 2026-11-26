/**
 * Effect Chat, step 3: holding a message for its menu, and what the menu
 * and the small buttons under a reply do, end to end on the simulated phone.
 *
 * A hold is read two ways: by the phone's own long press recogniser
 * (gesture-handler, stood in for here by the fake worklets) and by the
 * host's timer as the backup.
 */
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pickReply } from '../../native/src/host/aiChat/replies.js'
import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { configureWorklets, resetWorklets } from '../../native/src/host/worklets/host.js'
import { requireCompiledWorklets } from '../../native/src/host/worklets/run.js'
import { type FakeWorklets, makeWorklets } from '../../native/test/support/worklets.js'
import { NativeHost, NativeViews } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import {
  FAST,
  HOLD_MS,
  REPLY,
  REQUEST,
  type Started,
  type TestApp,
  hold,
  ids,
  replies,
  seeded,
  send,
  start,
  textIn,
  until,
} from './chatSupport.js'
import { run } from './support.js'

const RUNNING = 'How do I start running?'
const GRACE = NativeHost.NATIVE_GRACE_MS

let ui: FakeWorklets | undefined

beforeEach(() => {
  NativeViews.configureMarkdown({ native: true })
  NativeHost.resetHoldReport()
})
afterEach(() => {
  resetMarkdownSetup()
  ui?.uninstall()
  ui = undefined
  resetWorklets()
  requireCompiledWorklets(true)
})

/** Says the build has gesture-handler and Reanimated, as an iPhone build does. */
const useNativeHold = (): void => {
  requireCompiledWorklets(false)
  ui = makeWorklets()
  configureWorklets(ui.config)
}

/** gesture-handler's long press on a view says something: 2 began, 4 active (the hold), 1 failed. */
const nativeSays = (app: TestApp, id: string, state: number, oldState = 0): void =>
  (ui as FakeWorklets).emit(app.byTestId(id).reactTag, 'onGestureHandlerStateChange', { state, oldState, handlerTag: 0 })

/** A saved chat, open, with a finished reply and its question. */
const openSaved = (options: Parameters<typeof start>[0] = {}) =>
  Effect.gen(function* () {
    const started = yield* start({ disk: seeded(), ...options })
    yield* started.app.press('chat-row-c4')
    yield* started.app.wait(REQUEST)
    return started
  })

/** A new chat with a reply that is still being written. */
const openStreaming = (options: Parameters<typeof start>[0] = {}) =>
  Effect.gen(function* () {
    const started = yield* start({ timing: { ...FAST, tokensPerSecond: 110 }, ...options })
    const { app } = started
    yield* app.press('start-chat')
    yield* app.wait(REQUEST)
    yield* send(app, RUNNING)
    yield* until(app, () => app.has('stop') && replies(app).length > 0 && textIn(app.byTestId(replies(app)[0] as string)).length > 30, REPLY * 2, 'the reply to start')
    const reply = (replies(app)[0] as string).replace(/^reply-/, 'row-')
    return { ...started, reply }
  })

const notice = (started: Started): string => (started.app.has('chat-notice') ? started.app.text('chat-notice') : '')

describe('holding a message opens its menu', () => {
  it('a finished reply: Copy, Select text, Share and Write again, with a tap under the finger. Copy puts it on the clipboard', () =>
    run(
      Effect.gen(function* () {
        const started = yield* openSaved()
        const { app, device, menus } = started
        yield* hold(app, 'row-m6')
        expect(menus.titles()).toEqual(['Copy', 'Select text', 'Share', 'Write again'])
        expect(device.haptics.calls).toEqual(['impact:medium'])
        menus.choose('copy')
        yield* app.wait(REQUEST)
        expect(device.clipboard.contents()).toBe('About an hour, until it has **doubled**.')
        expect(notice(started)).toBe('Copied')
        expect(device.haptics.calls).toEqual(['impact:medium', 'notification:success'])
        // One hold opened one menu.
        expect(menus.shown).toHaveLength(1)
        // The line goes away by itself.
        yield* app.wait(2400)
        expect(app.has('chat-notice')).toBe(false)
      }),
    ))

  it('your own question: no Write again. Closing the menu does nothing', () =>
    run(
      Effect.gen(function* () {
        const { app, device, menus } = yield* openSaved()
        yield* hold(app, 'row-m5')
        expect(menus.titles()).toEqual(['Copy', 'Select text', 'Share'])
        menus.dismiss()
        yield* app.settle
        expect(device.clipboard.calls).toEqual([])
        // It can be opened again.
        yield* hold(app, 'row-m5')
        expect(menus.shown).toHaveLength(2)
      }),
    ))

  it('a short touch is not a hold, and neither is a finger that moves away', () =>
    run(
      Effect.gen(function* () {
        const { app, menus } = yield* openSaved()
        yield* app.press('row-m6')
        yield* app.touchStart('row-m6', { x: 100, y: 300 })
        yield* app.touchMove('row-m6', { x: 100, y: 330 })
        yield* app.wait(HOLD_MS + 80)
        yield* app.touchEnd('row-m6', { x: 100, y: 330 })
        expect(menus.shown).toEqual([])
      }),
    ))

  it('with the keyboard up: the keyboard goes first, and the menu opens a moment later', () =>
    run(
      Effect.gen(function* () {
        const { app, device, menus } = yield* openSaved()
        device.keyboard.show(335)
        yield* app.settle
        const dismissed = device.keyboard.dismissCount()
        yield* app.touchStart('row-m6')
        yield* app.wait(HOLD_MS + 20)
        // The hold is recognised: the keyboard is told to go, and no menu is up yet.
        expect(device.keyboard.dismissCount()).toBe(dismissed + 1)
        expect(device.haptics.calls).toEqual(['impact:medium'])
        expect(menus.open()).toBeUndefined()
        yield* app.wait(120)
        expect(menus.titles()).toEqual(['Copy', 'Select text', 'Share', 'Write again'])
        yield* app.touchEnd('row-m6')
        // The lift after the hold is not a tap.
        expect(device.keyboard.dismissCount()).toBe(dismissed + 1)
      }),
    ))

  it('while the reply is still being written: Copy so far and Stop. Stop stops it', () =>
    run(
      Effect.gen(function* () {
        const { app, device, menus, server, reply } = yield* openStreaming()
        yield* hold(app, reply)
        expect(menus.titles()).toEqual(['Copy so far', 'Stop'])
        expect(device.haptics.calls).toContain('impact:medium')
        menus.choose('stop')
        yield* until(app, () => !app.has('stop'), REPLY, 'the reply to stop')
        expect(server.log().some(name => name.startsWith('StopTurn'))).toBe(true)
        expect(textIn(app.byTestId(reply))).toContain('Stopped')
      }),
    ))

  it('Copy so far copies what the reply holds at that moment, which only its row knows', () =>
    run(
      Effect.gen(function* () {
        const started = yield* openStreaming()
        const { app, device, menus, reply } = started
        yield* hold(app, reply)
        menus.choose('copy')
        yield* app.wait(REQUEST)
        const copied = device.clipboard.contents()
        expect(copied.length).toBeGreaterThan(30)
        expect(pickReply(RUNNING).answer.startsWith(copied)).toBe(true)
        expect(copied.length).toBeLessThan(pickReply(RUNNING).answer.length)
        expect(notice(started)).toBe('Copied')
        // The reply went on being written.
        expect(app.has('stop')).toBe(true)
      }),
    ))

  it('Select text opens the message in a sheet where it can be selected', () =>
    run(
      Effect.gen(function* () {
        const { app, menus } = yield* openSaved()
        yield* hold(app, 'row-m6')
        menus.choose('select')
        yield* app.settle
        const sheet = app.byTestId('sheet-select')
        expect(sheet.props['sheetAllowedDetents']).toEqual([0.6, 1])
        // A reply is drawn as it is in the chat: by the native Markdown view.
        const markdown = NativeTest.flatten([sheet]).find(node => node.viewName === 'EnrichedMarkdown')
        expect(markdown?.props['markdown']).toBe('About an hour, until it has **doubled**.')
        yield* app.emit('sheet-select', 'topDismissed', { dismissCount: 1 })
        // Your own message is plain text that can be selected.
        yield* hold(app, 'row-m5')
        menus.choose('select')
        yield* app.settle
        const words = NativeTest.flatten([app.byTestId('select-text')]).find(node => node.props['selectable'] === true)
        expect(textIn(words as never)).toBe('How long does bread prove?')
      }),
    ))
})

describe("the phone's own long press recogniser on a row", () => {
  it('is attached to the row view as a long press of the same length, and its word opens the menu, once', () =>
    run(
      Effect.gen(function* () {
        useNativeHold()
        const { app, device, menus, reply } = yield* openStreaming()
        const worklets = ui as FakeWorklets
        const tag = app.byTestId(reply).reactTag
        const creates = worklets.gestureCalls.filter(call => call[0] === 'create' && call[1] === 'LongPressGestureHandler')
        expect(creates.length).toBeGreaterThan(0)
        expect(creates[0]?.[3]).toMatchObject({ minDurationMs: HOLD_MS, maxDist: 10 })
        // One recogniser on this row's view, however many times the row was drawn while the reply grew.
        expect(worklets.gestureCalls.filter(call => call[0] === 'attach' && call[2] === tag)).toHaveLength(1)
        // The finger goes down. Both ways see it.
        yield* app.touchStart(reply)
        nativeSays(app, reply, 2)
        yield* app.wait(HOLD_MS)
        // The timer here waits a little longer where the recogniser is on: nothing yet.
        expect(menus.open()).toBeUndefined()
        nativeSays(app, reply, 4, 2)
        yield* app.settle
        expect(menus.titles()).toEqual(['Copy so far', 'Stop'])
        expect(device.haptics.calls.filter(call => call === 'impact:medium')).toHaveLength(1)
        // The backup's own time passes. It heard the same finger: no second menu.
        yield* app.wait(GRACE + 80)
        yield* app.touchEnd(reply)
        expect(menus.shown).toHaveLength(1)
        expect(NativeHost.holdReport()).toMatch(/^hold: native recogniser on, JS as backup \| last: recognised by native after \d+ ms/)
      }),
    ))

  it('when the recogniser says nothing, the timer opens the menu a moment later', () =>
    run(
      Effect.gen(function* () {
        useNativeHold()
        const { app, menus, reply } = yield* openStreaming()
        yield* app.touchStart(reply)
        yield* app.wait(HOLD_MS + 40)
        expect(menus.open()).toBeUndefined()
        yield* app.wait(GRACE + 40)
        expect(menus.titles()).toEqual(['Copy so far', 'Stop'])
        // The recogniser's word comes after all, late. It is the same finger: no second menu.
        nativeSays(app, reply, 4, 2)
        yield* app.settle
        expect(menus.shown).toHaveLength(1)
        yield* app.touchEnd(reply)
        expect(NativeHost.holdReport()).toContain('recognised by JS')
        expect(NativeHost.holdReport()).toContain('native said nothing')
      }),
    ))

  it('when gesture-handler cancels the touch to start its own hold and its word never comes, the menu still opens', () =>
    run(
      Effect.gen(function* () {
        useNativeHold()
        const { app, menus, reply } = yield* openStreaming()
        yield* app.touchStart(reply)
        nativeSays(app, reply, 2)
        yield* app.wait(HOLD_MS)
        // The phone takes the touch away from JavaScript, as it does when a native gesture starts.
        yield* app.touchCancel(reply)
        expect(menus.open()).toBeUndefined()
        yield* app.wait(GRACE + 60)
        expect(menus.titles()).toEqual(['Copy so far', 'Stop'])
        expect(menus.shown).toHaveLength(1)
      }),
    ))

  it('a touch the phone cancels early is not a hold', () =>
    run(
      Effect.gen(function* () {
        useNativeHold()
        const { app, menus, reply } = yield* openStreaming()
        yield* app.touchStart(reply)
        nativeSays(app, reply, 2)
        yield* app.wait(30)
        yield* app.touchCancel(reply)
        nativeSays(app, reply, 1, 2)
        yield* app.wait(HOLD_MS + GRACE + 80)
        expect(menus.shown).toEqual([])
      }),
    ))

  it('is off on Android and in a build without gesture-handler, and the numbers say so', () =>
    run(
      Effect.gen(function* () {
        const plain = yield* openSaved()
        yield* hold(plain.app, 'row-m6')
        expect(plain.menus.shown).toHaveLength(1)
        expect(NativeHost.holdReport()).toMatch(/^hold: JS route \(native off: /)
        NativeHost.resetHoldReport()
        useNativeHold()
        const android = yield* openSaved({ platform: 'android' })
        yield* hold(android.app, 'row-m6')
        expect(android.menus.shown).toHaveLength(1)
        expect(NativeHost.holdReport()).toContain('JS route (native off: Android)')
      }),
    ))
})

describe('the small buttons under a finished reply', () => {
  it('Copy and Share act on that reply. Only the newest reply can be written again', () =>
    run(
      Effect.gen(function* () {
        const started = yield* start({ disk: seeded() })
        const { app, device } = started
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        expect(ids(app)).toContain('reply-regenerate-m6')
        yield* app.press('reply-share-m6')
        expect(device.share.calls).toEqual([{ message: 'About an hour, until it has **doubled**.' }])
        yield* app.press('reply-copy-m6')
        yield* app.wait(REQUEST)
        expect(device.clipboard.contents()).toBe('About an hour, until it has **doubled**.')
        expect(notice(started)).toBe('Copied')
        // A second question: the first reply loses its Write again button.
        yield* send(app, 'What can you do?')
        yield* until(app, () => replies(app).length === 2 && !app.has('stop'), REPLY * 2, 'the second reply')
        yield* app.wait(REQUEST * 3)
        expect(ids(app)).not.toContain('reply-regenerate-m6')
        expect(ids(app).filter(id => id.startsWith('reply-regenerate-'))).toHaveLength(1)
      }),
    ))

  it('Write again takes the old reply off at once and a new one is written in its place', () =>
    run(
      Effect.gen(function* () {
        const { app, device, server } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        yield* app.press('reply-regenerate-m6')
        // Gone before the server has said anything.
        expect(app.has('reply-m6')).toBe(false)
        expect(device.haptics.calls).toContain('impact:light')
        yield* until(app, () => replies(app).length === 1 && !app.has('stop') && app.has(`reply-actions-${(replies(app)[0] as string).slice(6)}`), REPLY * 2, 'the new reply')
        expect(server.log().some(name => name.startsWith('RegenerateTurn'))).toBe(true)
        expect(replies(app)).not.toContain('reply-m6')
        // Still one question and one reply.
        expect(ids(app).filter(id => id.startsWith('message-')).length).toBe(1)
      }),
    ))
})
