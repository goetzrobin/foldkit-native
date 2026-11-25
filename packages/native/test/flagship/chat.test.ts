/**
 * Fold Chat's chat screen on the simulated phone: a person types, sends,
 * stops, regenerates, holds a message, and reads the screen. The pretend
 * server, the NDJSON cable and the client run for real; Effect's TestClock
 * decides when each token is due.
 *
 * The simulated phone draws no pixels, so these tests check what the
 * program asks the phone to show and do, not how it looks.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60000 })

import { type ChatPhone, breathe, startChatPhone } from '../support/flagship.js'
import { hold } from '../support/expoUi.js'
import { byTestId } from '../support/phone.js'
import { LONG_PRESS_MS } from '../../flagship/longPress.js'
import { listNumbers } from '../../src/list/index.js'

const RUNNING = 'How do I start running?'
const TRAVEL = 'Should I take the train or drive to the coast? Think it through.'
const WEATHER = 'What is the weather in Lisbon tomorrow?'

let at: ChatPhone

afterEach(async () => {
  await at.stop()
})

/** Opens a new chat from the list's empty state. */
const newChat = async (): Promise<void> => {
  await at.tap('start-chat')
  await at.advance(100)
}

const replyKey = (): string => {
  const row = at.transcriptRows().find(each => /^m\d+:/.test(each))
  if (row === undefined) throw new Error(`No reply row in ${JSON.stringify(at.transcriptRows())}`)
  return row.split(':')[0] ?? ''
}

const lastReplyKey = (): string => {
  const rows = at.transcriptRows().filter(each => /^m\d+:/.test(each))
  return rows.at(-1)?.split(':')[0] ?? ''
}

