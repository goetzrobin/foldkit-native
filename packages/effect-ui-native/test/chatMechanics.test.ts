/**
 * Effect Chat, step 2: how the chat screen moves. End to end on a simulated
 * phone whose scroll view behaves as UIKit's does and whose keyboard moves
 * the composer's bar (`src/testing/ChatPhone.ts`).
 *
 * The pretend AI server, the cable, the turn keeper and the query cache run
 * for real, and the tests wait in real time.
 *
 * Each `describe` is one line of the step 2 brief. Each was a bug on a real
 * iPhone once, in Fold Chat.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { pickReply } from '../../native/src/host/aiChat/replies.js'
import { type Timing, makeAiServer, memoryDisk } from '../../native/src/host/aiChat/server.js'
import { makeInProcessLink } from '../../native/src/host/aiChat/transport.js'
import type { ChatMessage } from '../../native/src/host/aiChat/wire.js'
import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../chat/app.js'
import { PUSH_WAIT_MS } from '../chat/parts/chatScreen.js'
import { chatServices } from '../chat/start.js'
import { AnchoredList, Phone } from '../src/index.js'
import { ChatPhone, NativeTest } from '../src/testing/index.js'
import { provideForTest, run } from './support.js'

vi.setConfig({ testTimeout: 120_000 })

/** A reply takes a second or two, so it can be seen growing. */
const TIMING: Timing = {
  firstTokenMs: 40,
  tokensPerSecond: 500,
  jitter: 0,
  pauseChance: 0,
  pauseMs: 0,
  toolMs: 20,
  latencyMs: 10,
}
const REQUEST = 80

/** The composer's content: 8 above the pill, the pill, 8 under it. */
const COMPOSER = 68
const { HOME_INDICATOR, KEYBOARD, VIEWPORT, LIST_TOP } = ChatPhone
/** Your question is one bubble. */
const QUESTION = 64
/** How many letters the phone fits on a line of a reply. */
const CHARS_PER_LINE = 22
/** Where the question is held, from the list's top edge. */
const PIN = 16

const RUNNING = 'How do I start running?'
const SHORT = 'What can you do?'

const flatten = NativeTest.flatten
const textOf = (node: FakeFabricNode): string =>
  flatten([node])
    .map(each => (each.viewName === 'RawText' ? each.props['text'] : each.props['markdown']))
    .filter((value): value is string => typeof value === 'string')
    .join('')

const rowIdOf = (row: FakeFabricNode): string | undefined =>
  flatten([row])
    .map(node => String(node.props['testID'] ?? ''))
    .find(each => each.startsWith('row-'))

/** How tall the phone lays a row out: a question is one bubble, a reply grows with its text. */
const heightOf = (row: FakeFabricNode, late: ReadonlyMap<string, number> = new Map()): number | undefined => {
  const id = rowIdOf(row)
  if (id === undefined) return undefined
  if (flatten([row]).some(node => String(node.props['testID'] ?? '').startsWith('message-'))) return QUESTION
  return 20 + 24 * Math.max(1, Math.ceil(textOf(row).length / CHARS_PER_LINE)) + (late.get(id) ?? 0)
}

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

/** One saved chat, longer than the screen. */
const seeded = () => {
  const disk = memoryDisk()
  const messages: Array<ChatMessage> = []
  for (let at = 0; at < 8; at++) {
    messages.push(message(`m${10 + at * 2}`, 'user', `Question ${at + 1}`, 1_000 + at * 2))
    messages.push(message(`m${11 + at * 2}`, 'assistant', `Answer ${at + 1}. ${'More words follow here. '.repeat(12)}`, 1_001 + at * 2))
  }
  disk.entries.set('conversation-c1', JSON.stringify({ id: 'c1', title: 'A long chat', createdAt: 1_000, updatedAt: 2_000, messages }))
  disk.entries.set('index', JSON.stringify({ version: 1, nextId: 40, conversationIds: ['c1'] }))
  return disk
}

type StartOptions = Readonly<{
  disk?: ReturnType<typeof memoryDisk>
  timing?: Timing
  /** The phone moves the bar (an iPhone build). Default true. */
  phoneKeyboard?: boolean
  platform?: 'ios' | 'android'
}>

let stops: Array<() => void> = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  ChatPhone.reset()
  resetMarkdownSetup()
})

const startApp = (options: StartOptions = {}) =>
  Effect.gen(function* () {
    registerNavigation()
    const animated = options.phoneKeyboard === false ? undefined : ChatPhone.usePhoneKeyboard()
    const device = Phone.Device.makeTest()
    const disk = options.disk ?? memoryDisk()
    const server = makeAiServer({ disk: disk.disk, timing: options.timing ?? TIMING })
    const link = makeInProcessLink()
    const layer = Layer.provideMerge(chatServices(device.layer, { server, link }), device.layer)
    const platform = options.platform ?? 'ios'
    const app = yield* NativeTest.mount(App, { platform }, { platform }).pipe(provideForTest(layer))
    yield* app.wait(REQUEST)
    return { app, device, server, animated }
  })

type Started = Effect.Success<ReturnType<typeof startApp>>
type TestApp = Started['app']

const nodes = (app: TestApp) => flatten(app.fabric.committed)
const chatScreen = (app: TestApp): FakeFabricNode => {
  const screens = nodes(app).filter(node => node.viewName === 'RNSScreen')
  return screens[screens.length - 1] as FakeFabricNode
}
const focusCommands = (app: TestApp) => app.commands().filter(command => command.name === 'focus')

type PhoneOptions = Readonly<{
  measuredBottom?: number
  glideSteps?: number
  lateEnds?: boolean
  insetScrolls?: boolean
  late?: Map<string, number>
  measureDelay?: (row: FakeFabricNode) => number | undefined
  onScroll?: (scroll: ChatPhone.ScrollPhone) => void
}>

