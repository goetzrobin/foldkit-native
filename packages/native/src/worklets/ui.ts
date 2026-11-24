/**
 * The code that runs on the UI thread.
 *
 * Every function here that starts with the line `'worklet'` is a worklet.
 * When the app is built, the Babel plugin of `react-native-worklets` rewrites
 * each one: it keeps the function, and next to it stores the function's own
 * source as text plus the outside values it uses. That text is what is sent
 * to the JavaScript engine on the UI thread. In a build without the plugin
 * the line does nothing and these stay ordinary functions, which is how the
 * tests run them.
 *
 * Rules a worklet lives by:
 *
 * - It may call other worklets and read plain values from outside itself.
 *   Those are copied over once. Changing the original later changes nothing.
 * - A value both threads need is a shared value (`shared` in `run.ts`).
 *   Here, on the UI thread, read and write it as `box.value`.
 * - It reaches the phone through a few functions native code puts on the UI
 *   engine's global: `requestAnimationFrame` (worklets), and `_updateProps`,
 *   `_measure`, `_maybeFlushUIUpdatesQueue` (Reanimated's native code).
 * - A worklet that calls itself must do it through a function written
 *   inside it. The plugin cannot copy a worklet into its own copy.
 */
import { deliver } from './channel.js'
import type { UiChannel } from './channel.js'

/** A view as the UI thread knows it: its number, and Fabric's handle to it. */
export type UiTarget = Readonly<{ tag: number; node: unknown }>

/** A shared value as it is on the UI thread. */
export type SharedHost<T> = {
  value: T
  /** Runs `changed` after every change. One listener per `id`. */
  listen: (id: number, changed: () => void) => void
  unlisten: (id: number) => void
  /** What is animating this value now, so a newer animation can take over. */
  animation: object | null
}

export type Measured = Readonly<{
  x: number
  y: number
  width: number
  height: number
  pageX: number
  pageY: number
}>

/** What native code puts on the UI engine's global. All may be missing. */
type UiGlobal = {
  __RUNTIME_KIND?: number
  _WORKLET?: boolean
  __workletsModuleProxy?: { scheduleOnRN: (run: unknown, args: unknown) => void }
  __serializer?: (value: unknown) => unknown
  requestAnimationFrame?: (run: (nowMs: number) => void) => unknown
  _updateProps?: (operations: ReadonlyArray<{ shadowNodeWrapper: unknown; updates: object }>) => void
  _maybeFlushUIUpdatesQueue?: () => void
  _measure?: (node: unknown) => Measured | null | undefined
}

/** `__RUNTIME_KIND` on the UI thread's engine, as worklets names it. */
const UI_RUNTIME = 2

/**
 * Turns the plain box worklets makes for a shared value into one that tells
 * its listeners when it changes. Worklets calls this once, on the UI thread.
 */
export const decorateShared = <T>(host: SharedHost<T>): SharedHost<T> => {
  'worklet'
  let current = host.value
  const listeners = new Map<number, () => void>()
  Object.defineProperty(host, 'value', {
    get: () => current,
    set: (next: T) => {
      if (next === current) return
      current = next
      listeners.forEach(changed => changed())
    },
    enumerable: true,
    configurable: true,
  })
  host.listen = (id, changed) => {
    listeners.set(id, changed)
  }
  host.unlisten = id => {
    listeners.delete(id)
  }
  host.animation = null
  return host
}

/** Where this is running. The answer proves a worklet reached the UI thread. */
export const whereAmI = () => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  return {
    kind: host.__RUNTIME_KIND ?? 0,
    hasFrames: typeof host.requestAnimationFrame === 'function',
    hasUpdateProps: typeof host._updateProps === 'function',
    hasMeasure: typeof host._measure === 'function',
  }
}

/** Adds to a shared value on the UI thread and answers the new value. */
export const addOnUi = (value: SharedHost<number>, amount: number): number => {
  'worklet'
  value.value = value.value + amount
  return value.value
}

/**
 * Sends a Message's raw material to the JavaScript thread. `onUiMessage` on
 * an element turns it into a Foldkit Message. Safe on either thread.
 */
export const sendMessage = (channel: UiChannel, name: string, detail?: unknown): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  const proxy = host.__workletsModuleProxy
  if (host.__RUNTIME_KIND === UI_RUNTIME && proxy !== undefined && host.__serializer !== undefined) {
    // What worklets' own `scheduleOnRN` does on the UI thread. Over there
    // `deliver` is a stand-in that can only be handed back to JavaScript.
    proxy.scheduleOnRN(deliver, host.__serializer([channel.id, name, detail]))
    return
  }
  deliver(channel.id, name, detail)
}

/**
 * Ties a view's style to a worklet. `updater` answers the style. It runs
 * now, and again each time one of `inputs` changes. The style goes to the
 * view through Reanimated's native code with no JavaScript thread involved.
 */