describe('sending a message and reading the reply', () => {
  it('shows the question at once, Thinking, then the reply word by word, with haptics on send and first word', async () => {
    at = await startChatPhone()
    await newChat()
    expect(at.screens()).toEqual(['screen-chats', 'screen-chat'])
    expect(at.has('empty-chat')).toBe(true)

    const listTag = byTestId(at.phone.fabric, 'transcript').reactTag
    await at.type('draft', RUNNING)
    expect(at.has('send')).toBe(true)
    await at.tap('send')
    // The question is on screen before the server has answered anything.
    expect(at.transcriptRows()).toEqual([`c1: ${RUNNING}`])
    expect(at.device.haptics.calls).toContain('impact:light')
    expect(at.fieldText('draft')).toBe('')

    await at.until(() => at.has('thinking'))
    expect(at.has('thinking')).toBe(true)
    // The new chat got its id from the server meanwhile. The list was not
    // made again for it: same native view, so nothing jumped.
    expect(byTestId(at.phone.fabric, 'transcript').reactTag).toBe(listTag)
    expect(at.has('stop')).toBe(true)
    expect(at.has('send')).toBe(false)

    await at.until(() => at.transcriptRows().some(each => /Starting to run/.test(each)))
    const partial = at.transcriptRows().find(each => each.startsWith(replyKey()))
    expect(partial).toMatch(/Starting to run/)
    expect(at.has('thinking')).toBe(false)
    expect(at.device.haptics.calls.filter(each => each === 'selection')).toHaveLength(1)

    await at.untilDone()
    const whole = at.transcriptRows().find(each => each.startsWith(replyKey())) ?? ''
    expect(whole).toMatch(/Couch to 5K/)
    // One tick for the first words of the reply, not one per batch.
    expect(at.device.haptics.calls.filter(each => each === 'selection')).toHaveLength(1)
    expect(at.has('stop')).toBe(false)
    expect(at.has('mic')).toBe(true)
    // The question keeps the row it was drawn in: one key from sending to saved.
    expect(at.transcriptRows()[0]).toBe(`c1: ${RUNNING}`)
    // The new chat got its title from the question.
    expect(at.shown('chat-title')).toBe('How do I start running')
  })

  it('sends from a suggestion in an empty chat', async () => {
    at = await startChatPhone()
    await newChat()
    await at.tap('suggestion-weather')
    expect(at.transcriptRows()[0]).toBe(`c1: ${WEATHER}`)
    expect(at.has('empty-chat')).toBe(false)
  })

  it('pins a new question near the top: the list scrolls to its row less the offset', async () => {
    at = await startChatPhone({ timing: { firstTokenMs: 200, tokensPerSecond: 2000, jitter: 0, pauseChance: 0, pauseMs: 0, toolMs: 100, latencyMs: 50 } })
    await newChat()
    await at.ask('Write a debounce function in TypeScript.')
    await at.untilDone()

    const fabric = at.phone.fabric
    const canvas = (): FakeFabricNode => {
      const found = byTestId(fabric, 'transcript').children.at(-1)?.children[0]
      if (found === undefined) throw new Error('no canvas')
      return found
    }
    const layOut = async () => {
      fabric.emit(byTestId(fabric, 'transcript'), 'topLayout', { layout: { x: 0, y: 0, width: 390, height: 600 } })
      for (let round = 0; round < 3; round++) {
        for (const wrapper of canvas().children.slice(1)) {
          fabric.emit(wrapper, 'topLayout', { layout: { x: 0, y: 0, width: 390, height: 60 } })
        }
        await breathe(30)
      }
    }
    // Leave the chat and open it again from the list.
    fabric.emit(byTestId(fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
    await at.advance(100)
    expect(at.screens()).toEqual(['screen-chats'])
    await at.tap('chat-c1')
    await at.advance(300)
    await layOut()
    // An old chat opens at its end, with no blank space under it.
    expect(listNumbers('transcript')?.blankSpace).toBe(0)
    await at.ask(RUNNING)
    await at.advance(300)
    await layOut()
    await at.advance(100)
    await layOut()
    const numbers = listNumbers('transcript')
    // Rows of 60 in a list 600 tall. Blank space is left under the reply so
    // that the NEW question (not the first) can sit 16 points from the top:
    // 600 - 16 - 60 (the question) - 60 (the reply so far) = 464.
    expect(numbers?.rows).toBe(240)
    expect(numbers?.blankSpace).toBe(464)
    // And the list glides to the end of that space, which puts the question there.
    expect(numbers?.lastScroll?.target).toBe(240 + 464 - 600)
  })
})

describe('a new chat and its keyboard', () => {
  /** Every focus and blur the program sends to a text field, by the field's tag. */
  const fieldCommands = (): ReadonlyArray<string> =>
    at.phone.fabric.commands
      .filter(each => each.name === 'focus' || each.name === 'blur')
      .map(each => `${each.name} ${each.node?.reactTag}`)

  it('raises the keyboard once, after the push, and keeps one text field for the life of the screen', async () => {
    at = await startChatPhone()
    const fabric = at.phone.fabric
    const created: Array<number> = []
    const createNode = fabric.createNode.bind(fabric)
    fabric.createNode = ((tag: number, viewName: string, ...rest: [never, never, never]) => {
      if (viewName === 'TextInput') created.push(tag)
      return createNode(tag, viewName, ...rest)
    }) as typeof fabric.createNode
    await at.tap('start-chat')
    await at.advance(100)
    const field = byTestId(fabric, 'draft').reactTag
    // Not focused by the field itself as it is made, in the middle of the push.
    expect(byTestId(fabric, 'draft').props['autoFocus']).not.toBe(true)
    expect(fieldCommands()).toEqual([])
    // The push has finished: the phone says the screen appeared.
    fabric.emit(byTestId(fabric, 'screen-chat'), 'topAppear', {})
    await at.advance(50)
    expect(fieldCommands()).toEqual([`focus ${field}`])
    // The fallback timer that follows (on the program's own clock) does not focus it a second time.
    await breathe(800)
    await at.advance(50)
    expect(fieldCommands()).toEqual([`focus ${field}`])

    at.device.keyboard.show(336)
    await at.advance(100)
    await at.ask(RUNNING)
    await at.untilDone()
    // Typing, the new chat getting its id and the whole reply: still the one field.
    expect(byTestId(fabric, 'draft').reactTag).toBe(field)
    expect(created.filter(tag => tag === field)).toHaveLength(created.length)
  })

  it('focuses after a while when the phone never says the screen appeared', async () => {
    at = await startChatPhone()
    await at.tap('start-chat')
    await at.advance(100)
    expect(fieldCommands()).toEqual([])
    // The program's own clock, not the server's.
    await breathe(800)
    await at.advance(50)
    expect(fieldCommands()).toEqual([`focus ${byTestId(at.phone.fabric, 'draft').reactTag}`])
  })

  it('does not focus the field of a chat that was opened from the list', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
    await at.advance(100)
    const before = fieldCommands().filter(each => each.startsWith('focus')).length
    await at.tap('chat-c1')
    await at.advance(100)
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topAppear', {})
    await breathe(800)
    await at.advance(50)
    expect(fieldCommands().filter(each => each.startsWith('focus'))).toHaveLength(before)
  })
})

describe('stopping and regenerating', () => {
  it('Stop keeps what was written and says Stopped; Regenerate writes it again', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.advance(900)
    await at.tap('stop')
    expect(at.device.haptics.calls).toContain('impact:medium')
    await at.advance(600)
    const key = replyKey()
    expect(at.has(`${key}-stopped`)).toBe(true)
    expect(at.has('stop')).toBe(false)
    expect(at.server.log().filter(each => each.startsWith('StopTurn'))).toHaveLength(1)

    await at.tap(`${key}-regenerate`)
    await at.untilDone()
    expect(at.server.log().filter(each => each.startsWith('RegenerateTurn'))).toHaveLength(1)
    // The old, stopped reply is replaced by the new one.
    const replies = at.transcriptRows().filter(each => /^m\d+:/.test(each))
    expect(replies).toHaveLength(1)
    expect(at.has(`${lastReplyKey()}-stopped`)).toBe(false)
  })
})

