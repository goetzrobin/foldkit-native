/**
 * Fold Chat's list of chats, its settings and its theme on the simulated
 * phone, and the pure functions behind the list's day groups.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60000 })

import type { ConversationSummary } from '../../src/aiChat/index.js'
import * as Device from '../../src/device/index.js'
import { memoryDisk } from '../../src/aiChat/index.js'
import { dayGroupOf, listItems, matchesQuery } from '../../flagship/model.js'
import { LONG_PRESS_MS } from '../../flagship/longPress.js'
import { type ChatPhone, NOW, startChatPhone } from '../support/flagship.js'
import { hold } from '../support/expoUi.js'
import { byTestId, flatten, textOf } from '../support/phone.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const summary = (id: string, title: string, updatedAt: number, preview = ''): ConversationSummary => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  messageCount: 2,
  preview,
})

describe('the day groups', () => {
  it('puts each chat under Today, Yesterday, the last 7 and 30 days, then its month', () => {
    expect(dayGroupOf(NOW - HOUR, NOW)).toBe('Today')
    expect(dayGroupOf(NOW - DAY, NOW)).toBe('Yesterday')
    expect(dayGroupOf(NOW - 3 * DAY, NOW)).toBe('Previous 7 days')
    expect(dayGroupOf(NOW - 20 * DAY, NOW)).toBe('Previous 30 days')
    expect(dayGroupOf(new Date(2026, 5, 3).getTime(), NOW)).toBe('June')
    expect(dayGroupOf(new Date(2025, 11, 30).getTime(), NOW)).toBe('December 2025')
  })

  it('lists the newest first under one heading per group, and a search shows only matches with no headings', () => {
    const chats = [
      summary('a', 'Marathon plan', NOW - 3 * DAY, 'Week one: three easy runs'),
      summary('b', 'Coast trip', NOW - HOUR, 'Take the train'),
      summary('c', 'Debounce', NOW - 2 * HOUR, 'A debounce waits'),
      summary('d', 'Old notes', NOW - DAY - HOUR, 'Garden beds'),
    ]
    expect(listItems(chats, NOW, '').map(item => (item._tag === 'Header' ? `# ${item.title}` : item.summary.id))).toEqual([
      '# Today',
      'b',
      'c',
      '# Yesterday',
      'd',
      '# Previous 7 days',
      'a',
    ])
    expect(listItems(chats, NOW, 'TRAIN').map(item => item.key)).toEqual(['b'])
    expect(matchesQuery(chats[0] as ConversationSummary, 'easy')).toBe(true)
  })
})

describe('the list of chats', () => {
  let at: ChatPhone
  afterEach(async () => {
    await at.stop()
  })

  /** Makes a chat with one question and its whole reply, then goes back to the list. */
  const makeChat = async (question: string): Promise<void> => {
    if (at.has('start-chat')) await at.tap('start-chat')
    else await at.pressBar('bar-chats', 'new-chat')
    await at.advance(100)
    await at.ask(question)
    await at.untilDone()
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
    await at.advance(400)
  }

  const listed = (): ReadonlyArray<string> =>
    flatten([byTestId(at.phone.fabric, 'chat-list')])
      .filter(node => /^chat-c\d+$/.test(String(node.props['testID'] ?? '')))
      .map(node => textOf(node))

  it('starts empty with a way to begin, then lists each chat under Today with its title and the start of the reply', async () => {
    at = await startChatPhone({ now: Date.now(), platform: 'android' })
    expect(at.has('empty-list')).toBe(true)
    await makeChat('How do I start running?')
    await makeChat('What is the weather in Lisbon tomorrow?')
    expect(at.has('empty-list')).toBe(false)
    const shown = listed()
    expect(shown).toHaveLength(2)
    expect(shown[0]).toMatch(/^What is the weather in Lisbon/)
    expect(shown[1]).toMatch(/^How do I start running/)
    expect(textOf(byTestId(at.phone.fabric, 'chat-list'))).toMatch(/^Today/)
  })

  it('search keeps the chats whose title or text matches (Android field)', async () => {
    at = await startChatPhone({ now: Date.now(), platform: 'android' })
    await makeChat('How do I start running?')
    await makeChat('What is the weather in Lisbon tomorrow?')
    await at.type('search', 'lisbon')
    expect(listed()).toHaveLength(1)
    await at.type('search', 'nothing like this')
    expect(at.has('no-matches')).toBe(true)
  })

  it('search on iPhone comes from the bar’s own field', async () => {
    at = await startChatPhone({ now: Date.now() })
    await makeChat('How do I start running?')
    await makeChat('What is the weather in Lisbon tomorrow?')
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'search'), 'topChangeText', { text: 'running' })
    await at.advance(50)
    expect(listed()).toHaveLength(1)
    expect(listed()[0]).toMatch(/running/)
  })

  it('swipe, Rename: a sheet with the title, Save renames it on the server and in the list', async () => {
    at = await startChatPhone({ now: Date.now() })
    await makeChat('How do I start running?')
    await at.tap('c1-trailing-rename')
    await at.advance(50)
    expect(at.screens()).toEqual(['screen-chats', 'sheet-rename'])
    expect(at.fieldText('rename-field')).toBe('How do I start running')
    await at.type('rename-field', 'Running plan')
    await at.tap('rename-save')
    await at.advance(400)
    expect(at.screens()).toEqual(['screen-chats'])
    expect(at.server.log()).toContain('RenameConversation c1')
    expect(listed()[0]).toMatch(/^Running plan/)
  })

  it('swipe, Delete: gone from the list at once and from the server, with a warning tap', async () => {
    at = await startChatPhone({ now: Date.now() })
    await makeChat('How do I start running?')
    await makeChat('What is the weather in Lisbon tomorrow?')
    await at.tap('c1-trailing-delete')
    await at.advance(10)
    expect(listed()).toHaveLength(1)
    await at.advance(400)
    expect(at.server.log()).toContain('DeleteConversation c1')
    expect(listed()).toHaveLength(1)
    expect(at.device.haptics.calls).toContain('notification:warning')
  })

  it('hold a chat for its menu: Delete removes it', async () => {
    at = await startChatPhone({ now: Date.now() })
    await makeChat('How do I start running?')
    // No Expo UI on the simulated phone: the menu is the plain in-app list.
    await hold(at.phone.fabric, 'chat-menu-c1', LONG_PRESS_MS + 80)
    await at.tap('chat-menu-c1-delete')
    await at.advance(400)
    expect(at.server.log()).toContain('DeleteConversation c1')
    expect(at.has('empty-list')).toBe(true)
  })

  it('the chat’s own menu renames and deletes the open chat', async () => {
    at = await startChatPhone({ now: Date.now(), platform: 'android' })
    await at.tap('start-chat')
    await at.ask('How do I start running?')
    await at.untilDone()
    await at.tap('bar-chat-menu')
    await at.tap('bar-chat-menu-rename')
    expect(at.screens()).toEqual(['screen-chats', 'screen-chat', 'sheet-rename'])
    await at.tap('rename-cancel')
    await at.tap('bar-chat-menu')
    await at.tap('bar-chat-menu-delete')
    await at.advance(400)
    expect(at.screens()).toEqual(['screen-chats'])
    expect(at.has('empty-list')).toBe(true)
  })

  it('chats are kept on disk: a second launch lists them', async () => {
    const disk = memoryDisk()
    at = await startChatPhone({ now: Date.now(), disk })
    await makeChat('How do I start running?')
    await at.stop()
    at = await startChatPhone({ now: Date.now(), disk })
    await at.advance(300)
    expect(listed()).toHaveLength(1)
  })
})

