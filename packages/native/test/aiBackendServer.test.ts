/**
 * The pretend AI chat server, reached through the real RPC client over the
 * in-process NDJSON cable. No Foldkit here: these tests talk to the server
 * as any client would, with Effect's `TestClock` deciding when each token
 * is due.
 *
 * `test/aiBackend.test.ts` drives the same server through the demo program.
 */
import { Clock, Effect, Exit, Fiber, Layer, Option, Schema, Scope, Stream } from 'effect'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as TestClock from 'effect/testing/TestClock'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import * as Storage from '../src/device/storage.js'
import {
  AiChatRpcClient,
  ChatMessage,
  Conversation,
  type InProcessLink,
  NO_CHAOS,
  type Timing,
  TurnEvent,
  diskFromStorage,
  layerInProcess,
  makeAiServer,
  makeInProcessLink,
  memoryDisk,
  pickReply,
  tokenize,
} from '../src/aiChat/index.js'
import type { AiServer, Chaos, Disk } from '../src/aiChat/index.js'

/** Even timing, so counts and times can be checked exactly. */
const TIMING: Timing = {
  firstTokenMs: 500,
  tokensPerSecond: 100,
  jitter: 0,
  pauseChance: 0,
  pauseMs: 0,
  toolMs: 800,
  latencyMs: 0,
}

const PLAIN = 'How do I start running?'
const THINKING = 'Should I take the train or drive to the coast? Think it through.'
const TOOL = 'What is the weather in Lisbon tomorrow?'

type Rpc = typeof AiChatRpcClient.Service

/**
 * One running server and client. `close` ends the program, as closing the
 * app would; a second world on the same disk is the app opened again.
 */
