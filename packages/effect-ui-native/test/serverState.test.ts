/**
 * Effect UI's Query on the simulated phone.
 *
 * The first half drives the playground's Server state screen: the list
 * loads, a delete hides its row at once and the row never shows again, a
 * save the server refuses puts the row back, and leaving the app and coming
 * back loads the list again.
 *
 * The second half uses two small apps of its own, for what the playground
 * screen cannot show: an invalidation while no screen is watching, and the
 * phone going offline and online.
 */
import { Command, Query, UiSchema } from '@effect/ui'
import { Effect, Layer, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { describe, expect, it } from 'vitest'

import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../playground/app.js'
import { FakeServer } from '../playground/serverState.js'
import { playgroundServices } from '../playground/start.js'
import { Native, NativeQuery, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { provideForTest, run } from './support.js'

/** How long the pretend server takes, and a wait that is surely longer. */
const DELAY = 20
const AFTER = 60

const start = () =>
  Effect.gen(function* () {
    registerNavigation()
    const device = Phone.Device.makeTest()
    const layer = Layer.provideMerge(playgroundServices(device.layer, { serverDelayMs: DELAY }), device.layer)
    return yield* Effect.gen(function* () {
      const app = yield* NativeTest.mount(App, { platform: 'ios', hasReadout: false })
      const server = yield* FakeServer
      yield* app.press('menu-ServerState')
      return { app, device, server }
    }).pipe(provideForTest(layer))
  })

/** Calls `check` after every commit to the phone, so nothing drawn in between is missed. */
const onEveryCommit = (app: { fabric: any }, check: () => void): void => {
  const fabric = app.fabric
  const original = fabric.completeRoot.bind(fabric)
  fabric.completeRoot = (...args: Array<unknown>) => {
    original(...args)
    check()
  }
}

describe('the Server state screen', () => {
  it('is in the menu, and loads its list from the server', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start()
        // The server has not answered yet.
        expect(app.has('server-loading')).toBe(true)
        expect(app.text('server-status')).toBe('List loaded 0 times. Now: loading.')
        yield* app.wait(AFTER)
        expect(app.has('server-loading')).toBe(false)
        expect(app.allText()).toEqual(expect.arrayContaining(['Bread', 'Apples', 'Coffee']))
        expect(app.text('server-status')).toBe('List loaded 1 times. Now: loaded.')
        expect(server.peek().fetches).toBe(1)
      }),
    ))

  it('add saves a row and the list loads again by itself', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start()
        yield* app.wait(AFTER)
        yield* app.press('server-add')
        // Not on screen before the server has it: Add is not optimistic.
        expect(app.allText()).not.toContain('Milk')
        yield* app.wait(AFTER * 2)
        expect(app.allText()).toContain('Milk')
        expect(server.peek().fetches).toBe(2)
        expect(app.text('server-notice')).toBe('Saved.')
      }),
    ))

  it('delete hides the row at once, and the row is never drawn again', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start()
        yield* app.wait(AFTER)
        expect(app.has('server-row-i2')).toBe(true)
        yield* app.press('server-delete-i2')
        // Gone before the server answered.
        expect(server.peek().items.map(item => item.id)).toContain('i2')
        expect(app.has('server-row-i2')).toBe(false)
        let drawnAgain = 0
        let commits = 0
        onEveryCommit(app, () => {
          commits++
          if (app.has('server-row-i2')) drawnAgain++
        })
        // The save ends, then the list loads again.
        yield* app.wait(AFTER * 2)
        expect(server.peek().items.map(item => item.id)).toEqual(['i1', 'i3'])
        expect(server.peek().fetches).toBe(2)
        expect(app.text('server-status')).toBe('List loaded 2 times. Now: loaded.')
        expect(commits).toBeGreaterThan(0)
        expect(drawnAgain).toBe(0)
        expect(app.has('server-row-i2')).toBe(false)
      }),
    ))

  it('a save the server refuses puts the row back', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start()
        yield* app.wait(AFTER)
        yield* app.press('server-fail-next')
        expect(app.allText()).toContain('Next save fails: on')
        yield* app.press('server-delete-i2')
        expect(app.has('server-row-i2')).toBe(false)
        yield* app.wait(AFTER * 2)
        expect(app.has('server-row-i2')).toBe(true)
        expect(app.text('server-notice')).toBe('Not saved: The server said no.')
        expect(server.peek().items).toHaveLength(3)
        // The switch is for one save only.
        expect(app.allText()).toContain('Next save fails: off')
      }),
    ))

  it('leaving the app and coming back loads the list again', () =>
    run(
      Effect.gen(function* () {
        const { app, device, server } = yield* start()
        yield* app.wait(AFTER)
        expect(server.peek().fetches).toBe(1)
        device.appState.set('background')
        yield* app.wait(AFTER)
        // Nothing loads while the app is out of sight.
        expect(server.peek().fetches).toBe(1)
        device.appState.set('active')
        yield* app.wait(AFTER)
        expect(server.peek().fetches).toBe(2)
        expect(app.text('server-status')).toBe('List loaded 2 times. Now: loaded.')
      }),
    ))
})

// A SMALL APP: ONE SCREEN THAT CAN BE CLOSED, AND A WRITE THAT STAYS

