/**
 * `Motion`: animations that run on the phone's own thread, on a simulated
 * phone. The UI thread is stood in for by the fake worklets, which record
 * every style a worklet puts on a view and let a test move time on frame by
 * frame, with or without the JavaScript thread hearing about it.
 *
 * What these tests can show: which view the phone is told to change, with
 * which values, in which order, and what JavaScript does and does not do
 * meanwhile. They cannot show movement.
 */
import { Command, UiSchema } from '@effect/ui'
import { Effect, Exit, Schema, Scope } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { configureWorklets, resetWorklets } from '../../native/src/host/worklets/host.js'
import { requireCompiledWorklets } from '../../native/src/host/worklets/run.js'
import { type FakeWorklets, makeWorklets } from '../../native/test/support/worklets.js'
import { countMotionOnUi } from '../src/internal/motionUi.js'
import { Motion, Native } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const Message = UiSchema.TaggedEnum({
  PressedToggle: {},
  PressedShow: {},
  PressedTint: {},
  PressedNudge: {},
  PressedNote: {},
  Nudged: { route: Schema.String },
})

const Nudge = Native.ref('nudge')

const Demo = Native.component({
  name: 'MotionDemo',
  props: Schema.Struct({ spring: Schema.Boolean, delayMs: Schema.Number }),
  model: Schema.Struct({
    isOn: Schema.Boolean,
    isShown: Schema.Boolean,
    isTinted: Schema.Boolean,
    route: Schema.String,
    notes: Schema.Number,
  }),
  message: Message,
}).make({
  init: () => ({ isOn: false, isShown: false, isTinted: false, route: '', notes: 0 }),
  update: {
    PressedToggle: $ => $.evolve({ isOn: on => !on }),
    PressedShow: $ => $.evolve({ isShown: shown => !shown }),
    PressedTint: $ => $.evolve({ isTinted: tinted => !tinted }),
    PressedNote: $ => $.evolve({ notes: count => count + 1 }),
    PressedNudge: $ =>
      $.run(
        Motion.animateTo(Nudge, { from: { translateX: 40 }, to: { translateX: 0 }, ms: 100, easing: 'linear' }).pipe(
          Command.map(answer => Message.Nudged({ route: answer.route })),
        ),
      ),
    Nudged: ($, { route }) => $.evolve({ route }),
  },
  view: (h, model) =>
    h.view.children(
      h.pressable.testId('toggle').on('press', Message.PressedToggle()).children(h.text('toggle')),
      h.pressable.testId('show').on('press', Message.PressedShow()).children(h.text('show')),
      h.pressable.testId('tint').on('press', Message.PressedTint()).children(h.text('tint')),
      h.pressable.testId('nudge').on('press', Message.PressedNudge()).children(h.text('nudge')),
      h.text.testId('route').children(model.route),
      h.text.testId('notes').children(String(model.notes)),
      // Follows the Model.
      Motion.animate(
        h.view.testId('follower').set({ collapsable: false }).style({ width: 40, backgroundColor: model.isTinted ? '#111111' : '#EEEEEE' }),
        {
          to: { opacity: model.isOn ? 1 : 0.2, scale: model.isOn ? 1 : 0.5 },
          ...(h.props.spring ? { spring: { damping: 8 } } : { ms: 200, easing: 'linear' as const }),
        },
      ),
      // Comes and goes.
      model.isShown
        ? Motion.animate(h.view.key('guest').testId('guest').set({ collapsable: false }).style({ height: 20 }), {
            from: { opacity: 0, translateY: 24 },
            to: { opacity: 1, translateY: 0 },
            exit: { opacity: 0 },
            ms: 200,
            delayMs: h.props.delayMs,
            easing: 'linear',
          }).children(h.pressable.testId('note').on('press', Message.PressedNote()).children(h.text('a guest')))
        : null,
      // Moved by a Command.
      h.view.testId('nudged').ref(Nudge).set({ collapsable: false }).style({ height: 10 }),
    ),
})

let ui: FakeWorklets | undefined

afterEach(() => {
  ui?.uninstall()
  ui = undefined
  resetWorklets()
  requireCompiledWorklets(true)
  Motion.reset()
  // On a phone this is on the UI thread's own global. Here the two threads share one.
  delete (globalThis as { __effectUiMotion?: unknown }).__effectUiMotion
})

/** A build with worklets and Reanimated's native code. */
const useWorklets = (): FakeWorklets => {
  const made = makeWorklets()
  ui = made
  requireCompiledWorklets(false)
  configureWorklets(made.config)
  return made
}

const mount = (props: Partial<{ spring: boolean; delayMs: number }> = {}) =>
  NativeTest.mount(Demo, { spring: false, delayMs: 0, ...props })

type Look = Readonly<{ opacity?: number; translateX?: number; translateY?: number; scale?: number }>

