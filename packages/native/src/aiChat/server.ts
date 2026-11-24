/**
 * The pretend AI chat server. It runs inside the app, with no network, and
 * answers the requests in `wire.ts` the way a real one would.
 *
 * It keeps conversations in memory and writes them to the phone (a `Disk`,
 * below) so they are still there after the app restarts. When a message
 * arrives it starts a "turn": a scripted model (see `replies.ts`) picks a
 * reply and sends it a few letters at a time, with a delay before the first
 * word, a speed, some unevenness, and the odd pause. Some replies think
 * first, and some call a pretend tool and wait for it.
 *
 * Two sets of dials, for the demo and the tests:
 *
 * - Timing: how long before the first word, how many tokens a second.
 * - Chaos: fail halfway through a reply, cut the connection halfway through,
 *   or wait a long time before the first word.
 *
 * A turn belongs to the server, not to the request that started it. If the
 * phone stops listening, the reply is still written and saved, and the phone
 * can pick it up again with `WatchTurn`. Only `StopTurn` stops it, and then
 * the part already written is kept and marked "stopped".
 *
 * For engineers. `makeAiServer(options).handlers` is the Layer of RPC
 * handlers for `AiChatRpcs`. Each build of it (each program start) loads
 * from the disk and owns the turns it starts: closing the Layer stops them
 * and saves what they wrote. Delays are `Effect.sleep`, so a `TestClock`
 * controls them.
 */
import { Data, Duration, Effect, Fiber, Layer, Option, Queue, Schema, Stream } from 'effect'

import type { Files } from '../device/audioNative.js'
import type { StorageService } from '../device/storage.js'
import { type Script, pickReply, titleFrom, tokenize } from './replies.js'
import {
  AiChatRpcs,
  BadRequest,
  type ChatMessage,
  ChatMessage as ChatMessageSchema,
  type Conversation,
  ConversationNotFound,
  type ConversationSummary,
  type Part,
  TurnInProgress,
  TurnNotFound,
  type TurnEvent,
  type Usage,
  applyToParts,
  isLastEvent,
} from './wire.js'

// THE DISK

export class DiskError extends Data.TaggedError('DiskError')<{ reason: string }> {}

/**
 * Where the server keeps its files: a few named pieces of text. Names are
 * short and use letters, digits and `-` only.
 */
export type Disk = Readonly<{
  /** Where it writes, in words, for the demo's screen. */
  describe: string
  read: (name: string) => Effect.Effect<Option.Option<string>, DiskError>
  write: (name: string, text: string) => Effect.Effect<void, DiskError>
  remove: (name: string) => Effect.Effect<void, DiskError>
}>

const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/**
 * Files in a folder of the app's documents: the voice notes' file service,
 * `Native.filesFrom(module, 'ai-chat')`. No size limit worth worrying about.
 */
export const diskFromFiles = (files: Files): Disk => {
  const uriOf = (name: string) => `${files.root}${name}.json`
  const attempt = <A>(run: () => A) =>
    Effect.try({ try: run, catch: cause => new DiskError({ reason: reasonOf(cause) }) })
  return {
    describe: `files in ${files.root}`,
    read: name => attempt(() => Option.fromNullishOr(files.readText(uriOf(name)))),
    write: (name, text) => attempt(() => files.writeText(uriOf(name), text)),
    remove: name => attempt(() => files.remove(uriOf(name))),
  }
}

/**
 * The phone's key-value storage (`Phone.Storage`). On a phone that is the
 * secure store, which Expo warns about above 2 KB a value: fine for a few
 * short chats, slow for long ones. Prefer `diskFromFiles` there.
 */
export const diskFromStorage = (storage: StorageService, prefix = 'ai-chat.'): Disk => ({
  describe: 'the phone\'s key-value storage',
  read: name =>
    Effect.mapError(storage.get(`${prefix}${name}`), error => new DiskError({ reason: error.reason })),
  write: (name, text) =>
    Effect.mapError(storage.set(`${prefix}${name}`, text), error => new DiskError({ reason: error.reason })),
  remove: name =>
    Effect.mapError(storage.remove(`${prefix}${name}`), error => new DiskError({ reason: error.reason })),
})

