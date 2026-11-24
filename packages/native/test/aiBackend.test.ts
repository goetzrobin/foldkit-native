/**
 * The AI backend demo on the simulated phone: a person presses the buttons
 * and reads the screen. The pretend server, the in-process cable, the
 * client and the demo program all run for real. Effect's `TestClock`
 * decides when each token is due, and also drives the client's 32 ms
 * batching window and the once-a-second rate counter.
 *
 * The last part tests the client's Model pieces on their own.
 */
import { Clock, Effect, Exit, Layer, Option, Scope } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type AiServer,
  type Conversation,
  LiveTurnOps,
  NO_CHAOS,
  PendingOps,
  SPEEDS,
  type Timing,
  type TurnUpdate,
  makeAiServer,
  memoryDisk,
  pickReply,
  toUpdates,
  transcript,
} from '../src/aiChat/index.js'
import * as Device from '../src/device/index.js'
import { registerNavigation } from '../src/index.js'
import { PROMPTS, makeAiBackendDemo } from './demos/aiBackend.js'
import { type Phone, byTestId, flatten, hasTestId, press, startPhone, textOf } from './support/phone.js'

const TIMING: Timing = {
  firstTokenMs: 300,
  tokensPerSecond: 100,
  jitter: 0,
  pauseChance: 0,
  pauseMs: 0,
  toolMs: 500,
  latencyMs: 100,
}

const PLAIN = PROMPTS[0].text
const THINKING = PROMPTS[1].text
const TOOL = PROMPTS[2].text

/** A short real wait, for Foldkit and the fibers to run what is due. */
const breathe = (ms = 4) => new Promise(resolve => setTimeout(resolve, ms))