const lookOf = (style: Readonly<Record<string, unknown>>): Look => {
  const transform = (style['transform'] as ReadonlyArray<Record<string, number>> | undefined) ?? []
  const find = (name: string): number | undefined => transform.find(each => name in each)?.[name]
  return {
    ...(typeof style['opacity'] === 'number' ? { opacity: style['opacity'] } : {}),
    ...(find('translateX') === undefined ? {} : { translateX: find('translateX') as number }),
    ...(find('translateY') === undefined ? {} : { translateY: find('translateY') as number }),
    ...(find('scale') === undefined ? {} : { scale: find('scale') as number }),
  }
}

/** What the UI thread put on one view, oldest first. */
const sentTo = (worklets: FakeWorklets, tag: number): ReadonlyArray<Look> =>
  worklets.updates.filter(update => update.tag === tag).map(update => lookOf(update.style))

const close = (value: number | undefined, wanted: number): void => expect(value).toBeCloseTo(wanted, 2)

describe('Motion on the phone’s own thread', () => {
  it('a new view is first drawn where it starts, and the phone then moves that very view to its place', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        expect(Motion.route()).toBe('ui-thread')
        yield* app.press('show')
        // JavaScript's own draw holds the start, so nothing flashes at its end place first.
        expect(lookOf(app.byTestId('guest').props)).toEqual({ opacity: 0, translateX: 0, translateY: 24, scale: 1 })
        const tag = app.byTestId('guest').reactTag
        worklets.flushUi()
        // The first thing the UI thread writes to this view is the start.
        expect(sentTo(worklets, tag)).toEqual([{ opacity: 0, translateX: 0, translateY: 24, scale: 1 }])
        // Half of 200 ms on a straight line is half way.
        worklets.frame(0)
        worklets.frame(100)
        const half = sentTo(worklets, tag).at(-1)
        close(half?.opacity, 0.5)
        close(half?.translateY, 12)
        worklets.frame(100)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
        // Nothing asks for another frame once it is there.
        expect(worklets.framesAsked()).toBe(0)
        // It only ever went one way.
        const opacities = sentTo(worklets, tag).map(look => look.opacity as number)
        expect([...opacities].sort((a, b) => a - b)).toEqual(opacities)
      }),
    ))

  it('keeps going while JavaScript hears nothing and draws nothing, and JavaScript takes the end values afterwards', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        yield* app.press('show')
        const tag = app.byTestId('guest').reactTag
        worklets.flushUi()
        const commits = app.commitCount()
        // Twenty frames on the UI thread. Nothing it sends back is delivered: JavaScript is busy.
        for (let frame = 0; frame < 20; frame++) worklets.frame(16, { deliver: false })
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
        expect(sentTo(worklets, tag).length).toBeGreaterThan(8)
        expect(app.commitCount()).toBe(commits)
        // JavaScript's copy is still the start. It was not needed.
        expect(lookOf(app.byTestId('guest').props).opacity).toBe(0)
        expect(Motion.stats().running).toBe(1)
        // JavaScript is free again and hears that it is over.
        worklets.deliver()
        yield* app.settle
        expect(lookOf(app.byTestId('guest').props)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
        expect(Motion.stats().running).toBe(0)
      }),
    ))

  it('waits for its delay before anything moves', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount({ delayMs: 300 })
        yield* app.press('show')
        const tag = app.byTestId('guest').reactTag
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(150)
        worklets.frame(140)
        // 290 ms in: still only the start.
        expect(sentTo(worklets, tag)).toEqual([{ opacity: 0, translateX: 0, translateY: 24, scale: 1 }])
        worklets.frame(110)
        // 100 ms after the delay.
        close(sentTo(worklets, tag).at(-1)?.opacity, 0.5)
      }),
    ))

  it('a change in the Model starts a new animation from where the view is, in the middle of the old one', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        const tag = app.byTestId('follower').reactTag
        // Drawn at its place, with no animation: nothing was sent to the UI thread.
        expect(lookOf(app.byTestId('follower').props)).toEqual({ opacity: 0.2, translateX: 0, translateY: 0, scale: 0.5 })
        worklets.flushUi()
        expect(sentTo(worklets, tag)).toEqual([])
        yield* app.press('toggle')
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(100)
        const middle = sentTo(worklets, tag).at(-1) as Look
        close(middle.opacity, 0.6)
        close(middle.scale, 0.75)
        // Back again, half way through.
        yield* app.press('toggle')
        worklets.flushUi()
        const after = sentTo(worklets, tag)
        // The new run starts exactly where the old one was, not at either end.
        expect(after.at(-1)).toEqual(middle)
        worklets.frame(0)
        worklets.frame(100)
        close(sentTo(worklets, tag).at(-1)?.opacity, 0.4)
        worklets.frame(100)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ opacity: 0.2, translateX: 0, translateY: 0, scale: 0.5 })
        // The old run wrote nothing more after it was replaced: the values only fell.
        const tail = sentTo(worklets, tag).slice(after.length - 1).map(look => look.opacity as number)
        expect([...tail].sort((a, b) => b - a)).toEqual(tail)
        yield* app.settle
        expect(Motion.stats().running).toBe(0)
      }),
    ))

  it('a spring goes past its end and comes back to rest exactly on it', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount({ spring: true })
        const tag = app.byTestId('follower').reactTag
        yield* app.press('toggle')
        worklets.flushUi()
        for (let frame = 0; frame < 400 && worklets.framesAsked() > 0; frame++) worklets.frame(16)
        const scales = sentTo(worklets, tag).map(look => look.scale as number)
        expect(Math.max(...scales)).toBeGreaterThan(1.02)
        expect(scales.at(-1)).toBe(1)
        expect(worklets.framesAsked()).toBe(0)
      }),
    ))

  it('the element keeps its own style while it is animated, and a new style does not undo the animation', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        yield* app.press('toggle')
        worklets.flushUi()
        for (let frame = 0; frame < 20; frame++) worklets.frame(16)
        yield* app.settle
        expect(app.byTestId('follower').props).toMatchObject({ width: 40, opacity: 1 })
        yield* app.press('tint')
        const props = app.byTestId('follower').props
        expect(props['width']).toBe(40)
        // The colour is the new one, and the view is still where the animation left it.
        expect(props['backgroundColor']).not.toBe(undefined)
        expect(lookOf(props)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
      }),
    ))

  it('a Command animates the view a ref names, from a start it jumps to first', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        const tag = app.byTestId('nudged').reactTag
        yield* app.press('nudge')
        expect(app.text('route')).toBe('ui-thread')
        worklets.flushUi()
        // Only the transform is written. The view's opacity is not this animation's.
        expect(sentTo(worklets, tag)).toEqual([{ translateX: 40, translateY: 0, scale: 1 }])
        worklets.frame(0)
        worklets.frame(50)
        close(sentTo(worklets, tag).at(-1)?.translateX, 20)
        worklets.frame(50)
        expect(sentTo(worklets, tag).at(-1)).toEqual({ translateX: 0, translateY: 0, scale: 1 })
      }),
    ))
})