/** The phone's part for the chat on screen. */
const startPhone = (started: Started, options: PhoneOptions = {}) =>
  Effect.gen(function* () {
    const phone = yield* ChatPhone.start(started.app, {
      animated: started.animated as NonNullable<Started['animated']>,
      composer: COMPOSER,
      listId: 'transcript',
      rowHeight: row => heightOf(row, options.late),
      ...(options.measuredBottom === undefined ? {} : { measuredBottom: options.measuredBottom }),
      ...(options.glideSteps === undefined ? {} : { glideSteps: options.glideSteps }),
      ...(options.lateEnds === undefined ? {} : { lateEnds: options.lateEnds }),
      ...(options.insetScrolls === undefined ? {} : { insetScrolls: options.insetScrolls }),
      ...(options.measureDelay === undefined ? {} : { measureDelay: options.measureDelay }),
      ...(options.onScroll === undefined ? {} : { onScroll: options.onScroll }),
    })
    stops.push(phone.stop)
    return phone
  })

const breathe = (ms: number) => Effect.promise(() => new Promise<void>(resolve => setTimeout(resolve, ms)))

const until = (app: TestApp, check: () => boolean, ms = 8000, what = 'the wait') =>
  Effect.gen(function* () {
    const deadline = Date.now() + ms
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`Gave up on ${what}`)
      yield* app.wait(15)
    }
  })

/** A new chat on an iPhone, with the phone's part started. */
const newChat = (options: StartOptions & PhoneOptions = {}) =>
  Effect.gen(function* () {
    const started = yield* startApp(options)
    yield* until(started.app, () => started.app.has('start-chat'), 3000, 'the list of chats')
    yield* started.app.press('start-chat')
    yield* until(started.app, () => started.app.has('transcript'), 3000, 'the new chat')
    yield* started.app.wait(REQUEST)
    const phone = yield* startPhone(started, options)
    return { ...started, phone }
  })

const send = (app: TestApp, text: string) => Effect.andThen(app.typeText('draft', text), app.press('send'))

/** Sends, and waits until the reply has ended and the saved chat is back. */
const ask = (app: TestApp, text: string) =>
  Effect.gen(function* () {
    yield* send(app, text)
    yield* until(app, () => app.has('stop'), 3000, 'the reply to start')
    yield* until(app, () => !app.has('stop'), 20_000, 'the reply to end')
    yield* app.wait(REQUEST * 2)
  })

const numbers = () => {
  const found = AnchoredList.numbers('transcript')
  if (found === undefined) throw new Error('No transcript list')
  return found
}

/** The row keys on screen, in order, with `user` or `reply`. */
const rowIds = (app: TestApp): Array<string> =>
  nodes(app)
    .map(node => String(node.props['testID'] ?? ''))
    .filter(id => id.startsWith('row-'))

const questionIds = (app: TestApp): Array<string> => rowIds(app).filter(id => id.startsWith('row-local-') || /^row-m\d+$/.test(id) === false)

/** The newest question's row and the newest reply's row. */
const lastQuestion = (app: TestApp): string => rowIds(app).filter(id => id.startsWith('row-local-')).at(-1) as string
const lastReply = (app: TestApp): string => rowIds(app).filter(id => /^row-m\d+$/.test(id)).at(-1) as string

/** A finger drags the list to its end and lets go: the list is at its end and follows it. */
const dragToEnd = (started: { app: TestApp; phone: ChatPhone.ChatPhone }) =>
  Effect.gen(function* () {
    started.phone.scroll.drag(started.phone.scroll.furthest())
    // The finger lets go with no fling: the phone says nothing more.
    yield* breathe(120)
    yield* started.app.wait(REQUEST)
  })

/**
 * A new chat with one question answered, read to its end: the next question
 * can be held at the top. (The first reply ran off the bottom of the screen
 * under its question, as it should.)
 */
const chatWithHistory = (options: StartOptions & PhoneOptions = {}) =>
  Effect.gen(function* () {
    const started = yield* newChat(options)
    yield* ask(started.app, RUNNING)
    expect(AnchoredList.numbers('transcript')?.isAtEnd).toBe(false)
    yield* dragToEnd(started)
    return started
  })

/** Where the question is, from the list's top edge. */
const questionTop = (started: { app: TestApp; phone: ChatPhone.ChatPhone }): number =>
  started.phone.scroll.topOf(lastQuestion(started.app)) - LIST_TOP

/** Waits until the reply being written has run well past the bottom of the screen. */
const untilRunsOff = (started: { app: TestApp; phone: ChatPhone.ChatPhone }) =>
  until(started.app, () => started.phone.scroll.furthest() > started.phone.scroll.phone.offset + 150, 8000, 'the reply to run off the screen')

/** Whether the phone shows the end of the transcript just above the composer. */
const isPhoneAtEnd = (phone: ChatPhone.ChatPhone, covered = COMPOSER + HOME_INDICATOR): boolean =>
  phone.scroll.phone.offset >= phone.scroll.phone.size + covered - VIEWPORT - 1

describe('1. the phone moves the composer with the keyboard', () => {
  it('the bar is connected to the keyboard on the phone, and rises by the keyboard less the strip under it', () =>
    run(
      Effect.gen(function* () {
        const { phone } = yield* newChat()
        // The phone's own animation graph moves the bar: no JavaScript per frame.
        expect(phone.barLift(KEYBOARD)).toBe(KEYBOARD - HOME_INDICATOR)
        // Rising from the bottom, the keyboard first takes the strip. The bar waits for it.
        expect(phone.barLift(HOME_INDICATOR)).toBe(0)
        expect(phone.barLift(0)).toBe(0)
      }),
    ))

  it('nothing is padded by the keyboard from JavaScript, and the list keeps its full height', () =>
    run(
      Effect.gen(function* () {
        const { app, device, phone } = yield* newChat()
        const commits = app.commitCount()
        device.keyboard.show(KEYBOARD)
        yield* phone.keyboardMoves(KEYBOARD)
        const padded = nodes(app).filter(node => Number(node.props['paddingBottom'] ?? 0) >= KEYBOARD - HOME_INDICATOR)
        expect(padded).toEqual([])
        // The list was never made shorter. It makes room with its bottom inset.
        expect(numbers().viewport).toBe(VIEWPORT)
        expect(numbers().inset).toBe(KEYBOARD + COMPOSER)
        expect(app.commitCount() - commits).toBeLessThan(8)
      }),
    ))

  it('on a phone that cannot move the bar (Android), the bar is padded by the keyboard and the list gets no inset', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* startApp({ phoneKeyboard: false, platform: 'android' })
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        expect(nodes(app).some(node => node.viewName === 'KeyboardControllerView')).toBe(false)
        device.keyboard.show(300)
        // The bar eases to its place over a quarter of a second.
        yield* breathe(450)
        yield* app.settle
        expect(nodes(app).some(node => node.props['paddingBottom'] === 300)).toBe(true)
        expect(numbers().inset).toBeUndefined()
      }),
    ))
})

