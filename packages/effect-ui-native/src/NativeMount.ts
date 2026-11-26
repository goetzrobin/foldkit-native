/**
 * Mounts: work that starts with an element's native node and lasts as long
 * as the element does.
 *
 *   h.view.onMount(NativeMount.Measure().pipe(Mount.map(rect => Message.CompletedMeasure({ rect }))))
 *   h.view.onMount(NativeMount.TrackLayout().pipe(Mount.map(rect => Message.ChangedLayout({ rect }))))
 *   h.view.onMount(NativeMount.TrackHold({ ms: 500 }).pipe(Mount.map(change => Message.ChangedHold({ change }))))
 *   h.view.onMount(NativeMount.Fade({ isShown: model.isOpen, ms: 150 }))
 *
 * For animations, see `Motion`: it moves views on the phone's own thread.
 *
 * A Mount's body gets the engine node. Write your own with `Mount.make` and
 * `Mount.makeStream`, annotating the node as `Native.Node` and reading
 * `Native.Host` for the engine: that is how a gesture or a drawing library
 * attaches to a view.
 */
import * as Mount from '@effect/ui/Mount'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { onNextFrame } from '../../native/src/host/motion/clock.js'
import { attachNativeHold } from '../../native/src/host/worklets/hold.js'
import * as Native from './Native.js'

const EMPTY: Native.Rect = { x: 0, y: 0, width: 0, height: 0 }

/** Measures the element once, after it has been drawn. All zeros if the phone has not laid it out. */
export const Measure = Mount.make('Measure', { args: {} }, (node: Native.Node) =>
  Native.Host.use(host =>
    Effect.flatMap(
      // The first draw must have reached the phone before a view can be measured.
      Effect.callback<void>(resume => {
        host.afterCommit(() => resume(Effect.void))
      }),
      () => Effect.map(host.measure(node), rect => rect ?? EMPTY),
    ),
  ),
)

/** Reports the element's frame each time the phone lays it out. */
export const TrackLayout = Mount.makeStream('TrackLayout', { args: {} }, (node: Native.Node) =>
  Stream.unwrap(
    Native.Host.use(host =>
      Effect.sync(() =>
        Stream.callback<Native.Rect>(queue =>
          Effect.acquireRelease(
            Effect.sync(() =>
              host.engine.setEventListener(node, 'topLayout', event => {
                const layout = (event as { nativeEvent?: { layout?: Partial<Native.Rect> } })?.nativeEvent?.layout
                Queue.offerUnsafe(queue, {
                  x: layout?.x ?? 0,
                  y: layout?.y ?? 0,
                  width: layout?.width ?? 0,
                  height: layout?.height ?? 0,
                })
              }),
            ),
            stop => Effect.sync(stop),
          ),
        ),
      ),
    ),
  ),
)

/** What the phone's own long press recogniser said. */
export const HoldChange = Schema.Struct({
  /** `began`: finger down. `active`: held long enough. `ended`, `failed`, `cancelled`. `unavailable`: this build cannot. */
  state: Schema.Literals(['began', 'active', 'ended', 'failed', 'cancelled', 'unavailable']),
  reason: Schema.String,
})
export type HoldChange = typeof HoldChange.Type

const HOLD_STATES: Readonly<Record<number, HoldChange['state']>> = {
  1: 'failed',
  2: 'began',
  3: 'cancelled',
  4: 'active',
  5: 'ended',
}

/**
 * Attaches the phone's own long press recogniser (gesture-handler) to the
 * view, where the build has it. It sees only the finger, so it holds through
 * anything JavaScript draws meanwhile. The host's `longPress` event needs
 * none of this: this is the example of attaching a native gesture by Mount.
 */
export const TrackHold = Mount.makeStream(
  'TrackHold',
  { args: { ms: Schema.Number } },
  (node: Native.Node, args) =>
    Stream.unwrap(
      Native.Host.use(host =>
        Effect.sync(() =>
          Stream.callback<HoldChange>(queue =>
            Effect.acquireRelease(
              Effect.sync(() => {
                let detach = (): void => {}
                let isGone = false
                // A view has no number until a draw has reached the phone.
                host.afterCommit(() => {
                  if (isGone) return
                  const tag = host.tagOf(node)
                  if (tag === null) {
                    Queue.offerUnsafe(queue, { state: 'unavailable', reason: 'the view is not on the phone' })
                    return
                  }
                  const hold = attachNativeHold(tag, { minDurationMs: args.ms, maxDist: 10 }, change => {
                    const state = HOLD_STATES[change.state]
                    if (state !== undefined) Queue.offerUnsafe(queue, { state, reason: '' })
                  })
                  if (hold.ok) detach = hold.detach
                  else Queue.offerUnsafe(queue, { state: 'unavailable', reason: hold.reason })
                })
                return () => {
                  isGone = true
                  detach()
                }
              }),
              stop => Effect.sync(stop),
            ),
          ),
        ),
      ),
    ),
)

/** How small a faded view is when it is away. */
export const FADE_SCALE = 0.8

/**
 * Fades a view in and out, growing from 80% as it comes and shrinking as it
 * goes. The view stays in the tree: while it is away it is see-through and
 * takes no touches. This is how a button appears and disappears with a
 * quick fade, when the Model only holds whether it is wanted.
 *
 * The Mount owns the view's `style` and `pointerEvents`. Give that view no
 * style of its own in the view function, and put what is to be faded inside
 * it. A view that is wanted when it is first drawn fades in. One that is
 * not starts away, with nothing to see.
 *
 * The steps are written from JavaScript, one a frame, for `ms` milliseconds,
 * so it stands still while JavaScript is busy. `Motion.animate` does the
 * same on the phone's own thread, and lets the view leave the tree.
 */
export const Fade = Mount.makeStream(
  'Fade',
  { args: { isShown: Schema.Boolean, ms: Schema.Number } },
  (node: Native.Node, _args, changes) =>
    Stream.unwrap(
      Native.Host.use(host =>
        Effect.sync(() => {
          const engine = host.engine
          const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
          let at = 0
          let run = 0
          const write = (): void => {
            engine.setProp(node, 'style', { opacity: at, transform: [{ scale: FADE_SCALE + (1 - FADE_SCALE) * at }] })
            // Away, it must not take a touch meant for what is under it.
            engine.setProp(node, 'pointerEvents', at === 0 ? 'none' : 'box-none')
            engine.commit()
          }
          const moveTo = (target: number, ms: number): void => {
            const mine = ++run
            const from = at
            if (from === target) return
            const startedAt = clock()
            const step = (): void => {
              if (mine !== run) return
              const t = ms <= 0 ? 1 : Math.min(1, (clock() - startedAt) / ms)
              // Fast at first, then gentle.
              at = from + (target - from) * (1 - (1 - t) * (1 - t))
              write()
              if (t < 1) onNextFrame(engine, step)
            }
            onNextFrame(engine, step)
          }
          write()
          return changes.pipe(
            Stream.tap(args => Effect.sync(() => moveTo(args.isShown ? 1 : 0, args.ms))),
            Stream.filter((): boolean => false),
            Stream.map((): never => undefined as never),
            Stream.ensuring(
              Effect.sync(() => {
                run++
              }),
            ),
          )
        }),
      ),
    ),
)
