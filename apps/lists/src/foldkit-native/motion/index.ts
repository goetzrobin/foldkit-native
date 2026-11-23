/**
 * Motion: fades and slides when a style changes, when an element appears or
 * leaves, and a box the user can drag.
 *
 * 1. A style that eases to its new value instead of jumping:
 *
 *      view([
 *        transition({ opacity: 250, transform: { duration: 300, easing: 'easeOut' } }),
 *        style({ opacity: model.isShown ? 1 : 0 }),
 *      ], [...])
 *
 * 2. An element that fades in when the Model adds it and out when the Model
 *    removes it. Give it a stable `h.Key`:
 *
 *      animated(
 *        { enter: { from: { opacity: 0 } }, exit: { to: { opacity: 0 } } },
 *        view([h.Key(row.id), style({ opacity: 1 })], [...]),
 *      )
 *
 * 3. A box that follows the finger and eases back when let go. The program
 *    hears once, at the end:
 *
 *      draggable({ onRelease: drag => Message.DroppedCard(drag) }, [style(...)], [...])
 *
 * How it works. The engine underneath can ease a style property when the
 * element carries a `$transition` prop saying how long each property takes.
 * ng-native's CSS compiler writes that prop from a stylesheet. Here
 * `transition(...)` writes it directly, so no stylesheet is needed. The
 * engine works out each frame's value in JavaScript and commits it. Frames
 * are kept coming by `clock.ts`.
 *
 * What can be eased: numbers (opacity, width, borderRadius), colours, and
 * transform lists of the same shape, such as `[{ translateX: 0 }]` to
 * `[{ translateX: 120 }]`.
 *
 * Give styles with the adapter's `style({...})`, not `h.Style`. Enter and
 * exit read and write that style.
 */
import type { Engine, EngineNode, ResponderEvent } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { OnCustomEvent, Prop, type VNode, element } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend'
import { type Bag, type Handler, bagOf, customEvent, handlersByNode, nodeOf } from '../modules'
import { keepMoving } from './clock'

export { configureMotion, keepMoving, stopMotion } from './clock'
export type { MotionOptions } from './clock'

const el = element<any>()

/** The four numbers of a cubic bezier curve, as in CSS. */
export type Curve = readonly [number, number, number, number]

export type Easing = 'linear' | 'ease' | 'easeIn' | 'easeOut' | 'easeInOut' | 'overshoot' | Curve

const CURVES: Readonly<Record<Exclude<Easing, Curve>, Curve>> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  // Goes a little past the end and comes back, like a soft spring.
  overshoot: [0.34, 1.56, 0.64, 1],
}

export type Timing = Readonly<{
  /** Milliseconds. Default 250. */
  duration?: number
  /** Milliseconds to wait before starting. Default 0. */
  delay?: number
  /** Default 'ease'. */
  easing?: Easing
}>

/** What the engine reads: one entry per style property. */
type EngineTiming = Readonly<{ duration: number; delay: number; easing: Curve }>
type EngineTransition = Readonly<Record<string, EngineTiming>>

const DEFAULT_DURATION = 250

const engineTiming = (timing: Timing | number): EngineTiming => {
  const given = typeof timing === 'number' ? { duration: timing } : timing
  const easing = given.easing ?? 'ease'
  return {
    duration: given.duration ?? DEFAULT_DURATION,
    delay: given.delay ?? 0,
    easing: typeof easing === 'string' ? CURVES[easing] : easing,
  }
}

const TRANSITION = '$transition'

// The same request gives the same object back, so a draw that asks for the
// same transition as the last one changes nothing on the element.
const transitions = new Map<string, ReturnType<typeof Prop>>()

/**
 * Makes the named style properties ease to a new value whenever the view
 * gives them one. A number is a duration in milliseconds.
 */
export const transition = (properties: Readonly<Record<string, Timing | number>>) => {
  const spec: Record<string, EngineTiming> = {}
  for (const [name, timing] of Object.entries(properties)) spec[name] = engineTiming(timing)
  const id = JSON.stringify(spec)
  let made = transitions.get(id)
  if (made === undefined) transitions.set(id, (made = Prop({ key: TRANSITION, value: spec })))
  return made
}

type NativeStyle = Readonly<Record<string, unknown>>

export type Enter = Timing & Readonly<{ /** The style the element starts from. */ from: NativeStyle }>
export type Exit = Timing & Readonly<{ /** The style the element leaves to. */ to: NativeStyle }>
export type Animated = Readonly<{ enter?: Enter; exit?: Exit }>

