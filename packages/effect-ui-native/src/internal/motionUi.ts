/**
 * The part of `Motion` that runs on the phone's UI thread.
 *
 * Every function here that starts with the line `'worklet'` is a worklet:
 * the app's build copies it to the JavaScript engine on the UI thread
 * (`packages/native/src/host/worklets/ui.ts` explains how). There it moves a
 * view a step per frame through `_updateProps`, which is Reanimated's native
 * code. The JavaScript thread starts an animation and hears when it is over.
 * It does nothing in between, so the animation keeps running while
 * JavaScript is busy.
 *
 * What the UI thread remembers is on its own global, by the animation's
 * number: where the view is now, and which run is moving it. A newer run
 * starts from where the view is and takes over. A worklet's own variables
 * would not do: each call gets a copy of them.
 *
 * In the tests there is no build step. The `'worklet'` line does nothing and
 * these run as ordinary functions against a stand-in for the UI thread.
 */
import type { UiChannel } from '../../../native/src/host/worklets/channel.js'
import { type UiTarget, sendMessage } from '../../../native/src/host/worklets/ui.js'

/** Everything `Motion` can move, with nothing left out. */
export type Full = Readonly<{ opacity: number; translateX: number; translateY: number; scale: number }>

/** Which of the view's styles the animation writes. The others are left alone. */
export type Uses = Readonly<{ opacity: boolean; transform: boolean }>

/** The four numbers of a cubic bezier curve, as in CSS. */
export type Curve = readonly [number, number, number, number]

export type Timing =
  | Readonly<{ kind: 'timing'; ms: number; delayMs: number; curve: Curve }>
  | Readonly<{ kind: 'spring'; stiffness: number; damping: number; mass: number; delayMs: number }>

type State = { now: Full; run: number }

type UiGlobal = {
  __effectUiMotion?: Record<number, State>
  requestAnimationFrame?: (run: (nowMs: number) => void) => unknown
  _updateProps?: (operations: ReadonlyArray<{ shadowNodeWrapper: unknown; updates: object }>) => void
  _maybeFlushUIUpdatesQueue?: () => void
}

/** How far along a curve is at time `t`, both from 0 to 1. */
export const curveAt = (curve: Curve, t: number): number => {
  'worklet'
  if (t <= 0) return 0
  if (t >= 1) return 1
  const x1 = curve[0]
  const y1 = curve[1]
  const x2 = curve[2]
  const y2 = curve[3]
  if (x1 === y1 && x2 === y2) return t
  // The curve gives x and y for a hidden number s. Find the s whose x is t, by halving.
  let low = 0
  let high = 1
  let s = t
  for (let round = 0; round < 24; round++) {
    const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s
    if (Math.abs(x - t) < 0.0002) break
    if (x < t) low = s
    else high = s
    s = (low + high) / 2
  }
  return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s
}

/** Puts the values on the view, from the UI thread. */
export const writeMotion = (target: UiTarget, uses: Uses, values: Full): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  if (typeof host._updateProps !== 'function') return
  const updates: Record<string, unknown> = {}
  if (uses.opacity) updates['opacity'] = values.opacity
  if (uses.transform) {
    updates['transform'] = [{ translateX: values.translateX }, { translateY: values.translateY }, { scale: values.scale }]
  }
  host._updateProps([{ shadowNodeWrapper: target.node, updates }])
  // Outside a frame nothing would send the change on. Inside one this does nothing.
  host._maybeFlushUIUpdatesQueue?.()
}

/**
 * Moves a view to `to`, a step per frame, and sends `done` on the channel
 * when it is there.
 *
 * It starts from where the UI thread last put the view. If this is the
 * view's first animation, or `isFromForced`, it starts from `from`. With
 * `isJump` the place and the size go to their end at once and only the
 * opacity moves: that is Reduce Motion.
 */
export const startMotionOnUi = (
  id: number,
  target: UiTarget,
  from: Full,
  to: Full,
  uses: Uses,
  timing: Timing,
  isFromForced: boolean,
  isJump: boolean,
  run: number,
  channel: UiChannel,
): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  if (host.__effectUiMotion === undefined) host.__effectUiMotion = {}
  const store = host.__effectUiMotion
  const known = store[id]
  const first = known !== undefined && !isFromForced ? known.now : from
  const start: Full = isJump
    ? { opacity: first.opacity, translateX: to.translateX, translateY: to.translateY, scale: to.scale }
    : first
  const state: State = { now: start, run }
  // From here on an older run of this animation sees it has been replaced.
  store[id] = state
  writeMotion(target, uses, start)
  const finish = (): void => {
    state.now = to
    writeMotion(target, uses, to)
    sendMessage(channel, 'done', { id, run })
  }
  const frame = host.requestAnimationFrame
  const isThere =
    start.opacity === to.opacity &&
    start.translateX === to.translateX &&
    start.translateY === to.translateY &&
    start.scale === to.scale
  if (typeof frame !== 'function' || isThere) {
    finish()
    return
  }
  let startedAt = -1
  let last = -1
  // A spring's place and speed, where 0 is the start and 1 is the end.
  let place = 0
  let speed = 0
  const step = (nowMs: number): void => {
    if (store[id] !== state) return
    if (startedAt < 0) {
      startedAt = nowMs
      last = nowMs
    }
    const elapsed = nowMs - startedAt - timing.delayMs
    if (elapsed < 0) {
      last = nowMs
      frame(step)
      return
    }
    if (timing.kind === 'timing') {
      const t = timing.ms <= 0 ? 1 : Math.min(1, elapsed / timing.ms)
      if (t >= 1) {
        finish()
        return
      }
      place = curveAt(timing.curve, t)
    } else {
      // A long gap (the app was in the background) counts as a short one.
      let left = Math.min(Math.max(nowMs - last, 0), 64) / 1000
      // Small steps keep a stiff spring from blowing up.
      while (left > 0) {
        const dt = Math.min(left, 0.004)
        const force = -timing.stiffness * (place - 1) - timing.damping * speed
        speed += (force / timing.mass) * dt
        place += speed * dt
        left -= dt
      }
      if (Math.abs(place - 1) < 0.001 && Math.abs(speed) < 0.01) {
        finish()
        return
      }
    }
    last = nowMs
    state.now = {
      opacity: start.opacity + (to.opacity - start.opacity) * place,
      translateX: start.translateX + (to.translateX - start.translateX) * place,
      translateY: start.translateY + (to.translateY - start.translateY) * place,
      scale: start.scale + (to.scale - start.scale) * place,
    }
    writeMotion(target, uses, state.now)
    frame(step)
  }
  frame(step)
}

/** Ends what is moving the view, puts it at `to`, and forgets it. For a view that stops being animated. */
export const finishMotionOnUi = (id: number, target: UiTarget, to: Full, uses: Uses): void => {
  'worklet'
  const host = globalThis as unknown as UiGlobal
  const store = host.__effectUiMotion
  if (store === undefined || store[id] === undefined) return
  delete store[id]
  writeMotion(target, uses, to)
}

/** Ends what is moving the view and forgets it. For a view that is gone. */
export const forgetMotionOnUi = (id: number): void => {
  'worklet'
  const store = (globalThis as unknown as UiGlobal).__effectUiMotion
  if (store !== undefined) delete store[id]
}

/** How many views the UI thread is keeping a place for. For tests and the status line. */
export const countMotionOnUi = (): number => {
  'worklet'
  const store = (globalThis as unknown as UiGlobal).__effectUiMotion
  return store === undefined ? 0 : Object.keys(store).length
}
