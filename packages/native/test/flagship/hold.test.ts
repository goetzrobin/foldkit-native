/**
 * Holding a message while its reply streams, on a simulated phone whose list
 * reports its own scrolling as a real iPhone does.
 *
 * The phone test of 25 November 2026: holding a message while a reply
 * streams did nothing; holding a finished one worked. The cause is in the
 * engine, not in Fold Chat's view. While a reply streams the list changes
 * its bottom inset (the blank space under the reply shrinks as the reply
 * grows), and scrolls to follow the end. UIKit reports each as a scroll, and
 * React Native sends it on as `onScroll` with `responderIgnoreScroll: true`:
 * no finger did it (`RCTScrollViewComponentView.mm`). React's responder
 * ignores such a scroll (`ReactFabric`: `topScroll` only moves the responder
 * when `!nativeEvent.responderIgnoreScroll`). `@ng-native/fabric` 0.25.0
 * does not: `cancelPressForScroll` ends the touch of any responder inside a
 * scroll view on every `topScroll`. So the hold's responder was terminated
 * within a frame or two, and its timer with it. A finished chat does not
 * scroll by itself, so the hold there lived.
 *
 * The earlier tests held a streaming reply on the plain simulated phone,
 * which never reports a scroll the program did not ask a finger for. Here the
 * scroll view is `support/scrollPhone.ts` with `insetScrolls`.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60000 })

import { type ChatPhone, TIMING, startChatPhone } from '../support/flagship.js'
import { makeNativeAnimated } from '../support/nativeAnimated.js'
import { byTestId, flatten, textOf } from '../support/phone.js'
import { type ScrollPhone, startScrollPhone } from '../support/scrollPhone.js'
import { type FakeWorklets, makeWorklets } from '../support/worklets.js'
import { hold } from '../support/expoUi.js'
import { LONG_PRESS_MS, NATIVE_GRACE_MS } from '../../flagship/longPress.js'
import { configureKeyboardDock } from '../../src/keyboard/index.js'
import { configureWorklets, requireCompiledWorklets, resetWorklets } from '../../src/worklets/index.js'

const RUNNING = 'How do I start running?'
const VIEWPORT = 600

let at: ChatPhone | undefined
let scroll: ScrollPhone | undefined
let ui: FakeWorklets | undefined

afterEach(async () => {
  scroll?.stop()
  await at?.stop()
  ui?.uninstall()
  resetWorklets()
  requireCompiledWorklets(true)
  configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
  at = undefined
  scroll = undefined
  ui = undefined
})

const chat = (): ChatPhone => at as ChatPhone

const rowIdOf = (row: FakeFabricNode): string | undefined =>
  flatten([row])
    .map(node => String(node.props['testID'] ?? ''))
    .find(each => each.startsWith('row-'))

/** How tall the phone lays a row out: a question is one bubble, a reply grows a line per 36 letters. */
const rowHeight = (row: FakeFabricNode): number | undefined => {
  const id = rowIdOf(row)
  if (id === undefined) return undefined
  if (/^row-c\d+$/.test(id)) return 64
  return 20 + 24 * Math.max(1, Math.ceil(textOf(row).length / 36))
}

/**
 * Fold Chat as on the owner's phone: the keyboard's "inset" way, and a list
 * that reports its own scrolling. With `native`, gesture-handler's and
 * Reanimated's native code are in the build (stand-ins).
 */
const open = async (options: Readonly<{ native?: boolean }> = {}): Promise<void> => {
  if (options.native === true) {
    requireCompiledWorklets(false)
    ui = makeWorklets()
    configureWorklets(ui.config)
  }
  configureKeyboardDock({ controller: true, nativeAnimated: makeNativeAnimated().native })
  at = await startChatPhone({ timing: { ...TIMING, tokensPerSecond: 60 } })
  await chat().tap('start-chat')
  await chat().advance(100)
  scroll = startScrollPhone(chat().phone.fabric, { listId: 'transcript', viewport: VIEWPORT, rowHeight, insetScrolls: true })
  await chat().advance(100)
  // The developer's numbers, held open on the chat's title.
  // Long enough for the JavaScript route, which waits a little longer where the native route is on.
  await hold(chat().phone.fabric, 'chat-title', LONG_PRESS_MS + NATIVE_GRACE_MS + 80)
  expect(chat().has('numbers')).toBe(true)
}

const replyKey = (): string => {
  const row = chat().transcriptRows().find(each => /^m\d+:/.test(each))
  if (row === undefined) throw new Error(`No reply row in ${JSON.stringify(chat().transcriptRows())}`)
  return row.split(':')[0] ?? ''
}

const askAndWaitForWords = async (): Promise<void> => {
  await chat().ask(RUNNING)
  await chat().until(() => chat().transcriptRows().some(each => /Starting to run/.test(each)))
  expect(chat().has('stop')).toBe(true)
}

type Finger = Readonly<{ x: number; y: number }>

