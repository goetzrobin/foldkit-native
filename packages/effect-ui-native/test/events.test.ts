/**
 * Native events as Messages, Mounts on the native node, Commands by ref,
 * and what is left after unmount.
 */
import { Command, Mount, UiSchema } from '@effect/ui'
import { Effect, Exit, Layer, Option, Schema, Scope } from 'effect'
import { describe, expect, it } from 'vitest'

import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../playground/app.js'
import { Native, NativeCommand, NativeMount, Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const Rect = Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number })

const Message = UiSchema.TaggedEnum({
  LaidOut: { rect: Rect },
  Scrolled: { y: Schema.Number, byUser: Schema.Boolean },
  EndedScroll: { y: Schema.Number },
  HeardNative: { payload: Schema.Unknown },
  CompletedMeasure: { rect: Rect },
  ChangedLayout: { rect: Rect },
  PressedFocus: {},
  PressedScroll: {},
  PressedMeasure: {},
  CompletedMeasureByRef: { found: Schema.Boolean, width: Schema.Number },
  PressedHide: {},
  PressedShuffle: {},
})

const FieldRef = Native.ref('field')
const ListRef = Native.ref('list')
const BoxRef = Native.ref('box')

const Probe = Native.component({
  name: 'Probe',
  model: Schema.Struct({
    log: Schema.Array(Schema.String),
    isShown: Schema.Boolean,
    order: Schema.Array(Schema.String),
  }),
  message: Message,
}).make({
  init: () => ({ log: [], isShown: true, order: ['a', 'b', 'c'] }),
  update: {
    LaidOut: ($, { rect }) => $.evolve({ log: log => [...log, `layout ${rect.width}x${rect.height}`] }),
    Scrolled: ($, { y, byUser }) => $.evolve({ log: log => [...log, `scroll ${y} ${byUser ? 'user' : 'program'}`] }),
    EndedScroll: ($, { y }) => $.evolve({ log: log => [...log, `end ${y}`] }),
    HeardNative: ($, { payload }) => $.evolve({ log: log => [...log, `native ${JSON.stringify(payload)}`] }),
    CompletedMeasure: ($, { rect }) => $.evolve({ log: log => [...log, `measured ${rect.width}x${rect.height}`] }),
    ChangedLayout: ($, { rect }) => $.evolve({ log: log => [...log, `tracked ${rect.width}x${rect.height}`] }),
    PressedFocus: $ => $.run(NativeCommand.focus(FieldRef).pipe(Command.asNoop)),
    PressedScroll: $ => $.run(NativeCommand.scrollTo(ListRef, { y: 240, animated: true }).pipe(Command.asNoop)),
    PressedMeasure: $ =>
      $.run(
        NativeCommand.measure(BoxRef).pipe(
          Command.map(rect =>
            Message.CompletedMeasureByRef({
              found: Option.isSome(rect),
              width: Option.match(rect, { onNone: () => -1, onSome: found => found.width }),
            }),
          ),
        ),
      ),
    CompletedMeasureByRef: ($, { found, width }) => $.evolve({ log: log => [...log, `ref ${found} ${width}`] }),
    PressedHide: $ => $.evolve({ isShown: shown => !shown }),
    PressedShuffle: $ => $.evolve({ order: ['c', 'a', 'b'] }),
  },
  view: (h, model) =>
    h.view.children(
      h.text.testId('log').children(model.log.join(' | ')),
      model.isShown &&
        h.view
          .key('box')
          .ref(BoxRef)
          .testId('box')
          .set({ collapsable: false, nativeID: 'box' })
          .on('layout', rect => Message.LaidOut({ rect }))
          .onMount(NativeMount.Measure().pipe(Mount.map(rect => Message.CompletedMeasure({ rect })))),
      model.isShown &&
        h.view
          .key('tracked')
          .testId('tracked')
          .set({ collapsable: false })
          .onMount(NativeMount.TrackLayout().pipe(Mount.map(rect => Message.ChangedLayout({ rect })))),
      h.scrollView
        .ref(ListRef)
        .testId('list')
        .on('scroll', at => Message.Scrolled({ y: at.y, byUser: at.byUser }))
        .on('scrollEnd', at => Message.EndedScroll({ y: at.y }))
        .children(model.order.map(id => h.view.key(id).testId(`item-${id}`).set({ collapsable: false }))),
      h.el('view')
        .attr('testID', 'custom')
        .prop('collapsable', false)
        .on('somethingHappened', (payload: unknown) => Message.HeardNative({ payload })),
      h.textInput.ref(FieldRef).testId('field').value(''),
      h.pressable.testId('focus').on('press', Message.PressedFocus()).children(h.text('focus')),
      h.pressable.testId('scroll').on('press', Message.PressedScroll()).children(h.text('scroll')),
      h.pressable.testId('measure').on('press', Message.PressedMeasure()).children(h.text('measure')),
      h.pressable.testId('hide').on('press', Message.PressedHide()).children(h.text('hide')),
      h.pressable.testId('shuffle').on('press', Message.PressedShuffle()).children(h.text('shuffle')),
    ),
})

