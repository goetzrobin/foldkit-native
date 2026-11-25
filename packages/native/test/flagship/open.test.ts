/**
 * Opening a chat that exists already, on the simulated phone, in every way
 * the owner can: by tapping its row and from search, with the keyboard up and
 * down, with replies of every kind (plain, reasoning, a tool, stopped,
 * failed), while a reply is still being written, and after a restart (a new
 * program over the same pretend disk).
 *
 * The third phone test crashed here: after a restart, the client numbered
 * questions from `c1` again, so a question asked in an old chat had the same
 * client id as the chat's first one. Two rows then had one key, and Foldkit
 * stopped the program ("duplicate h.submodel slotId"). The chat kept the two
 * on disk, so it crashed again each time it was opened.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 120000 })

import { memoryDisk } from '../../src/aiChat/index.js'
import { type ChatPhone, startChatPhone } from '../support/flagship.js'
import { byTestId } from '../support/phone.js'

const RUNNING = 'How do I start running?'
const TRAVEL = 'Should I take the train or drive to the coast? Think it through.'
const WEATHER = 'What is the weather in Lisbon tomorrow?'
const CODE = 'Write a debounce function in TypeScript.'

let at: ChatPhone
let crashes: Array<string> = []

afterEach(async () => {
  vi.restoreAllMocks()
  await at.stop()
})

/** Records Foldkit's crash line, which it writes before it shows the crash screen. */
const watchForCrashes = (): void => {
  crashes = []
  const original = console.error
  vi.spyOn(console, 'error').mockImplementation((...args: Array<unknown>) => {
    const line = args.map(String).join(' ')
    if (line.includes('Application crash')) crashes.push(line.slice(0, 300))
    else original(...args)
  })
}

const backToList = async (): Promise<void> => {
  at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
  await at.advance(400)
}

const keysOf = (): ReadonlyArray<string> => at.transcriptRows().map(row => row.split(':')[0] ?? '')

/** The chat screen is up, with no crash, and every row has a key of its own. */
const expectOpenChat = (rowCount?: number): void => {
  expect(crashes).toEqual([])
  expect(at.screens()).toContain('screen-chat')
  const keys = keysOf()
  expect(new Set(keys).size).toBe(keys.length)
  if (rowCount !== undefined) expect(keys).toHaveLength(rowCount)
}

/** One chat with replies of every kind: plain, reasoning, a tool, stopped, failed. */
const makeChatOfEveryKind = async (): Promise<void> => {
  await at.tap('start-chat')
  await at.advance(100)
  await at.ask(RUNNING)
  await at.untilDone()
  await at.ask(TRAVEL)
  await at.untilDone()
  await at.ask(WEATHER)
  await at.untilDone()
  await at.ask(CODE)
  await at.advance(900)
  await at.tap('stop')
  await at.advance(600)
  at.server.setChaos({ failMidStream: true })
  await at.ask('And how often should I rest?')
  await at.untilDone()
  at.server.setChaos({ failMidStream: false })
}

describe('opening a chat that exists already', () => {
  it('by its row and from search, keyboard up or down, with replies of every kind', async () => {
    watchForCrashes()
    at = await startChatPhone({ now: Date.now() })
    await makeChatOfEveryKind()
    expectOpenChat(10)
    await backToList()

    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(10)
    await backToList()

    at.device.keyboard.show(336)
    await at.advance(100)
    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(10)
    await backToList()
    at.device.keyboard.hide()
    await at.advance(100)

    await at.type('search', 'running')
    await at.advance(100)
    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(10)
  })

  it('while its reply is still being written, and back to it again', async () => {
    watchForCrashes()
    at = await startChatPhone({ now: Date.now() })
    await at.tap('start-chat')
    await at.ask(RUNNING)
    await at.untilDone()
    await at.ask(TRAVEL)
    await at.advance(700)
    await backToList()
    await at.tap('chat-c1')
    await at.advance(200)
    expectOpenChat(4)
    await at.untilDone()
    expectOpenChat(4)
  })

  it('after a restart: opens, takes a new question, and opens again after another restart', async () => {
    watchForCrashes()
    const disk = memoryDisk()
    at = await startChatPhone({ now: Date.now(), disk })
    await makeChatOfEveryKind()
    await backToList()
    await at.stop()

    at = await startChatPhone({ now: Date.now(), disk })
    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(10)
    await at.ask('One more thing about running.')
    // The new question is on screen at once, as the newest row.
    expect(at.transcriptRows().at(-1)).toMatch(/One more thing about running/)
    await at.untilDone()
    expectOpenChat(12)
    // Asking twice more in this launch, still one key per row.
    await at.ask(RUNNING)
    await at.untilDone()
    expectOpenChat(14)
    await backToList()
    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(14)
    await backToList()
    await at.stop()

    at = await startChatPhone({ now: Date.now(), disk })
    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(14)
  })

  it('a chat already saved with two questions under one client id (the owner’s phone) still opens', async () => {
    watchForCrashes()
    const disk = memoryDisk()
    at = await startChatPhone({ now: Date.now(), disk })
    await at.tap('start-chat')
    await at.ask(RUNNING)
    await at.untilDone()
    await backToList()
    await at.stop()
    // What the old client wrote: a second question with the first one's client id.
    for (const [name, text] of disk.entries) {
      if (!name.includes('c1')) continue
      const saved = JSON.parse(text) as { messages: Array<Record<string, unknown>> }
      const question = saved.messages[0]
      const reply = saved.messages[1]
      if (question === undefined || reply === undefined) continue
      saved.messages.push({ ...question, id: 'm90' }, { ...reply, id: 'm91' })
      disk.entries.set(name, JSON.stringify(saved))
    }

    at = await startChatPhone({ now: Date.now(), disk })
    await at.tap('chat-c1')
    await at.advance(400)
    expectOpenChat(4)
  })
})