describe('2. a new chat raises the keyboard once, after the push', () => {
  it('the field takes the caret when the phone says the screen has appeared, and only then', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startApp()
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        // The screen is being pushed. Nothing has asked for the keyboard, and the field has no autoFocus.
        expect(focusCommands(app)).toEqual([])
        expect(app.byTestId('draft').props['autoFocus']).toBeUndefined()
        app.fabric.emit(chatScreen(app), 'topAppear', {})
        yield* app.wait(REQUEST)
        expect(focusCommands(app)).toHaveLength(1)
        expect(focusCommands(app)[0]?.viewName).toBe(app.byTestId('draft').viewName)
        // The timer that stands in for a phone that never says so does not ask again.
        yield* breathe(PUSH_WAIT_MS + 150)
        yield* app.settle
        expect(focusCommands(app)).toHaveLength(1)
        // Nor does the phone saying it again (coming back from a sheet).
        app.fabric.emit(chatScreen(app), 'topAppear', {})
        yield* app.wait(REQUEST)
        expect(focusCommands(app)).toHaveLength(1)
      }),
    ))

  it('a phone that never says the screen appeared: the field takes the caret a moment later, once', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startApp()
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        expect(focusCommands(app)).toEqual([])
        yield* breathe(PUSH_WAIT_MS + 150)
        yield* app.settle
        expect(focusCommands(app)).toHaveLength(1)
      }),
    ))

  it('a saved chat does not raise the keyboard, and a question sent before the push is over cancels it', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startApp({ disk: seeded() })
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST)
        app.fabric.emit(chatScreen(app), 'topAppear', {})
        yield* breathe(PUSH_WAIT_MS + 150)
        yield* app.settle
        expect(focusCommands(app)).toEqual([])
      }),
    ))

  it('a suggestion pressed before the push is over sends, and the keyboard stays down', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* startApp()
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        yield* app.press('suggestion-0')
        app.fabric.emit(chatScreen(app), 'topAppear', {})
        yield* breathe(PUSH_WAIT_MS + 150)
        yield* app.settle
        expect(focusCommands(app)).toEqual([])
      }),
    ))
})

describe('3. a tap outside the composer puts the keyboard away', () => {
  it('a tap on the transcript or on a message does, a drag does not', () =>
    run(
      Effect.gen(function* () {
        const { app, device, phone } = yield* chatWithHistory()
        device.keyboard.show(KEYBOARD)
        yield* phone.keyboardMoves(KEYBOARD)
        const before = device.keyboard.dismissCount()
        // A drag: the finger goes down, the list starts to scroll, the finger lifts.
        yield* app.touchStart('transcript')
        yield* app.emit('transcript', 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } })
        yield* app.touchEnd('transcript')
        expect(device.keyboard.dismissCount()).toBe(before)
        // A tap where no row is.
        yield* app.press('transcript')
        yield* app.wait(REQUEST)
        expect(device.keyboard.dismissCount()).toBe(before + 1)
        // And a tap on a message.
        device.keyboard.show(KEYBOARD)
        yield* app.wait(REQUEST)
        yield* app.press(lastReply(app))
        yield* app.wait(REQUEST)
        expect(device.keyboard.dismissCount()).toBe(before + 2)
      }),
    ))

  it('a tap on a button inside the composer bar does not', () =>
    run(
      Effect.gen(function* () {
        const { app, device, phone } = yield* chatWithHistory()
        yield* send(app, RUNNING)
        yield* untilRunsOff({ app, phone })
        device.keyboard.show(KEYBOARD)
        yield* phone.keyboardMoves(KEYBOARD)
        const before = device.keyboard.dismissCount()
        expect(app.has('scroll-to-end')).toBe(true)
        yield* app.press('scroll-to-end')
        yield* app.press('draft')
        yield* app.press('composer')
        yield* app.press('stop')
        yield* app.wait(REQUEST)
        expect(device.keyboard.dismissCount()).toBe(before)
      }),
    ))

  it('with the keyboard down a tap asks for nothing', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* chatWithHistory()
        const before = device.keyboard.dismissCount()
        yield* app.press('transcript')
        yield* app.wait(REQUEST)
        expect(device.keyboard.dismissCount()).toBe(before)
      }),
    ))
})

describe('4. the strip under the composer counts with the keyboard down and not with it up', () => {
  it.each([
    ['measured before the safe area is applied', 0],
    ['measured after', HOME_INDICATOR],
  ])('%s: the gap under the composer closes as the bar rises', (_title, measuredBottom) =>
    run(
      Effect.gen(function* () {
        const { app, device, phone } = yield* newChat({ measuredBottom })
        yield* ask(app, RUNNING)
        // Keyboard down: the composer and the strip under it.
        expect(numbers().bar).toBe(COMPOSER + HOME_INDICATOR)
        expect(numbers().composer).toMatchObject({ content: COMPOSER, rest: HOME_INDICATOR, covered: COMPOSER + HOME_INDICATOR, gap: HOME_INDICATOR })
        // The bar rises by the part of the keyboard above the strip, so its content meets the keyboard.
        expect(phone.barLift(KEYBOARD)).toBe(KEYBOARD - HOME_INDICATOR)
        device.keyboard.show(KEYBOARD)
        yield* phone.keyboardMoves(KEYBOARD)
        // Keyboard up: the keyboard and the composer on it. The strip is under the keyboard.
        expect(numbers().composer).toMatchObject({ covered: KEYBOARD + COMPOSER, gap: 0, keyboard: KEYBOARD })
        expect(numbers().inset).toBe(KEYBOARD + COMPOSER)
      }),
    ),
  )
})

