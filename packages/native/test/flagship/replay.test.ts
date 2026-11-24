/**
 * Replay: a log of Messages is enough to rebuild what the user saw.
 *
 * A whole session runs on the simulated phone with every part real: a new
 * chat, a question and its streamed reply, a second question stopped half
 * way, Regenerate, Rename from the chat's menu, and the theme set to Dark.
 * Every Message the program handles is recorded with the Model after it.
 *
 * Then a fresh program (the same `init` and `update`, nothing started: no
 * Commands run, no server, no Subscriptions) is fed the recorded Messages
 * one by one. After each, its Model must equal the recorded one.
 *
 * What makes this hold is that state kept outside the Model reports itself
 * as Messages: the list's end and follow state, the keyboard's phase, a
 * swipe row opening, a sheet's height, the reply's pieces, the recorder's
 * clock. A Message that read the outside world in `update` would break it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 90000 })

import { makeChatApp, type Message, type Model } from '../../flagship/app.js'
import { type ChatPhone, NOW, startChatPhone } from '../support/flagship.js'
import { byTestId } from '../support/phone.js'

const RUNNING = 'How do I start running?'
const AGAIN = 'How do I start running in the winter?'

type Entry = Readonly<{ message: Message; after: Model }>

let at: ChatPhone

afterEach(async () => {
  await at.stop()
})

const replyKeys = (): ReadonlyArray<string> =>
  at
    .transcriptRows()
    .filter(each => /^m\d+:/.test(each))
    .map(each => each.split(':')[0] ?? '')

/** The tags of a Message and of the part Messages wrapped inside it. */
const pathOf = (message: unknown): string => {
  const tags: Array<string> = []
  let at_: unknown = message
  while (typeof at_ === 'object' && at_ !== null && '_tag' in at_) {
    tags.push(String((at_ as { _tag: unknown })._tag))
    at_ = (at_ as { message?: unknown }).message
  }
  return tags.join(' > ')
}

describe('replay', () => {
  it('rebuilds every Model of a session from its Messages alone, without running a Command', async () => {
    const log: Array<Entry> = []
    let first: Model | undefined
    at = await startChatPhone({
      // Android: the bar's buttons and the chat's menu are views a test can tap.
      platform: 'android',
      onMessage: (message, before, after) => {
        first ??= before
        log.push({ message, after })
      },
    })

    // Send, and the reply streams in.
    await at.tap('start-chat')
    await at.advance(100)
    await at.ask(RUNNING)
    await at.untilDone()

    // A second question, stopped half way.
    await at.ask(AGAIN)
    await at.advance(900)
    await at.tap('stop')
    await at.advance(600)
    const stopped = replyKeys().at(-1) ?? ''
    expect(at.has(`${stopped}-stopped`)).toBe(true)

    // Regenerate writes it again.
    await at.tap(`${stopped}-regenerate`)
    await at.untilDone()

    // Rename from the chat's own menu.
    await at.tap('bar-chat-menu')
    await at.tap('bar-chat-menu-rename')
    await at.type('rename-field', 'Running and travel')
    await at.tap('rename-save')
    await at.advance(300)

    // Back to the list, Settings, Dark.
    at.phone.fabric.emit(byTestId(at.phone.fabric, 'screen-chat'), 'topDismissed', { dismissCount: 1 })
    await at.advance(200)
    await at.pressBar('bar-chats', 'settings')
    await at.tap('theme-dark')
    await at.advance(200)
    expect(at.appearance.calls).toEqual(['dark'])

    const seen = new Set(log.map(each => pathOf(each.message)))
    // The session covered what it set out to: these all happened.
    for (const wanted of [
      'GotChatScreenMessage > GotComposerMessage > PressedSend',
      'GotChatScreenMessage > GotReplyStreamMessage > ReceivedTurnUpdate',
      'GotChatScreenMessage > GotComposerMessage > PressedStop',
      'GotChatScreenMessage > StartedRegenerate',
      'PressedSaveRename',
      'GotSettingsSheetMessage > PressedTheme',
      'ChangedColorScheme',
      'GotChatScreenMessage > GotTranscriptMessage > ChangedFollowing',
      'GotChatScreenMessage > GotTranscriptMessage > GotRowMessage > PressedReplyAction',
    ]) {
      if (!seen.has(wanted)) throw new Error(`Missing ${wanted} in ${JSON.stringify([...seen])}`)
    }

    // A fresh program: its init and update, and nothing started.
    const fresh = makeChatApp(
      {} as HTMLElement,
      { device: { platform: 'android', osVersion: 35 } },
      undefined as never,
      { now: () => NOW },
    )
    const start = fresh.init().model
    expect(start).toEqual(first)
    let model = start
    for (const [index, entry] of log.entries()) {
      model = fresh.update(model, entry.message).model
      if (JSON.stringify(model) !== JSON.stringify(entry.after)) {
        throw new Error(`Message ${index} (${pathOf(entry.message)}) rebuilt a different Model`)
      }
    }
    expect(model).toEqual(log.at(-1)?.after)
    expect(model.shared.scheme).toBe('dark')
    expect(log.length).toBeGreaterThan(50)
  })
})
