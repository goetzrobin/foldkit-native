/**
 * Animations that run on the phone's own thread: a view fades, moves and
 * grows without JavaScript doing anything per frame. So it keeps moving
 * while JavaScript is busy.
 *
 * The component says where the view should be. The host takes it there.
 *
 *   // Fades in and rises 24 points when it is first drawn.
 *   Motion.animate(h.view.style({ padding: 16 }), {
 *     from: { opacity: 0, translateY: 24 },
 *     to: { opacity: 1, translateY: 0 },
 *     ms: 380,
 *     easing: 'easeOutExpo',
 *   }).children(...)
 *
 *   // Follows the Model: whenever `to` changes, the view is animated to it.
 *   Motion.animate(h.view, { to: { opacity: model.isOn ? 1 : 0.3, scale: model.isOn ? 1 : 0.9 }, ms: 150 })
 *
 *   // A spring in place of a time and a curve.
 *   Motion.animate(h.view, { to: { translateX: model.isRight ? 120 : 0 }, spring: { damping: 12 } })
 *
 *   // Leaves with a fade. The view stays on screen until the fade is over.
 *   model.isShown ? Motion.animate(h.view.key('note'), { from: { opacity: 0 }, to: { opacity: 1 }, exit: { opacity: 0 } }) : null
 *
 *   // By a Command, for a view named by a ref.
 *   PressedShake: $ => $.run(Motion.animateTo(Box, { from: { translateX: 12 }, to: { translateX: 0 }, spring: true }).pipe(Command.asNoop))
 *
 * What can be animated: `opacity`, `translateX`, `translateY` and `scale`.
 * A value that is left out is not touched.
 *
 * Two routes, and `Motion.status()` says which one this build uses:
 *
 * - On the phone's own thread, where the build has react-native-worklets and
 *   Reanimated's native code (`configureWorklets` at startup). A worklet
 *   moves the view a step per frame through Reanimated's `_updateProps`.
 * - At once. Where they are missing, and in the tests, the view is given its
 *   end values in one go. Nothing moves, and a view with a way out is simply
 *   taken away.
 *
 * Reduce Motion. Tell `Motion.configure` the phone's setting. With it on,
 * nothing moves or grows: a view goes to its place at once, and only a
 * short fade is left.
 *
 * Rules:
 *
 * - An animated element is always a real view on the phone (`collapsable`
 *   is set to false for you).
 * - The animated view keeps its own style. Leave `opacity` and `transform`
 *   out of it: those are written here.
 * - Do not animate a view that has a `pressedStyle`. Put the pressable
 *   inside the animated view.
 * - `from` counts once, when the view is first drawn. A row that scrolls
 *   out of a long list and back in is drawn again, so give it `from` only
 *   while it is new.
 * - A way out (`exit`) runs when the element itself is taken out of the
 *   view. It does not run for the elements inside one that is taken away.
 */
import * as Command from '@effect/ui/Command'
import * as Renderer from '@effect/ui/Renderer'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  type How,
  MOTION,
  type MotionStats,
  type Spec,
  type Values,
  controllerOf,
  isMotionReduced,
  resetMotion,
  routeCheck,
  setReduceMotion,
  setUiThread,
  stats as liveStats,
} from './internal/motion.js'
import * as Native from './Native.js'

export type { Easing, How, MotionStats, Spec, Spring, Values } from './internal/motion.js'
export { DEFAULT_MS, MOTION, REDUCED_MS } from './internal/motion.js'

/** The host's prop for node data. The same name as `NativeHost.NODE_DATA`. */
const NODE_DATA = 'nodeData'

type Animatable<B> = { readonly props: Readonly<Record<string, unknown>>; prop: (name: string, value: unknown) => B }

/**
 * Says how an element is animated. See the top of this file. `undefined`
 * leaves the element as it is, which is handy for a `from` that only a new
 * row gets.
 */
export const animate = <B extends Animatable<B>>(element: B, spec: Spec | undefined): B =>
  spec === undefined
    ? element
    : element
        // Never folded into its parent: the phone animates this very view.
        .prop('collapsable', false)
        .prop(NODE_DATA, { ...(element.props[NODE_DATA] as Readonly<Record<string, unknown>> | undefined), [MOTION]: spec })