describe("5. the list's bottom inset is what the composer covers", () => {
  it('the last message ends at the top of the composer, keyboard down and up, and after the keyboard has gone', () =>
    run(
      Effect.gen(function* () {
        const { app, device, phone } = yield* newChat()
        yield* ask(app, RUNNING)
        const down = COMPOSER + HOME_INDICATOR
        // The phone's own range ends where the last row's bottom is at the composer's top.
        expect(phone.scroll.phone.inset).toBe(down)
        expect(phone.scroll.furthest()).toBe(phone.scroll.phone.size + down - VIEWPORT)
        phone.scroll.drag(phone.scroll.furthest())
        yield* breathe(120)
        yield* app.wait(REQUEST)
        device.keyboard.show(KEYBOARD)
        yield* phone.keyboardMoves(KEYBOARD)
        const up = KEYBOARD + COMPOSER
        expect(phone.scroll.phone.inset).toBe(up)
        // The list was at its end and rose with the keyboard: the last row is still just above the composer.
        expect(phone.scroll.phone.offset).toBe(phone.scroll.phone.size + up - VIEWPORT)
        device.keyboard.hide()
        yield* phone.keyboardMoves(0)
        expect(phone.scroll.phone.inset).toBe(down)
        expect(phone.scroll.phone.offset).toBe(phone.scroll.phone.size + down - VIEWPORT)
      }),
    ))
})

describe('6. Send is off while a message is on its way, and is Stop while a reply is written', () => {
  it('grey and disabled with an empty field, grey while sending, Stop while replying, Send again after', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* newChat({ timing: { ...TIMING, latencyMs: 150, tokensPerSecond: 150 } })
        const grey = '#E8E8EA'
        const accent = '#0B6BCB'
        const look = () => ({ fill: app.byTestId('send').props['backgroundColor'], state: app.byTestId('send').props['accessibilityState'] })
        // An empty field has nothing to send: the two microphone buttons stand where Send will.
        expect(app.has('send')).toBe(false)
        expect(app.has('mic')).toBe(true)
        expect(app.has('record')).toBe(true)
        yield* app.typeText('draft', SHORT)
        expect(look()).toEqual({ fill: accent, state: { disabled: false } })
        // The arrow is drawn, not a letter.
        expect(textOf(app.byTestId('send'))).toBe('')
        expect(flatten([app.byTestId('send')]).filter(node => node.props['position'] === 'absolute')).toHaveLength(3)
        yield* app.press('send')
        // On its way to the server: the field is empty, and what is typed next cannot be sent yet.
        expect(app.has('send')).toBe(false)
        yield* app.typeText('draft', 'Again')
        expect(look()).toEqual({ fill: grey, state: { disabled: true } })
        yield* app.press('send')
        yield* until(app, () => app.has('stop'), 3000, 'Stop to show')
        expect(app.has('send')).toBe(false)
        expect(server.log().filter(name => name.startsWith('SendMessage')), JSON.stringify(server.log())).toHaveLength(1)
        // Stop ends the reply. What was written is kept and marked.
        yield* until(app, () => textOf(app.byTestId(lastReply(app))).length > 20, 5000, 'some of the reply')
        yield* app.press('stop')
        yield* until(app, () => !app.has('stop'), 3000, 'the reply to stop')
        yield* app.wait(REQUEST * 2)
        expect(server.log().some(name => name.startsWith('StopTurn')), JSON.stringify(server.log())).toBe(true)
        const reply = textOf(app.byTestId(lastReply(app)))
        expect(reply).toContain('Stopped')
        expect(reply.length).toBeLessThan(pickReply(SHORT).answer.length)
        // The draft typed meanwhile is still there, and Send is on again.
        expect(look()).toEqual({ fill: accent, state: { disabled: false } })
      }),
    ))
})

/** A small seeded random source (mulberry32), so a failing seed can be run again. */
const randomFrom = (seed: number) => {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <A,>(choices: ReadonlyArray<A>): A => choices[Math.floor(next() * choices.length)] as A
  return { next, pick }
}

const QUESTIONS = {
  plain: RUNNING,
  reasoning: 'Should I take the train or drive to the coast? Think it through.',
  tool: 'What is the weather in Lisbon tomorrow?',
} as const

type Scenario = Readonly<{
  seed: number
  history: 'short' | 'long'
  previous: 'finished' | 'stopped just before'
  keyboard: 'down' | 'up' | 'moving at Send'
  /** With the keyboard up: how long after Send it starts to go down, in ms. Undefined keeps it up. */
  keyboardDownAfter: number | undefined
  reply: keyof typeof QUESTIONS
  isFast: boolean
  questionMeasuredLate: boolean
  lateMarkdown: 'none' | 'above the question' | 'in the reply'
  /** How much taller (or shorter) the late text view turns out, in points. */
  lateBy: number
  lateWhen: 'early' | 'after the reply runs off'
  isFollowing: boolean
  glideSteps: number
  lateEnds: boolean
}>

const scenarioOf = (seed: number): Scenario => {
  const { pick } = randomFrom(seed)
  const keyboard = pick(['down', 'up', 'moving at Send'] as const)
  return {
    seed,
    history: pick(['short', 'long'] as const),
    previous: pick(['finished', 'stopped just before'] as const),
    keyboard,
    keyboardDownAfter: keyboard === 'down' ? undefined : pick([undefined, 0, 150, 600]),
    reply: pick(['plain', 'reasoning', 'tool'] as const),
    isFast: pick([true, false]),
    questionMeasuredLate: pick([true, false]),
    lateMarkdown: pick(['none', 'above the question', 'in the reply'] as const),
    lateBy: pick([-1, 0.7, 1, 3, 17]),
    lateWhen: pick(['early', 'after the reply runs off'] as const),
    isFollowing: pick([true, false]),
    glideSteps: pick([0, 12]),
    lateEnds: pick([true, false]),
  }
}

/**
 * One Send, from a seed: the question goes to 16 points from the top and
 * stays there while the reply grows, and the room under the reply shrinks
 * by as much as the reply grows.
 */
