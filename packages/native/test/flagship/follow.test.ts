/**
 * Fold Chat's transcript while a reply streams, on a simulated phone whose
 * scroll view behaves as UIKit's does (see `support/scrollPhone.ts`): the
 * keyboard in its "inset" way, rows that grow as their text arrives, and a
 * scroll view that puts itself back inside its range when that shrinks.
 *
 * - The round button takes the list to the end and the list then follows
 *   the reply, until a finger drags it up. Scrolling back to the end by
 *   hand follows again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 90000 })

import { type ChatPhone, breathe, startChatPhone } from '../support/flagship.js'
import { makeNativeAnimated } from '../support/nativeAnimated.js'
import { byTestId, flatten, textOf } from '../support/phone.js'
import { type ScrollPhone, startScrollPhone } from '../support/scrollPhone.js'
import { DOCK_CONTENT_ID } from '../../src/keyboard/dock.js'
import { configureKeyboardDock } from '../../src/keyboard/index.js'
import { listNumbers } from '../../src/list/index.js'

const RUNNING = 'How do I start running?'
const VIEWPORT = 700
const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
const COMPOSER = 56
const HOME_INDICATOR = 34

let at: ChatPhone
let phone: ScrollPhone

afterEach(async () => {
  phone?.stop()
  await at.stop()
  configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
})

/** How tall the phone lays a row out: your question is one bubble, a reply grows with its text. */
const rowHeight = (row: ReturnType<typeof byTestId>): number | undefined => {
  const ids = flatten([row]).map(node => String(node.props['testID'] ?? ''))
  const id = ids.find(each => each.startsWith('row-'))
  if (id === undefined) return undefined
  if (/^row-c\d+$/.test(id)) return 64
  const words = textOf(row).length
  return 20 + 24 * Math.max(1, Math.ceil(words / 36))
}

/** A new chat with the keyboard's "inset" way, its first question answered. */
const openChat = async (): Promise<void> => {
  configureKeyboardDock({ controller: true, nativeAnimated: makeNativeAnimated().native })
  at = await startChatPhone()
  const fabric = at.phone.fabric
  fabric.frames.set('View', WINDOW)
  fabric.frames.set(DOCK_CONTENT_ID, { x: 0, y: WINDOW.height - HOME_INDICATOR - COMPOSER, width: 402, height: COMPOSER })
  await at.tap('start-chat')
  await at.advance(100)
  phone = startScrollPhone(fabric, { listId: 'transcript', viewport: VIEWPORT, rowHeight })
  const content = flatten(fabric.committed).find(node => node.props['nativeID'] === DOCK_CONTENT_ID)
  if (content === undefined) throw new Error('No composer dock: the inset way is off')
  fabric.emit(content, 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER } })
  await at.advance(100)
  await at.ask(RUNNING)
  await at.untilDone()
}

/** The reply being written, as the phone has it now. */
const growing = (): string => at.transcriptRows().at(-1) ?? ''

/** Runs the clock until the reply being written has run well past the bottom of the screen. */
const untilRunsOff = async (): Promise<void> => {
  await at.until(() => /Starting to run/.test(growing()))
  await at.until(() => phone.furthest() > phone.phone.offset + 150)
  expect(at.has('stop')).toBe(true)
}

describe('following the reply', () => {
  /** Whether the list is at its end, as the phone has it. */
  const atEnd = (): boolean => Math.abs(phone.phone.offset - phone.furthest()) < 1

  it('the round button goes to the end and then follows the reply, until a finger drags up', async () => {
    await openChat()
    await at.ask(RUNNING)
    await untilRunsOff()
    expect(at.has('scroll-to-end')).toBe(true)
    await at.tap('scroll-to-end')
    await at.advance(100)
    expect(atEnd()).toBe(true)

    // The reply keeps growing, and the list keeps up with it.
    const grownFrom = phone.furthest()
    for (let step = 0; step < 6; step++) {
      await at.advance(150)
      expect(atEnd()).toBe(true)
    }
    expect(phone.furthest()).toBeGreaterThan(grownFrom)
    expect(at.has('scroll-to-end')).toBe(false)
    expect(listNumbers('transcript')?.isFollowing).toBe(true)

    // A finger drags the list up: it stays where the finger left it.
    phone.drag(phone.phone.offset - 300)
    await breathe(120)
    await at.advance(50)
    const left = phone.phone.offset
    await at.advance(600)
    expect(at.has('stop')).toBe(true)
    expect(phone.phone.offset).toBe(left)
    expect(phone.furthest()).toBeGreaterThan(left + 300)
    expect(listNumbers('transcript')?.isFollowing).toBe(false)
    expect(at.has('scroll-to-end')).toBe(true)
  })

  it('scrolling back to the end by hand while the reply streams follows it again', async () => {
    await openChat()
    await at.ask(RUNNING)
    await untilRunsOff()
    expect(listNumbers('transcript')?.isFollowing).toBe(false)
    phone.drag(phone.furthest())
    // The finger lets go with no fling: the phone says nothing more.
    await breathe(120)
    await at.advance(50)
    expect(listNumbers('transcript')?.isFollowing).toBe(true)
    const grownFrom = phone.furthest()
    for (let step = 0; step < 4; step++) {
      await at.advance(150)
      expect(atEnd()).toBe(true)
    }
    expect(phone.furthest()).toBeGreaterThan(grownFrom)
  })

  it('a new question stops following: it is held at the top again', async () => {
    await openChat()
    // The list opened at its end and follows; the next question is pinned all the same.
    await at.ask(RUNNING)
    await at.until(() => /Starting to run/.test(growing()))
    await at.advance(200)
    expect(listNumbers('transcript')?.isFollowing).toBe(false)
    const pinned = phone.topOf('row-c2')
    await untilRunsOff()
    expect(Math.abs(phone.topOf('row-c2') - pinned)).toBeLessThanOrEqual(0.5)
  })
})
