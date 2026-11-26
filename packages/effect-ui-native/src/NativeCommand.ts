/**
 * Commands that act on one native element, named by a ref:
 *
 *   const Field = Native.ref('field')
 *   h.textInput.ref(Field)...
 *   PressedEdit: $ => $.run(NativeCommand.focus(Field).pipe(Command.asNoop))
 *
 * They run through `Native.Host`, which the runtime provides, so issuing one
 * adds no requirement to a component. Each waits until the draw its `update`
 * caused has reached the phone.
 */
import * as Command from '@effect/ui/Command'
import * as Renderer from '@effect/ui/Renderer'
import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import * as Native from './Native.js'

/** Whether the ref's element was on screen. */
export interface Found {
  readonly found: boolean
}

type HostShape = Context.Service.Shape<typeof Native.Host>

const withNode = <A>(
  ref: Renderer.Ref<Native.Node>,
  run: (host: HostShape, node: Native.Node) => Effect.Effect<A>,
): Effect.Effect<Option.Option<A>, never, Renderer.Refs | Native.Host> =>
  Renderer.Refs.use(refs =>
    Effect.flatMap(refs.lookup(ref), node =>
      Option.isNone(node)
        ? Effect.succeed(Option.none<A>())
        : Native.Host.use(host => Effect.map(run(host, node.value), Option.some)),
    ),
  )

const found = (
  ref: Renderer.Ref<Native.Node>,
  run: (host: HostShape, node: Native.Node) => void,
): Effect.Effect<Found, never, Renderer.Refs | Native.Host> =>
  Effect.map(
    withNode(ref, (host, node) => Effect.sync(() => run(host, node))),
    (done): Found => ({ found: Option.isSome(done) }),
  )

const RectSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})

export const Focus = Command.make('NativeCommand.focus', { args: { ref: Renderer.Ref } }, ({ ref }) =>
  found(ref, (host, node) => host.focus(node)),
)

export const Blur = Command.make('NativeCommand.blur', { args: {} }, () =>
  Native.Host.use(host =>
    Effect.sync((): Found => {
      host.blur()
      return { found: true }
    }),
  ),
)

export const ScrollTo = Command.make(
  'NativeCommand.scrollTo',
  { args: { ref: Renderer.Ref, x: Schema.Number, y: Schema.Number, animated: Schema.Boolean } },
  ({ ref, x, y, animated }) => found(ref, (host, node) => host.scrollTo(node, { x, y, animated })),
)

export const ScrollToEnd = Command.make(
  'NativeCommand.scrollToEnd',
  { args: { ref: Renderer.Ref, animated: Schema.Boolean } },
  ({ ref, animated }) => found(ref, (host, node) => host.scrollToEnd(node, animated)),
)

export const Measure = Command.make('NativeCommand.measure', { args: { ref: Renderer.Ref } }, ({ ref }) =>
  Effect.map(
    withNode(ref, (host, node) => host.measure(node)),
    (rect): Option.Option<Native.Rect> => Option.flatMap(rect, Option.fromUndefinedOr),
  ),
)

/** Puts the caret in a text field and brings the keyboard up. */
export const focus = (ref: Renderer.Ref<Native.Node>) => Focus.make({ ref })

/** Puts the keyboard away. */
export const blur = () => Blur.make({})

/** Scrolls a scroll view to a place. */
export const scrollTo = (ref: Renderer.Ref<Native.Node>, to: Native.ScrollTarget) =>
  ScrollTo.make({ ref, x: to.x ?? 0, y: to.y ?? 0, animated: to.animated ?? false })

/** Scrolls a scroll view to its end. */
export const scrollToEnd = (ref: Renderer.Ref<Native.Node>, animated = false) =>
  ScrollToEnd.make({ ref, animated })

/** Where an element is in the window, or none if it is not on screen or not laid out. */
export const measure = (ref: Renderer.Ref<Native.Node>) => Measure.make({ ref })

export { RectSchema as Rect }