/** A disk in memory. Hand `entries` to a second server to stand for a restart. */
export const memoryDisk = (entries: Map<string, string> = new Map()) => {
  let failing = false
  const guard = <A>(run: () => A) =>
    Effect.suspend(() =>
      failing ? Effect.fail(new DiskError({ reason: 'the disk is full (pretend)' })) : Effect.sync(run),
    )
  const disk: Disk = {
    describe: 'memory only (gone when the app closes)',
    read: name => guard(() => Option.fromNullishOr(entries.get(name))),
    write: (name, text) => guard(() => void entries.set(name, text)),
    remove: name => guard(() => void entries.delete(name)),
  }
  return {
    disk,
    entries,
    setFailing: (value: boolean) => {
      failing = value
    },
  }
}

// THE DIALS

export type Timing = Readonly<{
  /** Wait before the first word (or the first reasoning), in milliseconds. */
  firstTokenMs: number
  /** Answer tokens a second. Reasoning streams twice as fast. */
  tokensPerSecond: number
  /** 0: every token takes as long. 0.5: each takes up to half more or less. */
  jitter: number
  /** The chance, for each token, of a pause. */
  pauseChance: number
  pauseMs: number
  /** How long a tool takes to answer. */
  toolMs: number
}>

export const SPEEDS = {
  slow: { firstTokenMs: 1500, tokensPerSecond: 12, jitter: 0.5, pauseChance: 0.03, pauseMs: 700, toolMs: 1800 },
  normal: { firstTokenMs: 700, tokensPerSecond: 45, jitter: 0.4, pauseChance: 0.01, pauseMs: 400, toolMs: 1000 },
  fast: { firstTokenMs: 250, tokensPerSecond: 160, jitter: 0.3, pauseChance: 0, pauseMs: 0, toolMs: 300 },
} as const satisfies Record<string, Timing>
export type Speed = keyof typeof SPEEDS

export type Chaos = Readonly<{
  /** The model gives up about halfway through the answer (`TurnFailed`). */
  failMidStream: boolean
  /** The connection is cut about a third of the way through. The turn goes on. */
  dropConnection: boolean
  /** The first word takes at least four seconds. */
  slowFirstToken: boolean
}>

export const NO_CHAOS: Chaos = { failMidStream: false, dropConnection: false, slowFirstToken: false }

export type AiServerOptions = Readonly<{
  disk?: Disk
  timing?: Timing
  chaos?: Chaos
  /** Seeds the unevenness of the timing, so a test sees the same run twice. */
  seed?: number
}>

export type AiServer = Readonly<{
  /** The RPC handlers. Each build loads from the disk and owns its turns. */
  handlers: Layer.Layer<HandlersOf>
  disk: Disk
  timing: () => Timing
  setTiming: (timing: Timing) => void
  chaos: () => Chaos
  setChaos: (patch: Partial<Chaos>) => void
  /**
   * The transport hands the server a way to cut the connection, so the
   * "drop the connection" chaos can do it at the right moment.
   */
  attachConnection: (drop: Effect.Effect<void>) => void
  /** Every request so far, oldest first: "SendMessage c1", "StopTurn t3". */
  log: () => ReadonlyArray<string>
  /** Turns being written right now. */
  activeTurns: () => number
  /** Saves that failed. The server goes on with what it has in memory. */
  diskErrors: () => number
}>

type HandlersOf = Layer.Success<ReturnType<typeof AiChatRpcs.toLayer>>

// WHAT IS STORED

const StoredIndex = Schema.Struct({
  version: Schema.Literal(1),
  nextId: Schema.Number,
  conversationIds: Schema.Array(Schema.String),
})

const StoredConversation = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  messages: Schema.Array(ChatMessageSchema),
})
type StoredConversation = typeof StoredConversation.Type

const decodeIndex = Schema.decodeUnknownOption(StoredIndex)
const decodeConversation = Schema.decodeUnknownOption(StoredConversation)

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const INDEX = 'index'
const fileOf = (id: string) => `conversation-${id}`

/** A conversation as the server holds it. Messages are replaced, never edited. */
type Held = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Array<ChatMessage>
  activeTurnId: string | null
}