const pinScenario = (scenario: Scenario) =>
  Effect.gen(function* () {
    const random = randomFrom(scenario.seed * 7919 + 1)
    const late = new Map<string, number>()
    let rowsBeforeSend: Set<string> | undefined
    let lateReplyId: string | undefined
    const timing: Timing = scenario.isFast
      ? { ...TIMING, firstTokenMs: 20, latencyMs: 10, tokensPerSecond: 900 }
      : { ...TIMING, tokensPerSecond: 350 }
    const started = yield* newChat({
      timing,
      late,
      glideSteps: scenario.glideSteps,
      lateEnds: scenario.lateEnds,
      measureDelay: row => {
        const id = rowIdOf(row)
        const isNewQuestion = id !== undefined && id.startsWith('row-local-') && rowsBeforeSend !== undefined && !rowsBeforeSend.has(id)
        if (scenario.questionMeasuredLate && isNewQuestion) return 40
        if (id !== undefined && id === lateReplyId) return 25
        return undefined
      },
    })
    const { app, device, phone } = started
    const scroll = phone.scroll

    // The history.
    const count = scenario.history === 'short' ? 1 : 3
    for (let at = 0; at < count; at++) yield* ask(app, at % 2 === 0 ? RUNNING : SHORT)
    // The reply before: finished, or still being written and stopped just before Send.
    if (scenario.previous === 'stopped just before') {
      yield* send(app, RUNNING)
      yield* until(app, () => app.has('stop') && textOf(app.byTestId(lastReply(app))).length > 60, 5000, 'the reply before')
      yield* app.press('stop')
      yield* until(app, () => !app.has('stop'), 3000, 'the reply before to stop')
      yield* app.wait(REQUEST * 2)
    }
    const previousReplyId = lastReply(app)

    // Following the end, or scrolled up by a finger.
    if (!scenario.isFollowing && scroll.furthest() > 200) {
      scroll.drag(scroll.phone.offset - 150 - random.next() * 200)
      yield* breathe(120)
      yield* app.wait(REQUEST)
    }

    // The keyboard.
    if (scenario.keyboard === 'up') {
      device.keyboard.show(KEYBOARD)
      yield* phone.keyboardMoves(KEYBOARD)
    }
    if (scenario.keyboard === 'moving at Send') {
      device.keyboard.show(KEYBOARD)
      phone.keyboardStarts(KEYBOARD)
    }

    // Send.
    const before = new Set(rowIds(app))
    yield* app.typeText('draft', QUESTIONS[scenario.reply])
    rowsBeforeSend = before
    yield* app.press('send')
    const questionId = lastQuestion(app)
    expect(before.has(questionId), 'the question is on screen at once').toBe(false)
    if (scenario.keyboard === 'moving at Send') {
      yield* app.wait(60)
      phone.keyboardEnds(KEYBOARD)
    }
    // Send puts the keyboard away, sooner or later.
    if (scenario.keyboard !== 'down' && scenario.keyboardDownAfter !== undefined) {
      yield* breathe(scenario.keyboardDownAfter)
      phone.keyboardStarts(0)
      yield* app.wait(120)
      phone.keyboardEnds(0)
    }

    // The reply's row.
    yield* until(app, () => rowIds(app).some(id => /^row-m\d+$/.test(id) && !before.has(id)), 5000, 'the reply row')
    const replyId = lastReply(app)
    if (scenario.lateMarkdown === 'in the reply') lateReplyId = replyId

    const where = (): number => scroll.topOf(questionId) - LIST_TOP
    const say = (): string =>
      JSON.stringify({ ...numbers(), phone: scroll.phone, scrolls: scroll.scrolls().slice(-6), rows: rowIds(app) })
    const expectPinned = (when: string): void => {
      expect(Math.abs(where() - PIN), `question at ${where()} ${when}; ${say()}`).toBeLessThanOrEqual(0.5)
    }

    // A glide takes real frames on the simulated phone: let the one under way arrive.
    yield* breathe(450)
    yield* app.wait(60)
    expectPinned('once the reply has started')

    // While the reply grows: the question stays, and the room under the reply takes the growth.
    let lateDone = false
    const samples: Array<{ top: number; blank: number; reply: number | undefined; isAtRest: boolean }> = []
    const isAtRest = (): boolean => numbers().lastScroll?.arrived !== false
    const applyLate = (): void => {
      lateDone = true
      late.set(scenario.lateMarkdown === 'above the question' ? previousReplyId : replyId, scenario.lateBy)
      scroll.remeasure()
    }
    for (let step = 0; step < 400 && app.has('stop'); step++) {
      yield* app.wait(25)
      const isLateDue = scenario.lateWhen === 'early' ? step === 4 : numbers().isAtEnd === false && step > 4
      if (!lateDone && isLateDue && scenario.lateMarkdown !== 'none') {
        applyLate()
        yield* app.wait(25)
      }
      samples.push({ top: where(), blank: numbers().blankSpace, reply: scroll.heightOf(replyId), isAtRest: isAtRest() })
    }
    yield* until(app, () => !app.has('stop'), 20_000, 'the reply to end')
    if (!lateDone && scenario.lateMarkdown !== 'none') applyLate()
    yield* breathe(500)
    yield* app.wait(REQUEST)
    samples.push({ top: where(), blank: numbers().blankSpace, reply: scroll.heightOf(replyId), isAtRest: isAtRest() })

    // A glide the list sent may be on its way in a sample. Everywhere the list is at rest, the question is in place.
    const worst = Math.max(...samples.filter(each => each.isAtRest).map(each => Math.abs(each.top - PIN)))
    expect(worst, `the question moved while the reply grew: ${JSON.stringify(samples.map(each => each.top))}`).toBeLessThanOrEqual(0.5)
    // The room is what the screen has left under the question and the reply.
    for (const each of samples) {
      if (each.reply === undefined) continue
      const wanted = Math.max(0, VIEWPORT - PIN - QUESTION - each.reply)
      expect(Math.abs(each.blank - wanted), `room ${each.blank}, wanted ${wanted}`).toBeLessThanOrEqual(0.5)
    }
    // And it shrinks as the reply grows.
    for (let at = 1; at < samples.length; at++) {
      const [was, now] = [samples[at - 1], samples[at]] as const
      if (was?.reply === undefined || now?.reply === undefined || now.reply < was.reply) continue
      expect(now.blank, 'the room grew while the reply grew').toBeLessThanOrEqual(was.blank + 0.5)
    }
    expectPinned('after the reply')
  })

const onlySeed = process.env['PIN_SEED']
const seeds =
  onlySeed !== undefined
    ? [Number(onlySeed)]
    : Array.from({ length: Number(process.env['PIN_SCENARIOS'] ?? 8) }, (_, at) => at + 1)

