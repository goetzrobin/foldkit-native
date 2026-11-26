/**
 * Shared by the step 3 tests of Effect Chat: the app on a simulated phone,
 * with the pretend server, the cable, the turn keeper and the query cache
 * all running for real. The phone's services are fakes a test reads and
 * drives, and so is the phone's list of choices.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect, Layer } from 'effect'

import { type Timing, makeAiServer, memoryDisk } from '../../native/src/host/aiChat/server.js'
import { makeInProcessLink } from '../../native/src/host/aiChat/transport.js'
import type { ChatMessage } from '../../native/src/host/aiChat/wire.js'
import { registerNavigation, registerSearchBar } from '../../native/src/host/navigation/views.js'
import { App } from '../chat/app.js'
import { chatServices } from '../chat/start.js'
import { Menus, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { provideForTest } from './support.js'

/** The server answers quickly, and a reply still takes long enough to be seen growing. */
export const FAST: Timing = {
  firstTokenMs: 40,
  tokensPerSecond: 1500,
  jitter: 0,
  pauseChance: 0,
  pauseMs: 0,
  toolMs: 20,
  latencyMs: 10,
}
/** Long enough for a request to be answered and drawn. */
export const REQUEST = 80
/** Long enough for a whole reply and the reloads after it. */
export const REPLY = 1500
/** The tests' long press, shorter than the phone's half second so they run quickly. */
export const HOLD_MS = 150

/** Noon on 26 November 2026, in the time zone the tests run in. */
export const NOW = new Date(2026, 10, 26, 12, 0, 0).getTime()
const DAY = 24 * 60 * 60 * 1000

export const message = (id: string, role: 'user' | 'assistant', text: string, at: number): ChatMessage => ({
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

/** Three chats, as if the app had been used before: one from today, one from yesterday, one from 40 days ago. */
export const seeded = () => {
  const disk = memoryDisk()
  const save = (id: string, title: string, at: number, messages: ReadonlyArray<ChatMessage>) =>
    disk.entries.set(`conversation-${id}`, JSON.stringify({ id, title, createdAt: at, updatedAt: at, messages }))
  save('c4', 'Bread recipe', NOW - 60_000, [
    message('m5', 'user', 'How long does bread prove?', NOW - 61_000),
    message('m6', 'assistant', 'About an hour, until it has **doubled**.', NOW - 60_000),
  ])
  save('c1', 'Weekend plans', NOW - DAY, [
    message('m2', 'user', 'Any ideas for the weekend?', NOW - DAY - 1000),
    message('m3', 'assistant', 'A walk by the river, then soup.', NOW - DAY),
  ])
  save('c7', 'Old notes', NOW - 40 * DAY, [message('m8', 'user', 'Remember the milk.', NOW - 40 * DAY)])
  disk.entries.set('index', JSON.stringify({ version: 1, nextId: 10, conversationIds: ['c4', 'c1', 'c7'] }))
  return disk
}

export type StartOptions = Readonly<{
  disk?: ReturnType<typeof memoryDisk>
  platform?: 'ios' | 'android'
  timing?: Timing
  /** What the phone's small store holds before the app starts. */
  stored?: Readonly<Record<string, string>>
  /** Services laid over the app's own, to make one of them fail. */
  override?: Layer.Layer<any>
}>

export const start = (options: StartOptions = {}) =>
  Effect.gen(function* () {
    registerNavigation()
    registerSearchBar()
    const device = Phone.Device.makeTest(options.stored === undefined ? {} : { stored: options.stored })
    const menus = Menus.makeTest()
    const disk = options.disk ?? memoryDisk()
    const server = makeAiServer({ disk: disk.disk, timing: options.timing ?? FAST })
    const link = makeInProcessLink()
    const services = Layer.provideMerge(
      chatServices(device.layer, { server, link, menus: menus.layer, now: () => NOW }),
      device.layer,
    )
    const layer = options.override === undefined ? services : Layer.merge(services, options.override)
    const platform = options.platform ?? 'ios'
    const app = yield* NativeTest.mount(App, { platform }, { platform, longPressMs: HOLD_MS }).pipe(
      provideForTest(layer as typeof services),
    )
    yield* app.wait(REQUEST)
    return { app, device, menus, server, link, disk }
  })

export type Started = Effect.Success<ReturnType<typeof start>>
export type TestApp = Started['app']

export const nodes = (app: TestApp): Array<FakeFabricNode> => NativeTest.flatten(app.fabric.committed)

/** Every testID on screen, in order. */
export const ids = (app: TestApp): Array<string> =>
  nodes(app)
    .map(node => node.props['testID'])
    .filter((id): id is string => typeof id === 'string')

/** The chats in the list, top to bottom, by id. */
export const listed = (app: TestApp): Array<string> =>
  ids(app)
    .filter(id => id.startsWith('chat-row-'))
    .map(id => id.slice('chat-row-'.length))

export const textIn = (node: FakeFabricNode): string => NativeTest.textOf(node)

/** A finger resting on a view for longer than a long press, then lifting. */
export const hold = (app: TestApp, id: string, ms = HOLD_MS + 60) =>
  Effect.gen(function* () {
    yield* app.touchStart(id)
    yield* app.wait(ms)
    yield* app.touchEnd(id)
  })

/** A press on one of the iPhone's own bar buttons. */
export const pressBarButton = (app: TestApp, bar: string, buttonId: string) =>
  app.emit(bar, 'topPressHeaderBarButtonItem', { buttonId })

/** A choice from an iPhone bar button's own menu. */
export const chooseBarMenu = (app: TestApp, bar: string, menuId: string) =>
  app.emit(bar, 'topPressHeaderBarButtonMenuItem', { menuId })

export const send = (app: TestApp, text: string) => Effect.andThen(app.typeText('draft', text), app.press('send'))

/** The reply rows on screen, by testID. */
export const replies = (app: TestApp): Array<string> => ids(app).filter(id => /^reply-m\d+$/.test(id))

/** Waits until `ready` says yes, or fails with what was being waited for. */
export const until = (app: TestApp, ready: () => boolean, ms: number, what: string) =>
  Effect.gen(function* () {
    const deadline = Date.now() + ms
    while (!ready()) {
      if (Date.now() > deadline) throw new Error(`Waited ${ms} ms for ${what}`)
      yield* app.wait(20)
    }
  })

/** Calls `check` after every commit to the phone. */
export const onEveryCommit = (app: TestApp, check: () => void): void => {
  const fabric = app.fabric as any
  const original = fabric.completeRoot.bind(fabric)
  fabric.completeRoot = (...args: Array<unknown>) => {
    original(...args)
    check()
  }
}

/**
 * The text the program last put into a text field itself. While a person
 * types, the phone owns the text and the program sends none.
 */
export const lastSetText = (app: TestApp): string | undefined => {
  const sets = app.commands().filter(command => command.name === 'setTextAndSelection')
  const text = sets[sets.length - 1]?.args[1]
  return typeof text === 'string' ? text : undefined
}
