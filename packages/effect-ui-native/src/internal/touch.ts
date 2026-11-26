/**
 * Press and long press on a view, read from the engine's responder.
 *
 * The host turns a whole touch into one finished event, so a program never
 * sees a Message per finger movement:
 *
 * - The finger goes down: the view shows its `pressedStyle`, if it has one.
 *   No Message.
 * - The finger drifts more than ten points: the press is off. This is what
 *   keeps a scroll that starts on a row from pressing the row.
 * - Another view takes the touch (a scroll view starts to scroll under a
 *   finger): off.
 * - The finger rests for half a second on a view that listens for
 *   `longPress`: that event is sent, and the lift after it sends nothing.
 * - The finger lifts while the press is still on: `press` is sent.
 * - `pressIn` is sent when the finger goes down and `pressOut` when the
 *   touch is over for this view, however it ended (a lift, a drift, a scroll
 *   taking over). A program uses the pair to know a finger is resting on it.
 *
 * The workaround for ng-native 0.25.0 (`docs/upstream/ng-native-scroll-ignore.md`):
 * its engine ends the touch of a responder inside a scroll view on every
 * scroll event, including the ones the program made itself (a `scrollTo`, a
 * list following a growing row). React Native marks those
 * `responderIgnoreScroll: true`. When the engine takes the touch away for
 * such a scroll, the press is not called off: from then on it is followed by
 * the raw touch events, which still reach the view. A newer engine never
 * takes the touch away for those scrolls, and this path is simply not used.
 *
 * The phone's own long press (`NATIVE_HOLD`). The raw touch path above passed
 * every simulated test in Fold Chat and still failed on a real iPhone while
 * a reply streamed. So a view can ask for the phone's own recogniser as
 * well: gesture-handler's long press, attached to the native view
 * (`packages/native/src/host/worklets/hold.ts`). It sees only the finger and
 * lasts as long as the view does, whatever JavaScript draws meanwhile. Where
 * it is on, the timer here is the backup: it waits a little longer
 * (`NATIVE_GRACE_MS`) and sends the long press itself if the recogniser said
 * nothing. gesture-handler cancels the JavaScript touch the moment its own
 * hold starts; if its word then never comes, the long press is sent from
 * here too. One hold, heard by both, is one `longPress`. This is the same
 * arrangement as Fold Chat's `flagship/longPress.ts`. Off on Android, where
 * gesture-handler needs a root view this host does not have, and in a build
 * without gesture-handler: `holdReport()` says which and why.
 *
 * Nothing here knows Effect UI. The host passes `fire`, which hands the
 * finished event to the renderer.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'

import type { NodeData, NodeHooks } from '../../../native/src/host/fabric/nodes.js'
import { platformName } from '../../../native/src/host/platform.js'
import { PRESSED_STYLE } from '../../../native/src/host/style.js'
import {
  HOLD_ACTIVE,
  HOLD_BEGAN,
  HOLD_CANCELLED,
  HOLD_FAILED,
  type NativeHoldChange,
  attachNativeHold,
  nativeHoldCheck,
} from '../../../native/src/host/worklets/hold.js'

/** The marker the host puts in an element's data: which of the two it listens for. */
export const TOUCH = 'euiTouch'

/**
 * In an element's data (`NODE_DATA`): also read this view's long press with
 * the phone's own recogniser. For a view that listens for `longPress`.
 */
export const NATIVE_HOLD = 'nativeHold'

/**
 * Where the phone's recogniser is on, how much longer the timer here waits
 * before it sends the long press itself. The recogniser's word comes through
 * the UI thread and may arrive a frame or two after half a second.
 */
export const NATIVE_GRACE_MS = 150

export type TouchSpec = Readonly<{ press: boolean; longPress: boolean; pressIn?: boolean; pressOut?: boolean }>

export type TouchEventName = 'press' | 'longPress' | 'pressIn' | 'pressOut'

/** Where the finger was, in the window. */
export type PressPayload = Readonly<{ x: number; y: number }>

/** How far a finger may drift, in points, and still count as a press. */
export const PRESS_SLOP = 10
/** How long a finger rests before it is a long press, as on the phone's own menus. */
export const LONG_PRESS_MS = 500

type Point = Readonly<{ x: number; y: number }>

const pointOf = (event: unknown): Point | undefined => {
  const native = (event as { nativeEvent?: { pageX?: number; pageY?: number } } | undefined)?.nativeEvent
  return typeof native?.pageX === 'number' && typeof native?.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : undefined
}

