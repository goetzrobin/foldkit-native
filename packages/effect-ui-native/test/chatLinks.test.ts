/**
 * Links and the code block's Copy button in a reply, on the simulated phone.
 *
 * The native Markdown view finds the tap itself and says which link or
 * which code block it was (`topLinkPress`, `topCopyPress`). These tests send
 * those two events as the phone would and check what the app does with
 * them: the link goes to the phone's Linking service once, and the exact
 * code goes to the clipboard, with a light tap and "Copied" above the
 * composer for a moment. While a reply is being written, after it, and for
 * a saved reply after its chat was closed and opened again.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { NOTICE_MS } from '../chat/events.js'
import { NativeViews } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import {
  FAST,
  HOLD_MS,
  NOW,
  REPLY,
  REQUEST,
  type TestApp,
  hold,
  message,
  pressBarButton,
  replies,
  seeded,
  send,
  start,
  until,
} from './chatSupport.js'
import { run } from './support.js'

vi.setConfig({ testTimeout: 30000 })

const CODE = 'const pace = (km: number, minutes: number) => minutes / km\nconsole.log(pace(5, 30))\n'
const SAVED_REPLY = [
  'Read [the running guide](https://example.com/guide?week=1) first.',
  '',
  '```ts',
  CODE.trimEnd(),
  '```',
].join('\n')

/** The seeded chats, plus one whose saved reply has a link and a code block. */
const withLinkChat = () => {
  const disk = seeded()
  disk.entries.set(
    'conversation-c9',
    JSON.stringify({
      id: 'c9',
      title: 'Pace',
      createdAt: NOW - 30_000,
      updatedAt: NOW - 30_000,
      messages: [
        message('m20', 'user', 'How do I work out my pace?', NOW - 31_000),
        message('m21', 'assistant', SAVED_REPLY, NOW - 30_000),
      ],
    }),
  )
  disk.entries.set('index', JSON.stringify({ version: 1, nextId: 30, conversationIds: ['c9', 'c4', 'c1', 'c7'] }))
  return disk
}

const markdownOf = (app: TestApp, replyId: string): FakeFabricNode => {
  const found = NativeTest.flatten([app.byTestId(replyId)]).find(node => node.viewName === 'EnrichedMarkdown')
  if (found === undefined) throw new Error(`No Markdown view in ${replyId}`)
  return found
}

/** The phone's Markdown view says a link was tapped. */
const tapLink = (app: TestApp, replyId: string, url: string) =>
  Effect.andThen(
    Effect.sync(() => app.fabric.emit(markdownOf(app, replyId), 'topLinkPress', { url })),
    app.wait(20),
  )

/** The phone's Markdown view says a code block's Copy button was tapped. */
const tapCopy = (app: TestApp, replyId: string, code: string, language = 'ts') =>
  Effect.andThen(
    Effect.sync(() => app.fabric.emit(markdownOf(app, replyId), 'topCopyPress', { code, language })),
    app.wait(20),
  )

const swipeBack = (app: TestApp) =>
  Effect.andThen(
    Effect.sync(() => app.fabric.emit(app.byTestId('screen-chat'), 'topDismissed', { dismissCount: 1 })),
    app.wait(REQUEST),
  )

const openChat = (app: TestApp, id: string) => Effect.andThen(app.press(`chat-row-${id}`), app.wait(REQUEST * 2))

beforeEach(() => {
  NativeViews.configureMarkdown({ native: true })
})
afterEach(() => {
  resetMarkdownSetup()
})

