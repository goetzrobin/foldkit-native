/**
 * Effect Chat, step 1, end to end on the simulated phone.
 *
 * The pretend AI server, the NDJSON cable between app and server, the turn
 * keeper and Effect UI's query cache all run for real. Only the phone is
 * simulated. The server is set to answer fast, and the tests wait in real
 * time.
 */
import { Effect, Layer, Option, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pickReply } from '../../native/src/host/aiChat/replies.js'
import { type Timing, makeAiServer, memoryDisk } from '../../native/src/host/aiChat/server.js'
import { AiChatRpcClient, layerInProcess, makeInProcessLink } from '../../native/src/host/aiChat/transport.js'
import { TurnKeeper } from '../../native/src/host/aiChat/turns.js'
import type { ChatMessage } from '../../native/src/host/aiChat/wire.js'
import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../chat/app.js'
import * as Data from '../chat/data.js'
import { chatServices } from '../chat/start.js'
import { NativeViews, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { provideForTest, run } from './support.js'

/** The server answers quickly, and a reply still takes long enough to be seen growing. */
const FAST: Timing = {
  firstTokenMs: 40,
  tokensPerSecond: 1500,
  jitter: 0,
  pauseChance: 0,
  pauseMs: 0,
  toolMs: 20,
  latencyMs: 10,
}
/** Long enough for a request to be answered and drawn. */
const REQUEST = 80
/** Long enough for a whole reply and the reloads after it. */
const REPLY = 1500

const QUESTION = 'What can you do?'
const ANSWER = pickReply(QUESTION).answer

const message = (id: string, role: 'user' | 'assistant', text: string, at: number): ChatMessage => ({
  id,
  role,
  parts: [{ _tag: 'Text', text }],
  status: 'complete',
  createdAt: at,
  turnId: null,
  clientMessageId: null,
  attachments: [],
  failure: null,
  usage: null,
})

/** Two chats, written the way the server saves them, as if the app had been used before. */
const seeded = () => {
  const disk = memoryDisk()
  const save = (id: string, title: string, at: number, messages: ReadonlyArray<ChatMessage>) =>
    disk.entries.set(`conversation-${id}`, JSON.stringify({ id, title, createdAt: at, updatedAt: at, messages }))
  save('c1', 'Weekend plans', 1_000, [
    message('m2', 'user', 'Any ideas for the weekend?', 1_000),
    message('m3', 'assistant', 'A walk by the **river**, then soup.', 1_001),
  ])
  save('c4', 'Bread recipe', 2_000, [
    message('m5', 'user', 'How long does bread prove?', 2_000),
    message('m6', 'assistant', 'About an hour, until it has doubled.', 2_001),
  ])
  disk.entries.set('index', JSON.stringify({ version: 1, nextId: 10, conversationIds: ['c4', 'c1'] }))
  return disk
}

const start = (options: Readonly<{ disk?: ReturnType<typeof memoryDisk>; platform?: 'ios' | 'android' }> = {}) =>
  Effect.gen(function* () {
    registerNavigation()
    const device = Phone.Device.makeTest()
    const disk = options.disk ?? memoryDisk()
    const server = makeAiServer({ disk: disk.disk, timing: FAST })
    const link = makeInProcessLink()
    const layer = Layer.provideMerge(chatServices(device.layer, { server, link }), device.layer)
    const platform = options.platform ?? 'ios'
    const app = yield* NativeTest.mount(App, { platform }, { platform }).pipe(provideForTest(layer))
    yield* app.wait(REQUEST)
    return { app, device, server, link, disk }
  })

type Started = Effect.Success<ReturnType<typeof start>>
type TestApp = Started['app']

const nodes = (app: TestApp) => NativeTest.flatten(app.fabric.committed)
const screens = (app: TestApp) => nodes(app).filter(node => node.viewName === 'RNSScreen')
const barTitles = (app: TestApp) =>
  nodes(app)
    .filter(node => node.viewName === 'RNSScreenStackHeaderConfig')
    .map(node => node.props['title'])

/** The native Markdown views on screen, with the text each was last given. */
const markdowns = (app: TestApp) => nodes(app).filter(node => node.viewName === 'EnrichedMarkdown')
const markdownIn = (app: TestApp, id: string) =>
  NativeTest.flatten([app.byTestId(id)]).find(node => node.viewName === 'EnrichedMarkdown')

const pressNewChat = (app: TestApp) => app.emit('bar-chats', 'topPressHeaderBarButtonItem', { buttonId: 'new-chat' })
const swipeBack = (app: TestApp) =>
  Effect.andThen(
    Effect.sync(() => app.fabric.emit(screens(app)[screens(app).length - 1] as never, 'topDismissed', { dismissCount: 1 })),
    app.settle,
  )
const send = (app: TestApp, text: string) =>
  Effect.andThen(app.typeText('draft', text), app.press('send'))

/** Calls `check` after every commit to the phone. */
const onEveryCommit = (app: TestApp, check: () => void): void => {
  const fabric = app.fabric as any
  const original = fabric.completeRoot.bind(fabric)
  fabric.completeRoot = (...args: Array<unknown>) => {
    original(...args)
    check()
  }
}

beforeEach(() => {
  // The replies are drawn with the native Markdown view, as in a built app.
  NativeViews.configureMarkdown({ native: true })
})
afterEach(() => {
  resetMarkdownSetup()
})

describe('the list of chats', () => {
  it('loads and shows the saved chats, newest first, in a native screen with a title bar', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        // The part draws the native screen itself, and it sits directly in the app's stack.
        expect(app.fabric.find('RNSScreenStack')?.children.map(child => child.viewName)).toEqual(['RNSScreen'])
        expect(screens(app)).toHaveLength(1)
        expect(barTitles(app)).toEqual(['Chats'])
        expect(app.text('chat-title-c4')).toBe('Bread recipe')
        expect(app.text('chat-preview-c4')).toBe('About an hour, until it has doubled.')
        expect(app.text('chat-title-c1')).toBe('Weekend plans')
        const titles = app.allText().filter(text => text === 'Bread recipe' || text === 'Weekend plans')
        expect(titles).toEqual(['Bread recipe', 'Weekend plans'])
        expect(app.has('empty-list')).toBe(false)
        expect(server.log()).toEqual(['ListConversations'])
      }),
    ))

  it('says so when there are no chats, and offers to start one', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        expect(app.text('empty-list')).toContain('No chats yet')
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        expect(screens(app)).toHaveLength(2)
        expect(app.has('empty-chat')).toBe(true)
      }),
    ))

  it('the bar button makes a chat and opens it empty, with nothing more to load', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* pressNewChat(app)
        yield* app.wait(REQUEST)
        expect(screens(app)).toHaveLength(2)
        expect(app.root.model()?.screens.map(screen => screen._tag)).toEqual(['Chats', 'Chat'])
        expect(barTitles(app)).toEqual(['Chats', 'New chat'])
        expect(app.text('empty-chat')).toContain('Ask anything')
        expect(app.has('chat-loading')).toBe(false)
        // The new chat is in the list under it, with no manual refresh.
        expect(app.has('chat-row-c10')).toBe(true)
        // The answer to "create" was written into the cache, so the chat itself was never asked for.
        expect(server.log()).toEqual(['ListConversations', 'CreateConversation', 'ListConversations'])
      }),
    ))

  it('on Android the bar button is a word in the bar', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ platform: 'android' })
        yield* app.press('bar-new-chat')
        yield* app.wait(REQUEST)
        expect(screens(app)).toHaveLength(2)
      }),
    ))
})

