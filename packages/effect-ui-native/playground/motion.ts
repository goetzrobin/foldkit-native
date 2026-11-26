/**
 * Motion: boxes that fade, move and spring, to answer one question on a real
 * phone. Does an animation keep running while JavaScript is busy?
 *
 * The first three boxes are moved by the phone's own thread (`Motion`). The
 * last one is moved from JavaScript, a step per frame (`NativeMount.Fade`),
 * to compare. "Run, and block JavaScript" starts all four and then keeps
 * JavaScript busy for one second. On a phone with worklets the first three
 * keep going and the last one stands still for that second.
 *
 * The line at the top says which route this build uses. Where it says "set
 * at once", nothing here moves: the boxes jump.
 */
import { Command, UiSchema } from '@effect/ui'
import { Effect, Schema } from 'effect'

import { Motion, Native, NativeMount } from '../src/index.js'
import * as Look from './look.js'

export const MotionMessage = UiSchema.TaggedEnum({
  PressedRun: {},
  PressedRunAndBlock: {},
  Unblocked: { ms: Schema.Number },
  PressedGuest: {},
})

/** How long the boxes take, so they are still moving while JavaScript is blocked. */
export const TRAVEL_MS = 1500
export const BLOCK_MS = 1000
const TRAVEL = 180
const BOX = 44

/**
 * Keeps JavaScript busy for `ms`, doing nothing useful. It waits a moment
 * first, so the draw that starts the animations has reached the phone.
 */
export const Block = Command.make('playground/Block', { args: { ms: Schema.Number } }, ({ ms }) =>
  Effect.andThen(
    Effect.sleep('60 millis'),
    Effect.sync(() => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < ms) {
        // Busy on purpose.
      }
      return { ms: Date.now() - startedAt }
    }),
  ),
)

const box = (color: string): Native.ViewStyle => ({ width: BOX, height: BOX, borderRadius: 10, backgroundColor: color })

export const MotionScreen = Native.component({
  name: 'MotionScreen',
  model: Schema.Struct({
    /** The boxes are at their far end. */
    isAway: Schema.Boolean,
    /** How long JavaScript was last blocked, or 0. */
    blockedMs: Schema.Number,
    isBlocking: Schema.Boolean,
    hasGuest: Schema.Boolean,
  }),
  message: MotionMessage,
}).make({
  init: () => ({ isAway: false, blockedMs: 0, isBlocking: false, hasGuest: false }),
  update: {
    PressedRun: $ => $.evolve({ isAway: away => !away }),
    PressedRunAndBlock: $ =>
      $.model.isBlocking
        ? $.model
        : $.evolve({ isAway: away => !away, isBlocking: true }).run(
            Block.make({ ms: BLOCK_MS }).pipe(Command.map(({ ms }) => MotionMessage.Unblocked({ ms }))),
          ),
    Unblocked: ($, { ms }) => $.evolve({ blockedMs: ms, isBlocking: false }),
    PressedGuest: $ => $.evolve({ hasGuest: has => !has }),
  },
  view: (h, model) => {
    const { isAway } = model
    const lane = (id: string, title: string, moving: Native.NoTextContent<typeof MotionMessage.Type, Native.Host>) =>
      h.view.key(id).style({ gap: 6 }).children(h.text.style(Look.small).children(title), h.view.style({ height: BOX }).children(moving))
    return h.scrollView.testId('motion').style(Look.page).set({ contentStyle: Look.pad }).children(
      h.text.testId('motion-route').style(Look.label).children(`Animations run: ${Motion.status()}`),
      lane(
        'fade',
        'Fades',
        Motion.animate(h.view.testId('motion-fade').style(box(Look.INK)), {
          to: { opacity: isAway ? 0.15 : 1 },
          ms: TRAVEL_MS,
          easing: 'easeInOut',
        }),
      ),
      lane(
        'move',
        'Moves',
        Motion.animate(h.view.testId('motion-move').style(box(Look.BLUE)), {
          to: { translateX: isAway ? TRAVEL : 0 },
          ms: TRAVEL_MS,
          easing: 'easeInOut',
        }),
      ),
      lane(
        'spring',
        'Springs, and grows',
        Motion.animate(h.view.testId('motion-spring').style(box(Look.RED)), {
          to: { translateX: isAway ? TRAVEL : 0, scale: isAway ? 1.25 : 1 },
          spring: { stiffness: 60, damping: 6 },
        }),
      ),
      lane(
        'js',
        'Moved from JavaScript, to compare',
        h.view
          .testId('motion-js')
          .set({ collapsable: false })
          .onMount(NativeMount.Fade({ isShown: !isAway, ms: TRAVEL_MS }))
          .children(h.view.style(box(Look.DIM))),
      ),
      h.view.style({ gap: 8 }).children(
        Look.plainButton(h, 'motion-run', 'Run', MotionMessage.PressedRun()),
        Look.plainButton(h, 'motion-block', 'Run, and block JavaScript for one second', MotionMessage.PressedRunAndBlock()),
        h.text
          .testId('motion-blocked')
          .style(Look.small)
          .children(
            model.isBlocking
              ? 'JavaScript is blocked now.'
              : model.blockedMs === 0
                ? 'JavaScript has not been blocked yet.'
                : `JavaScript was blocked for ${model.blockedMs} ms. Did the first three boxes keep moving?`,
          ),
      ),
      h.view.style({ gap: 8 }).children(
        Look.plainButton(h, 'motion-guest', model.hasGuest ? 'Take the line away' : 'Show a line', MotionMessage.PressedGuest()),
        h.view.style({ height: 24 }).children(
          model.hasGuest
            ? Motion.animate(h.view.key('guest').testId('motion-guest-line'), {
                from: { opacity: 0, translateY: 12 },
                to: { opacity: 1, translateY: 0 },
                exit: { opacity: 0 },
                ms: 300,
              }).children(h.text.style(Look.label).children('It rises in, and fades out before it is taken away.'))
            : null,
        ),
      ),
    )
  },
})