describe('a link in a reply', () => {
  it('opens through the Linking service, once, with the address as written', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* start({ disk: withLinkChat() })
        yield* openChat(app, 'c9')
        expect(markdownOf(app, 'reply-m21').props['markdown']).toBe(SAVED_REPLY)
        expect(device.linking.opened).toEqual([])

        yield* tapLink(app, 'reply-m21', 'https://example.com/guide?week=1')
        expect(device.linking.opened).toEqual(['https://example.com/guide?week=1'])
        // Nothing is said when it worked.
        expect(app.has('chat-notice')).toBe(false)
      }),
    ))

  it('still opens for a saved reply after the chat was closed and opened again', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* start({ disk: withLinkChat() })
        yield* openChat(app, 'c9')
        yield* swipeBack(app)
        expect(app.has('screen-chat')).toBe(false)
        yield* openChat(app, 'c9')

        yield* tapLink(app, 'reply-m21', 'https://example.com/guide?week=1')
        expect(device.linking.opened).toEqual(['https://example.com/guide?week=1'])
      }),
    ))

  it('says so when no app on the phone opens the address', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* start({ disk: withLinkChat() })
        yield* openChat(app, 'c9')
        yield* tapLink(app, 'reply-m21', 'strange://nowhere')
        expect(device.linking.opened).toEqual(['strange://nowhere'])
        expect(app.text('chat-notice')).toBe('Could not open the link.')
      }),
    ))

  it('leaves a hold to the message menu: the phone shows no link preview of its own', () =>
    run(
      Effect.gen(function* () {
        const { app, menus, device } = yield* start({ disk: withLinkChat() })
        yield* openChat(app, 'c9')
        expect(markdownOf(app, 'reply-m21').props['enableLinkPreview']).toBe(false)
        yield* hold(app, 'row-m21', HOLD_MS + 60)
        yield* app.wait(REQUEST)
        expect(menus.titles()).toContain('Copy')
        expect(device.linking.opened).toEqual([])
      }),
    ))
})

describe("a code block's Copy button", () => {
  it('puts the exact code on the clipboard, with a light tap and "Copied" for a moment', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* start({ disk: withLinkChat() })
        yield* openChat(app, 'c9')
        yield* tapCopy(app, 'reply-m21', CODE)

        expect(device.clipboard.contents()).toBe(CODE)
        expect(device.clipboard.calls).toEqual([`copy:${CODE}`])
        expect(device.haptics.calls).toEqual(['impact:light'])
        expect(app.text('chat-notice')).toBe('Copied')
        yield* app.wait(NOTICE_MS + 200)
        expect(app.has('chat-notice')).toBe(false)
      }),
    ))

  it('still works for a saved reply after the chat was closed and opened again', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* start({ disk: withLinkChat() })
        yield* openChat(app, 'c9')
        yield* swipeBack(app)
        yield* openChat(app, 'c9')
        yield* tapCopy(app, 'reply-m21', CODE)
        expect(device.clipboard.contents()).toBe(CODE)
        expect(app.text('chat-notice')).toBe('Copied')
      }),
    ))

  it('works while the reply is still being written, and after it', () =>
    run(
      Effect.gen(function* () {
        // Slow enough for the reply to be caught half written.
        const { app, device } = yield* start({ timing: { ...FAST, tokensPerSecond: 150 } })
        yield* pressBarButton(app, 'bar-chats', 'new-chat')
        yield* app.wait(REQUEST)
        yield* send(app, 'How do I start running?')
        yield* until(app, () => replies(app).length === 1, REPLY, 'the reply to start')
        const reply = replies(app)[0] as string
        // Empty until the first words: the reply says "Thinking" before it has a Markdown view.
        const written = (): string =>
          String(
            NativeTest.flatten([app.byTestId(reply)]).find(node => node.viewName === 'EnrichedMarkdown')?.props['markdown'] ?? '',
          )
        yield* until(app, () => written().includes('```ts'), 20_000, 'the code block to start')
        expect(written()).not.toContain('Couch to 5K')
        const view = markdownOf(app, reply).reactTag

        yield* tapCopy(app, reply, 'const pace = 1')
        expect(device.clipboard.contents()).toBe('const pace = 1')
        expect(device.haptics.calls).toContain('impact:light')
        expect(app.text('chat-notice')).toBe('Copied')
        yield* tapLink(app, reply, 'https://example.com/half')
        expect(device.linking.opened).toEqual(['https://example.com/half'])
        // The reply was still being written when both were tapped.
        expect(app.has('stop')).toBe(true)

        yield* until(app, () => app.has(`reply-actions-${reply.slice('reply-'.length)}`), 30_000, 'the reply to end')
        // The same native view, start to end.
        expect(markdownOf(app, reply).reactTag).toBe(view)
        yield* tapCopy(app, reply, CODE)
        expect(device.clipboard.contents()).toBe(CODE)
        yield* tapLink(app, reply, 'https://example.com/done')
        expect(device.linking.opened).toEqual(['https://example.com/half', 'https://example.com/done'])
      }),
    ))
})
