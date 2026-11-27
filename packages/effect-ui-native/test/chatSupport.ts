/**
 * Shared by the step 3 tests of Effect Chat: the app on a simulated phone,
 * with the pretend server, the cable, the turn keeper and the query cache
 * all running for real. The phone's services are fakes a test reads and
 * drives, and so is the phone's list of choices.
 */
import * as MessageLog from '@effect/ui/MessageLog'
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Context, Effect, Layer } from 'effect'

import { type Timing, makeAiServer, memoryDisk } from '../../native/src/host/aiChat/server.js'
import { makeInProcessLink } from '../../native/src/host/aiChat/transport.js'
import type { ChatMessage } from '../../native/src/host/aiChat/wire.js'
import { registerNavigation, registerSearchBar } from '../../native/src/host/navigation/views.js'
import { App } from '../chat/app.js'
import { makeClock } from '../chat/clock.js'
import { Player } from '../chat/playback.js'
import { chatServices } from '../chat/start.js'
import * as Timeline from '../chat/timeline.js'
import { Menus, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'

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
  /** What to show when a part of the app fails. Nothing if left out. */
  crash?: NativeTest.TestOptions['crash']
  /** Keep the screens' log, numbered from the shared clock, as a development build does. */
  records?: boolean
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
    // The shared clock, and with `records` a recorder of the screens' log that reads it.
    const clock = makeClock()
    const recorder = options.records === true ? Timeline.makeRecorder(clock) : undefined
    const services = Layer.provideMerge(
      chatServices(device.layer, {
        server,
        link,
        menus: menus.layer,
        now: () => NOW,
        clock,
        ...(recorder === undefined ? {} : { recorder }),
      }),
      device.layer,
    )
    const logged = recorder === undefined ? services : Layer.merge(services, Layer.succeed(MessageLog.MessageLog, recorder.log))
    const layer = options.override === undefined ? logged : Layer.merge(logged, options.override)
    const platform = options.platform ?? 'ios'
    // Built once and kept until the test ends: see `provideForTest`.
    const context = yield* Layer.build(layer as typeof services)
    const app = yield* NativeTest.mount(
      App,
      { platform, hasTimeline: recorder !== undefined },
      { platform, longPressMs: HOLD_MS, ...(options.crash === undefined ? {} : { crash: options.crash }) },
    ).pipe(Effect.provideContext(context))
    yield* app.wait(REQUEST)
    /** The app's one audio player, as the app's Layer made it. */
    const player = Context.get(context, Player)
    /** The merged timeline so far. Empty of screens without `records`. */
    const timeline = () => Timeline.merge(recorder?.entries() ?? [], player.log())
    return { app, device, menus, server, link, disk, player, clock, recorder, timeline }
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

/** The words in a view: its text, and what its native Markdown views were last given. */
export const textIn = (node: FakeFabricNode): string =>
  NativeTest.flatten([node])
    .map(each =>
      each.viewName === 'RawText'
        ? each.props['text']
        : each.viewName === 'EnrichedMarkdown'
          ? each.props['markdown']
          : undefined,
    )
    .filter((value): value is string => typeof value === 'string')
    .join('')

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

/** The text the program holds for the composer's field, as the phone was last given it. */
export const lastSetText = (app: TestApp): string | undefined => {
  if (!app.has('draft')) return undefined
  const text = app.byTestId('draft').props['text']
  return typeof text === 'string' ? text : undefined
}