const touchAt = (node: FakeFabricNode, where: Finger, phase: 'start' | 'move' | 'end') => {
  const point = { identifier: 0, target: node.reactTag, pageX: where.x, pageY: where.y, locationX: 0, locationY: 0, timestamp: Date.now() }
  return { ...point, touches: phase === 'end' ? [] : [point], changedTouches: [point] }
}

const TOUCH = { start: 'topTouchStart', move: 'topTouchMove', end: 'topTouchEnd' } as const

/** A finger on the view with this testID, as the phone reports it to the view it came down on. */
const finger = (id: string) => {
  const node = byTestId(chat().phone.fabric, id)
  const send = (phase: 'start' | 'move' | 'end', where: Finger): void =>
    chat().phone.fabric.emit(node, TOUCH[phase], touchAt(node, where, phase))
  return { node, send }
}

/**
 * A finger resting on a view while the reply keeps streaming, for `ms`: the
 * clock moves on in steps and each step draws the transcript again. Says how
 * many scrolls the list reported meanwhile that no finger did.
 */
const restWhileStreaming = async (id: string, ms: number, lift = true): Promise<number> => {
  const touch = finger(id)
  const toldBefore = (scroll as ScrollPhone).told.length
  touch.send('start', { x: 100, y: 300 })
  const started = Date.now()
  while (Date.now() - started < ms) await chat().advance(50)
  const told = (scroll as ScrollPhone).told.slice(toldBefore).filter(each => !each.byFinger).length
  if (lift) touch.send('end', { x: 100, y: 300 })
  await chat().advance(50)
  return told
}

/** The numbers strip's line about holds. */
const holdLine = (): string => {
  const shown = chat().shown('numbers')
  const at = shown.indexOf('hold: ')
  return at < 0 ? '' : (shown.slice(at).split('\n')[0] ?? '')
}

describe('holding a message while its reply streams, on a list that scrolls by itself', () => {
  it('holding the reply opens Copy so far and Stop, with a haptic', async () => {
    await open()
    await askAndWaitForWords()
    chat().sheet.answerWith(null)
    const hapticsBefore = chat().device.haptics.calls.length
    const told = await restWhileStreaming(`row-${replyKey()}`, LONG_PRESS_MS + 150)
    // The list did report scrolls of its own under the finger: the case the phone has.
    expect(told).toBeGreaterThan(0)
    expect(chat().sheet.shown.map(each => each.items.map(item => item.title))).toEqual([['Copy so far', 'Stop']])
    expect(chat().device.haptics.calls.slice(hapticsBefore)).toContain('impact:medium')
    expect(holdLine()).toMatch(/^hold: JS route .*last: recognised by JS after \d+ ms/)
  })

  it('holding your question opens its menu', async () => {
    await open()
    await askAndWaitForWords()
    chat().sheet.answerWith(null)
    const told = await restWhileStreaming('row-c1', LONG_PRESS_MS + 150)
    expect(told).toBeGreaterThan(0)
    expect(chat().sheet.shown.map(each => each.items.map(item => item.key))).toEqual([['copy', 'select', 'share']])
  })

  it('a finger that moves is not a hold, and the numbers say why', async () => {
    await open()
    await askAndWaitForWords()
    const touch = finger(`row-${replyKey()}`)
    touch.send('start', { x: 100, y: 300 })
    await chat().advance(150)
    touch.send('move', { x: 100, y: 325 })
    await chat().advance(LONG_PRESS_MS)
    touch.send('end', { x: 100, y: 325 })
    await chat().advance(50)
    expect(chat().sheet.shown).toHaveLength(0)
    expect(holdLine()).toMatch(/last: cancelled, moved 25 pt/)
  })

  it('a short touch is a tap: it puts the keyboard away and opens nothing', async () => {
    await open()
    await askAndWaitForWords()
    chat().device.keyboard.show(336)
    await chat().advance(50)
    const before = chat().device.keyboard.dismissCount()
    await restWhileStreaming(`row-${replyKey()}`, 150)
    expect(chat().sheet.shown).toHaveLength(0)
    expect(chat().device.keyboard.dismissCount()).toBe(before + 1)
    expect(holdLine()).toMatch(/last: a tap/)
  })
})