type Turn = {
  turnId: string
  conversationId: string
  messageId: string
  events: Array<TurnEvent>
  listeners: Set<(event: TurnEvent) => void>
  isDone: boolean
  fiber: Fiber.Fiber<void> | undefined
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number }
}

/** How many finished turns are kept for `WatchTurn`. */
const FINISHED_TURNS_KEPT = 20

const CLOSED_WHILE_WRITING = 'The app closed while this reply was being written.'

/** A small, seeded random number source, so runs can be repeated. */
const seeded = (seed: number) => {
  let state = seed >>> 0
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const textOfParts = (parts: ReadonlyArray<Part>): string =>
  parts
    .filter(part => part._tag === 'Text')
    .map(part => (part._tag === 'Text' ? part.text : ''))
    .join('')

/** The start of a message as plain words, for the conversation list. */
const previewOf = (messages: ReadonlyArray<ChatMessage>): string => {
  const last = messages[messages.length - 1]
  if (last === undefined) return ''
  const plain = textOfParts(last.parts)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\]\([^)]*\)/g, '')
    .replace(/[*_`[\]]+/g, '')
    .replace(/(^|\n)\s*([#>|-]+|\d+\.)\s/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 80 ? `${plain.slice(0, 79)}…` : plain
}

const summaryOf = (held: Held): ConversationSummary => ({
  id: held.id,
  title: held.title,
  createdAt: held.createdAt,
  updatedAt: held.updatedAt,
  messageCount: held.messages.length,
  preview: previewOf(held.messages),
})

const conversationOf = (held: Held): Conversation => ({
  ...summaryOf(held),
  messages: [...held.messages],
  activeTurnId: held.activeTurnId,
})

/** What an event does to the reply being written. */
const applyEvent = (message: ChatMessage, event: TurnEvent): ChatMessage => {
  switch (event._tag) {
    case 'TurnFinished':
      return {
        ...message,
        status: event.reason === 'stopped' ? 'stopped' : 'complete',
        usage: event.usage,
      }
    case 'TurnFailed':
      return { ...message, status: 'failed', failure: event.reason }
    default:
      return { ...message, parts: applyToParts(message.parts, event) }
  }
}

export const makeAiServer = (options: AiServerOptions = {}): AiServer => {
  const disk = options.disk ?? memoryDisk().disk
  let timing: Timing = options.timing ?? SPEEDS.normal
  let chaos: Chaos = options.chaos ?? NO_CHAOS
  let dropConnection: Effect.Effect<void> = Effect.void
  const random = seeded(options.seed ?? 7)
  const log: Array<string> = []
  let activeTurns = 0
  let diskErrors = 0

  const handlers = AiChatRpcs.toLayer(
    Effect.gen(function* () {
      const scope = yield* Effect.scope

      // LOADING

      const conversations = new Map<string, Held>()
      let order: Array<string> = []
      let nextId = 1

      const savedIndex = yield* disk.read(INDEX).pipe(
        Effect.map(Option.flatMap(text => decodeIndex(parse(text)))),
        Effect.catch(() => Effect.sync(() => {
          diskErrors += 1
          return Option.none()
        })),
      )
      if (Option.isSome(savedIndex)) {
        nextId = savedIndex.value.nextId
        for (const id of savedIndex.value.conversationIds) {
          const stored = yield* disk.read(fileOf(id)).pipe(
            Effect.map(Option.flatMap(text => decodeConversation(parse(text)))),
            Effect.catch(() => Effect.succeed(Option.none<StoredConversation>())),
          )
          if (Option.isNone(stored)) continue
          conversations.set(id, {
            ...stored.value,
            // A reply that was being written when the app closed stays as
            // far as it got, marked stopped.
            messages: stored.value.messages.map(message =>
              message.status === 'streaming'
                ? { ...message, status: 'stopped', failure: CLOSED_WHILE_WRITING }
                : message,
            ),
            activeTurnId: null,
          })
          order.push(id)
        }
      }

      // SAVING

      const quietly = (effect: Effect.Effect<void, DiskError>) =>
        Effect.catch(effect, () =>
          Effect.sync(() => {
            diskErrors += 1
          }),
        )

      const saveIndex = () =>
        quietly(
          disk.write(INDEX, JSON.stringify({ version: 1, nextId, conversationIds: order })),
        )

      const saveConversation = (id: string) =>
        Effect.suspend(() => {
          const held = conversations.get(id)
          if (held === undefined) return Effect.void
          const stored: StoredConversation = {
            id: held.id,
            title: held.title,
            createdAt: held.createdAt,
            updatedAt: held.updatedAt,
            messages: held.messages,
          }
          return quietly(disk.write(fileOf(id), JSON.stringify(stored)))
        })

      const newId = (letter: 'c' | 'm' | 't'): string => `${letter}${nextId++}`

      const find = (id: string) =>
        Effect.suspend(() => {
          const held = conversations.get(id)
          return held === undefined
            ? Effect.fail(new ConversationNotFound({ conversationId: id }))
            : Effect.succeed(held)
        })

      // TURNS

      const turns = new Map<string, Turn>()

      const forgetOldTurns = () => {
        const finished = [...turns.values()].filter(turn => turn.isDone)
        for (const turn of finished.slice(0, Math.max(0, finished.length - FINISHED_TURNS_KEPT))) {
          turns.delete(turn.turnId)
        }
      }

      /** The one place an event is made: numbered, applied, saved, sent. */
      const emit = (turn: Turn, make: (seq: number) => TurnEvent): Effect.Effect<void> =>
        Effect.suspend(() => {
          if (turn.isDone) return Effect.void
          const event = make(turn.events.length + 1)
          turn.events.push(event)
          const held = conversations.get(turn.conversationId)
          if (held !== undefined) {
            const index = held.messages.findIndex(message => message.id === turn.messageId)
            const message = held.messages[index]
            if (message !== undefined) held.messages[index] = applyEvent(message, event)
          }
          const isLast = isLastEvent(event)
          if (isLast) {
            turn.isDone = true
            activeTurns -= 1
            if (held !== undefined && held.activeTurnId === turn.turnId) {
              held.activeTurnId = null
              held.updatedAt = Date.now()
            }
          }
          for (const listener of [...turn.listeners]) listener(event)
          if (isLast) forgetOldTurns()
          // Saved at the end, and now and then on the way, so that a crash
          // loses only the last few words.
          return isLast || turn.events.length % 40 === 0
            ? saveConversation(turn.conversationId)
            : Effect.void
        })

      const sleep = (ms: number) => Effect.sleep(Duration.millis(Math.max(0, Math.round(ms))))

      /** How long one token takes, with the unevenness and the odd pause. */
      const tokenDelay = (tokensPerSecond: number): number => {
        const base = 1000 / Math.max(1, tokensPerSecond)
        const uneven = base * (1 + timing.jitter * (random() * 2 - 1))
        const pause = random() < timing.pauseChance ? timing.pauseMs : 0
        return uneven + pause
      }

      const write = (turn: Turn, script: Script, plan: Chaos, isRetry: boolean) =>
        Effect.gen(function* () {
          const firstWait = plan.slowFirstToken
            ? Math.max(4000, timing.firstTokenMs * 6)
            : timing.firstTokenMs
          yield* sleep(firstWait)

          if (script.reasoning !== undefined) {
            let thought = firstWait
            for (const token of tokenize(script.reasoning)) {
              yield* emit(turn, seq => ({ _tag: 'ReasoningDelta', seq, text: token }))
              turn.usage.reasoningTokens += 1
              const delay = tokenDelay(timing.tokensPerSecond * 2)
              thought += delay
              yield* sleep(delay)
            }
            const seconds = Math.max(1, Math.round(thought / 100) / 10)
            yield* emit(turn, seq => ({ _tag: 'ReasoningDone', seq, seconds }))
          }

          if (script.tool !== undefined) {
            const { name, input, output } = script.tool
            const callId = `${turn.turnId}-call1`
            yield* emit(turn, seq => ({ _tag: 'ToolCallStarted', seq, callId, name, input }))
            yield* sleep(timing.toolMs)
            yield* emit(turn, seq => ({ _tag: 'ToolCallResult', seq, callId, output }))
            yield* sleep(timing.firstTokenMs / 2)
          }

          const answer = isRetry ? `*Here is another go at it.*\n\n${script.answer}` : script.answer
          const tokens = tokenize(answer)
          const failAt = plan.failMidStream ? Math.floor(tokens.length * 0.5) : -1
          const dropAt = plan.dropConnection ? Math.floor(tokens.length * 0.35) : -1
          for (let index = 0; index < tokens.length; index++) {
            if (index === failAt) {
              yield* emit(turn, seq => ({
                _tag: 'TurnFailed',
                seq,
                reason: 'The model stopped in the middle of its answer (pretend overload).',
                isRetryable: true,
              }))
              return
            }
            if (index === dropAt) yield* dropConnection
            const text = tokens[index] as string
            yield* emit(turn, seq => ({ _tag: 'TextDelta', seq, text }))
            turn.usage.outputTokens += 1
            yield* sleep(tokenDelay(timing.tokensPerSecond))
          }
          yield* emit(turn, seq => ({
            _tag: 'TurnFinished',
            seq,
            usage: { ...turn.usage } satisfies Usage,
            reason: 'complete',
          }))
        }).pipe(
          // Stop, or the program closing: keep what was written, marked stopped.
          Effect.onInterrupt(() =>
            emit(turn, seq => ({
              _tag: 'TurnFinished',
              seq,
              usage: { ...turn.usage },
              reason: 'stopped',
            })),
          ),
        )

      /** Starts writing a reply to `userMessage` and returns its turn. */
      const startTurn = (held: Held, userMessage: ChatMessage, isRetry: boolean) =>
        Effect.gen(function* () {
          const turnId = newId('t')
          const messageId = newId('m')
          const now = Date.now()
          held.messages.push({
            id: messageId,
            role: 'assistant',
            parts: [],
            status: 'streaming',
            createdAt: now,
            turnId,
            clientMessageId: null,
            attachments: [],
            failure: null,
            usage: null,
          })
          held.activeTurnId = turnId
          held.updatedAt = now
          const history = held.messages
            .slice(0, -1)
            .map(message => textOfParts(message.parts))
            .join('\n')
          const turn: Turn = {
            turnId,
            conversationId: held.id,
            messageId,
            events: [],
            listeners: new Set(),
            isDone: false,
            fiber: undefined,
            usage: { inputTokens: tokenize(history).length, outputTokens: 0, reasoningTokens: 0 },
          }
          turns.set(turnId, turn)
          activeTurns += 1
          yield* emit(turn, seq => ({
            _tag: 'TurnStarted',
            seq,
            turnId,
            conversationId: held.id,
            messageId,
            userMessageId: userMessage.id,
          }))
          yield* saveIndex()
          yield* saveConversation(held.id)
          const script = pickReply(textOfParts(userMessage.parts))
          turn.fiber = yield* Effect.forkIn(write(turn, script, chaos, isRetry), scope)
          return turn
        })

      /** The turn's events after `afterSeq`, then the rest as they are made. */
      const follow = (turn: Turn, afterSeq: number): Stream.Stream<TurnEvent> =>
        Stream.callback<TurnEvent>(queue =>
          Effect.acquireRelease(
            Effect.sync(() => {
              for (const event of turn.events) {
                if (event.seq > afterSeq) Queue.offerUnsafe(queue, event)
              }
              if (turn.isDone) {
                Queue.endUnsafe(queue)
                return undefined
              }
              const listener = (event: TurnEvent) => {
                Queue.offerUnsafe(queue, event)
                if (isLastEvent(event)) Queue.endUnsafe(queue)
              }
              turn.listeners.add(listener)
              return listener
            }),
            listener =>
              Effect.sync(() => {
                if (listener !== undefined) turn.listeners.delete(listener)
              }),
          ),
        )

      const busy = (held: Held) =>
        held.activeTurnId === null
          ? Effect.void
          : Effect.fail(new TurnInProgress({ conversationId: held.id, turnId: held.activeTurnId }))

      const note = (line: string) => Effect.sync(() => void log.push(line))

      return AiChatRpcs.of({
        ListConversations: () =>
          note('ListConversations').pipe(
            Effect.map(() =>
              order
                .map(id => conversations.get(id))
                .filter((held): held is Held => held !== undefined)
                .map(summaryOf)
                .sort((a, b) => b.updatedAt - a.updatedAt),
            ),
          ),

        GetConversation: ({ id }) =>
          note(`GetConversation ${id}`).pipe(Effect.andThen(find(id)), Effect.map(conversationOf)),

        CreateConversation: ({ title }) =>
          Effect.gen(function* () {
            yield* note('CreateConversation')
            const now = Date.now()
            const held: Held = {
              id: newId('c'),
              title: title?.trim() || 'New chat',
              createdAt: now,
              updatedAt: now,
              messages: [],
              activeTurnId: null,
            }
            conversations.set(held.id, held)
            order = [held.id, ...order]
            yield* saveConversation(held.id)
            yield* saveIndex()
            return summaryOf(held)
          }),

        RenameConversation: ({ id, title }) =>
          Effect.gen(function* () {
            yield* note(`RenameConversation ${id}`)
            const held = yield* find(id)
            const clean = title.trim()
            if (clean === '') return yield* new BadRequest({ reason: 'A title cannot be empty.' })
            held.title = clean
            held.updatedAt = Date.now()
            yield* saveConversation(id)
            return summaryOf(held)
          }),

        DeleteConversation: ({ id }) =>
          Effect.gen(function* () {
            yield* note(`DeleteConversation ${id}`)
            const held = yield* find(id)
            const turn = held.activeTurnId === null ? undefined : turns.get(held.activeTurnId)
            conversations.delete(id)
            order = order.filter(each => each !== id)
            if (turn?.fiber !== undefined) yield* Fiber.interrupt(turn.fiber)
            yield* quietly(disk.remove(fileOf(id)))
            yield* saveIndex()
          }),

        SendMessage: ({ conversationId, text, attachments, clientMessageId }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* note(`SendMessage ${conversationId}`)
              const held = yield* find(conversationId)
              yield* busy(held)
              if (text.trim() === '' && (attachments ?? []).length === 0) {
                return yield* new BadRequest({ reason: 'A message needs some text.' })
              }
              const userMessage: ChatMessage = {
                id: newId('m'),
                role: 'user',
                parts: [{ _tag: 'Text', text }],
                status: 'complete',
                createdAt: Date.now(),
                turnId: null,
                clientMessageId: clientMessageId ?? null,
                attachments: attachments ?? [],
                failure: null,
                usage: null,
              }
              if (held.messages.length === 0 && held.title === 'New chat') held.title = titleFrom(text)
              held.messages.push(userMessage)
              const turn = yield* startTurn(held, userMessage, false)
              return follow(turn, 0)
            }),
          ),

        StopTurn: ({ turnId }) =>
          Effect.gen(function* () {
            yield* note(`StopTurn ${turnId}`)
            const turn = turns.get(turnId)
            if (turn === undefined) return yield* new TurnNotFound({ turnId })
            // Waits until the stopped reply is saved and announced.
            if (turn.fiber !== undefined) yield* Fiber.interrupt(turn.fiber)
          }),

        RegenerateTurn: ({ conversationId }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* note(`RegenerateTurn ${conversationId}`)
              const held = yield* find(conversationId)
              yield* busy(held)
              const last = held.messages[held.messages.length - 1]
              const question = held.messages[held.messages.length - 2]
              if (last?.role !== 'assistant' || question?.role !== 'user') {
                return yield* new BadRequest({ reason: 'There is no reply to write again.' })
              }
              held.messages.pop()
              const turn = yield* startTurn(held, question, true)
              return follow(turn, 0)
            }),
          ),

        WatchTurn: ({ turnId, afterSeq }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              yield* note(`WatchTurn ${turnId} after ${afterSeq}`)
              const turn = turns.get(turnId)
              if (turn === undefined) return yield* new TurnNotFound({ turnId })
              return follow(turn, afterSeq)
            }),
          ),
      })
    }),
  )

  return {
    handlers,
    disk,
    timing: () => timing,
    setTiming: next => {
      timing = next
    },
    chaos: () => chaos,
    setChaos: patch => {
      chaos = { ...chaos, ...patch }
    },
    attachConnection: drop => {
      dropConnection = drop
    },
    log: () => log,
    activeTurns: () => activeTurns,
    diskErrors: () => diskErrors,
  }
}