/** Whether the event that ended the touch is a scroll, and whether the program made it. */
const scrollOf = (event: unknown): { byProgram: boolean } | undefined => {
  const native = (event as { nativeEvent?: { contentOffset?: unknown; responderIgnoreScroll?: unknown } } | undefined)
    ?.nativeEvent
  if (native?.contentOffset === undefined) return undefined
  return { byProgram: native.responderIgnoreScroll === true }
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * waiting: the view holds the responder. following: the engine took the
 * responder away for a scroll the program made, and the raw touch is followed.
 */
type Phase = 'idle' | 'waiting' | 'following' | 'awaitingNative'

type NativeRoute =
  | Readonly<{ kind: 'off'; reason: string }>
  | Readonly<{ kind: 'on'; tag: number; detach: () => void }>

const report = { route: 'no hold on screen yet', last: 'none yet' }

/**
 * Which way holds are read (the phone's recogniser with JavaScript as the
 * backup, or JavaScript alone and why), and how the last one went. One line
 * for a numbers strip, so a phone test can say what happened.
 */
export const holdReport = (): string => `hold: ${report.route} | last: ${report.last}`

/** Back to the start. For tests. */
export const resetHoldReport = (): void => {
  report.route = 'no hold on screen yet'
  report.last = 'none yet'
}

type Wired = {
  spec: TouchSpec
  phase: Phase
  start: Point | undefined
  last: Point | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  /** The long press was sent for this touch: the lift sends nothing. */
  held: boolean
  /** When this finger came down, as the responder heard it. */
  startedAt: number
  /** The view asked for the phone's own recogniser. */
  wantsNative: boolean
  native: NativeRoute
  nativeBeganAt: number | undefined
  /** When a long press was last sent, by either route. */
  firedAt: number
  stop: () => void
}

/** Counters a test or a readout can show. */
export type TouchStats = {
  /** Presses kept through a scroll the program made (the workaround ran). */
  keptThroughScroll: number
  /** Presses called off: drift, a finger scroll, or the phone cancelling. */
  cancelled: number
  /** Views wired for presses now. Back to 0 when everything is unmounted. */
  wired: number
}

export type TouchOptions = Readonly<{
  /** Hands a finished event to the renderer. */
  fire: (node: EngineNode, name: TouchEventName, payload: PressPayload) => void
  /** The newest props drawn on a node, for `pressedStyle` and the style to return to. */
  propsOf: (node: EngineNode) => Readonly<Record<string, unknown>>
  stats: TouchStats
  longPressMs?: number
  /** Queues work for after the next draw has reached the phone: a view has no number before. */
  afterCommit?: (job: () => void) => void
}>

export const specOf = (data: NodeData): TouchSpec | undefined => data[TOUCH] as TouchSpec | undefined

export const makeTouchHooks = (engine: Engine, options: TouchOptions): NodeHooks => {
  const wiredByNode = new Map<EngineNode, Wired>()
  const longPressMs = options.longPressMs ?? LONG_PRESS_MS

  const showPressed = (node: EngineNode, isPressed: boolean): void => {
    const props = options.propsOf(node)
    const pressedStyle = props[PRESSED_STYLE]
    if (!isPlain(pressedStyle)) return
    const base = isPlain(props['style']) ? props['style'] : undefined
    engine.setProp(node, 'style', isPressed ? { ...base, ...pressedStyle } : base)
    // A press happens between draws, so this change is sent now.
    engine.commit()
  }

  const wire = (node: EngineNode, spec: TouchSpec): void => {
    const wired: Wired = {
      spec,
      phase: 'idle',
      start: undefined,
      last: undefined,
      timer: undefined,
      held: false,
      startedAt: 0,
      wantsNative: false,
      native: { kind: 'off', reason: 'not asked for' },
      nativeBeganAt: undefined,
      firedAt: -Infinity,
      stop: () => {},
    }
    const routeOf = (): string =>
      wired.native.kind === 'on' ? 'native recogniser on, JS as backup' : `JS route (native off: ${wired.native.reason})`
    /** Sends the long press once for a finger, whichever route heard it first. */
    const fireHold = (route: 'native' | 'JS', note = ''): void => {
      if (!wired.spec.longPress) return
      const now = Date.now()
      const began = Math.max(wired.phase === 'idle' ? -Infinity : wired.startedAt, wired.nativeBeganAt ?? -Infinity)
      const startedAt = Number.isFinite(began) ? began : now
      if (wired.firedAt >= startedAt) return
      wired.firedAt = now
      clearTimer()
      wired.held = true
      if (wired.wantsNative) {
        report.route = routeOf()
        report.last = `recognised by ${route} after ${now - startedAt} ms${note}`
      }
      options.fire(node, 'longPress', wired.last ?? wired.start ?? { x: 0, y: 0 })
    }
    const clearTimer = (): void => {
      if (wired.timer !== undefined) clearTimeout(wired.timer)
      wired.timer = undefined
    }
    const end = (): void => {
      clearTimer()
      if (wired.phase === 'idle') return
      wired.phase = 'idle'
      showPressed(node, false)
      if (wired.spec.pressOut === true) options.fire(node, 'pressOut', wired.last ?? wired.start ?? { x: 0, y: 0 })
    }
    const cancel = (): void => {
      if (wired.phase === 'idle') return
      options.stats.cancelled++
      end()
    }
    /**
     * The phone cancelled the touch with no scroll and no other view taking
     * it. gesture-handler does that the moment its own hold starts. If its
     * word does not follow, the long press is sent from here.
     */
    const cancelledByPhone = (): void => {
      if (wired.phase === 'idle') return
      const elapsed = Date.now() - wired.startedAt
      if (wired.native.kind === 'on' && wired.spec.longPress && !wired.held && elapsed >= longPressMs - 50) {
        clearTimer()
        wired.phase = 'awaitingNative'
        wired.timer = setTimeout(() => {
          wired.timer = undefined
          if (wired.phase !== 'awaitingNative') return
          fireHold('JS', ' (the phone cancelled the touch as its own hold would start, and its word never came)')
          end()
        }, NATIVE_GRACE_MS)
        return
      }
      cancel()
    }
    const moved = (event: unknown): void => {
      const now = pointOf(event)
      if (wired.phase === 'idle' || wired.start === undefined || now === undefined) return
      wired.last = now
      if (Math.hypot(now.x - wired.start.x, now.y - wired.start.y) > PRESS_SLOP) cancel()
    }
    const lifted = (event: unknown): void => {
      if (wired.phase === 'idle') return
      const point = pointOf(event) ?? wired.last ?? wired.start ?? { x: 0, y: 0 }
      const wasHeld = wired.held
      end()
      if (!wasHeld && wired.spec.press) options.fire(node, 'press', point)
    }

    const stopResponder = engine.setResponder(node, {
      onStartShouldSetResponder: () => true,
      // A scroll or a swipe that starts may take the touch.
      onResponderTerminationRequest: () => true,
      onResponderGrant: event => {
        clearTimer()
        wired.start = pointOf(event)
        wired.last = wired.start
        wired.held = false
        wired.phase = 'waiting'
        wired.startedAt = Date.now()
        showPressed(node, true)
        if (wired.spec.pressIn === true) options.fire(node, 'pressIn', wired.start ?? { x: 0, y: 0 })
        if (wired.spec.longPress) {
          const isNativeOn = wired.native.kind === 'on'
          wired.timer = setTimeout(
            () => {
              wired.timer = undefined
              if (wired.phase === 'idle' || !wired.spec.longPress) return
              fireHold('JS', isNativeOn ? ' (native said nothing)' : '')
            },
            // The phone's recogniser goes first where it is on.
            isNativeOn ? longPressMs + NATIVE_GRACE_MS : longPressMs,
          )
        }
      },
      onResponderMove: event => {
        if (wired.phase === 'waiting') moved(event)
      },
      onResponderTerminate: event => {
        if (wired.phase !== 'waiting') return
        const scroll = scrollOf(event)
        if (scroll !== undefined && scroll.byProgram) {
          // The list moved by itself. The finger has not: follow it from here.
          wired.phase = 'following'
          options.stats.keptThroughScroll++
          return
        }
        // A drag of the list, or another view taking the touch: off. Anything else is the phone's own doing.
        if (scroll !== undefined || (engine as { responder?: unknown }).responder === node) cancel()
        else cancelledByPhone()
      },
      onResponderRelease: event => {
        if (wired.phase === 'waiting') lifted(event)
      },
    })
    // The raw touch, once the engine has taken the responder away for a scroll
    // the program made. Each still reaches the view it came down on.
    const following = (run: (event: unknown) => void) => (event: unknown) => {
      if (wired.phase === 'following') run(event)
    }
    const stopListening = [
      engine.setEventListener(node, 'topTouchMove', following(moved)),
      engine.setEventListener(node, 'topTouchEnd', following(lifted)),
      engine.setEventListener(node, 'topTouchCancel', following(cancelledByPhone)),
      // On a scroll view: it started to scroll under the finger. The engine
      // takes a touch away from a view inside a list that scrolls, but not
      // from the list itself, so the list's own press is called off here.
      engine.setEventListener(node, 'topScrollBeginDrag', cancel),
    ]
    wired.stop = () => {
      clearTimer()
      wired.phase = 'idle'
      stopResponder()
      for (const stop of stopListening) stop()
      if (wired.native.kind === 'on') wired.native.detach()
      wired.native = { kind: 'off', reason: 'the view is gone' }
    }
    onNative.set(wired, (change: NativeHoldChange): void => {
      if (change.state === HOLD_BEGAN) {
        wired.nativeBeganAt = Date.now()
        return
      }
      if (change.state === HOLD_ACTIVE) {
        const wasAwaiting = wired.phase === 'awaitingNative'
        fireHold('native')
        if (wasAwaiting) end()
        return
      }
      if ((change.state === HOLD_FAILED || change.state === HOLD_CANCELLED) && wired.phase === 'awaitingNative') {
        // Its hold did not happen after all: nothing is sent.
        report.last = `not a hold: native said ${change.state === HOLD_FAILED ? 'failed' : 'cancelled'}`
        end()
      }
    })
    wiredByNode.set(node, wired)
    options.stats.wired = wiredByNode.size
  }

  const onNative = new WeakMap<Wired, (change: NativeHoldChange) => void>()

  /** Attaches the phone's recogniser to the view, again if the phone made the view afresh. */
  const syncNative = (node: EngineNode, wired: Wired): void => {
    if (!wired.wantsNative) {
      if (wired.native.kind === 'on') wired.native.detach()
      wired.native = { kind: 'off', reason: 'not asked for' }
      return
    }
    const tag = engine.tagOf(node)
    if (tag === null) return
    if (wired.native.kind === 'on' && wired.native.tag === tag) return
    if (wired.native.kind === 'on') wired.native.detach()
    const off = (reason: string): void => {
      wired.native = { kind: 'off', reason }
      if (report.last === 'none yet') report.route = `JS route (native off: ${reason})`
    }
    // gesture-handler needs its root view around the view on Android. This host has none.
    if (platformName() === 'android') return off('Android')
    const check = nativeHoldCheck()
    if (!check.ok) return off(check.reason)
    const hold = attachNativeHold(tag, { minDurationMs: longPressMs, maxDist: PRESS_SLOP }, change => onNative.get(wired)?.(change))
    if (!hold.ok) return off(hold.reason)
    wired.native = { kind: 'on', tag, detach: hold.detach }
    if (report.last === 'none yet') report.route = 'native recogniser on, JS as backup'
  }

  const unwire = (node: EngineNode): void => {
    wiredByNode.get(node)?.stop()
    wiredByNode.delete(node)
    options.stats.wired = wiredByNode.size
  }

  /** A view may gain or lose its handlers between draws. */
  const sync = (node: EngineNode, data: NodeData): void => {
    const spec = specOf(data)
    const wired = wiredByNode.get(node)
    if (spec === undefined) {
      if (wired !== undefined) unwire(node)
      return
    }
    if (wired === undefined) wire(node, spec)
    else wired.spec = spec
    const now = wiredByNode.get(node)
    if (now !== undefined) now.wantsNative = data[NATIVE_HOLD] === true && spec.longPress
  }

  return {
    create: sync,
    update: (node, _before, after) => sync(node, after),
    destroy: node => unwire(node),
    // A view has no number until a draw has reached the phone.
    post: () => {
      const afterCommit = options.afterCommit
      if (afterCommit === undefined) return
      let wants = false
      for (const wired of wiredByNode.values()) {
        if (wired.wantsNative || wired.native.kind === 'on') {
          wants = true
          break
        }
      }
      if (!wants) return
      afterCommit(() => {
        for (const [node, wired] of [...wiredByNode]) {
          if (wiredByNode.get(node) === wired) syncNative(node, wired)
        }
      })
    },
  }
}
