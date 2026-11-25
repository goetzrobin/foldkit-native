/**
 * Fold Chat's crash screen on the simulated phone.
 *
 * In the third phone test Fold Chat showed Foldkit's own crash screen, made
 * of web elements: its words sat outside any text view, and the phone drew
 * every line at the top of the screen, on top of each other. The simulated
 * phone draws no pixels, so these tests check the shape of what is drawn:
 * every word inside a text view, one column with nothing placed by hand, the
 * details in a scroll view that takes the room left, and buttons that work
 * although the program has stopped.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60000 })

import { type ChatPhone, startChatPhone } from '../support/flagship.js'
import { byTestId, flatten, press, textOf } from '../support/phone.js'

let at: ChatPhone

afterEach(async () => {
  vi.restoreAllMocks()
  await at.stop()
})

const LONG = 'broken on purpose: ' + 'a very long reason that has to wrap over many lines '.repeat(8).trim()

/** Starts Fold Chat, then breaks it on the next Message after `breakNow`. */
const startBreakable = async (copied: Array<string>) => {
  let isArmed = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
  at = await startChatPhone({
    onMessage: () => {
      if (!isArmed) return
      isArmed = false
      throw new Error(LONG)
    },
    copy: text => copied.push(text),
  })
  return {
    breakNow: async () => {
      isArmed = true
      await at.pressBar('bar-chats', 'settings')
      await at.advance(50)
    },
  }
}

/** Each node with its parent, below `root`. */
const withParents = (root: FakeFabricNode): ReadonlyArray<{ node: FakeFabricNode; parent: FakeFabricNode }> =>
  root.children.flatMap(child => [{ node: child, parent: root }, ...withParents(child)])

describe('the crash screen', () => {
  it('shows the error in one column: name, message and stack in a scroll view, then Reload and Copy', async () => {
    const copied: Array<string> = []
    const app = await startBreakable(copied)
    await app.breakNow()

    expect(at.has('crash-screen')).toBe(true)
    const screen = byTestId(at.phone.fabric, 'crash-screen')
    expect(screen.props['flexDirection']).toBe('column')

    // Every word is inside a text view, so it wraps and takes its own line.
    const words = withParents(screen).filter(each => each.node.viewName === 'RawText')
    expect(words.length).toBeGreaterThan(0)
    for (const each of words) expect(each.parent.viewName).toBe('Paragraph')
    // Nothing is placed by hand: no view sits on top of another.
    for (const node of flatten([screen])) expect(node.props['position']).not.toBe('absolute')
    // Each line is at least as tall as its letters. Foldkit's web view says
    // `lineHeight: 1.5` (times the font size, on the web), which a phone
    // reads as 1.5 points: every line then lands on the one before.
    for (const node of flatten([screen]).filter(each => each.viewName === 'Paragraph')) {
      const fontSize = node.props['fontSize']
      const lineHeight = node.props['lineHeight']
      expect(typeof fontSize).toBe('number')
      if (lineHeight !== undefined) expect(lineHeight).toBeGreaterThanOrEqual(fontSize as number)
    }

    // Title, the details that scroll and take the room left, the hint, the buttons: in that order.
    const order = screen.children.map(child => String(child.props['testID'] ?? child.viewName))
    expect(order).toEqual(['crash-title', 'crash-during', 'crash-details', 'crash-hint', 'crash-buttons'])
    const details = byTestId(at.phone.fabric, 'crash-details')
    expect(details.viewName).toBe('ScrollView')
    expect(details.props['flex']).toBe(1)
    const inside = flatten([details]).map(node => String(node.props['testID'] ?? ''))
    expect(inside).toEqual(expect.arrayContaining(['crash-name', 'crash-message', 'crash-stack']))

    expect(textOf(byTestId(at.phone.fabric, 'crash-name'))).toBe('Error')
    expect(textOf(byTestId(at.phone.fabric, 'crash-message'))).toBe(LONG)
    expect(textOf(byTestId(at.phone.fabric, 'crash-during'))).toMatch(/^While handling /)
    const stack = textOf(byTestId(at.phone.fabric, 'crash-stack')).split('\n')
    expect(stack.length).toBeGreaterThan(1)
    expect(stack.length).toBeLessThanOrEqual(12)
    expect(stack[0]).toMatch(/^at /)

    // Copy hands over the whole report.
    await press(at.phone.fabric, 'crash-copy')
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatch(/^Error: broken on purpose/)
    expect(copied[0]).toMatch(/\nWhile handling \w+\n/)
    expect(copied[0]).toMatch(/\nat /)
  })

  it('Reload starts the program again over the same chats', async () => {
    const app = await startBreakable([])
    await at.tap('start-chat')
    await at.ask('How do I start running?')
    await at.untilDone()
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
    await at.advance(400)
    await app.breakNow()
    expect(at.has('crash-screen')).toBe(true)

    await press(at.phone.fabric, 'crash-reload')
    await at.advance(300)
    expect(at.has('crash-screen')).toBe(false)
    expect(at.screens()).toEqual(['screen-chats'])
    expect(at.has('chat-c1')).toBe(true)
    // And the new program works.
    await at.tap('chat-c1')
    await at.advance(300)
    expect(at.screens()).toEqual(['screen-chats', 'screen-chat'])
  })
})
