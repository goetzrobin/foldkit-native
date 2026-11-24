/**
 * The two chat demos on the simulated phone: sending, replies, the streamed
 * answer, the scroll-to-end button and the composer above the keyboard.
 *
 * The demos open with the keyboard set to "inset", which on this phone is the
 * same as the composer "following" the keyboard, which on this
 * simulated phone means the eased fallback. `chatDock.test.ts` goes through
 * every way of docking the composer.
 *
 * As in `chatList.test.ts`, the test plays the phone's part for layout: it
 * says how tall the list and its rows are and where the list has scrolled.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Keyboard } from '../src/device/index.js'
import { registerNavigation } from '../src/index.js'
import { makeDemo as makeAiChat } from './demos/aiChat.js'
import { makeDemo as makeChat } from './demos/chat.js'
import {
  type Phone,
  byTestId,
  flatten,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

const VIEWPORT = 600
const ROW = 90

let phone: Phone
let handle: { dispose: () => void }
let keyboard: ReturnType<typeof Keyboard.makeTest>
let exits = 0

const env = {
  device: { platform: 'ios', osVersion: 27 },
  exit: () => {
    exits += 1
  },
}

beforeEach(() => {
  exits = 0
  registerNavigation()
  phone = startPhone()
  keyboard = Keyboard.makeTest()
})

afterEach(async () => {
  handle.dispose()
  await settle()
  phone.surface.dispose()
})

const canvasOf = (): FakeFabricNode => {
  const canvas = byTestId(phone.fabric, 'messages').children.at(-1)?.children[0]
  if (canvas === undefined) throw new Error('The list has no canvas')
  return canvas
}

/** The phone says every row is 90 points tall, or as tall as `heightOf` says. */
const layOutRows = async (heightOf: (wrapper: FakeFabricNode) => number = () => ROW) => {
  for (let round = 0; round < 3; round++) {
    for (const wrapper of canvasOf().children.slice(1)) {
      phone.fabric.emit(wrapper, 'topLayout', {
        layout: { x: 0, y: 0, width: 320, height: heightOf(wrapper) },
      })
    }
    await settle()
  }
}

const layOutList = async (height = VIEWPORT): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'messages'), 'topLayout', {
    layout: { x: 0, y: 0, width: 320, height },
  })
  await settle()
}

const scrollTo = async (y: number): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'messages'), 'topScroll', {
    contentOffset: { x: 0, y },
    layoutMeasurement: { width: 320, height: VIEWPORT },
    contentSize: { width: 320, height: Number(canvasOf().props['height']) },
  })
  await settle()
}

const scrolls = (): ReadonlyArray<ReadonlyArray<unknown>> =>
  phone.fabric.commands.filter(command => command.name === 'scrollTo').map(command => command.args)

const type = async (words: string, eventCount = 1): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'draft'), 'topChange', { text: words, eventCount })
  await settle()
}

const status = (): string => textOf(byTestId(phone.fabric, 'status'))

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Waits until `isTrue` holds, for a few seconds at most. */
const until = async (isTrue: () => boolean, ms = 12000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!isTrue() && Date.now() < deadline) await wait(25)
}

/** The simple dock's three views: the caller's, the keyboard padding, the safe area. */
const dockParts = () => {
  const dock = byTestId(phone.fabric, 'dock')
  const padding = dock.children[0]
  const safeArea = padding?.children[0]
  if (padding === undefined || safeArea === undefined) throw new Error('The dock is not built')
  return { dock, padding, safeArea }
}

