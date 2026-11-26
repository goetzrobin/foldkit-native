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
 * Nothing here knows Effect UI. The host passes `fire`, which hands the
 * finished event to the renderer.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'

import type { NodeData, NodeHooks } from '../../../native/src/host/fabric/nodes.js'
import { PRESSED_STYLE } from '../../../native/src/host/style.js'

/** The marker the host puts in an element's data: which of the two it listens for. */
export const TOUCH = 'euiTouch'

export type TouchSpec = Readonly<{ press: boolean; longPress: boolean }>

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
type Phase = 'idle' | 'waiting' | 'following'

type Wired = {
  spec: TouchSpec
  phase: Phase
  start: Point | undefined
  last: Point | undefined
  timer: ReturnType<typeof setTimeout> | undefined
  /** The long press was sent for this touch: the lift sends nothing. */
  held: boolean
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
  fire: (node: EngineNode, name: 'press' | 'longPress', payload: PressPayload) => void
  /** The newest props drawn on a node, for `pressedStyle` and the style to return to. */
  propsOf: (node: EngineNode) => Readonly<Record<string, unknown>>
  stats: TouchStats
  longPressMs?: number
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
      stop: () => {},
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
    }
    const cancel = (): void => {
      if (wired.phase === 'idle') return
      options.stats.cancelled++
      end()
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
        showPressed(node, true)
        if (wired.spec.longPress) {
          wired.timer = setTimeout(() => {
            wired.timer = undefined
            if (wired.phase === 'idle' || !wired.spec.longPress) return
            wired.held = true
            options.fire(node, 'longPress', wired.last ?? wired.start ?? { x: 0, y: 0 })
          }, longPressMs)
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
        cancel()
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
      engine.setEventListener(node, 'topTouchCancel', following(cancel)),
    ]
    wired.stop = () => {
      clearTimer()
      wired.phase = 'idle'
      stopResponder()
      for (const stop of stopListening) stop()
    }
    wiredByNode.set(node, wired)
    options.stats.wired = wiredByNode.size
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
  }

  return {
    create: sync,
    update: (node, _before, after) => sync(node, after),
    destroy: node => unwire(node),
  }
}