describe("the native recogniser (gesture-handler's long press on the row)", () => {
  const STATE = { began: 2, active: 4, end: 5, failed: 1, cancelled: 3 } as const

  /** gesture-handler's state change for the row's view, as Reanimated hands it to the worklet. */
  const gesture = (tag: number, state: number, oldState: number): void => {
    ;(ui as FakeWorklets).emit(tag, 'onGestureHandlerStateChange', { state, oldState, handlerTag: 0 })
  }

  const attachedTo = (tag: number) =>
    (ui as FakeWorklets).gestureCalls.filter(call => call[0] === 'attach' && call[2] === tag)

  it('is a long press of half a second and ten points, on the row view, which keeps its number while the reply streams', async () => {
    await open({ native: true })
    await chat().ask(RUNNING)
    await chat().until(() => chat().transcriptRows().some(each => /^m\d+:/.test(each)))
    const id = `row-${replyKey()}`
    const tag = byTestId(chat().phone.fabric, id).reactTag
    expect(byTestId(chat().phone.fabric, id).props['collapsable']).toBe(false)
    await chat().untilDone()
    // The same native view from the reply's first word to its last.
    expect(byTestId(chat().phone.fabric, id).reactTag).toBe(tag)
    const creates = (ui as FakeWorklets).gestureCalls.filter(call => call[0] === 'create' && call[1] === 'LongPressGestureHandler')
    expect(creates.length).toBeGreaterThan(0)
    expect(creates[0]?.[3]).toMatchObject({ minDurationMs: LONG_PRESS_MS, maxDist: 10 })
    expect(attachedTo(tag)).toHaveLength(1)
    expect(attachedTo(tag)[0]?.[3]).toBe(1)
    const handlerTag = attachedTo(tag)[0]?.[1]
    expect((ui as FakeWorklets).gestureCalls.some(call => call[0] === 'drop' && call[1] === handlerTag)).toBe(false)
  })

  it('recognised while the reply streams: Copy so far and Stop, a haptic, and the numbers say native', async () => {
    await open({ native: true })
    await askAndWaitForWords()
    chat().sheet.answerWith(null)
    const id = `row-${replyKey()}`
    const tag = byTestId(chat().phone.fabric, id).reactTag
    const hapticsBefore = chat().device.haptics.calls.length
    const touch = finger(id)
    gesture(tag, STATE.began, 0)
    touch.send('start', { x: 100, y: 300 })
    await chat().advance(LONG_PRESS_MS - 50)
    gesture(tag, STATE.active, STATE.began)
    await chat().advance(100)
    expect(chat().sheet.shown.map(each => each.items.map(item => item.title))).toEqual([['Copy so far', 'Stop']])
    expect(chat().device.haptics.calls.slice(hapticsBefore)).toContain('impact:medium')
    // gesture-handler cancels the JavaScript touch once it has the hold.
    chat().phone.fabric.emit(touch.node, 'topTouchCancel', touchAt(touch.node, { x: 100, y: 300 }, 'end'))
    await chat().advance(300)
    gesture(tag, STATE.end, STATE.active)
    await chat().advance(50)
    // One menu: the JavaScript route did not open a second.
    expect(chat().sheet.shown).toHaveLength(1)
    expect(holdLine()).toMatch(/^hold: native recogniser on, JS as backup .*last: recognised by native/)
  })

  it('when the native recogniser says nothing, the JavaScript route opens the menu a moment later', async () => {
    await open({ native: true })
    await askAndWaitForWords()
    chat().sheet.answerWith(null)
    await restWhileStreaming(`row-${replyKey()}`, LONG_PRESS_MS + 300)
    expect(chat().sheet.shown).toHaveLength(1)
    expect(holdLine()).toMatch(/last: recognised by JS after \d+ ms \(native said nothing\)/)
  })

  it('when gesture-handler cancels the touch to start its hold and its word never comes, the menu still opens', async () => {
    await open({ native: true })
    await askAndWaitForWords()
    chat().sheet.answerWith(null)
    const touch = finger(`row-${replyKey()}`)
    touch.send('start', { x: 100, y: 300 })
    const started = Date.now()
    while (Date.now() - started < LONG_PRESS_MS) await chat().advance(50)
    chat().phone.fabric.emit(touch.node, 'topTouchCancel', touchAt(touch.node, { x: 100, y: 300 }, 'end'))
    expect(chat().sheet.shown).toHaveLength(0)
    const cancelled = Date.now()
    while (Date.now() - cancelled < NATIVE_GRACE_MS + 100) await chat().advance(50)
    expect(chat().sheet.shown).toHaveLength(1)
    expect(holdLine()).toMatch(/recognised by JS after \d+ ms \(the phone cancelled the touch at \d+ ms, as gesture-handler does/)
  })

  it('a native long press that failed is not a hold', async () => {
    await open({ native: true })
    await askAndWaitForWords()
    const id = `row-${replyKey()}`
    const tag = byTestId(chat().phone.fabric, id).reactTag
    const touch = finger(id)
    gesture(tag, STATE.began, 0)
    touch.send('start', { x: 100, y: 300 })
    await chat().advance(100)
    touch.send('move', { x: 100, y: 330 })
    gesture(tag, STATE.failed, STATE.began)
    await chat().advance(LONG_PRESS_MS + 200)
    touch.send('end', { x: 100, y: 330 })
    await chat().advance(50)
    expect(chat().sheet.shown).toHaveLength(0)
    expect(holdLine()).toMatch(/last: cancelled, moved 30 pt; native said failed/)
  })
})
