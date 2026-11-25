/**
 * A press and hold read by the phone itself: gesture-handler's long press,
 * attached to a native view by its number.
 *
 *   const hold = attachNativeHold(tag, { minDurationMs: 500, maxDist: 10 }, change => ...)
 *   hold.ok && hold.detach()
 *
 * Why not the engine's JavaScript responder: `@ng-native/fabric` 0.25.0 ends
 * the touch of any responder inside a scroll view on every scroll event,
 * including the ones the program caused (a new bottom inset, a scroll to
 * follow the end), which React Native marks `responderIgnoreScroll` and React
 * ignores. A list that moves by itself while a finger rests on a row (a reply
 * streaming in) took the hold away. A recogniser on the native view sees only
 * the finger, and lives as long as the view does, whatever JavaScript commits
 * in the meantime.
 *
 * The recogniser's state changes reach JavaScript the way the pan's do in
 * `src/foldkit/worklets/views.ts`: gesture-handler hands them to Reanimated's
 * native code (action type 1), which calls a worklet for the view, which
 * sends them back on a channel. Nothing here imports React or a view library.
 * Nothing here throws: where a piece is missing the answer says which.
 *
 * Gesture-handler's states: 2 began (finger down), 4 active (held long
 * enough: the hold), 5 ended (lifted after), 1 failed (moved too far, or
 * lifted too soon), 3 cancelled (the view went, or the system took the touch).
 */
import { listenToChannel, uiChannel, type UiChannel } from './channel.js'
import { type Check, gestureModule, gesturesCheck, reanimatedProxy, workletsPackage } from './host.js'
import { workletCheck } from './run.js'
import { sendMessage } from './ui.js'

export const HOLD_FAILED = 1
export const HOLD_BEGAN = 2
export const HOLD_CANCELLED = 3
export const HOLD_ACTIVE = 4
export const HOLD_END = 5

export type NativeHoldConfig = Readonly<{
  /** How long the finger rests before it is a hold. */
  minDurationMs: number
  /** How far it may move meanwhile, in points, in the view's own coordinates. */
  maxDist: number
}>

/** One change of the recogniser's state. */
export type NativeHoldChange = Readonly<{ state: number; oldState: number }>

export type NativeHold =
  | Readonly<{ ok: true; handlerTag: number; detach: () => void }>
  | Readonly<{ ok: false; reason: string }>

/** gesture-handler's code for "send the events to a Reanimated worklet". */
const ACTION_REANIMATED_WORKLET = 1
const STATE_EVENT = 'onGestureHandlerStateChange'
/** Apart from the pans' numbers (880 000 up, `views.ts`). */
let nextHandlerTag = 890_000

type StateEvent = Readonly<{ state: number; oldState?: number }>

/** The worklet Reanimated's native code calls with each state change, on the UI thread. */
const stateWorklet = (channel: UiChannel) => {
  return (_timestampMs: number, event: StateEvent): void => {
    'worklet'
    sendMessage(channel, 'state', { state: event.state, oldState: event.oldState ?? 0 })
  }
}

/** Whether this build can read a hold natively, and why not. Never throws. */
export const nativeHoldCheck = (): Check => {
  const gestures = gesturesCheck()
  return gestures.ok ? workletCheck(stateWorklet(uiChannel())) : gestures
}

/**
 * Attaches a long press to the native view numbered `tag`. `onChange` hears
 * each state change, on the JavaScript thread. Never throws.
 */
export const attachNativeHold = (
  tag: number,
  config: NativeHoldConfig,
  onChange: (change: NativeHoldChange) => void,
): NativeHold => {
  const check = nativeHoldCheck()
  if (!check.ok) return { ok: false, reason: check.reason }
  const [module, proxy, pkg] = [gestureModule(), reanimatedProxy(), workletsPackage()]
  if (module === null || proxy === null || pkg === null) return { ok: false, reason: 'gesture-handler is not ready' }
  const channel = uiChannel()
  const stopListening = listenToChannel(channel, (_name, detail) => {
    const change = detail as Partial<NativeHoldChange> | undefined
    if (typeof change?.state !== 'number') return
    onChange({ state: change.state, oldState: typeof change.oldState === 'number' ? change.oldState : 0 })
  })
  const handlerTag = nextHandlerTag++
  let eventId: number | undefined
  try {
    eventId = proxy.registerEventHandler(pkg.createSerializable(stateWorklet(channel)), STATE_EVENT, tag)
    module.createGestureHandler('LongPressGestureHandler', handlerTag, {
      minDurationMs: config.minDurationMs,
      maxDist: config.maxDist,
    })
    module.attachGestureHandler(handlerTag, tag, ACTION_REANIMATED_WORKLET)
    module.flushOperations()
  } catch (error) {
    stopListening()
    try {
      if (eventId !== undefined) proxy.unregisterEventHandler(eventId)
      module.dropGestureHandler(handlerTag)
      module.flushOperations()
    } catch {
      // Left as it is: nothing was attached.
    }
    return { ok: false, reason: `gesture-handler refused the hold (${error instanceof Error ? error.message : String(error)})` }
  }
  let isAttached = true
  return {
    ok: true,
    handlerTag,
    detach: () => {
      if (!isAttached) return
      isAttached = false
      stopListening()
      try {
        if (eventId !== undefined) proxy.unregisterEventHandler(eventId)
        module.dropGestureHandler(handlerTag)
        module.flushOperations()
      } catch {
        // The view is going away either way.
      }
    },
  }
}