const logOf = (app: { root: { model: () => any } }): ReadonlyArray<string> => app.root.model().log

const metrics = (y: number, extra: Record<string, unknown> = {}) => ({
  contentOffset: { x: 0, y },
  contentSize: { width: 390, height: 4000 },
  layoutMeasurement: { width: 390, height: 700 },
  ...extra,
})

describe('events to Messages', () => {
  it('layout arrives as a plain rectangle', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        yield* app.emit('box', 'topLayout', { layout: { x: 0, y: 10, width: 320, height: 48 }, target: 7 })
        expect(logOf(app)).toContain('layout 320x48')
      }),
    ))

  it('scroll says where the list is and whether a finger did it', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {}, { scrollThrottleMs: 0 })
        yield* app.emit('list', 'topScroll', metrics(120, { responderIgnoreScroll: false }))
        yield* app.emit('list', 'topScroll', metrics(180, { responderIgnoreScroll: true }))
        expect(logOf(app)).toEqual(['scroll 120 user', 'scroll 180 program'])
      }),
    ))

  it('scroll Messages are at most one per frame, and the last position is never lost', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {}, { scrollThrottleMs: 40 })
        // Five reports inside one frame.
        yield* Effect.sync(() => {
          for (const y of [10, 20, 30, 40, 50]) app.fabric.emit(app.byTestId('list'), 'topScroll', metrics(y))
        })
        yield* app.settle
        expect(logOf(app)).toEqual(['scroll 10 user'])
        yield* app.wait(60)
        expect(logOf(app)).toEqual(['scroll 10 user', 'scroll 50 user'])
      }),
    ))

  it('scrollEnd is the glide ending, or the finger lifting with no glide', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        // Lifted with speed: a glide follows, so not yet.
        yield* app.emit('list', 'topScrollEndDrag', metrics(300, { velocity: { x: 0, y: 2.5 } }))
        expect(logOf(app)).toEqual([])
        yield* app.emit('list', 'topMomentumScrollEnd', metrics(900))
        expect(logOf(app)).toEqual(['end 900'])
        yield* app.emit('list', 'topScrollEndDrag', metrics(950, { velocity: { x: 0, y: 0 } }))
        expect(logOf(app)).toEqual(['end 900', 'end 950'])
      }),
    ))

  it("a native view's own event arrives with a copy of what the phone sent", () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        yield* app.emit('custom', 'topSomethingHappened', { count: 2, target: 99 })
        expect(logOf(app)).toEqual(['native {"count":2}'])
      }),
    ))
})

