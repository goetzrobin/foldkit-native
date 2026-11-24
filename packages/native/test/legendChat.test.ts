/**
 * The AI chat demo on the simulated phone: Legend List's core, no React.
 *
 * The pretend phone gives each message a height from the length of its text,
 * so a reply grows taller as it streams, as it would on a real screen.
 */
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Phone as Device, registerNavigation } from '../src/index.js'
import { makeDemo } from './demos/legendChat.js'
import {
  type FakeScroll,
  drawnRows,
  furthest,
  layOutList,
  makeFakeScroll,
  partsOf,
  pump,
  rowsOnScreen,
  screenTopOf,
  dragTo,
} from './support/legendPhone.js'
import { type Phone, byTestId, hasTestId, press, settle, startPhone, textOf } from './support/phone.js'

const VIEWPORT = 560

/** About 34 letters to a line, 20 points a line, and the bubble's padding and label. */
const heightOfText = (words: string): number => 12 + 20 + 20 + Math.ceil(Math.max(1, words.length) / 34) * 20

const type = async (phone: Phone, text: string): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'draft'), 'topChange', { text, eventCount: text.length })
  await settle()
}

describe.each(['ios', 'android'] as const)('the AI chat demo on Legend core (%s)', platform => {
  let phone: Phone
  let device: ReturnType<typeof Device.makeTest>
  let handle: { dispose: () => void }
  let scroll: FakeScroll
  let exit: ReturnType<typeof vi.fn<() => void>>

  const bodyOf = (rowId: string): string => {
    // The first text in a bubble is the message, the second its small label.
    const words = textOf(byTestId(phone.fabric, rowId))
    return words.replace(/(Writing…|You|Assistant)$/, '')
  }

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone(platform)
    device = Device.makeTest()
    exit = vi.fn<() => void>()
    handle = Runtime.embed(
      makeDemo(phone.surface.container, { device: { platform, osVersion: 27 }, exit }, device.layer),
    )
    await settle()
    scroll = makeFakeScroll(phone, 'chat-list', VIEWPORT, rowId => heightOfText(bodyOf(rowId)))
    await layOutList(scroll)
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  const send = async (words: string): Promise<void> => {
    await type(phone, words)
    await press(phone.fabric, 'send')
    await pump(scroll)
  }

  it('opens at the newest message', () => {
    const shown = rowsOnScreen(scroll)
    expect(shown.at(-1)!.rowId).toBe('message-seed-39')
    expect(scroll.offset).toBe(furthest(scroll))
    expect(shown.length).toBeLessThan(12)
    expect(partsOf(scroll).layer.props['opacity']).toBe(1)
  })

  it('on Send, brings the new message near the top and empties the field', async () => {
    await send('Does it hold?')
    expect(textOf(byTestId(phone.fabric, 'chat-status'))).toContain(
      '42 messages. Message 41 is held near the top.',
    )
    expect(byTestId(phone.fabric, 'draft').props['text'] ?? '').toBe('')
    // 16 points below the top of the list, and 8 of padding: Legend's `anchorOffset`.
    expect(Math.abs(screenTopOf(scroll, 'message-user-0')! - 16)).toBeLessThanOrEqual(1)
    // The reply is drawn under it and has started.
    expect(hasTestId(phone.fabric, 'message-assistant-1')).toBe(true)
    // Room was left below so the list could scroll this far.
    expect(Number(partsOf(scroll).end.props['height'])).toBeGreaterThan(200)
    expect(scroll.offset).toBe(furthest(scroll))
  })

  it('streams the reply word by word while the sent message stays put', async () => {
    await send('Does it hold?')
    const lengths: number[] = []
    const tops: number[] = []
    const rooms: number[] = []
    for (let look = 0; look < 6; look++) {
      await new Promise(resolve => setTimeout(resolve, 150))
      await pump(scroll, 6)
      lengths.push(bodyOf('message-assistant-1').length)
      tops.push(screenTopOf(scroll, 'message-user-0')!)
      rooms.push(Number(partsOf(scroll).end.props['height']))
    }
    // The reply got longer each time it was looked at ...
    for (let at = 1; at < lengths.length; at++) expect(lengths[at]!).toBeGreaterThan(lengths[at - 1]!)
    // ... the message above it never moved ...
    for (const top of tops) expect(Math.abs(top - 16)).toBeLessThanOrEqual(1)
    // ... and the room below was used up by the reply.
    expect(rooms.at(-1)!).toBeLessThan(rooms[0]!)
  })

  it('finishes the reply, and a second Send anchors the second message', async () => {
    await send('First')
    // Long enough for every word: about 100 words at 45 ms.
    for (let wait = 0; wait < 40 && textOf(byTestId(phone.fabric, 'message-assistant-1')).endsWith('Writing…'); wait++) {
      await new Promise(resolve => setTimeout(resolve, 300))
      await pump(scroll, 4)
    }
    expect(textOf(byTestId(phone.fabric, 'message-assistant-1'))).toMatch(/Assistant$/)
    expect(bodyOf('message-assistant-1')).toContain('You asked: "First".')
    await send('Second')
    expect(textOf(byTestId(phone.fabric, 'chat-status'))).toContain('Message 43 is held near the top.')
    expect(Math.abs(screenTopOf(scroll, 'message-user-2')! - 16)).toBeLessThanOrEqual(1)
  }, 30000)

  it('adds older messages above without moving what is on screen', async () => {
    await dragTo(scroll, scroll.offset - 900)
    const watched = rowsOnScreen(scroll)[1]!.rowId
    const before = screenTopOf(scroll, watched)!
    await press(phone.fabric, 'load-older')
    await pump(scroll)
    expect(textOf(byTestId(phone.fabric, 'chat-status'))).toContain('50 messages.')
    expect(Math.abs(screenTopOf(scroll, watched)! - before)).toBeLessThanOrEqual(1)
  })

  it('goes back to the newest message on "Go to latest"', async () => {
    await dragTo(scroll, scroll.offset - 900)
    expect(rowsOnScreen(scroll).some(row => row.rowId === 'message-seed-39')).toBe(false)
    await press(phone.fabric, 'latest')
    // The scroll is animated: the pretend phone arrives at once.
    await pump(scroll)
    expect(rowsOnScreen(scroll).at(-1)!.rowId).toBe('message-seed-39')
    expect(scroll.offset).toBe(furthest(scroll))
  })

  it('lifts the composer by the keyboard and stays at the newest message', async () => {
    expect(byTestId(phone.fabric, 'composer').props['marginBottom'] ?? 0).toBe(0)
    device.keyboard.show(300)
    await settle()
    expect(byTestId(phone.fabric, 'composer').props['marginBottom']).toBe(300)
    // The list is 300 points shorter now, as flex layout would make it.
    scroll.viewport = VIEWPORT - 300
    await layOutList(scroll)
    expect(scroll.offset).toBe(furthest(scroll))
    expect(rowsOnScreen(scroll).at(-1)!.rowId).toBe('message-seed-39')
    device.keyboard.hide()
    await settle()
    expect(byTestId(phone.fabric, 'composer').props['marginBottom'] ?? 0).toBe(0)
  })

  it('keeps the number of row views small', () => {
    expect(drawnRows(scroll).length).toBeLessThan(16)
  })

  it('leaves the demo on Exit', async () => {
    await press(phone.fabric, 'exit')
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