describe('7. after Send the question goes to the top, within half a point', () => {
  it('lands 16 points from the top of the list, with room under it for the reply', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory()
        const { app, phone } = started
        const rowsBefore = numbers().rows
        yield* send(app, RUNNING)
        yield* app.wait(REQUEST)
        // Room under the question: the screen less the gap, the question, and nothing else yet.
        expect(numbers().blankSpace).toBeGreaterThan(VIEWPORT - PIN - QUESTION - 200)
        // It is the list's bottom content inset. The rows' own view did not grow by it.
        expect(phone.scroll.phone.inset).toBeGreaterThanOrEqual(numbers().blankSpace)
        expect(phone.scroll.phone.size).toBeLessThan(rowsBefore + QUESTION + 200)
        yield* app.wait(REQUEST * 2)
        expect(Math.abs(questionTop(started) - PIN)).toBeLessThanOrEqual(0.5)
        // The list does not follow the reply: it is held by the question.
        expect(numbers().isFollowing).toBe(false)
      }),
    ))

  // The second screenshot of Fold Chat's third phone test: the keyboard up,
  // the question in place, and "drift -1.0". The reply above the question laid
  // itself out again a point shorter after the question was put in place.
  it('a reply above the question that measures itself again a point shorter leaves the question where it is', () =>
    run(
      pinScenario({
        seed: 1000,
        history: 'long',
        previous: 'finished',
        keyboard: 'up',
        keyboardDownAfter: undefined,
        reply: 'plain',
        isFast: false,
        questionMeasuredLate: false,
        lateMarkdown: 'above the question',
        lateBy: -1,
        lateWhen: 'after the reply runs off',
        isFollowing: true,
        glideSteps: 12,
        lateEnds: false,
      }),
    ))

  it.each(seeds.map(seed => [seed, JSON.stringify(scenarioOf(seed))] as const))('seed %i: %s', seed => run(pinScenario(scenarioOf(seed))))
})

describe('8. as the reply grows the room shrinks and nothing creeps', () => {
  it('the question stays to the half point, the phone is never put back inside its range, and the smaller inset follows the rows', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory({ timing: { ...TIMING, tokensPerSecond: 90 } })
        const { app, phone } = started
        yield* send(app, RUNNING)
        yield* until(app, () => rowIds(app).some(id => id === lastReply(app)) && textOf(app.byTestId(lastReply(app))).length > 30, 5000, 'the reply to start')
        yield* app.wait(REQUEST * 2)
        const pinned = questionTop(started)
        expect(Math.abs(pinned - PIN)).toBeLessThanOrEqual(0.5)
        const tops: Array<number> = []
        const insets: Array<number> = []
        // Every inset the phone was handed, with the rows' height it had at that moment.
        let heldBack = 0
        while (app.has('stop') && tops.length < 600) {
          yield* app.wait(10)
          tops.push(questionTop(started))
          insets.push(phone.scroll.phone.inset)
          // The inset the list wants is smaller than the one the phone has: it is being held back.
          if ((numbers().inset ?? 0) < phone.scroll.phone.inset - 0.5) heldBack++
        }
        expect(tops.length).toBeGreaterThan(20)
        expect(Math.max(...tops.map(top => Math.abs(top - pinned)))).toBeLessThanOrEqual(0.5)
        // UIKit puts a list that is outside its range back in, with a jump. It never had to.
        expect(phone.scroll.clamps).toEqual([])
        // The room shrank, in steps.
        expect(Math.min(...insets)).toBeLessThan(Math.max(...insets) - 100)
        // And the smaller inset came after the taller rows, not with them.
        expect(heldBack).toBeGreaterThan(0)
        // The reply ran past the bottom of the screen and the list did not follow it there.
        expect(numbers().isAtEnd).toBe(false)
        expect(app.has('scroll-to-end')).toBe(true)
      }),
    ))
})

describe('9. the round button to the end belongs to the composer bar', () => {
  it('is inside the view the phone moves, and is not placed again when the keyboard moves', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory()
        const { app, device, phone } = started
        yield* send(app, RUNNING)
        yield* untilRunsOff(started)
        const button = app.byTestId('scroll-to-end')
        expect(phone.ridesOnBar(button)).toBe(true)
        // The seat is out of the layout, on the bar's top edge.
        expect(app.byTestId('scroll-to-end-seat').props['pointerEvents']).toBe('box-none')
        const place = () => JSON.stringify(flatten([phone.bar()]).filter(node => flatten([node]).includes(app.byTestId('scroll-to-end'))).map(node => node.props))
        // The button fades in first. That is its own doing, not a new place.
        yield* app.wait(300)
        const before = place()
        device.keyboard.show(KEYBOARD)
        yield* phone.keyboardMoves(KEYBOARD)
        expect(app.has('scroll-to-end')).toBe(true)
        expect(place()).toBe(before)
      }),
    ))

  it('shows once the end is under the composer, not only once it is under the keyboard', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory()
        const { app, phone } = started
        expect(app.has('scroll-to-end')).toBe(false)
        // A finger leaves the end 30 points under the composer's top. The keyboard is down.
        phone.scroll.drag(phone.scroll.furthest() - 30)
        yield* breathe(120)
        yield* app.wait(REQUEST)
        expect(app.has('scroll-to-end')).toBe(true)
        // Back to the end by hand: it goes.
        phone.scroll.drag(phone.scroll.furthest())
        yield* breathe(120)
        yield* app.wait(REQUEST)
        expect(app.has('scroll-to-end')).toBe(false)
      }),
    ))

  it('a tap scrolls to the end and the list follows the reply from then on', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory({ timing: { ...TIMING, tokensPerSecond: 90 } })
        const { app, phone } = started
        yield* send(app, RUNNING)
        yield* untilRunsOff(started)
        expect(numbers().isFollowing).toBe(false)
        yield* app.press('scroll-to-end')
        yield* app.wait(REQUEST)
        expect(isPhoneAtEnd(phone)).toBe(true)
        expect(app.has('scroll-to-end')).toBe(false)
        const grownFrom = phone.scroll.furthest()
        for (let step = 0; step < 5; step++) {
          yield* app.wait(100)
          expect(isPhoneAtEnd(phone)).toBe(true)
        }
        expect(phone.scroll.furthest()).toBeGreaterThan(grownFrom)
        expect(numbers().isFollowing).toBe(true)
        expect(app.has('stop')).toBe(true)
      }),
    ))
})

