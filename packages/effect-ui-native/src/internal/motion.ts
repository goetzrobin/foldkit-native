/**
 * The JavaScript side of `Motion`: which views are animated, where each one
 * is, and which of two routes moves it.
 *
 * - On the phone's own thread. A worklet (`motionUi.ts`) moves the view a
 *   step per frame. JavaScript starts it and hears when it is over.
 * - At once. Where worklets are missing the view is given its end values in
 *   one go, with no movement.
 *
 * The host calls the hooks here as elements are made, drawn again and taken
 * away (`NativeHost.makeSurface`). An element asks for motion with a key in
 * its node data (`MOTION`), which `Motion.animate` writes.
 *
 * The view's style. An animated view has two sources for its style: the
 * element's own, and the opacity and transform from here. Both are merged
 * and written together, here, after the element's own hooks have run.
 * JavaScript's copy holds where the view last came to rest. While the UI
 * thread moves a view, Reanimated's native code lays the moving values over
 * whatever JavaScript commits, so the two do not fight.
 *
 * Nothing here knows Effect UI.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'

import type { NodeData, NodeHooks } from '../../../native/src/host/fabric/nodes.js'
import { listenToChannel, uiChannel } from '../../../native/src/host/worklets/channel.js'
import { type Check, reanimatedProxy, viewUpdatesCheck } from '../../../native/src/host/worklets/host.js'
import { runOnUi, workletCheck } from '../../../native/src/host/worklets/run.js'
import { type Curve, type Full, type Timing, type Uses, finishMotionOnUi, forgetMotionOnUi, startMotionOnUi } from './motionUi.js'

/** In an element's data (`NODE_DATA`): how the view is animated. Written by `Motion.animate`. */
export const MOTION = 'effectUiMotion'

/** What can be animated. A value that is left out is not touched. */
export type Values = Readonly<{
  /** 0 is see-through, 1 is solid. */
  opacity?: number
  /** Points to the right of where the view is laid out. */
  translateX?: number
  /** Points below where the view is laid out. */
  translateY?: number
  /** 1 is the view's own size. */
  scale?: number
}>

export type Easing = 'linear' | 'easeOut' | 'easeInOut' | 'easeOutExpo' | Curve

export type Spring = Readonly<{
  /** How hard it pulls. Default 170. */
  stiffness?: number
  /** How fast it settles. Default 22. Lower, and it swings past the end and back. */
  damping?: number
  /** Default 1. */
  mass?: number
}>

/** How long, and along which curve. */
export type How = Readonly<{
  /** Milliseconds. Default 200. */
  ms?: number
  /** Milliseconds to wait first. Default 0. */
  delayMs?: number
  /** Default `easeOut`: fast at first, then gentle. */
  easing?: Easing
  /** A spring in place of `ms` and `easing`. `true` is the default spring. */
  spring?: Spring | boolean
}>

/** How one view is animated. See `Motion.animate`. */
export type Spec = How &
  Readonly<{
    /** Where the view should be. Whenever this changes, the host animates to it. */
    to: Values
    /** Where the view starts when it is first drawn. Left out, it starts at `to` and nothing moves. */
    from?: Values
    /** Where the view goes before it is taken away. The view stays on screen until it is there. */
    exit?: Values
    /** How long the way out takes. Default: the same as `ms`. */
    exitMs?: number
  }>