describe('Motion: a view that leaves', () => {
  it('stays on screen, out of reach, until its way out is over, and is then taken away', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        yield* app.press('show')
        worklets.flushUi()
        for (let frame = 0; frame < 20; frame++) worklets.frame(16)
        yield* app.settle
        const tag = app.byTestId('guest').reactTag
        const before = sentTo(worklets, tag).length
        yield* app.press('show')
        // The Model no longer has it. The phone still shows it, and a finger goes through it.
        expect(app.has('guest')).toBe(true)
        expect(app.byTestId('guest').props['pointerEvents']).toBe('none')
        expect(Motion.stats().leaving).toBe(1)
        yield* app.press('note')
        expect(app.text('notes')).toBe('0')
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(100)
        close(sentTo(worklets, tag).at(-1)?.opacity, 0.5)
        expect(app.has('guest')).toBe(true)
        worklets.frame(100)
        expect(sentTo(worklets, tag).length).toBeGreaterThan(before)
        expect(sentTo(worklets, tag).at(-1)?.opacity).toBe(0)
        yield* app.settle
        expect(app.has('guest')).toBe(false)
        expect(Motion.stats().leaving).toBe(0)
        // Shown again, it is a new view that comes in from its start.
        yield* app.press('show')
        expect(lookOf(app.byTestId('guest').props).opacity).toBe(0)
        expect(app.byTestId('guest').reactTag).not.toBe(tag)
      }),
    ))

  it('is taken away a moment after its time even if the phone never says the way out is over', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const app = yield* mount()
        yield* app.press('show')
        worklets.flushUi()
        for (let frame = 0; frame < 20; frame++) worklets.frame(16)
        yield* app.settle
        yield* app.press('show')
        // The UI thread gets the job and then says nothing at all.
        expect(app.has('guest')).toBe(true)
        yield* app.wait(200 + 400 + 100)
        expect(app.has('guest')).toBe(false)
        expect(Motion.stats().leaving).toBe(0)
      }),
    ))
})