describe('the chat demo', () => {
  beforeEach(async () => {
    handle = Runtime.embed(
      makeChat(phone.surface.container, env, keyboard.layer, {
        replyDelayMs: 150,
        incomingDelayMs: 150,
      }),
    )
    await settle()
  })

  it('opens at the newest message', async () => {
    expect(status()).toBe('20 messages. At the end: yes.')
    expect(hasTestId(phone.fabric, 'message-19')).toBe(true)
    await layOutList()
    await layOutRows()
    expect(scrolls().at(-1)).toEqual([0, 20 * ROW - VIEWPORT, false])
    expect(canvasOf().props['opacity']).toBe(1)
    expect(hasTestId(phone.fabric, 'scroll-to-end')).toBe(false)
  })

  it('sends what was typed, clears the field, and gets a reply', async () => {
    await layOutList()
    await layOutRows()
    await type('Is anyone there?')
    await press(phone.fabric, 'send')
    expect(textOf(byTestId(phone.fabric, 'message-20'))).toContain('Is anyone there?')
    expect(textOf(byTestId(phone.fabric, 'message-20'))).toContain('You')
    expect(byTestId(phone.fabric, 'draft').props['text']).toBe('')
    await until(() => hasTestId(phone.fabric, 'message-21'))
    await settle()
    expect(textOf(byTestId(phone.fabric, 'message-21'))).toContain('"Is anyone there?"')
    expect(textOf(byTestId(phone.fabric, 'message-21'))).toContain('Alex')
    expect(status()).toBe('22 messages. At the end: yes.')
    // The list followed both new rows to the end.
    await layOutRows()
    expect(scrolls().at(-1)?.[1]).toBe(22 * ROW - VIEWPORT)
  })

  it('sends from the Return key as well', async () => {
    await type('From the keyboard')
    phone.fabric.emit(byTestId(phone.fabric, 'draft'), 'topSubmitEditing', {
      text: 'From the keyboard',
    })
    await settle()
    expect(textOf(byTestId(phone.fabric, 'message-20'))).toContain('From the keyboard')
  })

  it('does not send an empty message', async () => {
    await type('   ')
    await press(phone.fabric, 'send')
    expect(status()).toBe('20 messages. At the end: yes.')
  })

  it('leaves a user who scrolled up alone when a message arrives, and offers a way back', async () => {
    await layOutList()
    await layOutRows()
    await scrollTo(20 * ROW - VIEWPORT)
    await scrollTo(300)
    expect(status()).toBe('20 messages. At the end: no.')
    expect(hasTestId(phone.fabric, 'scroll-to-end')).toBe(true)
    await layOutRows()

    const before = scrolls().length
    await press(phone.fabric, 'message-me')
    await until(() => status().startsWith('21 messages'))
    await settle()
    await layOutRows()
    expect(status()).toBe('21 messages. At the end: no.')
    expect(scrolls().length).toBe(before)

    await press(phone.fabric, 'scroll-to-end')
    expect(scrolls().at(-1)?.[2]).toBe(true)
    // The new message is seen for the first time on the way and measured.
    await layOutRows()
    expect(scrolls().at(-1)).toEqual([0, 21 * ROW - VIEWPORT, true])
    expect(status()).toBe('21 messages. At the end: yes.')
    expect(hasTestId(phone.fabric, 'scroll-to-end')).toBe(false)
  })

  it('goes to the end when the user sends from further up', async () => {
    await layOutList()
    await layOutRows()
    await scrollTo(20 * ROW - VIEWPORT)
    await scrollTo(300)
    await layOutRows()
    await type('Sent from up here')
    await press(phone.fabric, 'send')
    expect(status()).toContain('At the end: yes.')
    expect(hasTestId(phone.fabric, 'message-20')).toBe(true)
    // The reply arrives as well, and the list is at the end of both.
    await until(() => status().startsWith('22 messages'))
    await settle()
    await layOutRows()
    expect(scrolls().at(-1)?.[1]).toBe(22 * ROW - VIEWPORT)
    expect(status()).toBe('22 messages. At the end: yes.')
  })

  it('in "simple" mode, pads the composer by the keyboard, and by the safe area when the keyboard is down', async () => {
    // The demo opens in "inset", then comes "following". `chatInset.test.ts`
    // and `chatDock.test.ts` cover those.
    await press(phone.fabric, 'dock-mode')
    await press(phone.fabric, 'dock-mode')
    expect(dockParts().padding.props['paddingBottom']).toBe(0)
    expect(dockParts().safeArea.viewName).toBe('RNSSafeAreaView')
    expect(dockParts().safeArea.props['edges']).toEqual({
      top: false,
      right: false,
      bottom: true,
      left: false,
    })
    // As tall as the composer, not as tall as the screen.
    expect(dockParts().safeArea.props['flex']).toBe(0)

    keyboard.show(336)
    await settle()
    expect(dockParts().padding.props['paddingBottom']).toBe(336)
    expect((dockParts().safeArea.props['edges'] as { bottom: boolean }).bottom).toBe(false)

    keyboard.hide()
    await settle()
    expect(dockParts().padding.props['paddingBottom']).toBe(0)
    expect((dockParts().safeArea.props['edges'] as { bottom: boolean }).bottom).toBe(true)
  })

  it('in "simple" mode, puts the keyboard away when the user drags the list, only if it is up', async () => {
    await press(phone.fabric, 'dock-mode')
    await press(phone.fabric, 'dock-mode')
    // Switching the dock put the keyboard away once already.
    const before = keyboard.dismissCount()
    phone.fabric.emit(byTestId(phone.fabric, 'messages'), 'topScrollBeginDrag', {})
    await settle()
    expect(keyboard.dismissCount()).toBe(before)
    keyboard.show(336)
    await settle()
    phone.fabric.emit(byTestId(phone.fabric, 'messages'), 'topScrollBeginDrag', {})
    await settle()
    expect(keyboard.dismissCount()).toBe(before + 1)
    expect(dockParts().padding.props['paddingBottom']).toBe(0)
  })

  it('keeps the screen clear of the top but leaves the bottom to the dock', () => {
    const area = flatten(phone.fabric.committed).find(
      node =>
        node.viewName === 'RNSSafeAreaView' &&
        (node.props['edges'] as { top?: boolean } | undefined)?.top === true,
    )
    expect(area?.props['edges']).toEqual({ top: true, right: true, bottom: false, left: true })
  })

  it('leaves two messages for "Short chat" and brings the rest back', async () => {
    await press(phone.fabric, 'short-chat')
    expect(status()).toBe('2 messages. At the end: yes.')
    const content = byTestId(phone.fabric, 'messages').children.at(-1)
    expect(content?.props['justifyContent']).toBe('flex-end')
    await press(phone.fabric, 'long-chat')
    expect(status()).toBe('20 messages. At the end: yes.')
  })

  it('leaves through the Exit button', async () => {
    await press(phone.fabric, 'exit')
    expect(exits).toBe(1)
  })
})