describe('reasoning and tools', () => {
  it('shows Thinking while the model thinks, then "Thought for", which opens the reasoning in a sheet', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(TRAVEL)
    await at.until(() => at.transcriptRows().some(each => /^m\d+:/.test(each)))
    const key = replyKey()
    await at.until(() => at.has(`${key}-reasoning`))
    expect(at.has(`${key}-reasoning`)).toBe(true)
    expect(at.shown(`${key}-reasoning`)).toBe('Thinking')
    await at.untilDone()
    expect(at.shown(`${key}-reasoning`)).toMatch(/^Thought for \d+ s›$/)

    await at.tap(`${key}-reasoning`)
    expect(at.screens()).toEqual(['screen-chats', 'screen-chat', 'sheet-reasoning'])
    expect(at.shown('reasoning-text')).toMatch(/choosing between the train and the car/)
    // A swipe down closes it, and the phone says so.
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'sheet-reasoning'), 'topDismissed', { dismissCount: 1 })
    await at.advance(100)
    expect(at.screens()).toEqual(['screen-chats', 'screen-chat'])
  })

  it('shows a tool call as a quiet row with a spinner, then what it did', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(WEATHER)
    await at.until(() => at.transcriptRows().some(each => /Checking the weather/.test(each)))
    const key = replyKey()
    const toolRow = at.transcriptRows().find(each => each.startsWith(key)) ?? ''
    expect(toolRow).toMatch(/Checking the weather/)
    await at.untilDone()
    const done = at.transcriptRows().find(each => each.startsWith(key)) ?? ''
    expect(done).toMatch(/Checked the weather/)
    expect(done).toMatch(/Tomorrow in Lisbon/)
  })
})