const MOTION_DATA = 'foldkitMotion'
const DRAG_DATA = 'foldkitDrag'
const DRAG_END = 'dragEnd'

/**
 * Eases an element in when the Model adds it and out when the Model removes
 * it. The element stays on screen, untouchable, until its exit has finished.
 *
 * Not for the rows of a virtualised `list`: there a row is also removed when
 * it scrolls off, and it would fade out on its way.
 */
export const animated = (motion: Animated, target: Html): Html => {
  if (target !== null) (target.data ??= {})[MOTION_DATA] = motion
  return target
}

export type Drag = Readonly<{ dx: number; dy: number }>

export type Draggable<Message> = Readonly<{
  /** Sent once, when the finger lifts. `dx` and `dy` are how far it moved. */
  onRelease?: (drag: Drag) => Message
  /** Limit the movement to one direction. Default 'both'. */
  axis?: 'x' | 'y' | 'both'
  /** How the box eases back. `false` leaves it where it was dropped. */
  release?: Timing | false
}>

/**
 * A view that follows the finger. While it is dragged the adapter moves it
 * directly, with a commit per touch move and no Message. See `Draggable`.
 *
 * It takes over touches on itself, so do not also give it `h.OnClick`, and do
 * not give it a `transform` style or a `transition` for `transform`: the drag
 * owns both. Put pressable things inside it instead.
 */
export const draggable = <Message>(
  config: Draggable<Message>,
  attributes: ReadonlyArray<any>,
  children: ReadonlyArray<any>,
): Html => {
  const onRelease = config.onRelease
  const box = el('view')(
    [
      ...attributes,
      ...(onRelease === undefined
        ? []
        : [
            OnCustomEvent({
              name: DRAG_END,
              f: event => Option.some(onRelease(event.detail as Drag)),
            }),
          ]),
    ] as never,
    children as never,
  )
  if (box !== null) (box.data ??= {})[DRAG_DATA] = config
  return box
}

const styleOf = (vnode: VNode): Bag => (bagOf(vnode, 'props')['style'] as Bag | undefined) ?? {}

const timingFor = (names: ReadonlyArray<string>, timing: Timing): EngineTransition =>
  Object.fromEntries(names.map(name => [name, engineTiming(timing)]))

const isOnScreen = (engine: Engine, node: EngineNode): boolean => {
  let at: EngineNode | null = node
  while (at !== null && at !== engine.root) at = engine.parentNode(at)
  return at === engine.root
}

/** Whether the engine is easing any of these properties on this node now. */
const isEasing = (node: EngineNode, names: ReadonlyArray<string>): boolean => {
  const running = (node as { transitions?: Map<string, { done?: boolean }> }).transitions
  return names.some(name => running?.get(name)?.done === false)
}

/** Long after an exit should have ended, the element is removed regardless. */
const EXIT_GRACE_MS = 300

const REST = [{ translateX: 0 }, { translateY: 0 }] as const