const makeGate = () => {
  const server = { value: 'first', fetches: 0 }

  // Fresh for a minute: only an invalidation can make it load again.
  class GetWord extends Query.Service<GetWord>()('test/GetWord', {
    args: {},
    success: Schema.String,
    error: Schema.Never,
    staleTime: '1 minute',
  }) {
    static readonly layer = this.toLayer(() =>
      Effect.andThen(
        Effect.sleep(`${DELAY} millis`),
        Effect.sync(() => {
          server.fetches++
          return server.value
        }),
      ),
    )
  }

  class ChangeWord extends Command.Service<ChangeWord>()('test/ChangeWord', {
    args: { value: Schema.String },
    success: Schema.Void,
    invalidates: () => [GetWord],
  }) {
    static readonly layer = this.toLayer(({ value }) =>
      Effect.sync(() => {
        server.value = value
      }),
    )
  }

  const Word = Native.component({
    name: 'Word',
    model: Schema.Null,
    message: Schema.Never,
    queries: { word: { query: GetWord, args: () => ({}) } },
  }).make({
    init: () => null,
    update: $ => $.model,
    view: h =>
      h.text.testId('word').children(
        AsyncResult.match(h.queries.word, {
          onInitial: () => 'loading',
          onSuccess: ({ value, waiting }) => (waiting ? `${value} (loading again)` : value),
          onFailure: () => 'failed',
        }),
      ),
  })

  const GateMessage = UiSchema.TaggedEnum({ PressedToggle: {}, PressedChange: {}, Changed: {} })
  const Gate = Native.component({
    name: 'Gate',
    model: Schema.Struct({ isOpen: Schema.Boolean }),
    message: GateMessage,
  }).make({
    init: () => ({ isOpen: true }),
    update: {
      PressedToggle: $ => $.evolve({ isOpen: open => !open }),
      PressedChange: $ => $.run(ChangeWord.make({ value: 'second' }).pipe(Command.as(GateMessage.Changed()))),
      Changed: $ => $.model,
    },
    view: (h, model) =>
      h.view.children(
        h.pressable.testId('toggle').on('press', GateMessage.PressedToggle()).children(h.text('Toggle')),
        h.pressable.testId('change').on('press', GateMessage.PressedChange()).children(h.text('Change')),
        model.isOpen ? Word(h, { key: 'word' }) : null,
      ),
  })

  return { Gate, server, layer: Layer.mergeAll(GetWord.layer, ChangeWord.layer) }
}

describe('Query on the native host', () => {
  it('an invalidation while no screen watches is not lost: the next screen gets the new value', () =>
    run(
      Effect.gen(function* () {
        const { Gate, server, layer } = makeGate()
        const app = yield* NativeTest.mount(Gate, {}).pipe(provideForTest(layer))
        yield* app.wait(AFTER)
        expect(app.text('word')).toBe('first')
        // The screen closes. The cache keeps the value for a while.
        yield* app.press('toggle')
        expect(app.has('word')).toBe(false)
        // The data changes on the server and the query is invalidated, with nobody watching.
        yield* app.press('change')
        yield* app.wait(AFTER)
        expect(server.fetches).toBe(1)
        // The screen opens again. It must not show the old value as if it were new.
        const drawn: Array<string> = []
        const fabric = app.fabric as any
        const original = fabric.completeRoot.bind(fabric)
        fabric.completeRoot = (...args: Array<unknown>) => {
          original(...args)
          if (app.has('word')) drawn.push(app.text('word'))
        }
        yield* app.press('toggle')
        yield* app.wait(AFTER)
        expect(server.fetches).toBe(2)
        expect(app.text('word')).toBe('second')
        // The old value may be shown while the new one loads, but only marked as loading again.
        expect(drawn).not.toContain('first')
        expect(drawn[drawn.length - 1]).toBe('second')
      }),
    ))

  it('without an invalidation, the next screen is served from the cache with no request', () =>
    run(
      Effect.gen(function* () {
        const { Gate, server, layer } = makeGate()
        const app = yield* NativeTest.mount(Gate, {}).pipe(provideForTest(layer))
        yield* app.wait(AFTER)
        yield* app.press('toggle')
        yield* app.press('toggle')
        yield* app.wait(AFTER)
        expect(app.text('word')).toBe('first')
        expect(server.fetches).toBe(1)
      }),
    ))

  it('going offline and coming back online loads a stale list again', () =>
    run(
      Effect.gen(function* () {
        const server = { fetches: 0 }
        class GetCount extends Query.Service<GetCount>()('test/GetCount', {
          args: {},
          success: Schema.Number,
          error: Schema.Never,
          staleTime: 0,
        }) {
          static readonly layer = this.toLayer(() => Effect.sync(() => ++server.fetches))
        }
        const Count = Native.component({
          name: 'Count',
          model: Schema.Null,
          message: Schema.Never,
          queries: { count: { query: GetCount, args: () => ({}) } },
        }).make({
          init: () => null,
          update: $ => $.model,
          view: h =>
            h.text.testId('count').children(
              AsyncResult.isSuccess(h.queries.count) ? String(h.queries.count.value) : 'loading',
            ),
        })
        const device = Phone.Device.makeTest()
        const app = yield* NativeTest.mount(Count, {}).pipe(
          provideForTest(Layer.provideMerge(Layer.mergeAll(GetCount.layer, NativeQuery.layer), device.layer)),
        )
        yield* app.wait(AFTER)
        expect(app.text('count')).toBe('1')
        device.network.set('offline')
        yield* app.wait(AFTER)
        expect(server.fetches).toBe(1)
        device.network.set('online')
        yield* app.wait(AFTER)
        expect(app.text('count')).toBe('2')
      }),
    ))
})