describe('when things go wrong', () => {
  it('a reply that fails halfway says why, and Try again writes it again', async () => {
    at = await startChatPhone()
    at.server.setChaos({ failMidStream: true })
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    const key = replyKey()
    expect(at.has(`${key}-failed`)).toBe(true)
    expect(at.device.haptics.calls).toContain('notification:error')

    at.server.setChaos({ failMidStream: false })
    await at.tap('try-again')
    await at.untilDone()
    expect(at.has(`${lastReplyKey()}-failed`)).toBe(false)
    expect(at.transcriptRows().find(each => each.startsWith(lastReplyKey()))).toMatch(/Couch to 5K/)
  })

  it('a message the server refuses comes off the screen and back into the field, with the reason', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    at.server.setChaos({ refuseSend: true })
    await at.ask('And how often should I rest?')
    await at.advance(600)
    expect(at.transcriptRows().some(each => each.includes('how often should I rest'))).toBe(false)
    expect(at.fieldText('draft')).toBe('And how often should I rest?')
    expect(at.shown('notice')).toMatch(/^Not sent\./)
  })

  it('a dropped connection is picked up again, and the reply reads whole', async () => {
    at = await startChatPhone()
    at.server.setChaos({ dropConnection: true })
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    const reply = at.transcriptRows().find(each => each.startsWith(replyKey())) ?? ''
    expect(reply).toMatch(/Starting to run/)
    expect(reply).toMatch(/Couch to 5K/)
    expect(at.server.log().filter(each => each.startsWith('WatchTurn')).length).toBeGreaterThanOrEqual(1)
  })

  it('going to the background and back resumes the reply from its last piece', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.advance(900)
    at.device.appState.set('background')
    await at.advance(100)
    at.device.appState.set('active')
    await at.advance(100)
    expect(at.server.log().filter(each => each.startsWith('WatchTurn'))).toHaveLength(1)
    await at.untilDone()
    expect(at.transcriptRows().find(each => each.startsWith(replyKey()))).toMatch(/Couch to 5K/)
  })

  it('offline: a line says so and Send is off; back online, a reply being written is resumed', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.advance(900)
    at.device.network.set('offline')
    await at.advance(100)
    expect(at.has('offline')).toBe(true)
    at.device.network.set('online')
    await at.advance(100)
    expect(at.has('offline')).toBe(false)
    expect(at.server.log().filter(each => each.startsWith('WatchTurn'))).toHaveLength(1)
    await at.untilDone()

    at.device.network.set('offline')
    await at.advance(100)
    await at.type('draft', 'Anything else?')
    // Send is drawn greyed and does nothing.
    await at.tap('send')
    expect(at.transcriptRows().some(each => each.includes('Anything else?'))).toBe(false)
  })
})