describe('the AI chat demo', () => {
  beforeEach(async () => {
    handle = Runtime.embed(
      makeAiChat(phone.surface.container, env, keyboard.layer, { thinkingMs: 200, wordMs: 4 }),
    )
    await settle()
  })

  const answer = (): string => textOf(byTestId(phone.fabric, 'message-9'))

  it('opens at the newest message with no answer on its way', async () => {
    expect(status()).toBe('No answer on its way. At the end: yes.')
    await layOutList()
    await layOutRows()
    expect(scrolls().at(-1)).toEqual([0, 8 * ROW - VIEWPORT, false])
  })

  it('shows the question and "Thinking...", then writes the answer word by word', async () => {
    await type('Why is the sky blue?')
    await press(phone.fabric, 'send')
    expect(textOf(byTestId(phone.fabric, 'message-8'))).toBe('Why is the sky blue?')
    expect(answer()).toContain('Thinking...')
    expect(status()).toContain('Thinking')
    expect(byTestId(phone.fabric, 'draft').props['text']).toBe('')
    // The keyboard is put away so the answer has the whole screen.
    expect(keyboard.dismissCount()).toBe(1)

    await until(() => status().startsWith('Writing'))
    await until(() => answer().includes('You asked'))
    const early = answer()
    expect(early).toContain('Writing...')
    expect(early).not.toContain('That is the whole answer.')

    await until(() => status().startsWith('No answer'))
    await settle()
    const whole = answer()
    expect(whole.startsWith('You asked: "Why is the sky blue?"')).toBe(true)
    expect(whole.endsWith('That is the whole answer.')).toBe(true)
    expect(whole).not.toContain('Writing...')
    expect(whole.length).toBeGreaterThan(early.length)
    // The words arrived in order: what was on screen early is how it starts.
    expect(whole.startsWith(early.replace('Writing...', ''))).toBe(true)
  }, 30000)

  it('stops ticking once the answer is whole', async () => {
    await press(phone.fabric, 'sample')
    await until(() => status().startsWith('No answer'))
    await settle()
    const commits = phone.fabric.calls.completeRoot
    await wait(200)
    expect(phone.fabric.calls.completeRoot).toBe(commits)
  }, 30000)

  it('scrolls the question to the top with room for the answer under it', async () => {
    await layOutList()
    await layOutRows()
    await scrollTo(8 * ROW - VIEWPORT)
    await press(phone.fabric, 'sample')
    // The question is 60 points tall and "Thinking..." is 50.
    const heightOf = (wrapper: FakeFabricNode): number => {
      const ids = flatten([wrapper]).map(node => node.props['testID'])
      if (ids.includes('message-8')) return 60
      if (ids.includes('message-9')) return 50
      return ROW
    }
    await layOutRows(heightOf)
    // The end of the list is where the question is 16 points from the top.
    const questionStart = 8 * ROW
    expect(scrolls().at(-1)).toEqual([0, questionStart - 16, true])
    expect(canvasOf().props['height']).toBe(questionStart - 16 + VIEWPORT)
    expect(status()).toContain('At the end: yes.')
  })

  it('shows the scroll-to-end button once the answer runs off the screen', async () => {
    await layOutList()
    await layOutRows()
    await scrollTo(8 * ROW - VIEWPORT)
    await press(phone.fabric, 'sample')
    const heightOf =
      (answerHeight: number) =>
      (wrapper: FakeFabricNode): number => {
        const ids = flatten([wrapper]).map(node => node.props['testID'])
        if (ids.includes('message-8')) return 60
        if (ids.includes('message-9')) return answerHeight
        return ROW
      }
    await layOutRows(heightOf(50))
    await scrollTo(8 * ROW - 16)
    const before = scrolls().length
    expect(hasTestId(phone.fabric, 'scroll-to-end')).toBe(false)

    // The answer grows to twice the height of the screen.
    await layOutRows(heightOf(1200))
    expect(status()).toContain('At the end: no.')
    expect(hasTestId(phone.fabric, 'scroll-to-end')).toBe(true)
    // The list was not moved: the question is still at the top.
    expect(scrolls().length).toBe(before)

    await press(phone.fabric, 'scroll-to-end')
    expect(scrolls().at(-1)).toEqual([0, 8 * ROW + 60 + 1200 - VIEWPORT, true])
    expect(hasTestId(phone.fabric, 'scroll-to-end')).toBe(false)
  }, 30000)

  it('finishes the answer at once when a second question is sent', async () => {
    await press(phone.fabric, 'sample')
    await until(() => answer().includes('You asked'))
    await press(phone.fabric, 'sample')
    expect(answer().endsWith('That is the whole answer.')).toBe(true)
    expect(textOf(byTestId(phone.fabric, 'message-10'))).toContain('What should I look for')
    expect(textOf(byTestId(phone.fabric, 'message-11'))).toContain('Thinking...')
    await until(() => status().startsWith('No answer'))
    await settle()
    expect(textOf(byTestId(phone.fabric, 'message-11')).endsWith('That is the whole answer.')).toBe(
      true,
    )
  }, 30000)

  it('leaves through the Exit button', async () => {
    await press(phone.fabric, 'exit')
    expect(exits).toBe(1)
  })
})