const motionModule: ModuleFactory = (engine, afterCommit) => {
  // What the view last said about each animated element.
  const latest = new WeakMap<EngineNode, VNode>()
  const dragStops = new WeakMap<EngineNode, () => void>()
  const dragConfigs = new WeakMap<EngineNode, Draggable<unknown>>()

  /** Runs `then` once the engine has finished easing every named property. */
  const whenEased = (node: EngineNode, names: ReadonlyArray<string>, then: () => void): (() => void) => {
    const left = new Set(names)
    const stop = engine.setEventListener(node, 'topTransitionend', event => {
      const name = (event as { propertyName?: string } | undefined)?.propertyName
      if (name === undefined) left.clear()
      else left.delete(name)
      if (left.size > 0) return
      stop()
      then()
    })
    return stop
  }

  const enter = (node: EngineNode, vnode: VNode, motion: Enter): void => {
    const names = Object.keys(motion.from)
    // The first commit shows the element in its starting style...
    engine.setProp(node, 'style', { ...styleOf(vnode), ...motion.from })
    afterCommit(() => {
      // ...and the second gives it the style the view asked for, to ease to.
      const now = latest.get(node) ?? vnode
      const own = bagOf(now, 'props')[TRANSITION] as EngineTransition | undefined
      engine.setProp(node, TRANSITION, { ...own, ...timingFor(names, motion) })
      engine.setProp(node, 'style', styleOf(now))
      engine.commit()
      const restore = (): void => {
        // Back to the element's own timing, so later changes use that.
        engine.setProp(node, TRANSITION, bagOf(latest.get(node) ?? vnode, 'props')[TRANSITION])
        keepMoving(engine)
      }
      if (isEasing(node, names)) whenEased(node, names, restore)
      else restore()
      keepMoving(engine)
    })
  }

  const exit = (node: EngineNode, vnode: VNode, motion: Exit, remove: () => void): void => {
    const names = Object.keys(motion.to)
    const timing = engineTiming(motion)
    let isDone = false
    let stop = (): void => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (isDone) return
      isDone = true
      stop()
      clearTimeout(timer)
      // If an ancestor was removed meanwhile, this element went with it.
      if (!isOnScreen(engine, node)) return
      remove()
      keepMoving(engine)
    }
    engine.setProp(node, TRANSITION, timingFor(names, motion))
    engine.setProp(node, 'style', { ...styleOf(vnode), ...motion.to })
    // A leaving element takes no touches.
    engine.setProp(node, 'pointerEvents', 'none')
    stop = whenEased(node, names, finish)
    afterCommit(() => {
      // Nothing to ease, for example an exit to the style it already has.
      if (!isEasing(node, names)) {
        finish()
        engine.commit()
        return
      }
      // A net under the clock: if frames stop coming, the element still goes.
      timer = setTimeout(() => {
        finish()
        engine.commit()
      }, timing.delay + timing.duration + EXIT_GRACE_MS)
      keepMoving(engine)
    })
  }

  const listenForDrag = (node: EngineNode): (() => void) => {
    let startX = 0
    let startY = 0
    let drag: Drag = { dx: 0, dy: 0 }
    const move = (event: ResponderEvent): void => {
      const axis = dragConfigs.get(node)?.axis ?? 'both'
      drag = {
        dx: axis === 'y' ? 0 : (event.nativeEvent?.pageX ?? startX) - startX,
        dy: axis === 'x' ? 0 : (event.nativeEvent?.pageY ?? startY) - startY,
      }
      engine.setProp(node, 'transform', [{ translateX: drag.dx }, { translateY: drag.dy }])
      engine.commit()
    }
    const end = (event: ResponderEvent): void => {
      const release = dragConfigs.get(node)?.release ?? { duration: 350, easing: 'overshoot' }
      if (release !== false) {
        engine.setProp(node, TRANSITION, { transform: engineTiming(release) })
        engine.setProp(node, 'transform', REST)
        engine.commit()
        keepMoving(engine)
      }
      const handler = handlersByNode.get(node)?.[DRAG_END] as Handler | undefined
      handler?.(customEvent(DRAG_END, drag))
      void event
    }
    return engine.setResponder(node, {
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      // A scroll view around the box must not take the drag away.
      onResponderTerminationRequest: () => false,
      blockNativeResponder: true,
      onResponderGrant: event => {
        startX = event.nativeEvent?.pageX ?? 0
        startY = event.nativeEvent?.pageY ?? 0
        drag = { dx: 0, dy: 0 }
        // While the finger is down the box follows it exactly, with no easing.
        engine.setProp(node, TRANSITION, undefined)
      },
      onResponderMove: move,
      onResponderRelease: end,
      onResponderTerminate: end,
    })
  }

  return {
    create: (_empty, vnode) => {
      const node = nodeOf(vnode)
      if (node === undefined) return
      const motion = vnode.data?.[MOTION_DATA] as Animated | undefined
      if (motion !== undefined) latest.set(node, vnode)
      if (motion?.enter !== undefined) enter(node, vnode, motion.enter)
      const drag = vnode.data?.[DRAG_DATA] as Draggable<unknown> | undefined
      if (drag !== undefined) {
        dragConfigs.set(node, drag)
        dragStops.set(node, listenForDrag(node))
      }
    },
    update: (_old, vnode) => {
      const node = nodeOf(vnode)
      if (node === undefined) return
      if (vnode.data?.[MOTION_DATA] !== undefined) latest.set(node, vnode)
      const drag = vnode.data?.[DRAG_DATA] as Draggable<unknown> | undefined
      if (drag !== undefined) dragConfigs.set(node, drag)
    },
    destroy: vnode => {
      const node = nodeOf(vnode)
      if (node === undefined) return
      dragStops.get(node)?.()
      dragStops.delete(node)
    },
    remove: (vnode, remove) => {
      const node = nodeOf(vnode)
      const motion = vnode.data?.[MOTION_DATA] as Animated | undefined
      if (node === undefined || motion?.exit === undefined) {
        remove()
        return
      }
      exit(node, vnode, motion.exit, remove)
    },
    // After every draw: if the draw started a transition, frames must follow.
    post: () => afterCommit(() => keepMoving(engine)),
  }
}

registerModule(motionModule)