describe('holding a message', () => {
  it('opens an action sheet: Copy puts the reply on the clipboard and says Copied', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    const key = replyKey()
    at.sheet.answerWith('copy')
    await hold(at.phone.fabric, `row-${key}`, LONG_PRESS_MS + 80)
    await at.advance(50)
    expect(at.sheet.shown.at(-1)?.items.map(item => item.key)).toEqual(['copy', 'select', 'share', 'regenerate'])
    expect(at.device.clipboard.contents()).toMatch(/^## Starting to run/)
    expect(at.shown('notice')).toBe('Copied')
    expect(at.device.haptics.calls).toContain('notification:success')
  })

  it('Select text opens the reply in a sheet; your own question offers no Regenerate', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    at.sheet.answerWith('select')
    await hold(at.phone.fabric, `row-${replyKey()}`, LONG_PRESS_MS + 80)
    await at.advance(50)
    expect(at.screens()).toContain('sheet-select')
    expect(at.has('select-text')).toBe(true)
    await at.tap('select-done')
    expect(at.screens()).not.toContain('sheet-select')

    at.sheet.answerWith(null)
    await hold(at.phone.fabric, 'row-c1', LONG_PRESS_MS + 80)
    expect(at.sheet.shown.at(-1)?.items.map(item => item.key)).toEqual(['copy', 'select', 'share'])
  })

  /**
   * A finger resting on a view while the reply keeps streaming: the clock
   * moves on in steps, and every step draws the transcript again, until
   * the finger has rested for longer than a hold.
   */
  const holdWhileStreaming = async (id: string): Promise<void> => {
    const fabric = at.phone.fabric
    const node = byTestId(fabric, id)
    const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: Date.now() }
    fabric.emit(node, 'topTouchStart', { ...point, touches: [point], changedTouches: [point] })
    const started = Date.now()
    let draws = 0
    while (Date.now() - started < LONG_PRESS_MS + 120) {
      const before = at.transcriptRows().join('|')
      await at.advance(50)
      if (at.transcriptRows().join('|') !== before) draws += 1
    }
    // The reply did change under the finger: this is a hold during streaming.
    expect(draws).toBeGreaterThan(0)
    fabric.emit(byTestId(fabric, id), 'topTouchEnd', { ...point, touches: [], changedTouches: [point] })
    await at.advance(50)
  }

  it('holding the reply while it streams offers Copy so far and Stop; Stop stops it', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.until(() => at.transcriptRows().some(each => /Starting to run/.test(each)))
    expect(at.has('stop')).toBe(true)
    const key = replyKey()
    at.sheet.answerWith('stop')
    await holdWhileStreaming(`row-${key}`)
    expect(at.sheet.shown.at(-1)?.items.map(item => item.title)).toEqual(['Copy so far', 'Stop'])
    await at.advance(600)
    expect(at.has(`${key}-stopped`)).toBe(true)
    expect(at.server.log().filter(each => each.startsWith('StopTurn'))).toHaveLength(1)
  })

  it('holding the reply while it streams and choosing Copy so far copies what is there', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.until(() => at.transcriptRows().some(each => /Starting to run/.test(each)))
    at.sheet.answerWith('copy')
    await holdWhileStreaming(`row-${replyKey()}`)
    expect(at.device.clipboard.contents()).toMatch(/^## Starting to run/)
    // Still streaming: copying did not stop it.
    expect(at.has('stop')).toBe(true)
  })

  it('holding your question while the reply streams opens its menu', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.until(() => at.transcriptRows().some(each => /Starting to run/.test(each)))
    at.sheet.answerWith(null)
    await holdWhileStreaming('row-c1')
    expect(at.sheet.shown.at(-1)?.items.map(item => item.key)).toEqual(['copy', 'select', 'share'])
  })

  it('a short touch is not a hold', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    await hold(at.phone.fabric, `row-${replyKey()}`, 120)
    expect(at.sheet.shown).toHaveLength(0)
  })

  it('the buttons under a reply share it', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    await at.tap(`${replyKey()}-share`)
    await at.advance(50)
    expect(at.device.share.calls.at(-1)?.message).toMatch(/^## Starting to run/)
  })
})