describe('10. following stops under a finger and after a drag away, and starts again at the end', () => {
  const following = (timing: Timing = { ...TIMING, tokensPerSecond: 90 }) =>
    Effect.gen(function* () {
      const started = yield* chatWithHistory({ timing })
      yield* send(started.app, RUNNING)
      yield* untilRunsOff(started)
      yield* started.app.press('scroll-to-end')
      yield* started.app.wait(REQUEST)
      expect(isPhoneAtEnd(started.phone)).toBe(true)
      return started
    })

  it('a finger resting on a message: the list waits, and catches up when the finger lifts', () =>
    run(
      Effect.gen(function* () {
        const started = yield* following()
        const { app, phone } = started
        yield* app.touchStart(lastReply(app))
        yield* app.wait(40)
        const held = phone.scroll.phone.offset
        const grownFrom = phone.scroll.furthest()
        yield* app.wait(350)
        expect(app.has('stop')).toBe(true)
        expect(phone.scroll.furthest()).toBeGreaterThan(grownFrom + 40)
        expect(phone.scroll.phone.offset).toBe(held)
        // Still following: the finger only made it wait.
        expect(numbers().isFollowing).toBe(true)
        yield* app.touchEnd(lastReply(app))
        yield* app.wait(REQUEST)
        expect(isPhoneAtEnd(phone)).toBe(true)
      }),
    ))

  it('a drag away from the end stops it, and the list stays where the finger left it', () =>
    run(
      Effect.gen(function* () {
        const started = yield* following()
        const { app, phone } = started
        phone.scroll.drag(phone.scroll.phone.offset - 300)
        yield* breathe(120)
        yield* app.wait(REQUEST)
        const left = phone.scroll.phone.offset
        yield* app.wait(400)
        expect(app.has('stop')).toBe(true)
        expect(phone.scroll.phone.offset).toBe(left)
        expect(numbers().isFollowing).toBe(false)
        expect(app.has('scroll-to-end')).toBe(true)
      }),
    ))

  it('coming back to the end by hand follows again', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory({ timing: { ...TIMING, tokensPerSecond: 90 } })
        const { app, phone } = started
        yield* send(app, RUNNING)
        yield* untilRunsOff(started)
        expect(numbers().isFollowing).toBe(false)
        phone.scroll.drag(phone.scroll.furthest())
        // The finger lets go with no fling: the phone says nothing more.
        yield* breathe(120)
        yield* app.wait(REQUEST)
        expect(numbers().isFollowing).toBe(true)
        const grownFrom = phone.scroll.furthest()
        for (let step = 0; step < 4; step++) {
          yield* app.wait(100)
          expect(isPhoneAtEnd(phone)).toBe(true)
        }
        expect(phone.scroll.furthest()).toBeGreaterThan(grownFrom)
      }),
    ))

  it('a new question stops following: it is held at the top again', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory()
        const { app } = started
        // The list opened at its end and follows. The next question is held all the same.
        expect(numbers().isFollowing).toBe(true)
        yield* send(app, RUNNING)
        yield* app.wait(REQUEST * 3)
        expect(numbers().isFollowing).toBe(false)
        expect(Math.abs(questionTop(started) - PIN)).toBeLessThanOrEqual(0.5)
      }),
    ))
})

describe('9b. the round button fades', () => {
  it('in as the end goes out of view, and out again when the list is taken to the end, without leaving the bar', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory()
        const { app } = started
        const motion = () => app.byTestId('scroll-to-end-motion').props
        // Away: see-through, small, and out of a finger's reach.
        expect(motion()['opacity']).toBe(0)
        expect(motion()['pointerEvents']).toBe('none')
        expect(app.has('scroll-to-end')).toBe(false)
        yield* send(app, RUNNING)
        yield* untilRunsOff(started)
        const seen: Array<number> = []
        for (let step = 0; step < 14; step++) {
          seen.push(motion()['opacity'] as number)
          yield* app.wait(12)
        }
        // It did not pop in: it was partly there on the way.
        expect(seen.some(opacity => opacity > 0 && opacity < 1), JSON.stringify(seen)).toBe(true)
        yield* app.wait(200)
        expect(motion()['opacity']).toBe(1)
        expect(motion()['transform']).toEqual([{ scale: 1 }])
        expect(motion()['pointerEvents']).toBe('box-none')
        yield* app.press('scroll-to-end')
        yield* app.wait(400)
        expect(app.has('scroll-to-end')).toBe(false)
        expect(motion()['opacity']).toBe(0)
        expect(motion()['pointerEvents']).toBe('none')
      }),
    ))
})

describe('11. a finger held on a message while a reply streams is a hold', () => {
  const holds = (app: TestApp): string => app.text('numbers-holds')

  it.each([
    ['keyboard down', false],
    ['keyboard up', true],
  ])('%s: on a list that scrolls by itself, the hold is counted in the numbers strip', (_title, isKeyboardUp) =>
    run(
      Effect.gen(function* () {
        // As on a real iPhone: a new inset is reported as a scroll that no finger made.
        const started = yield* chatWithHistory({ timing: { ...TIMING, tokensPerSecond: 90 }, insetScrolls: true })
        const { app, device, phone } = started
        yield* app.touchStart('bar-chat-title')
        yield* breathe(560)
        yield* app.touchEnd('bar-chat-title')
        yield* app.wait(REQUEST)
        expect(holds(app)).toContain('holds 0')
        if (isKeyboardUp) {
          device.keyboard.show(KEYBOARD)
          yield* phone.keyboardMoves(KEYBOARD)
        }
        yield* send(app, RUNNING)
        if (isKeyboardUp) {
          // Send put the keyboard away. It comes back, as when the field is tapped again.
          yield* phone.keyboardMoves(0)
          device.keyboard.show(KEYBOARD)
          yield* phone.keyboardMoves(KEYBOARD)
        }
        yield* until(app, () => app.has('stop') && textOf(app.byTestId(lastReply(app))).length > 40, 5000, 'the reply to start')
        const told = phone.scroll.told.length
        const dismissed = device.keyboard.dismissCount()
        const reply = lastReply(app)
        yield* app.touchStart(reply)
        yield* breathe(600)
        yield* app.settle
        // The list reported scrolls of its own while the finger rested.
        expect(phone.scroll.told.slice(told).some(each => !each.byFinger)).toBe(true)
        expect(app.has('stop')).toBe(true)
        expect(holds(app)).toContain('holds 1')
        expect(holds(app)).toContain(`last held ${reply.replace(/^row-/, '')}`)
        // With the keyboard up, the hold itself puts the keyboard away, so the menu is not under it.
        const afterHold = dismissed + (isKeyboardUp ? 1 : 0)
        expect(device.keyboard.dismissCount()).toBe(afterHold)
        yield* app.touchEnd(reply)
        // The lift after a hold is not a tap: nothing more is asked of the keyboard.
        expect(device.keyboard.dismissCount()).toBe(afterHold)
        // Your own question can be held too.
        const question = lastQuestion(app)
        yield* app.touchStart(question)
        yield* breathe(600)
        yield* app.touchEnd(question)
        yield* app.settle
        expect(holds(app)).toContain('holds 2')
      }),
    ),
  )

  it('a finger that moves away is not a hold', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory({ insetScrolls: true })
        const { app } = started
        yield* app.touchStart('bar-chat-title')
        yield* breathe(560)
        yield* app.touchEnd('bar-chat-title')
        const reply = lastReply(app)
        yield* app.touchStart(reply, { x: 100, y: 300 })
        yield* app.touchMove(reply, { x: 100, y: 330 })
        yield* breathe(600)
        yield* app.touchEnd(reply, { x: 100, y: 330 })
        yield* app.settle
        expect(holds(app)).toContain('holds 0')
      }),
    ))
})