/** The part of React Native's `AccessibilityInfo` that knows the phone's Reduce Motion setting. */
export type AccessibilityInfo = Readonly<{
  isReduceMotionEnabled?: () => Promise<boolean>
  addEventListener?: (name: 'reduceMotionChanged', listener: (isOn: boolean) => void) => unknown
}>

export type MotionOptions = Readonly<{
  /**
   * The phone's Reduce Motion setting, read now and followed as it changes.
   * In an app: `Motion.configure({ accessibilityInfo: ReactNative.AccessibilityInfo })`.
   */
  accessibilityInfo?: AccessibilityInfo
  /** Or say it yourself: yes, no, or a function that is asked each time. */
  reduceMotion?: boolean | (() => boolean)
  /** `false` sets every change at once, as if worklets were missing. Default true. */
  uiThread?: boolean
}>

/** Optional. Call at startup. Never throws. */
export const configure = (options: MotionOptions): void => {
  if (options.uiThread !== undefined) setUiThread(options.uiThread)
  if (options.reduceMotion !== undefined) setReduceMotion(options.reduceMotion)
  const info = options.accessibilityInfo
  if (info === undefined) return
  let isReduced = false
  setReduceMotion(() => isReduced)
  try {
    info
      .isReduceMotionEnabled?.()
      .then(isOn => {
        isReduced = isOn === true
      })
      .catch(() => {})
    info.addEventListener?.('reduceMotionChanged', isOn => {
      isReduced = isOn === true
    })
  } catch {
    // Not known means off.
  }
}

/** Back to the state before `configure`, with the counts at zero. For tests. */
export const reset = (): void => resetMotion()

/** `ui-thread`: animations run on the phone's own thread. `at-once`: values are set in one go. */
export const route = (): 'ui-thread' | 'at-once' => (routeCheck().ok ? 'ui-thread' : 'at-once')

export const isReduced = (): boolean => isMotionReduced()

/** Which route this build uses, and why, as one line for a screen. */
export const status = (): string => {
  const check = routeCheck()
  const how = check.ok ? "on the phone's own thread" : `set at once, no movement (${check.reason})`
  return isMotionReduced() ? `${how}, Reduce Motion on` : how
}

/** Counts: views animated now, animations under way, and how many went each route. */
export const stats = (): Readonly<MotionStats> => ({ ...liveStats })

const ValuesSchema = Schema.Struct({
  opacity: Schema.optional(Schema.Number),
  translateX: Schema.optional(Schema.Number),
  translateY: Schema.optional(Schema.Number),
  scale: Schema.optional(Schema.Number),
})

/** What `animateTo` answers: whether the view was on screen, and which route took it. */
export interface Animated {
  readonly found: boolean
  readonly route: 'ui-thread' | 'at-once'
}

export const AnimateTo = Command.make(
  'Motion.animateTo',
  { args: { ref: Renderer.Ref, to: ValuesSchema, from: Schema.optional(ValuesSchema), how: Schema.Unknown } },
  ({ ref, to, from, how }) =>
    Renderer.Refs.use(refs =>
      Effect.flatMap(refs.lookup(ref as Renderer.Ref<Native.Node>), found =>
        Option.isNone(found)
          ? Effect.succeed<Animated>({ found: false, route: route() })
          : Native.Host.use(host =>
              Effect.sync((): Animated => {
                const controller = controllerOf(host.engine)
                if (controller === undefined) return { found: false, route: 'at-once' }
                return {
                  found: true,
                  route: controller.command(found.value, to as Values, { ...(how as How), ...(from === undefined ? {} : { from: from as Values }) }),
                }
              }),
            ),
      ),
    ),
)

/**
 * Animates the element a ref names to `to`, now. With `from` it jumps there
 * first. The Command answers as soon as the animation has started.
 */
export const animateTo = (ref: Renderer.Ref<Native.Node>, options: How & Readonly<{ to: Values; from?: Values }>) => {
  const { to, from, ...how } = options
  return AnimateTo.make({ ref, to, how, ...(from === undefined ? {} : { from }) })
}