describe('putting the keyboard away', () => {
  const touch = (id: string, phase: 'start' | 'end') => {
    const node = byTestId(at.phone.fabric, id)
    const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: Date.now() }
    at.phone.fabric.emit(node, phase === 'start' ? 'topTouchStart' : 'topTouchEnd', {
      ...point,
      touches: phase === 'start' ? [point] : [],
      changedTouches: [point],
    })
  }

  it('a tap on the transcript, or on a message, puts the keyboard away; a button keeps it', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    at.device.keyboard.show(336)
    await at.advance(100)
    const before = at.device.keyboard.dismissCount()

    // Between the rows: nothing there takes the touch but the list itself.
    await at.tap('transcript')
    await at.advance(50)
    expect(at.device.keyboard.dismissCount()).toBe(before + 1)

    at.device.keyboard.show(336)
    await at.advance(100)
    await at.tap(`row-${replyKey()}`)
    await at.advance(50)
    expect(at.device.keyboard.dismissCount()).toBe(before + 2)

    at.device.keyboard.show(336)
    await at.advance(100)
    await at.tap('row-c1')
    await at.advance(50)
    expect(at.device.keyboard.dismissCount()).toBe(before + 3)

    // A button under a reply does its own job and leaves the keyboard up.
    at.device.keyboard.show(336)
    await at.advance(100)
    await at.tap(`${replyKey()}-share`)
    await at.advance(50)
    expect(at.device.share.calls).toHaveLength(1)
    expect(at.device.keyboard.dismissCount()).toBe(before + 3)
  })

  it('a drag is not a tap, and the keyboard still follows a drag down', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    at.device.keyboard.show(336)
    await at.advance(100)
    const before = at.device.keyboard.dismissCount()
    touch('transcript', 'start')
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'transcript'), 'topScrollBeginDrag', {
      contentOffset: { x: 0, y: 0 },
      layoutMeasurement: { width: 390, height: 600 },
    })
    touch('transcript', 'end')
    await at.advance(50)
    expect(at.device.keyboard.dismissCount()).toBe(before)
    // The phone's own way: the keyboard follows the finger down, or leaves as the drag starts.
    expect(['interactive', 'on-drag']).toContain(byTestId(at.phone.fabric, 'transcript').props['keyboardDismissMode'])
  })

  it('holding a message with the keyboard up puts the keyboard away first, then opens the menu, as Messages does', async () => {
    at = await startChatPhone()
    await newChat()
    await at.ask(RUNNING)
    await at.untilDone()
    at.device.keyboard.show(336)
    await at.advance(100)
    const before = at.device.keyboard.dismissCount()
    at.sheet.answerWith(null)
    touch(`row-${replyKey()}`, 'start')
    await new Promise(resolve => setTimeout(resolve, LONG_PRESS_MS + 10))
    // The hold has fired: the keyboard goes first. The phone's sheet would be
    // drawn under the keyboard, so it waits for the keyboard to start going.
    expect(at.device.keyboard.dismissCount()).toBe(before + 1)
    expect(at.sheet.shown).toHaveLength(0)
    await new Promise(resolve => setTimeout(resolve, 100))
    await at.advance(100)
    expect(at.sheet.shown.map(each => each.items.map(item => item.key))).toEqual([['copy', 'select', 'share', 'regenerate']])
    // The finger lifts: a hold is not also a tap.
    touch(`row-${replyKey()}`, 'end')
    await at.advance(50)
    expect(at.device.keyboard.dismissCount()).toBe(before + 1)
    // With the keyboard down a hold opens the menu at once, and a tap still puts a raised keyboard away.
    at.device.keyboard.hide()
    await at.advance(100)
    await hold(at.phone.fabric, 'row-c1', LONG_PRESS_MS + 80)
    expect(at.sheet.shown).toHaveLength(2)
    expect(at.device.keyboard.dismissCount()).toBe(before + 1)
    at.device.keyboard.show(336)
    await at.advance(100)
    await at.tap(`row-${replyKey()}`)
    await at.advance(50)
    expect(at.device.keyboard.dismissCount()).toBe(before + 2)
    expect(at.sheet.shown).toHaveLength(2)
  })
})

describe('a voice note', () => {
  it('records, then attaches the note with a transcript placeholder in the field', async () => {
    at = await startChatPhone()
    await newChat()
    await at.tap('mic')
    await at.advance(100)
    expect(at.has('recording')).toBe(true)
    await at.tap('finish-recording')
    await at.advance(200)
    expect(at.has('recording')).toBe(false)
    expect(at.has('remove-attachment')).toBe(true)
    expect(at.fieldText('draft')).toMatch(/^\(Voice note, 0:0\d\. A transcript would go here/)
    await at.tap('send')
    await at.advance(400)
    expect(at.transcriptRows()[0]).toMatch(/Voice note 0:0\d/)
  })
})