const openWorld = async (
  options: Readonly<{ disk?: Disk; chaos?: Partial<Chaos>; timing?: Timing }> = {},
) => {
  const disk = options.disk ?? memoryDisk().disk
  const server: AiServer = makeAiServer({
    disk,
    timing: options.timing ?? TIMING,
    chaos: { ...NO_CHAOS, ...options.chaos },
  })
  const link: InProcessLink = makeInProcessLink()
  const scope = Effect.runSync(Scope.make())
  const clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(scope)))
  const context = await Effect.runPromise(
    Layer.buildWithScope(
      layerInProcess(server, link).pipe(Layer.provide(Layer.succeed(Clock.Clock, clock))),
      scope,
    ),
  )
  const run = <A, E>(effect: Effect.Effect<A, E, AiChatRpcClient>): Promise<A> =>
    Effect.runPromise(Effect.provideContext(effect, context))
  const rpc = await run(AiChatRpcClient.use(Effect.succeed))
  return {
    server,
    link,
    rpc,
    run,
    /** Moves time on. Tokens due by then are written. */
    advance: async (ms: number) => {
      await Effect.runPromise(clock.adjust(ms))
      await flush()
    },
    /** Starts reading a stream in the background, keeping what arrives. */
    collect: <E>(stream: Stream.Stream<TurnEvent, E>) => {
      const seen: Array<TurnEvent> = []
      const fiber = Effect.runFork(
        Effect.provideContext(
          Stream.runForEach(stream, event => Effect.sync(() => void seen.push(event))),
          context,
        ),
      )
      return { seen, fiber }
    },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

type World = Awaited<ReturnType<typeof openWorld>>

const textOf = (events: ReadonlyArray<TurnEvent>): string =>
  events.map(event => (event._tag === 'TextDelta' ? event.text : '')).join('')

const reasoningOf = (events: ReadonlyArray<TurnEvent>): string =>
  events.map(event => (event._tag === 'ReasoningDelta' ? event.text : '')).join('')

const savedText = (message: ChatMessage | undefined): string =>
  (message?.parts ?? []).map(part => (part._tag === 'Text' ? part.text : '')).join('')

/** Lets the work that the last step woke up finish. */
const flush = () => new Promise(resolve => setTimeout(resolve, 5))

/** Sends a question and runs time until the reply has ended. */
const sendAndFinish = async (world: World, conversationId: string, text: string) => {
  const { seen, fiber } = world.collect(world.rpc.SendMessage({ conversationId, text }))
  for (let index = 0; index < 400 && !seen.some(isEnd); index++) {
    await world.advance(250)
  }
  await Effect.runPromise(Fiber.await(fiber))
  return seen
}

const isEnd = (event: TurnEvent) => event._tag === 'TurnFinished' || event._tag === 'TurnFailed'

describe('the wire', () => {
  const samples: ReadonlyArray<TurnEvent> = [
    { _tag: 'TurnStarted', seq: 1, turnId: 't1', conversationId: 'c1', messageId: 'm2', userMessageId: 'm1' },
    { _tag: 'ReasoningDelta', seq: 2, text: ' "quoted"\nand \\ slashes' },
    { _tag: 'ReasoningDone', seq: 3, seconds: 2.4 },
    { _tag: 'ToolCallStarted', seq: 4, callId: 't1-call1', name: 'get_weather', input: { city: 'Lisbon', day: 'tomorrow' } },
    { _tag: 'ToolCallResult', seq: 5, callId: 't1-call1', output: '{"highC":21}' },
    { _tag: 'TextDelta', seq: 6, text: '| é | 🌧 |\n' },
    { _tag: 'TurnFinished', seq: 7, usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 3 }, reason: 'stopped' },
    { _tag: 'TurnFailed', seq: 8, reason: 'pretend overload', isRetryable: true },
  ]

  it('carries every kind of event through one line of NDJSON and back unchanged', () => {
    const codec = RpcSerialization.ndjson.codecFor(TurnEvent)
    const encode = Schema.encodeSync(codec)
    const decode = Schema.decodeUnknownSync(codec)
    const writer = RpcSerialization.ndjson.makeUnsafe()
    const reader = RpcSerialization.ndjson.makeUnsafe()
    expect(new Set(samples.map(each => each._tag)).size).toBe(TurnEvent.members.length)
    for (const event of samples) {
      const line = writer.encode(encode(event)) as string
      expect(line.endsWith('\n')).toBe(true)
      expect(line.slice(0, -1).includes('\n')).toBe(false)
      const [back] = reader.decode(line)
      expect(decode(back)).toEqual(event)
    }
  })

  it('carries a whole conversation through and back unchanged', () => {
    const codec = RpcSerialization.ndjson.codecFor(Conversation)
    const conversation: Conversation = {
      id: 'c1',
      title: 'Lisbon',
      createdAt: 1,
      updatedAt: 2,
      messageCount: 2,
      preview: 'Tomorrow',
      activeTurnId: null,
      messages: [
        {
          id: 'm1',
          role: 'user',
          parts: [{ _tag: 'Text', text: 'Weather?' }],
          status: 'complete',
          createdAt: 1,
          turnId: null,
          clientMessageId: 'k1',
          attachments: [{ name: 'map.png', mediaType: 'image/png', sizeBytes: 2048 }],
          failure: null,
          usage: null,
        },
        {
          id: 'm2',
          role: 'assistant',
          parts: [
            { _tag: 'Reasoning', text: 'Look it up.', seconds: 1.2 },
            { _tag: 'ToolCall', callId: 'x', name: 'get_weather', input: { city: 'Lisbon' }, output: null },
            { _tag: 'Text', text: '## Sunny' },
          ],
          status: 'stopped',
          createdAt: 2,
          turnId: 't1',
          clientMessageId: null,
          attachments: [],
          failure: null,
          usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 3 },
        },
      ],
    }
    const line = RpcSerialization.ndjson.makeUnsafe().encode(Schema.encodeSync(codec)(conversation)) as string
    const [back] = RpcSerialization.ndjson.makeUnsafe().decode(line)
    expect(Schema.decodeUnknownSync(codec)(back)).toEqual(conversation)
  })
})