describe('Mounts and Commands on the native node', () => {
  it('Measure reads the frame of the element once it is drawn', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        // The simulated phone has not laid it out and never answers: all zeros, after a short wait.
        yield* app.wait(300)
        expect(logOf(app)).toContain('measured 0x0')
        // Taken away and drawn again, on a phone that has laid it out.
        app.fabric.frames.set('box', { x: 0, y: 100, width: 320, height: 48 })
        yield* app.press('hide')
        yield* app.press('hide')
        expect(logOf(app)).toContain('measured 320x48')
      }),
    ))

  it('TrackLayout reports each layout, and stops when the element goes', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        yield* app.emit('tracked', 'topLayout', { layout: { x: 0, y: 0, width: 100, height: 20 } })
        yield* app.emit('tracked', 'topLayout', { layout: { x: 0, y: 0, width: 100, height: 44 } })
        expect(logOf(app).filter(line => line.startsWith('tracked'))).toEqual(['tracked 100x20', 'tracked 100x44'])
        const live = app.stats.live
        yield* app.press('hide')
        expect(app.has('tracked')).toBe(false)
        expect(app.stats.live).toBe(live - 2)
      }),
    ))

  it('focus, scrollTo and measure reach the element named by a ref', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        app.fabric.frames.set('box', { x: 0, y: 100, width: 320, height: 48 })
        yield* app.press('focus')
        yield* app.press('scroll')
        yield* app.press('measure')
        const commands = app.commands().map(command => `${command.viewName}.${command.name}`)
        expect(commands).toContain('TextInput.focus')
        expect(app.commands().find(command => command.name === 'scrollTo')?.args).toEqual([0, 240, true])
        expect(logOf(app)).toContain('ref true 320')
        // A ref that is not on screen answers "not found".
        yield* app.press('hide')
        yield* app.press('measure')
        expect(logOf(app)).toContain('ref false -1')
      }),
    ))

  it('a keyed reorder moves native views and makes none', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Probe, {})
        const ids = () => app.byTestId('list').children[0]?.children.map(child => child.props['testID'])
        expect(ids()).toEqual(['item-a', 'item-b', 'item-c'])
        const created = app.stats.created
        const tags = app.byTestId('list').children[0]?.children.map(child => child.reactTag)
        yield* app.press('shuffle')
        expect(ids()).toEqual(['item-c', 'item-a', 'item-b'])
        expect(app.stats.created).toBe(created)
        expect([...(app.byTestId('list').children[0]?.children.map(child => child.reactTag) ?? [])].sort()).toEqual(
          [...(tags ?? [])].sort(),
        )
      }),
    ))
})

describe('mount and dispose', () => {
  it('closing the Scope unmounts the whole app and leaves no listener behind', async () => {
    registerNavigation()
    const device = Phone.Device.makeTest()
    const scope = Effect.runSync(Scope.make())
    const app = await Effect.runPromise(
      NativeTest.mount(App, { platform: 'ios', hasReadout: true }).pipe(
        Effect.provide(Layer.provideMerge(Phone.layer, device.layer)),
        Effect.provideService(Scope.Scope, scope),
      ) as Effect.Effect<NativeTest.MountedApp<any, any>>,
    )
    await Effect.runPromise(app.press('menu-Phone'))
    expect(device.keyboard.listenerCount()).toBe(1)
    expect(app.stats.live).toBeGreaterThan(10)
    expect(app.stats.wired).toBeGreaterThan(3)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(app.stats.live).toBe(0)
    expect(app.stats.listeners).toBe(0)
    expect(app.stats.wired).toBe(0)
    expect(device.keyboard.listenerCount()).toBe(0)
    expect(device.colorScheme.listenerCount()).toBe(0)
    expect(device.appState.listenerCount()).toBe(0)
    expect(NativeTest.flatten(app.fabric.committed)).toHaveLength(1)
    // Nothing draws after the end.
    const commits = app.commitCount()
    await Effect.runPromise(app.wait(60))
    expect(app.commitCount()).toBe(commits)
  })
})