describe('settings', () => {
  let at: ChatPhone
  afterEach(async () => {
    await at.stop()
  })

  it('Theme: Dark tells the phone, redraws in dark, and is remembered for the next launch', async () => {
    const device = Device.makeTest()
    at = await startChatPhone({ device })
    await at.pressBar('bar-chats', 'settings')
    expect(at.screens()).toEqual(['screen-chats', 'sheet-settings'])
    const look = () => String(byTestId(at.phone.fabric, 'chat-list').props['backgroundColor'])
    const before = look()
    await at.tap('theme-dark')
    await at.advance(50)
    expect(at.appearance.calls).toEqual(['dark'])
    expect(before).toBe('#FFFFFF')
    expect(look()).toBe('#0B0B0C')
    expect(device.haptics.calls).toContain('selection')
    expect([...device.storage.items.values()].join()).toMatch(/"theme":"dark"/)
    await at.stop()

    // The next launch asks the phone for dark again before anything else.
    at = await startChatPhone({ device: Device.makeTest({ storage: device.storage }) })
    await at.advance(50)
    expect(at.appearance.calls).toEqual(['dark'])
  })

  it('Reply speed and the failure switches set the pretend server', async () => {
    at = await startChatPhone()
    await at.pressBar('bar-chats', 'settings')
    await at.tap('speed-fast')
    await at.advance(50)
    expect(at.server.timing().tokensPerSecond).toBe(160)
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'chaos-refuseSend'), 'topChange', { value: true })
    await at.advance(50)
    expect(at.server.chaos().refuseSend).toBe(true)
  })

  it('Show numbers: from Settings, or by holding the chat’s title', async () => {
    at = await startChatPhone()
    await at.tap('start-chat')
    expect(at.has('numbers')).toBe(false)
    await hold(at.phone.fabric, 'chat-title', LONG_PRESS_MS + 80)
    expect(at.has('numbers')).toBe(true)
    expect(at.shown('numbers')).toMatch(/^list \d+ rows \d+ blank/)
    await hold(at.phone.fabric, 'chat-title', LONG_PRESS_MS + 80)
    expect(at.has('numbers')).toBe(false)
  })
})