export const bindStyle = (
  id: number,
  target: UiTarget,
  updater: (() => object) | null,
  inputs: ReadonlyArray<SharedHost<unknown>>,
  ref: SharedHost<UiTarget | null> | null,
): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  const apply = (): void => {
    if (updater === null || typeof host._updateProps !== 'function') return
    host._updateProps([{ shadowNodeWrapper: target.node, updates: updater() }])
    // Outside a frame nothing would send the change on. Inside one this
    // does nothing and the frame's end sends it.
    host._maybeFlushUIUpdatesQueue?.()
  }
  for (const input of inputs) input.listen(id, apply)
  if (ref !== null) ref.value = target
  apply()
}

export const unbindStyle = (
  id: number,
  inputs: ReadonlyArray<SharedHost<unknown>>,
  ref: SharedHost<UiTarget | null> | null,
): void => {
  'worklet'
  for (const input of inputs) input.unlisten(id)
  if (ref !== null) ref.value = null
}

/** Where a view is and how big, as the phone last laid it out. Null if unknown. */
export const measureView = (ref: SharedHost<UiTarget | null>): Measured | null => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  const target = ref.value
  if (target === null || typeof host._measure !== 'function') return null
  return host._measure(target.node) ?? null
}

export type Spring = Readonly<{
  /** How hard it pulls. Default 170. */
  stiffness?: number
  /** How fast it settles. Default 22. */
  damping?: number
  /** Default 1. */
  mass?: number
}>

/**
 * Moves a shared number to `to` like a spring, a step per frame, all on the
 * UI thread. A later `springTo` or `stopAnimation` on the same value takes
 * over. `finished` runs when it has come to rest.
 */
export const springTo = (
  value: SharedHost<number>,
  to: number,
  spring?: Spring,
  finished?: () => void,
): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  const frame = host.requestAnimationFrame
  if (typeof frame !== 'function') {
    value.value = to
    return
  }
  const stiffness = spring?.stiffness ?? 170
  const damping = spring?.damping ?? 22
  const mass = spring?.mass ?? 1
  const token = {}
  value.animation = token
  let velocity = 0
  let last = -1
  const step = (nowMs: number): void => {
    if (value.animation !== token) return
    // A long gap (the app was in the background) counts as a short one.
    let left = (last < 0 ? 16 : Math.min(Math.max(nowMs - last, 0), 64)) / 1000
    last = nowMs
    let position = value.value
    // Small steps keep a stiff spring from blowing up.
    while (left > 0) {
      const dt = Math.min(left, 0.004)
      const force = -stiffness * (position - to) - damping * velocity
      velocity += (force / mass) * dt
      position += velocity * dt
      left -= dt
    }
    if (Math.abs(position - to) < 0.5 && Math.abs(velocity) < 5) {
      value.value = to
      value.animation = null
      finished?.()
      return
    }
    value.value = position
    frame(step)
  }
  frame(step)
}

/** Springs a shared number back and forth between two values until stopped. */
export const bounceBetween = (
  value: SharedHost<number>,
  from: number,
  to: number,
  spring?: Spring,
): void => {
  'worklet'
  let target = to
  const turn = (): void => {
    target = target === to ? from : to
    springTo(value, target, spring, turn)
  }
  springTo(value, target, spring, turn)
}

/** Stops whatever is animating this value. It stays where it is. */
export const stopAnimation = (value: SharedHost<number>): void => {
  'worklet'
  value.animation = null
}

/**
 * For the status check. Changes a view's width from the UI thread, then
 * asks the phone, frame after frame, how wide the view is. Sends what it
 * found as the message `probed`.
 */
export const probeView = (
  ref: SharedHost<UiTarget | null>,
  width: SharedHost<number>,
  wanted: number,
  channel: UiChannel,
): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  const frame = host.requestAnimationFrame
  width.value = wanted
  let frames = 0
  const look = (): void => {
    frames += 1
    const found = measureView(ref)
    const isThere = found !== null && Math.abs(found.width - wanted) < 0.5
    if (isThere || frames >= 30 || typeof frame !== 'function') {
      sendMessage(channel, 'probed', { width: found === null ? null : found.width, wanted, frames })
      return
    }
    frame(look)
  }
  if (typeof frame !== 'function') look()
  else frame(look)
}

/** What a pan gesture reports, on the UI thread. Field names are gesture-handler's. */
export type PanEvent = Readonly<{
  /** 2 began, 4 active (moving), 5 ended, 3 cancelled, 1 failed. */
  state: number
  /** Only on a change of state. */
  oldState?: number
  translationX: number
  translationY: number
  velocityX: number
  velocityY: number
}>

export const PAN_ACTIVE = 4
export const PAN_END = 5

/** The shape Reanimated's native code calls an event worklet with. */
export const eventWorklet = <Event>(handler: (event: Event) => void) => {
  return (_timestampMs: number, event: Event): void => {
    'worklet'
    handler(event)
  }
}