describe('the AI backend demo on the simulated phone', () => {
  let phone: Phone
  let device: ReturnType<typeof Device.makeTest>
  let disk: ReturnType<typeof memoryDisk>
  let server: AiServer
  let demo: ReturnType<typeof makeAiBackendDemo>
  let handle: { dispose: () => void } | undefined
  let clock: TestClock.TestClock
  let clockScope: Scope.Closeable
  let exits = 0

  const shown = (id: string): string => textOf(byTestId(phone.fabric, id))

  /** Moves the test clock on in small steps, letting the program run between them. */
  const advance = async (ms: number, step = 50): Promise<void> => {
    for (let passed = 0; passed < ms; passed += step) {
      await Effect.runPromise(clock.adjust(Math.min(step, ms - passed)))
      await breathe()
    }
    await breathe(30)
  }

  const tap = async (id: string): Promise<void> => {
    await press(phone.fabric, id)
  }

  const start = async (options: Readonly<{ timing?: Timing }> = {}): Promise<void> => {
    server = makeAiServer({ disk: disk.disk, timing: options.timing ?? TIMING, chaos: NO_CHAOS })
    demo = makeAiBackendDemo(
      phone.surface.container,
      {
        device: { platform: 'ios', osVersion: 26 },
        exit: () => {
          exits += 1
        },
      },
      device.layer,
      { server, extra: Layer.succeed(Clock.Clock, clock) },
    )
    handle = Runtime.embed(demo.program)
    await advance(200)
  }

  const stop = async (): Promise<void> => {
    handle?.dispose()
    handle = undefined
    await breathe(50)
  }

  const replyRows = (): ReadonlyArray<string> =>
    flatten([byTestId(phone.fabric, 'reply')])
      .filter(node => String(node.props['testID'] ?? '').startsWith('row-'))
      .map(node => `${String(node.props['testID'])}|${textOf(node)}`)

  const count = (line: string): number => server.log().filter(each => each.startsWith(line)).length

  /** Makes a conversation and opens it. */
  const newConversation = async (): Promise<void> => {
    await tap('new')
    await advance(300)
  }

  /** Runs time until the reply is no longer being written. */
  const untilDone = async (limitMs = 20000): Promise<void> => {
    // Long enough for the request to arrive and the reply to start.
    await advance(1000)
    for (let passed = 0; passed < limitMs; passed += 500) {
      if (!/streaming/.test(shown('turn-status'))) break
      await advance(500)
    }
    // The saved copy loads after the end is announced.
    await advance(400)
  }

  beforeEach(async () => {
    exits = 0
    registerNavigation()
    phone = startPhone()
    device = Device.makeTest()
    disk = memoryDisk()
    clockScope = Effect.runSync(Scope.make())
    clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(clockScope)))
  })

  afterEach(async () => {
    await stop()
    await Effect.runPromise(Scope.close(clockScope, Exit.void))
  })

  it('makes a conversation, shows the question at once, and writes the reply into it', async () => {
    await start()
    expect(shown('list-status')).toContain('No conversations yet')
    await newConversation()
    expect(shown('list-status')).toBe('1 conversations.')
    expect(hasTestId(phone.fabric, 'conversation-c1')).toBe(true)

    await tap('prompt-plain')
    // Before the server has answered: the question is there, greyed, "sending".
    expect(replyRows()).toEqual([`row-pending-k1|You (sending): ${PLAIN}`])

    await advance(800)
    expect(shown('turn-status')).toMatch(/streaming/)
    expect(shown('event-log')).toMatch(/^\+0 ms {2}TurnStarted t\d+, reply m\d+/)
    expect(replyRows()[0]).toMatch(/^row-saved-m\d+\|You: How do I start running\?$/)
    expect(replyRows()[1]).toMatch(/^row-live-m\d+\|Assistant \(streaming\): ## Starting/)

    await untilDone()
    expect(shown('turn-status')).toBe('No reply in progress.')
    const rows = replyRows()
    expect(rows).toHaveLength(2)
    expect(rows[1]).toBe(`${rows[1]?.split('|')[0]}|Assistant: ${pickReply(PLAIN).answer}`)
    expect(rows[1]).toMatch(/^row-saved-/)
    const log = shown('event-log')
    expect(log).toMatch(/\+\d+ ms {2}TurnFinished complete/)
    expect(shown('conversation-c1')).toContain('How do I start running · 2 messages')
  })

  it('takes the message off again when the server refuses it, and says why', async () => {
    await start()
    await newConversation()
    await tap('chaos-refuse')
    await tap('prompt-plain')
    expect(replyRows()).toEqual([`row-pending-k1|You (sending): ${PLAIN}`])
    await advance(300)
    expect(replyRows()).toEqual([])
    expect(shown('status')).toBe(
      'Not sent: The server is not taking messages right now (pretend 503). Your message was taken off.',
    )
    expect(shown('turn-status')).toBe('No reply in progress.')
  })

  it('refreshes the list through sync topics after create, rename and delete', async () => {
    await start()
    const lists = count('ListConversations')
    await newConversation()
    expect(count('ListConversations')).toBe(lists + 1)
    expect(shown('conversation-c1')).toContain('New chat · 0 messages')

    await tap('rename')
    await advance(300)
    expect(count('ListConversations')).toBe(lists + 2)
    expect(shown('conversation-c1')).toContain('Renamed 1 · 0 messages')
    expect(shown('status')).toBe('Renamed to "Renamed 1".')

    await tap('delete')
    await advance(300)
    expect(count('ListConversations')).toBe(lists + 3)
    expect(hasTestId(phone.fabric, 'conversation-c1')).toBe(false)
    expect(shown('list-status')).toContain('No conversations yet')
  })

  it('reaches the Model about 30 times a second at most, however fast the tokens come', async () => {
    await start({ timing: { ...TIMING, tokensPerSecond: 400 } })
    await newConversation()
    await tap('prompt-plain')
    await advance(3000, 20)
    const [messages, events] = (shown('turn-count').match(/\d+/g) ?? []).map(Number)
    const peak = Number(/highest (\d+)/.exec(shown('rate'))?.[1])
    expect(events).toBeGreaterThan(350)
    expect(peak).toBeGreaterThan(10)
    expect(peak).toBeLessThanOrEqual(33)
    expect(events! / messages!).toBeGreaterThan(8)
  })

  it('shows the reasoning, then the reply, for a question that makes it think', async () => {
    await start()
    await newConversation()
    await tap('prompt-thinking')
    await advance(1000)
    expect(replyRows()[1]).toMatch(/Assistant \(streaming\): \[thinking: /)
    expect(shown('event-log')).toContain('Reasoning ×')
    await advance(500)
    expect(shown('event-log')).toMatch(/ReasoningDone after \d/)
    expect(shown('event-log')).toMatch(/^\+0 ms {2}TurnStarted .*\+\d+ ms {2}Reasoning ×\d+ \(seq 2-/)
    await untilDone()
    expect(replyRows()[1]).toMatch(/Assistant: \[thought for \d+(\.\d)? s: \d+ characters\]\n## Train or car/)
  })

  it('shows the tool call running, then answered, then the reply', async () => {
    await start()
    await newConversation()
    await tap('prompt-tool')
    await advance(600)
    expect(replyRows()[1]).toContain('[tool get_weather(Lisbon, tomorrow) running…]')
    await advance(600)
    expect(replyRows()[1]).toContain('[tool get_weather(Lisbon, tomorrow) answered]')
    expect(shown('event-log')).toContain('ToolCallStarted get_weather(city=Lisbon, day=tomorrow)')
    await untilDone()
    expect(replyRows()[1]).toContain('## Tomorrow in Lisbon')
  })

  it('stops in the middle and keeps what was written, marked stopped', async () => {
    await start()
    await newConversation()
    await tap('prompt-plain')
    await advance(1500)
    await tap('stop')
    await advance(400)
    expect(shown('status')).toBe('Stopped. What was written is kept.')
    expect(shown('turn-status')).toBe('No reply in progress.')
    const reply = replyRows()[1] ?? ''
    expect(reply).toMatch(/^row-saved-m\d+\|Assistant \(stopped\): ## Starting/)
    const written = reply.split('Assistant (stopped): ')[1] ?? ''
    expect(written.length).toBeLessThan(pickReply(PLAIN).answer.length / 2)
    expect(pickReply(PLAIN).answer.startsWith(written)).toBe(true)
    expect(shown('event-log')).toContain('TurnFinished stopped')
  })

  it('writes the last reply again on Regenerate, in place of the old one', async () => {
    await start()
    await newConversation()
    await tap('prompt-plain')
    await untilDone()
    await tap('regenerate')
    await advance(800)
    const during = replyRows()
    expect(during).toHaveLength(2)
    expect(during[1]).toMatch(/row-live-.*\*Here is another go at it\.\*/)
    await untilDone()
    expect(replyRows()[1]).toContain(`Assistant: *Here is another go at it.*\n\n${pickReply(PLAIN).answer}`)
  })

  it('says why when the model fails halfway, and keeps the half', async () => {
    await start()
    await newConversation()
    await tap('chaos-fail')
    await tap('prompt-plain')
    await untilDone()
    const reply = replyRows()[1] ?? ''
    expect(reply).toMatch(/Assistant \(failed\): ## Starting/)
    expect(reply).toContain('! The model stopped in the middle of its answer (pretend overload).')
    expect(shown('event-log')).toContain('TurnFailed')
  })

  it('reconnects by itself when the connection drops, and the reply ends whole', async () => {
    await start()
    await newConversation()
    await tap('chaos-drop')
    await tap('prompt-plain')
    await untilDone()
    expect(shown('status')).toBe('Reconnected. The reply goes on where it stopped.')
    expect(count('WatchTurn')).toBe(1)
    expect(demo.link.stats().drops).toBe(1)
    expect(replyRows()[1]).toBe(`${replyRows()[1]?.split('|')[0]}|Assistant: ${pickReply(PLAIN).answer}`)
  })

  it('picks the reply up again after the app was in the background, with nothing lost or doubled', async () => {
    await start()
    await newConversation()
    await tap('prompt-plain')
    await advance(1000)
    device.appState.set('background')
    await advance(1500)
    device.appState.set('active')
    await advance(100)
    expect(count('WatchTurn')).toBe(1)
    expect(shown('event-log')).toContain('back in the app: resuming the reply')
    await untilDone()
    expect(replyRows()[1]).toBe(`${replyRows()[1]?.split('|')[0]}|Assistant: ${pickReply(PLAIN).answer}`)
  })

  it('still has the conversations when the program starts again', async () => {
    await start()
    await newConversation()
    await tap('prompt-tool')
    await untilDone()
    const before = replyRows()
    await stop()

    phone = startPhone()
    await start()
    expect(shown('list-status')).toBe('1 conversations.')
    await tap('conversation-c1')
    await advance(300)
    expect(replyRows()).toEqual(before)
  })

  it('sets the server\'s speed from the Speed button', async () => {
    await start()
    expect(shown('speed')).toBe('Speed: custom')
    await tap('speed')
    expect(shown('speed')).toBe('Speed: normal')
    expect(server.timing()).toBe(SPEEDS.normal)
    await tap('speed')
    expect(server.timing()).toBe(SPEEDS.fast)
    await tap('chaos-slow')
    expect(server.chaos().slowFirstToken).toBe(true)
    expect(server.timing()).toBe(SPEEDS.fast)
  })

  it('leaves through Menu', async () => {
    await start()
    await tap('menu')
    expect(exits).toBe(1)
  })
})

describe('the client\'s Model pieces', () => {
  const started = {
    _tag: 'TurnStarted' as const,
    seq: 1,
    turnId: 't3',
    conversationId: 'c1',
    messageId: 'm4',
    userMessageId: 'm2',
  }

  it('joins text pieces in a row into one update and keeps other events apart, in order', () => {
    const updates = toUpdates([
      { _tag: 'ReasoningDelta', seq: 2, text: 'a' },
      { _tag: 'ReasoningDelta', seq: 3, text: 'b' },
      { _tag: 'ReasoningDone', seq: 4, seconds: 1 },
      { _tag: 'TextDelta', seq: 5, text: 'Hel' },
      { _tag: 'TextDelta', seq: 6, text: 'lo' },
      { _tag: 'ToolCallStarted', seq: 7, callId: 'x', name: 'search_notes', input: {} },
      { _tag: 'TextDelta', seq: 8, text: '!' },
    ])
    expect(updates.map(each => each._tag)).toEqual([
      'ReasoningBatch',
      'ReasoningDone',
      'TextBatch',
      'ToolCallStarted',
      'TextBatch',
    ])
    expect(updates[2]).toEqual({ _tag: 'TextBatch', fromSeq: 5, pieces: ['Hel', 'lo'] })
  })

  it('skips pieces it already has when a turn is replayed', () => {
    const apply = (live: ReturnType<typeof LiveTurnOps.start>, update: TurnUpdate) =>
      Option.getOrThrow(LiveTurnOps.apply(Option.some(live), update))
    let live = LiveTurnOps.start(started)
    live = apply(live, { _tag: 'TextBatch', fromSeq: 2, pieces: ['One', ' two'] })
    live = apply(live, { _tag: 'TextBatch', fromSeq: 2, pieces: ['One', ' two', ' three'] })
    live = apply(live, started)
    expect(LiveTurnOps.text(live)).toBe('One two three')
    expect(live.lastSeq).toBe(4)
    live = apply(live, { _tag: 'ConnectionLost', reason: 'gone' })
    expect([live.connection, live.lostCount]).toEqual(['lost', 1])
    live = apply(live, { _tag: 'TurnFinished', seq: 5, usage: { inputTokens: 1, outputTokens: 3, reasoningTokens: 0 }, reason: 'complete' })
    expect([live.status, live.connection, live.lostCount]).toEqual(['complete', 'open', 0])
  })

  const conversation = (messages: Conversation['messages'], activeTurnId: string | null = null): Conversation => ({
    id: 'c1',
    title: 'x',
    createdAt: 0,
    updatedAt: 0,
    messageCount: messages.length,
    preview: '',
    activeTurnId,
    messages,
  })
  const message = (id: string, role: 'user' | 'assistant', text: string, status: 'complete' | 'streaming' = 'complete', clientMessageId: string | null = null) => ({
    id,
    role,
    parts: [{ _tag: 'Text' as const, text }],
    status,
    createdAt: 0,
    turnId: null,
    clientMessageId,
    attachments: [],
    failure: null,
    usage: null,
  })

  it('keeps the live reply until the saved copy is finished, then lets it go', () => {
    const finished = { ...LiveTurnOps.start(started), status: 'complete' as const }
    const streamingCopy = conversation([message('m2', 'user', 'q'), message('m4', 'assistant', 'par', 'streaming')], 't3')
    const doneCopy = conversation([message('m2', 'user', 'q'), message('m4', 'assistant', 'full')])
    const olderCopy = conversation([message('m2', 'user', 'q')])
    expect(Option.isSome(LiveTurnOps.settle(Option.some(finished), streamingCopy))).toBe(true)
    expect(Option.isSome(LiveTurnOps.settle(Option.some(finished), olderCopy))).toBe(true)
    expect(Option.isNone(LiveTurnOps.settle(Option.some(finished), doneCopy))).toBe(true)
    const writing = LiveTurnOps.start(started)
    expect(Option.isSome(LiveTurnOps.settle(Option.some(writing), doneCopy))).toBe(true)
  })

  it('puts saved, pending and live messages in one list, hiding a reply being written again', () => {
    const saved = conversation([
      message('m1', 'user', 'first', 'complete', 'k1'),
      message('m2', 'assistant', 'old reply'),
    ])
    const regenerating = { ...LiveTurnOps.start({ ...started, userMessageId: 'm1' }), parts: [{ _tag: 'Text' as const, text: 'new' }] }
    const pending = PendingOps.add([], { clientMessageId: 'k2', conversationId: 'c1', text: 'later', attachments: [], createdAt: 0 })
    const rows = transcript('c1', Option.some(saved), pending, Option.some(regenerating))
    expect(rows.map(row => [row.key, row.source])).toEqual([
      ['m1', 'saved'],
      ['k2', 'pending'],
      ['m4', 'live'],
    ])
    expect(PendingOps.settle(pending, conversation([message('m9', 'user', 'later', 'complete', 'k2')]))).toEqual([])
    expect(PendingOps.rollBack(pending, 'k2')).toEqual([])
    expect(transcript('c2', Option.some(saved), pending, Option.some(regenerating))).toEqual([])
  })
})
