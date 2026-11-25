/**
 * The list of chats never shows old data after a write: every frame the
 * phone is sent is recorded, and a deleted chat that comes back in any of
 * them, or a new title that turns back into the old one, fails the test.
 *
 * In the third phone test, deleting the only chat showed the empty list,
 * then the chat again, then the empty list. The list's read, refreshed by
 * the delete, first hands back what it held before (marked as loading
 * again), and that put the deleted chat back for a moment.
 */
import type { FakeFabric } from '@ng-native/testing/fake'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60000 })

import { LONG_PRESS_MS } from '../../flagship/longPress.js'
import { type ChatPhone, startChatPhone } from '../support/flagship.js'
import { hold } from '../support/expoUi.js'
import { byTestId, flatten, textOf } from '../support/phone.js'

let at: ChatPhone

afterEach(async () => {
  await at.stop()
})

type Frame = ReadonlyArray<string>

/** Each commit the phone is sent: the chats the list shows then, as `id: words`. */
const recordFrames = (fabric: FakeFabric): Array<Frame> => {
  const frames: Array<Frame> = []
  const completeRoot = fabric.completeRoot.bind(fabric)
  fabric.completeRoot = ((...args: Parameters<FakeFabric['completeRoot']>) => {
    completeRoot(...args)
    const list = flatten(fabric.committed).find(node => node.props['testID'] === 'chat-list')
    const chats =
      list === undefined
        ? []
        : flatten([list])
            .filter(node => /^chat-c\d+$/.test(String(node.props['testID'] ?? '')))
            .map(node => `${String(node.props['testID']).slice(5)}: ${textOf(node)}`)
    if (frames.at(-1)?.join('|') !== chats.join('|')) frames.push(chats)
  }) as FakeFabric['completeRoot']
  return frames
}

const idsOf = (frame: Frame): ReadonlyArray<string> => frame.map(each => each.split(':')[0] ?? '')

/** Every frame after the first one without `id` is also without it. */
const expectGoneForGood = (frames: ReadonlyArray<Frame>, id: string): void => {
  const gone = frames.findIndex(frame => !idsOf(frame).includes(id))
  expect(gone, `${id} never left the list: ${JSON.stringify(frames)}`).toBeGreaterThanOrEqual(0)
  const back = frames.slice(gone).find(frame => idsOf(frame).includes(id))
  expect(back, `${id} came back after it was deleted: ${JSON.stringify(frames)}`).toBeUndefined()
}

/** The chats the list shows now, by id. */
const listedIds = (): ReadonlyArray<string> =>
  flatten(at.phone.fabric.committed)
    .map(node => String(node.props['testID'] ?? ''))
    .filter(id => /^chat-c\d+$/.test(id))
    .map(id => id.slice(5))

/** Makes a chat with one question and its reply, back on the list; its id. */
const makeChat = async (question: string): Promise<string> => {
  const before = new Set(listedIds())
  if (at.has('start-chat')) await at.tap('start-chat')
  else await at.pressBar('bar-chats', 'new-chat')
  await at.advance(100)
  await at.ask(question)
  await at.untilDone()
  at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
  await at.advance(400)
  const id = listedIds().find(each => !before.has(each))
  if (id === undefined) throw new Error('The new chat is not in the list')
  return id
}

describe('the list of chats shows no old data', () => {
  it('deleting the only chat: the chat, then the empty list, and never the chat again', async () => {
    at = await startChatPhone({ now: Date.now() })
    await makeChat('How do I start running?')
    const frames = recordFrames(at.phone.fabric)
    await at.tap('c1-trailing-delete')
    await at.advance(1000)
    expect(at.has('empty-list')).toBe(true)
    expectGoneForGood(frames, 'c1')
    expect(frames.at(-1)).toEqual([])
  })

  it('deleting 1 of 2 from its hold menu, and the open chat from its own menu', async () => {
    at = await startChatPhone({ now: Date.now(), platform: 'android' })
    const first = await makeChat('How do I start running?')
    const second = await makeChat('What is the weather in Lisbon tomorrow?')
    const frames = recordFrames(at.phone.fabric)
    await hold(at.phone.fabric, `chat-menu-${first}`, LONG_PRESS_MS + 80)
    await at.tap(`chat-menu-${first}-delete`)
    await at.advance(1000)
    expectGoneForGood(frames, first)
    expect(idsOf(frames.at(-1) ?? [])).toEqual([second])

    await at.tap(`chat-${second}`)
    await at.advance(300)
    await at.tap('bar-chat-menu')
    await at.tap('bar-chat-menu-delete')
    await at.advance(1000)
    expectGoneForGood(frames, second)
    expect(at.has('empty-list')).toBe(true)
  })

  it('renaming: the new title, and never the old one again', async () => {
    at = await startChatPhone({ now: Date.now() })
    await makeChat('How do I start running?')
    const frames = recordFrames(at.phone.fabric)
    await at.tap('c1-trailing-rename')
    await at.advance(50)
    await at.type('rename-field', 'Running plan')
    await at.tap('rename-save')
    await at.advance(1000)
    const renamed = frames.findIndex(frame => /^c1: Running plan/.test(frame[0] ?? ''))
    expect(renamed, JSON.stringify(frames)).toBeGreaterThanOrEqual(0)
    expect(frames.slice(renamed).every(frame => /^c1: Running plan/.test(frame[0] ?? '')), JSON.stringify(frames)).toBe(true)
  })

  it('creating: a new chat, once in the list, stays there', async () => {
    at = await startChatPhone({ now: Date.now() })
    const first = await makeChat('How do I start running?')
    const frames = recordFrames(at.phone.fabric)
    const second = await makeChat('What is the weather in Lisbon tomorrow?')
    await at.advance(600)
    const shown = frames.findIndex(frame => idsOf(frame).includes(second))
    expect(shown, JSON.stringify(frames)).toBeGreaterThanOrEqual(0)
    expect(frames.slice(shown).every(frame => idsOf(frame).includes(second)), JSON.stringify(frames)).toBe(true)
    expect(idsOf(frames.at(-1) ?? [])).toEqual([second, first])
  })
})