describe('a chat', () => {
  it('opening one pushes a native screen and shows its saved messages', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        // The screen is there at once. Its messages are still on their way.
        expect(screens(app)).toHaveLength(2)
        expect(app.has('chat-loading')).toBe(true)
        yield* app.wait(REQUEST)
        expect(app.has('chat-loading')).toBe(false)
        expect(barTitles(app)).toEqual(['Chats', 'Weekend plans'])
        expect(app.text('message-m2')).toBe('Any ideas for the weekend?')
        expect(markdownIn(app, 'reply-m3')?.props['markdown']).toBe('A walk by the **river**, then soup.')
        expect(app.has('empty-chat')).toBe(false)
      }),
    ))

  it('a swipe back, which the phone reports afterwards, drops the screen from the Model', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        yield* swipeBack(app)
        expect(app.root.model()?.screens.map(screen => screen._tag)).toEqual(['Chats'])
        expect(screens(app)).toHaveLength(1)
        expect(app.has('transcript')).toBe(false)
        // And another chat can be opened.
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        expect(app.text('message-m5')).toBe('How long does bread prove?')
      }),
    ))

  it('sending shows the message at once, then a reply that streams in and ends', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        const seen: Array<string> = []
        onEveryCommit(app, () => {
          const text = markdowns(app)[1]?.props['markdown']
          if (typeof text === 'string' && text !== seen[seen.length - 1]) seen.push(text)
        })
        yield* send(app, QUESTION)
        // On screen before the server has started a reply.
        expect(server.activeTurns()).toBe(0)
        expect(app.allText()).toContain(QUESTION)
        expect(app.byTestId('draft').props['text'] ?? '').toBe('')
        yield* app.wait(REPLY)
        // The reply grew in several steps, each one longer than the last, and ended whole.
        expect(seen.length).toBeGreaterThan(4)
        for (let index = 1; index < seen.length; index++) {
          expect((seen[index] as string).startsWith(seen[index - 1] as string)).toBe(true)
        }
        expect(seen[seen.length - 1]).toBe(ANSWER)
        expect(markdowns(app).map(node => node.props['markdown'])).toEqual([
          'A walk by the **river**, then soup.',
          ANSWER,
        ])
        // The saved chat has both messages, and the screen shows each once.
        expect(app.allText().filter(text => text === QUESTION)).toHaveLength(1)
        expect(server.activeTurns()).toBe(0)
        expect(app.root.model()).toBeDefined()
      }),
    ))

  it('the pieces of a reply arrive in bundles: far fewer draws than pieces', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        const before = app.commitCount()
        yield* send(app, QUESTION)
        yield* app.wait(REPLY)
        const pieces = ANSWER.match(/\s*\S{1,4}|\s+$/g)?.length ?? 0
        expect(pieces).toBeGreaterThan(100)
        expect(app.commitCount() - before).toBeLessThan(pieces / 2)
      }),
    ))

  it('the rows are not made again when the saved chat takes over from the live reply', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        yield* send(app, QUESTION)
        // In the middle of the reply.
        yield* app.wait(150)
        const liveReply = markdowns(app)[0]
        const liveQuestion = app.byTestId('message-local-c1-0')
        expect(liveReply).toBeDefined()
        expect(String(liveReply?.props['markdown']).length).toBeLessThan(ANSWER.length)
        yield* app.wait(REPLY)
        expect(markdowns(app)).toHaveLength(1)
        expect(markdowns(app)[0]?.props['markdown']).toBe(ANSWER)
        expect(markdowns(app)[0]?.reactTag).toBe(liveReply?.reactTag)
        expect(app.byTestId('message-local-c1-0').reactTag).toBe(liveQuestion.reactTag)
      }),
    ))

  it('after the reply ends, the list row shows the new last message with no refresh', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        expect(app.text('chat-preview-c1')).toBe('A walk by the river, then soup.')
        yield* send(app, QUESTION)
        yield* app.wait(REPLY)
        // The list is under the chat screen. Its row changed by itself.
        expect(app.text('chat-preview-c1')).toContain('About "What can you do?"')
        yield* swipeBack(app)
        expect(screens(app)).toHaveLength(1)
        expect(app.text('chat-preview-c1')).toContain('About "What can you do?"')
        // The chat with the newest message is first now.
        const titles = app.allText().filter(text => text === 'Bread recipe' || text === 'Weekend plans')
        expect(titles).toEqual(['Weekend plans', 'Bread recipe'])
      }),
    ))

  it('a message the server refuses comes off the screen, with the reason', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        server.setChaos({ refuseSend: true })
        yield* send(app, QUESTION)
        expect(app.allText()).toContain(QUESTION)
        yield* app.wait(REQUEST * 2)
        expect(app.allText()).not.toContain(QUESTION)
        expect(app.text('chat-notice').length).toBeGreaterThan(0)
        expect(markdowns(app)).toHaveLength(1)
      }),
    ))
})