describe('12. a saved chat opens at its end with nothing seen to move', () => {
  it('the rows are unseen until the list is at its end, and it never shows any other place', () =>
    run(
      Effect.gen(function* () {
        const started = yield* startApp({ disk: seeded() })
        const { app } = started
        const canvas = (): FakeFabricNode | undefined =>
          app.has('transcript') ? (app.byTestId('transcript').children.at(-1)?.children[0] as FakeFabricNode | undefined) : undefined
        const rowCount = (): number => Math.max(0, (canvas()?.children.length ?? 1) - 1)
        yield* app.press('chat-row-c1')
        // No list while the messages are on their way.
        expect(app.has('transcript')).toBe(false)
        yield* until(app, () => app.has('transcript'), 2000, 'the chat to load')
        // It is there, with its rows, and cannot be seen yet.
        yield* until(app, () => rowCount() > 0, 1000, 'the rows')
        expect(canvas()?.props['opacity']).toBe(0)
        // From here on: what the phone shows after each commit it has taken in.
        let scroll: ChatPhone.ScrollPhone | undefined
        const seen: Array<{ offset: number; furthest: number; rows: number }> = []
        const fabric = app.fabric as unknown as { completeRoot: (...args: Array<unknown>) => void }
        const original = fabric.completeRoot.bind(fabric)
        fabric.completeRoot = (...args) => {
          original(...args)
          // Two turns later: the phone has mounted this commit by then.
          setTimeout(
            () =>
              setTimeout(() => {
                if (scroll === undefined || canvas()?.props['opacity'] === 0 || rowCount() === 0) return
                seen.push({ offset: scroll.phone.offset, furthest: scroll.furthest(), rows: rowCount() })
              }, 0),
            0,
          )
        }
        stops.push(() => {
          fabric.completeRoot = original
        })
        const phone = yield* startPhone(started, { onScroll: made => (scroll = made) })
        yield* until(app, () => canvas()?.props['opacity'] === 1, 2000, 'the list to be shown')
        yield* app.wait(REQUEST * 2)
        expect(seen.length).toBeGreaterThan(0)
        // The chat is longer than the screen.
        expect(phone.scroll.furthest()).toBeGreaterThan(500)
        // Whenever it could be seen, it was at its end.
        for (const each of seen) expect(Math.abs(each.offset - each.furthest), JSON.stringify(seen.slice(0, 6))).toBeLessThanOrEqual(1)
        expect(phone.scroll.phone.offset).toBe(phone.scroll.furthest())
        // The last message is drawn, and the first is not: only the rows near the screen exist.
        expect(app.has('row-m25')).toBe(true)
        expect(app.has('row-m10')).toBe(false)
        expect(app.has('scroll-to-end')).toBe(false)
        expect(numbers().isAtEnd).toBe(true)
      }),
    ))
})

describe('the numbers strip', () => {
  it('is off until the title is held, shows the list, the inset, following and holds, and stays on in the next chat', () =>
    run(
      Effect.gen(function* () {
        const started = yield* chatWithHistory()
        const { app, phone } = started
        expect(app.has('numbers')).toBe(false)
        yield* app.touchStart('bar-chat-title')
        yield* breathe(560)
        yield* app.touchEnd('bar-chat-title')
        yield* app.wait(REQUEST)
        expect(app.has('numbers')).toBe(true)
        // It takes no touches: the messages under it still do.
        expect(app.byTestId('numbers').props['pointerEvents']).toBe('none')
        const offset = Math.round(phone.scroll.phone.offset)
        expect(app.text('numbers-list')).toContain(`offset ${offset} of ${offset}, at end, following`)
        expect(app.text('numbers-list')).toContain(`inset ${COMPOSER + HOME_INDICATOR}, blank 0, bar covers ${COMPOSER + HOME_INDICATOR}, gap ${HOME_INDICATOR}, keyboard 0`)
        expect(app.text('numbers-holds')).toContain('holds 0')
        // The list rewrites its line as it moves, with no draw by the program.
        phone.scroll.drag(phone.scroll.furthest() - 200)
        yield* breathe(120)
        yield* app.wait(REQUEST)
        expect(app.text('numbers-list')).toContain(`offset ${offset - 200} of ${offset}, not at end, not following`)
        // After Send it says where the question is.
        yield* send(app, RUNNING)
        yield* app.wait(REQUEST * 4)
        expect(app.text('numbers-list')).toContain('question y 16.0, drift +0.0')
        // A second hold turns it off.
        yield* app.touchStart('bar-chat-title')
        yield* breathe(560)
        yield* app.touchEnd('bar-chat-title')
        yield* app.wait(REQUEST)
        expect(app.has('numbers')).toBe(false)
      }),
    ))
})