const CURVES: Readonly<Record<Exclude<Easing, Curve>, Curve>> = {
  linear: [0, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  // Fast at first, then a long gentle stop.
  easeOutExpo: [0.16, 1, 0.3, 1],
}

const REST: Full = { opacity: 1, translateX: 0, translateY: 0, scale: 1 }
export const DEFAULT_MS = 200
/** With Reduce Motion on, a fade takes at most this long. */
export const REDUCED_MS = 120
/** How long after an animation should be over JavaScript stops waiting to hear so. */
const LATE_MS = 400
/** As long as any spring here is given to settle. */
const SPRING_MS = 2000

const fill = (values: Values | undefined, base: Full): Full => ({
  opacity: values?.opacity ?? base.opacity,
  translateX: values?.translateX ?? base.translateX,
  translateY: values?.translateY ?? base.translateY,
  scale: values?.scale ?? base.scale,
})

const isSame = (a: Full, b: Full): boolean =>
  a.opacity === b.opacity && a.translateX === b.translateX && a.translateY === b.translateY && a.scale === b.scale

const usesOf = (...all: ReadonlyArray<Values | undefined>): Uses => ({
  opacity: all.some(values => values?.opacity !== undefined),
  transform: all.some(
    values => values?.translateX !== undefined || values?.translateY !== undefined || values?.scale !== undefined,
  ),
})

const timingOf = (how: How, ms = how.ms ?? DEFAULT_MS): Timing => {
  const delayMs = Math.max(0, how.delayMs ?? 0)
  if (how.spring !== undefined && how.spring !== false) {
    const spring = how.spring === true ? {} : how.spring
    return { kind: 'spring', stiffness: spring.stiffness ?? 170, damping: spring.damping ?? 22, mass: spring.mass ?? 1, delayMs }
  }
  const easing = how.easing ?? 'easeOut'
  return { kind: 'timing', ms: Math.max(0, ms), delayMs, curve: typeof easing === 'string' ? CURVES[easing] : easing }
}

const lengthOf = (timing: Timing): number => timing.delayMs + (timing.kind === 'timing' ? timing.ms : SPRING_MS)

// SETTINGS, the same for every screen of the app

let reduce: () => boolean = () => false
let isSwitchedOff = false

/** Whether the phone's Reduce Motion setting is on, as the app last said. */
export const isMotionReduced = (): boolean => {
  try {
    return reduce()
  } catch {
    return false
  }
}

export const setReduceMotion = (value: boolean | (() => boolean)): void => {
  reduce = typeof value === 'function' ? value : () => value
}

/** `false` sends every animation the "at once" way, as if worklets were missing. */
export const setUiThread = (isOn: boolean): void => {
  isSwitchedOff = !isOn
}

/** Whether animations run on the phone's own thread in this build, and why not. Never throws. */
export const routeCheck = (): Check => {
  if (isSwitchedOff) return { ok: false, reason: 'switched off by the app' }
  const views = viewUpdatesCheck()
  return views.ok ? workletCheck(startMotionOnUi) : views
}

/** Numbers a test or an on-screen readout can show. */
export type MotionStats = {
  /** Views that are animated now. Back to 0 after unmount. */
  attached: number
  /** Animations under way now. */
  running: number
  /** Animations handed to the phone's own thread, since the start. */
  onUiThread: number
  /** Changes set at once, with no movement, since the start. */
  atOnce: number
  /** Views kept on screen for their way out, now. */
  leaving: number
}

export const stats: MotionStats = { attached: 0, running: 0, onUiThread: 0, atOnce: 0, leaving: 0 }

/** For tests. */
export const resetMotion = (): void => {
  reduce = () => false
  isSwitchedOff = false
  Object.assign(stats, { attached: 0, running: 0, onUiThread: 0, atOnce: 0, leaving: 0 })
}

type Bag = Readonly<Record<string, unknown>>

type Item = {
  readonly id: number
  readonly node: EngineNode
  /** What the element asked for, or undefined for a view only a Command animates. */
  spec: Spec | undefined
  uses: Uses
  /** What JavaScript's copy of the view's style holds: where it last came to rest. */
  held: Full
  target: Full
  /** Counts this view's animations. The UI thread says which one is over. */
  run: number
  /** The run under way, or 0. */
  running: number
  /** The element's own style. */
  style: Bag | undefined
  /** The UI thread keeps a place for this view. */
  isOnUi: boolean
  late: ReturnType<typeof setTimeout> | undefined
  /** Called once when the way out is over. */
  whenGone: (() => void) | undefined
}

export type MotionController = Readonly<{
  hooks: NodeHooks
  /** Whether the view has a way out to run before it is taken away. */
  hasExit: (node: EngineNode) => boolean
  /** Runs the view's way out, then calls `gone`. False, and nothing is called, if it has none. */
  leave: (node: EngineNode, gone: () => void) => boolean
  /** Forgets every view and stops listening to the UI thread. */
  dispose: () => void
  /** Animates a view because a Command said so. Answers which route took it. */
  command: (node: EngineNode, to: Values, how: How & Readonly<{ from?: Values }>) => 'ui-thread' | 'at-once'
}>

const controllers = new WeakMap<Engine, MotionController>()

/** The controller of the surface this engine draws, if it has one. */
export const controllerOf = (engine: Engine): MotionController | undefined => controllers.get(engine)

let nextId = 1

const shadowNodeOf = (engine: Engine, node: EngineNode): unknown =>
  (engine as { shadowNodeOf?: (node: EngineNode) => unknown }).shadowNodeOf?.(node) ??
  (node as { committed?: { handle?: unknown } | null }).committed?.handle ??
  null

const styleOf = (data: NodeData): Bag | undefined => {
  const style = (data['props'] as Bag | undefined)?.['style']
  return typeof style === 'object' && style !== null ? (style as Bag) : undefined
}

export const makeMotion = (
  engine: Engine,
  afterCommit: (job: () => void) => void,
  /** The element's own props as last drawn, for a view only a Command animates. */
  propsOf: (node: EngineNode) => Bag,
): MotionController => {
  const items = new Map<EngineNode, Item>()
  const byId = new Map<number, Item>()
  const channel = uiChannel()

  const write = (item: Item): void => {
    const motion: Record<string, unknown> = {}
    if (item.uses.opacity) motion['opacity'] = item.held.opacity
    if (item.uses.transform) {
      motion['transform'] = [
        { translateX: item.held.translateX },
        { translateY: item.held.translateY },
        { scale: item.held.scale },
      ]
    }
    engine.setProp(item.node, 'style', { ...item.style, ...motion })
  }

  /** The animation is over: JavaScript's copy takes the end values. */
  const settle = (item: Item, run: number, isCommitted: boolean): void => {
    if (item.running !== run || items.get(item.node) !== item) return
    if (item.late !== undefined) clearTimeout(item.late)
    item.late = undefined
    item.running = 0
    stats.running--
    item.held = item.target
    write(item)
    if (!isCommitted) engine.commit()
    const gone = item.whenGone
    item.whenGone = undefined
    gone?.()
  }

  const stopListening = listenToChannel(channel, (name, detail) => {
    if (name !== 'done') return
    const said = detail as { id?: unknown; run?: unknown } | undefined
    const item = typeof said?.id === 'number' ? byId.get(said.id) : undefined
    if (item !== undefined && typeof said?.run === 'number') settle(item, said.run, false)
  })

  /**
   * Moves the view to `to`. `inDraw` says a commit follows by itself (the
   * hooks run just before one).
   */
  const go = (item: Item, to: Full, timing: Timing, from: Full | undefined, inDraw: boolean): 'ui-thread' | 'at-once' => {
    if (item.running !== 0) {
      if (item.late !== undefined) clearTimeout(item.late)
      item.late = undefined
      item.running = 0
      stats.running--
    }
    item.run++
    item.target = to
    const run = item.run
    const check = routeCheck()
    const tag = check.ok ? engine.tagOf(item.node) : null
    const shadowNode = check.ok ? shadowNodeOf(engine, item.node) : null
    if (check.ok && tag !== null && shadowNode !== null) {
      const isReduced = isMotionReduced()
      const sent = runOnUi(
        startMotionOnUi,
        item.id,
        { tag, node: shadowNode },
        from ?? item.held,
        to,
        item.uses,
        isReduced
          ? { kind: 'timing', ms: timing.kind === 'timing' ? Math.min(REDUCED_MS, timing.ms) : REDUCED_MS, delayMs: timing.delayMs, curve: CURVES.easeOut }
          : timing,
        from !== undefined,
        isReduced,
        run,
        channel,
      )
      if (sent.ok) {
        item.isOnUi = true
        item.running = run
        stats.running++
        stats.onUiThread++
        // If the UI thread's word never comes, JavaScript takes the end values anyway.
        item.late = setTimeout(() => settle(item, run, false), lengthOf(timing) + LATE_MS)
        return 'ui-thread'
      }
    }
    // At once: no movement, the end values in one go.
    stats.atOnce++
    item.running = run
    stats.running++
    settle(item, run, inDraw)
    return 'at-once'
  }

  const attach = (node: EngineNode, spec: Spec | undefined, uses: Uses, style: Bag | undefined, held: Full): Item => {
    const item: Item = {
      id: nextId++,
      node,
      spec,
      uses,
      held,
      target: held,
      run: 0,
      running: 0,
      style,
      isOnUi: false,
      late: undefined,
      whenGone: undefined,
    }
    items.set(node, item)
    byId.set(item.id, item)
    stats.attached++
    return item
  }

  /** Forgets the view. `isGone`: the view itself is being taken away. */
  const detach = (item: Item, isGone: boolean): void => {
    if (items.get(item.node) !== item) return
    items.delete(item.node)
    byId.delete(item.id)
    stats.attached--
    if (item.late !== undefined) clearTimeout(item.late)
    if (item.running !== 0) stats.running--
    item.running = 0
    if (item.whenGone !== undefined) stats.leaving--
    item.whenGone = undefined
    if (!item.isOnUi) return
    try {
      const shadowNode = shadowNodeOf(engine, item.node)
      const tag = engine.tagOf(item.node)
      if (isGone || shadowNode === null || tag === null) {
        runOnUi(forgetMotionOnUi, item.id)
        // Lets Reanimated's native code forget what it last put on this view.
        if (shadowNode !== null) reanimatedProxy()?.markNodeAsRemovable?.(shadowNode)
      } else runOnUi(finishMotionOnUi, item.id, { tag, node: shadowNode }, item.target, item.uses)
    } catch {
      // Only tidying.
    }
  }

  /** A first draw: where the view starts, and whether it moves from there once it is on the phone. */
  const enter = (node: EngineNode, spec: Spec, style: Bag | undefined, isDrawn: boolean): void => {
    const to = fill(spec.to, REST)
    const uses = usesOf(spec.to, spec.from, spec.exit)
    const from = spec.from === undefined ? undefined : fill(spec.from, to)
    // Where worklets are missing, the view is simply drawn where it belongs.
    if (from === undefined || isSame(from, to) || !routeCheck().ok) {
      const item = attach(node, spec, uses, style, to)
      if (from !== undefined && !isSame(from, to)) stats.atOnce++
      write(item)
      return
    }
    // With Reduce Motion only the fade is left, so the view starts in its place.
    const start = isMotionReduced() ? { ...to, opacity: from.opacity } : from
    const item = attach(node, spec, uses, style, start)
    item.target = to
    write(item)
    const begin = (): void => {
      if (items.get(node) !== item || item.spec === undefined || item.run !== 0) return
      go(item, fill(item.spec.to, REST), timingOf(item.spec), undefined, false)
    }
    // A view has no handle until a draw has reached the phone.
    if (isDrawn) begin()
    else afterCommit(begin)
  }

  const sync = (node: EngineNode, data: NodeData, isDrawn: boolean): void => {
    const spec = data[MOTION] as Spec | undefined
    const style = styleOf(data)
    const item = items.get(node)
    if (item === undefined) {
      if (spec !== undefined) enter(node, spec, style, isDrawn)
      return
    }
    // On its way out: what the element says no longer matters.
    if (item.whenGone !== undefined) return
    if (spec === undefined && item.spec !== undefined) {
      detach(item, false)
      engine.setProp(node, 'style', style)
      return
    }
    const isStyleNew = style !== item.style
    item.style = style
    if (spec === undefined) {
      if (isStyleNew) write(item)
      return
    }
    item.spec = spec
    const to = fill(spec.to, REST)
    const uses = usesOf(spec.to, spec.from, spec.exit)
    const usesMore = (uses.opacity && !item.uses.opacity) || (uses.transform && !item.uses.transform)
    if (usesMore) item.uses = { opacity: uses.opacity || item.uses.opacity, transform: uses.transform || item.uses.transform }
    if (!isSame(to, item.target)) go(item, to, timingOf(spec), undefined, true)
    else if (isStyleNew || usesMore) write(item)
  }

  const controller: MotionController = {
    hooks: {
      create: (node, data) => sync(node, data, false),
      update: (node, _before, after) => sync(node, after, true),
      destroy: node => {
        const item = items.get(node)
        if (item !== undefined) detach(item, true)
      },
    },
    // Where nothing can move, a view with a way out is simply taken away.
    hasExit: node => {
      const item = items.get(node)
      return item?.spec?.exit !== undefined && item.whenGone === undefined && routeCheck().ok
    },
    dispose: () => {
      stopListening()
      for (const item of [...items.values()]) detach(item, true)
      controllers.delete(engine)
    },
    leave: (node, gone) => {
      const item = items.get(node)
      const spec = item?.spec
      if (item === undefined || spec?.exit === undefined || item.whenGone !== undefined) return false
      const to = fill(spec.exit, item.target)
      stats.leaving++
      item.whenGone = () => {
        stats.leaving--
        gone()
      }
      go(item, to, timingOf(spec, spec.exitMs ?? spec.ms ?? DEFAULT_MS), undefined, false)
      return true
    },
    command: (node, to, how) => {
      const uses = usesOf(to, how.from)
      let item = items.get(node)
      if (item === undefined) {
        const style = propsOf(node)['style']
        item = attach(node, undefined, uses, typeof style === 'object' && style !== null ? (style as Bag) : undefined, REST)
      }
      else if ((uses.opacity && !item.uses.opacity) || (uses.transform && !item.uses.transform)) {
        item.uses = { opacity: uses.opacity || item.uses.opacity, transform: uses.transform || item.uses.transform }
      }
      const end = fill(to, item.target)
      const from = how.from === undefined ? undefined : fill(how.from, end)
      if (from !== undefined) {
        // JavaScript's copy starts there too, so a draw in between shows the same.
        item.held = from
        write(item)
      }
      return go(item, end, timingOf(how), from, false)
    },
  }
  controllers.set(engine, controller)
  return controller
}