describe('the reply stream', () => {
  it('a chat left in the middle of a reply: the list and the chat are both fresh afterwards', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        yield* send(app, QUESTION)
        yield* app.wait(150)
        expect(server.activeTurns()).toBe(1)
        yield* swipeBack(app)
        expect(screens(app)).toHaveLength(1)
        // The reply ends with no chat screen open.
        yield* app.wait(REPLY)
        expect(server.activeTurns()).toBe(0)
        expect(app.text('chat-preview-c1')).toContain('About "What can you do?"')
        // The chat was marked old while nobody showed it. Opening it must
        // never draw the half-written reply the cache still holds.
        const drawn: Array<string> = []
        onEveryCommit(app, () => {
          const text = markdowns(app)[1]?.props['markdown']
          if (typeof text === 'string') drawn.push(text)
        })
        const loads = () => server.log().filter(line => line === 'GetConversation c1').length
        const before = loads()
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        expect(loads()).toBe(before + 1)
        expect(markdowns(app)[1]?.props['markdown']).toBe(ANSWER)
        expect(drawn.every(text => text === ANSWER)).toBe(true)
        // The saved reply is finished, so the composer is free: a second question starts a second reply.
        yield* send(app, 'And what else?')
        yield* app.wait(REQUEST)
        expect(server.activeTurns()).toBe(1)
        yield* app.wait(REPLY)
      }),
    ))

  it('a chat opened in the middle of a reply joins it and shows it to the end', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        yield* send(app, QUESTION)
        yield* app.wait(120)
        yield* swipeBack(app)
        yield* app.press('chat-row-c1')
        yield* app.wait(60)
        expect(server.activeTurns()).toBe(1)
        const middle = String(markdowns(app)[1]?.props['markdown'])
        expect(middle.length).toBeGreaterThan(0)
        expect(middle.length).toBeLessThan(ANSWER.length)
        expect(ANSWER.startsWith(middle)).toBe(true)
        yield* app.wait(REPLY)
        expect(markdowns(app)[1]?.props['markdown']).toBe(ANSWER)
      }),
    ))

  it('a turn the client has never seen is joined from its first event', () =>
    run(
      Effect.gen(function* () {
        // The turn is started behind the keeper's back, as another launch of the app would have.
        const server = makeAiServer({ timing: FAST })
        const collected = yield* Effect.gen(function* () {
          const rpc = yield* AiChatRpcClient
          const chat = yield* rpc.CreateConversation({})
          const first = yield* Stream.runHead(rpc.SendMessage({ conversationId: chat.id, text: QUESTION }))
          const started = Option.getOrThrow(first)
          if (started._tag !== 'TurnStarted') throw new Error(`The first event was ${started._tag}`)
          const turnId = started.turnId
          expect((yield* TurnKeeper).has(turnId)).toBe(false)
          return yield* Stream.runCollect(Data.followTurn(turnId, update => update).stream)
        }).pipe(Effect.orDie, provideForTest(Layer.provideMerge(Data.layer, layerInProcess(server))))
        const updates = [...collected]
        expect(updates[0]?._tag).toBe('TurnStarted')
        expect(updates[updates.length - 1]?._tag).toBe('TurnFinished')
        const text = updates.flatMap(update => (update._tag === 'TextBatch' ? update.pieces : [])).join('')
        expect(text).toBe(ANSWER)
        expect(server.log().filter(line => line.startsWith('WatchTurn'))).toHaveLength(1)
      }),
    ))

  it('a connection cut in the middle is resumed from the last piece, and the reply ends whole', () =>
    run(
      Effect.gen(function* () {
        const { app, server, link } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        const seen: Array<string> = []
        onEveryCommit(app, () => {
          const text = markdowns(app)[1]?.props['markdown']
          if (typeof text === 'string' && text !== seen[seen.length - 1]) seen.push(text)
        })
        yield* send(app, QUESTION)
        yield* app.wait(150)
        yield* link.drop
        // The first try comes after a quarter of a second.
        yield* app.wait(REPLY)
        expect(link.stats().drops).toBe(1)
        expect(server.log().filter(line => line.startsWith('WatchTurn'))).toHaveLength(1)
        expect(markdowns(app)[1]?.props['markdown']).toBe(ANSWER)
        // Nothing was lost and nothing came twice: every step only added to the one before.
        for (let index = 1; index < seen.length; index++) {
          expect((seen[index] as string).startsWith(seen[index - 1] as string)).toBe(true)
        }
      }),
    ))

  it('coming back to the app during a reply asks for the rest again at once', () =>
    run(
      Effect.gen(function* () {
        const { app, server, device } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        yield* send(app, QUESTION)
        yield* app.wait(150)
        device.appState.set('background')
        yield* app.wait(20)
        device.appState.set('active')
        yield* app.wait(REPLY)
        expect(server.log().filter(line => line.startsWith('WatchTurn'))).toHaveLength(1)
        expect(markdowns(app)[1]?.props['markdown']).toBe(ANSWER)
      }),
    ))
})