describe('Motion without worklets', () => {
  it('draws a new view at its place at once, sets a change in one go, and says which route it is on', () =>
    run(
      Effect.gen(function* () {
        const app = yield* mount()
        expect(Motion.route()).toBe('at-once')
        expect(Motion.status()).toBe('set at once, no movement (the app did not call configureWorklets())')
        const first = app.commitCount()
        yield* app.press('show')
        // No start, no steps: the end values, in the one draw that made the view.
        expect(lookOf(app.byTestId('guest').props)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
        expect(app.commitCount() - first).toBe(1)
        const commits = app.commitCount()
        yield* app.press('toggle')
        expect(lookOf(app.byTestId('follower').props)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
        expect(app.commitCount() - commits).toBe(1)
        yield* app.press('nudge')
        expect(app.text('route')).toBe('at-once')
        expect(lookOf(app.byTestId('nudged').props)).toEqual({ translateX: 0, translateY: 0, scale: 1 })
        // A view with a way out is simply taken away.
        yield* app.press('show')
        expect(app.has('guest')).toBe(false)
        const stats = Motion.stats()
        expect(stats.onUiThread).toBe(0)
        expect(stats.atOnce).toBeGreaterThanOrEqual(3)
        expect(stats.running).toBe(0)
      }),
    ))

  it('can be switched off by the app in a build that has worklets', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        Motion.configure({ uiThread: false })
        const app = yield* mount()
        expect(Motion.status()).toBe('set at once, no movement (switched off by the app)')
        yield* app.press('toggle')
        worklets.flushUi()
        expect(worklets.updates).toEqual([])
        expect(lookOf(app.byTestId('follower').props).opacity).toBe(1)
      }),
    ))
})

describe('Motion with Reduce Motion on', () => {
  it('nothing moves or grows: the view is in its place from the first draw, and only a short fade is left', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        Motion.configure({ reduceMotion: true })
        const app = yield* mount()
        expect(Motion.status()).toBe("on the phone's own thread, Reduce Motion on")
        yield* app.press('show')
        expect(lookOf(app.byTestId('guest').props)).toEqual({ opacity: 0, translateX: 0, translateY: 0, scale: 1 })
        const guest = app.byTestId('guest').reactTag
        worklets.flushUi()
        worklets.frame(0)
        worklets.frame(60)
        const sent = sentTo(worklets, guest)
        // Never away from its place, at any step.
        expect(sent.every(look => look.translateY === 0)).toBe(true)
        const middle = sent.at(-1)?.opacity as number
        expect(middle).toBeGreaterThan(0.5)
        expect(middle).toBeLessThan(1)
        // Over after 120 ms, not after the 200 ms it asked for.
        worklets.frame(60)
        expect(sentTo(worklets, guest).at(-1)).toEqual({ opacity: 1, translateX: 0, translateY: 0, scale: 1 })
        expect(worklets.framesAsked()).toBe(0)
        // A change of size is set at once, and its opacity fades.
        const follower = app.byTestId('follower').reactTag
        yield* app.press('toggle')
        worklets.flushUi()
        expect(sentTo(worklets, follower)[0]).toEqual({ opacity: 0.2, translateX: 0, translateY: 0, scale: 1 })
      }),
    ))

  it('follows the phone’s own setting as it changes', () =>
    run(
      Effect.gen(function* () {
        let tell = (_isOn: boolean): void => {}
        Motion.configure({
          accessibilityInfo: {
            isReduceMotionEnabled: () => Promise.resolve(true),
            addEventListener: (_name, listener) => {
              tell = listener
            },
          },
        })
        yield* Effect.promise(() => Promise.resolve())
        expect(Motion.isReduced()).toBe(true)
        tell(false)
        expect(Motion.isReduced()).toBe(false)
      }),
    ))
})

describe('Motion after unmount', () => {
  it('leaves nothing attached, on either thread', () =>
    run(
      Effect.gen(function* () {
        const worklets = useWorklets()
        const scope = yield* Scope.make()
        const app = yield* mount().pipe(Scope.provide(scope))
        yield* app.press('show')
        yield* app.press('toggle')
        yield* app.press('nudge')
        worklets.flushUi()
        // In the middle of three animations.
        worklets.frame(0)
        worklets.frame(50)
        expect(Motion.stats()).toMatchObject({ attached: 3, running: 3 })
        expect(worklets.pkg.runOnUISync(countMotionOnUi)).toBe(3)
        yield* Scope.close(scope, Exit.void)
        worklets.flushUi()
        expect(Motion.stats()).toMatchObject({ attached: 0, running: 0, leaving: 0 })
        // The UI thread keeps no place for any view, and Reanimated was told it may forget them.
        expect(worklets.pkg.runOnUISync(countMotionOnUi)).toBe(0)
        expect(worklets.removable).toHaveLength(3)
        const sent = worklets.updates.length
        for (let frame = 0; frame < 10; frame++) worklets.frame(16)
        // No frame writes to a view that is gone.
        expect(worklets.updates.length).toBe(sent)
        expect(worklets.framesAsked()).toBe(0)
        expect(app.stats.live).toBe(0)
        expect(app.stats.listeners).toBe(0)
        // No timer of this module fires later into the next test.
        yield* app.wait(700)
        expect(Motion.stats()).toMatchObject({ attached: 0, running: 0, leaving: 0 })
      }),
    ))
})