describe('the pretend server over the in-process cable', () => {
  let world: World

  afterEach(async () => {
    await world?.close()
  })

  describe('a plain turn', () => {
    beforeEach(async () => {
      world = await openWorld()
    })

    it('streams the reply in token-sized pieces, numbered from 1 without gaps, and saves it', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const events = await sendAndFinish(world, id, PLAIN)

      expect(events[0]?._tag).toBe('TurnStarted')
      expect(events.at(-1)).toMatchObject({ _tag: 'TurnFinished', reason: 'complete' })
      expect(events.map(event => event.seq)).toEqual(events.map((_, index) => index + 1))
      expect(events.some(event => event._tag.startsWith('Reasoning') || event._tag.startsWith('Tool'))).toBe(false)
      const answer = pickReply(PLAIN).answer
      expect(textOf(events)).toBe(answer)
      const deltas = events.filter(event => event._tag === 'TextDelta')
      expect(deltas.length).toBe(tokenize(answer).length)
      expect(Math.max(...deltas.map(each => (each._tag === 'TextDelta' ? each.text.trim().length : 0)))).toBeLessThanOrEqual(4)

      const saved = await world.run(world.rpc.GetConversation({ id }))
      expect(saved.title).toBe('How do I start running')
      expect(saved.activeTurnId).toBeNull()
      expect(saved.messages.map(message => [message.role, message.status])).toEqual([
        ['user', 'complete'],
        ['assistant', 'complete'],
      ])
      expect(savedText(saved.messages[1])).toBe(answer)
      expect(saved.messages[1]?.usage?.outputTokens).toBe(deltas.length)
    })

    it('waits for the first token, then writes at the set speed', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const { seen } = world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      await world.advance(0)
      await flush()
      expect(seen.map(event => event._tag)).toEqual(['TurnStarted'])
      await world.advance(499)
      expect(seen.length).toBe(1)
      await world.advance(1)
      expect(seen.length).toBe(2)
      // 100 tokens a second: ten more in the next 100 ms.
      await world.advance(100)
      expect(seen.length).toBe(12)
    })

    it('says no to a second message while a reply is being written, and to unknown ids', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      await world.advance(10)
      await flush()
      const busy = await world.run(
        Stream.runDrain(world.rpc.SendMessage({ conversationId: id, text: 'again' })).pipe(Effect.flip),
      )
      expect(busy._tag).toBe('TurnInProgress')
      const missing = await world.run(world.rpc.GetConversation({ id: 'c999' }).pipe(Effect.flip))
      expect(missing._tag).toBe('ConversationNotFound')
      const gone = await world.run(Stream.runDrain(world.rpc.WatchTurn({ turnId: 't999', afterSeq: 0 })).pipe(Effect.flip))
      expect(gone._tag).toBe('TurnNotFound')
      const nothing = await world.run(world.rpc.CreateConversation({}))
      const regenerate = await world.run(
        Stream.runDrain(world.rpc.RegenerateTurn({ conversationId: nothing.id })).pipe(Effect.flip),
      )
      expect(regenerate._tag).toBe('BadRequest')
    })
  })

  describe('reasoning and tools', () => {
    beforeEach(async () => {
      world = await openWorld()
    })

    it('thinks first, says for how long, then answers, and saves the reasoning', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const events = await sendAndFinish(world, id, THINKING)
      const tags = events.map(event => event._tag)
      const done = tags.indexOf('ReasoningDone')
      expect(tags.slice(1, done).every(tag => tag === 'ReasoningDelta')).toBe(true)
      expect(done).toBeGreaterThan(10)
      expect(tags.slice(done + 1, -1).every(tag => tag === 'TextDelta')).toBe(true)
      const script = pickReply(THINKING)
      expect(reasoningOf(events)).toBe(script.reasoning)
      const seconds = events[done]?._tag === 'ReasoningDone' ? events[done].seconds : 0
      expect(seconds).toBeGreaterThan(1)

      const saved = await world.run(world.rpc.GetConversation({ id }))
      const reply = saved.messages[1]
      expect(reply?.parts.map(part => part._tag)).toEqual(['Reasoning', 'Text'])
      expect(reply?.parts[0]).toMatchObject({ _tag: 'Reasoning', text: script.reasoning, seconds })
    })

    it('calls the weather tool, waits for its answer, then answers', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const { seen } = world.collect(world.rpc.SendMessage({ conversationId: id, text: TOOL }))
      await world.advance(500)
      await flush()
      expect(seen.at(-1)).toMatchObject({
        _tag: 'ToolCallStarted',
        name: 'get_weather',
        input: { city: 'Lisbon', day: 'tomorrow' },
      })
      await world.advance(799)
      expect(seen.at(-1)?._tag).toBe('ToolCallStarted')
      await world.advance(1)
      expect(seen.at(-1)?._tag).toBe('ToolCallResult')
      for (let index = 0; index < 100 && !seen.some(isEnd); index++) await world.advance(250)
      expect(textOf(seen)).toBe(pickReply(TOOL).answer)
      const saved = await world.run(world.rpc.GetConversation({ id }))
      const call = saved.messages[1]?.parts[0]
      expect(call?._tag === 'ToolCall' && JSON.parse(call.output ?? '{}').city).toBe('Lisbon')
    })

    it('searches the notes for a notes question', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const events = await sendAndFinish(world, id, 'What do my notes say about the move?')
      expect(events.find(event => event._tag === 'ToolCallStarted')).toMatchObject({
        name: 'search_notes',
        input: { query: 'the move' },
      })
    })
  })

  describe('stop', () => {
    beforeEach(async () => {
      world = await openWorld()
    })

    it('stops mid-stream, keeps what was written marked stopped, and writes no more', async () => {
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const { seen } = world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      await world.advance(800)
      const started = seen[0]
      if (started?._tag !== 'TurnStarted') throw new Error('no start')
      await world.run(world.rpc.StopTurn({ turnId: started.turnId }))
      await flush()
      expect(seen.at(-1)).toMatchObject({ _tag: 'TurnFinished', reason: 'stopped' })
      const written = textOf(seen)
      expect(written.length).toBeGreaterThan(20)
      expect(pickReply(PLAIN).answer.startsWith(written)).toBe(true)
      const count = seen.length
      await world.advance(5000)
      expect(seen.length).toBe(count)

      const saved = await world.run(world.rpc.GetConversation({ id }))
      expect(saved.activeTurnId).toBeNull()
      expect(saved.messages[1]).toMatchObject({ status: 'stopped', failure: null })
      expect(savedText(saved.messages[1])).toBe(written)
      expect(world.server.activeTurns()).toBe(0)
    })
  })

  describe('chaos', () => {
    it('fails halfway, keeps the half, and a regenerate then writes it all', async () => {
      world = await openWorld({ chaos: { failMidStream: true } })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const events = await sendAndFinish(world, id, PLAIN)
      expect(events.at(-1)).toMatchObject({ _tag: 'TurnFailed', isRetryable: true })
      const half = textOf(events)
      const full = pickReply(PLAIN).answer
      expect(half.length).toBeGreaterThan(full.length * 0.3)
      expect(half.length).toBeLessThan(full.length * 0.7)
      const saved = await world.run(world.rpc.GetConversation({ id }))
      expect(saved.messages[1]).toMatchObject({ status: 'failed' })
      expect(saved.messages[1]?.failure).toContain('stopped in the middle')

      world.server.setChaos({ failMidStream: false })
      const { seen } = world.collect(world.rpc.RegenerateTurn({ conversationId: id }))
      for (let index = 0; index < 200 && !seen.some(isEnd); index++) await world.advance(250)
      expect(seen.at(-1)).toMatchObject({ reason: 'complete' })
      const again = await world.run(world.rpc.GetConversation({ id }))
      expect(again.messages).toHaveLength(2)
      expect(savedText(again.messages[1])).toBe(`*Here is another go at it.*\n\n${full}`)
    })

    it('cuts the connection a third of the way in; the turn goes on and WatchTurn picks it up', async () => {
      world = await openWorld({ chaos: { dropConnection: true } })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const { seen, fiber } = world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      for (let index = 0; index < 40 && world.link.stats().drops === 0; index++) await world.advance(250)
      const exit = await Effect.runPromise(Fiber.await(fiber))
      expect(Exit.isFailure(exit) && String(exit.cause)).toContain('RpcClientError')
      expect(world.server.activeTurns()).toBe(1)

      // Time passes while nobody listens: the server keeps writing.
      await world.advance(1000)
      const last = seen.at(-1)?.seq ?? 0
      const turnId = seen[0]?._tag === 'TurnStarted' ? seen[0].turnId : ''
      const rest = world.collect(world.rpc.WatchTurn({ turnId, afterSeq: last }))
      for (let index = 0; index < 200 && !rest.seen.some(isEnd); index++) await world.advance(250)
      const all = [...seen, ...rest.seen]
      expect(all.map(event => event.seq)).toEqual(all.map((_, index) => index + 1))
      expect(textOf(all)).toBe(pickReply(PLAIN).answer)
      expect(world.link.stats().drops).toBe(1)
    })

    it('waits four seconds or more for the first token when the start is slow', async () => {
      world = await openWorld({ chaos: { slowFirstToken: true } })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const { seen } = world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      await world.advance(3999)
      expect(seen.map(event => event._tag)).toEqual(['TurnStarted'])
      await world.advance(1)
      expect(seen.at(-1)?._tag).toBe('TextDelta')
    })

    it('refuses new messages while "refuse" is on', async () => {
      world = await openWorld({ chaos: { refuseSend: true } })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      const error = await world.run(
        Stream.runDrain(world.rpc.SendMessage({ conversationId: id, text: PLAIN })).pipe(Effect.flip),
      )
      expect(error).toMatchObject({ _tag: 'BadRequest' })
    })
  })

  describe('saved on the phone', () => {
    it('has every conversation and reply after the app is closed and opened', async () => {
      const disk = memoryDisk()
      world = await openWorld({ disk: disk.disk })
      const first = await world.run(world.rpc.CreateConversation({ title: 'Trip' }))
      await sendAndFinish(world, first.id, THINKING)
      const second = await world.run(world.rpc.CreateConversation({}))
      await sendAndFinish(world, second.id, TOOL)
      await world.run(world.rpc.RenameConversation({ id: second.id, title: 'Lisbon' }))
      const listBefore = await world.run(world.rpc.ListConversations())
      const before = await world.run(world.rpc.GetConversation({ id: first.id }))
      await world.close()

      world = await openWorld({ disk: disk.disk })
      expect(await world.run(world.rpc.ListConversations())).toEqual(listBefore)
      expect(await world.run(world.rpc.GetConversation({ id: first.id }))).toEqual(before)
      // Ids go on from where they were.
      const third = await world.run(world.rpc.CreateConversation({}))
      expect(listBefore.map(each => each.id)).not.toContain(third.id)
    })

    it('keeps a reply that was being written when the app closed, marked stopped', async () => {
      const disk = memoryDisk()
      world = await openWorld({ disk: disk.disk })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      await world.advance(1200)
      await world.close()

      world = await openWorld({ disk: disk.disk })
      const saved = await world.run(world.rpc.GetConversation({ id }))
      expect(saved.activeTurnId).toBeNull()
      expect(saved.messages[1]?.status).toBe('stopped')
      expect(savedText(saved.messages[1]).length).toBeGreaterThan(0)
    })

    it('marks a reply cut off by a crash as stopped, with a note, on the next start', async () => {
      const disk = memoryDisk()
      world = await openWorld({ disk: disk.disk })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      world.collect(world.rpc.SendMessage({ conversationId: id, text: PLAIN }))
      await world.advance(1500)
      // What the disk held at that moment: the app is killed, nothing more is saved.
      const snapshot = new Map(disk.entries)
      await world.close()

      world = await openWorld({ disk: memoryDisk(snapshot).disk })
      const saved = await world.run(world.rpc.GetConversation({ id }))
      expect(saved.messages[1]).toMatchObject({
        status: 'stopped',
        failure: 'The app closed while this reply was being written.',
      })
    })

    it('works on the phone\'s key-value storage too', async () => {
      const storage = Storage.makeTest()
      const service = Effect.runSync(Effect.provide(Storage.Storage.use(Effect.succeed), storage.layer))
      world = await openWorld({ disk: diskFromStorage(service) })
      const { id } = await world.run(world.rpc.CreateConversation({ title: 'Kept' }))
      await sendAndFinish(world, id, PLAIN)
      await world.close()
      expect([...storage.items.keys()].sort()).toEqual([`ai-chat.conversation-${id}`, 'ai-chat.index'])

      world = await openWorld({ disk: diskFromStorage(service) })
      const saved = await world.run(world.rpc.GetConversation({ id }))
      expect(saved.title).toBe('Kept')
      expect(savedText(saved.messages[1])).toBe(pickReply(PLAIN).answer)
    })

    it('goes on in memory when the disk fails, and counts the failures', async () => {
      const disk = memoryDisk()
      world = await openWorld({ disk: disk.disk })
      disk.setFailing(true)
      const { id } = await world.run(world.rpc.CreateConversation({}))
      expect((await world.run(world.rpc.ListConversations())).map(each => each.id)).toEqual([id])
      expect(world.server.diskErrors()).toBeGreaterThan(0)
    })

    it('forgets a deleted conversation on the disk as well', async () => {
      const disk = memoryDisk()
      world = await openWorld({ disk: disk.disk })
      const { id } = await world.run(world.rpc.CreateConversation({}))
      await world.run(world.rpc.DeleteConversation({ id }))
      expect([...disk.entries.keys()]).toEqual(['index'])
      await world.close()
      world = await openWorld({ disk: disk.disk })
      expect(await world.run(world.rpc.ListConversations())).toEqual([])
    })
  })

  it('sends everything as lines of JSON across the cable', async () => {
    world = await openWorld()
    const { id } = await world.run(world.rpc.CreateConversation({}))
    await sendAndFinish(world, id, PLAIN)
    const lines = world.link.recentLines()
    expect(lines.length).toBeGreaterThan(50)
    for (const { line } of lines) {
      expect(line.endsWith('\n')).toBe(true)
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(lines.some(each => each.direction === 'down' && each.line.includes('"TextDelta"'))).toBe(true)
    expect(Option.isSome(Option.fromNullishOr(world.link.stats().bytesDown))).toBe(true)
  })
})
