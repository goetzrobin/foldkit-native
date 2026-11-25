/**
 * A press and hold on a view, as a Message.
 *
 *   view([...onLongPress(Message.LongPressedMessage({ rowKey })), style(...)], [...])
 *
 * The adapter has presses (`onPress`) but no hold. Fold Chat holds a message
 * to open its action sheet (Copy, Share, Regenerate, Select text; Copy so far
 * and Stop while the reply streams). A hold is half a second without moving
 * more than ten points.
 *
 * Two routes read it.
 *
 * 1. Native, where the build has gesture-handler and Reanimated (iOS): a
 *    long press recogniser on the view itself (`attachNativeHold`,
 *    `src/host/worklets/hold.ts`). It sees only the finger, and lives as
 *    long as the native view does, whatever JavaScript draws meanwhile.
 * 2. JavaScript, always: the engine's responder, as the menus' own hold does
 *    (`src/menus/menu.ts`). It also tells a hold from a tap. Where the native
 *    route is on it is the backup: it opens the menu a moment later if the
 *    native route said nothing.
 *
 * Why the JavaScript route alone failed while a reply streamed (the phone
 * test of 25 November 2026): `@ng-native/fabric` 0.25.0 ends the touch of
 * any responder inside a scroll view on every scroll event
 * (`cancelPressForScroll`), and a list that moves by itself sends them: a
 * new bottom inset as the reply grows, a scroll to follow the end. React
 * Native marks those `responderIgnoreScroll` and React ignores them; the
 * engine does not. So here a scroll that no finger did no longer ends the
 * hold: the touch is followed from then on by its raw events, which still
 * reach the view. A scroll a finger did, a move past ten points or a touch
 * the phone cancelled does end it.
 *
 * A short touch that is not a hold can send a second Message, `onTap`:
 * Fold Chat puts the keyboard away when a message is tapped, as it does for
 * a tap anywhere else on the transcript. A view that is also pressed for
 * something else keeps its own `onPress` on a child.
 *
 * `holdNumbers` is a line for the developer's numbers: which route is on,
 * and how the last hold went (recognised by which route, or cancelled and
 * why), so a phone test can say what happened.
 */
import { type Engine, type EngineNode, type ResponderEvent, nativePlatform } from '@ng-native/fabric'
import { Option } from 'effect'
import { OnCustomEvent, type VNode, element } from 'foldkit/renderTarget'
import type { Html } from 'foldkit/html'

import { prop } from '../src/foldkit/attributes.js'
import { type ModuleFactory, registerModule } from '../src/foldkit/extend.js'
import { type Handler, bagOf, customEvent, handlersByNode, nodeOf } from '../src/foldkit/modules.js'
import {
  HOLD_ACTIVE,
  HOLD_BEGAN,
  HOLD_CANCELLED,
  HOLD_FAILED,
  type NativeHoldChange,
  attachNativeHold,
  nativeHoldCheck,
} from '../src/worklets/index.js'

/** How long a finger rests before it is a hold, as on the phone's own menus. */
export const LONG_PRESS_MS = 500
/** How far it may drift meanwhile, in points. */
const SLOP = 10
/**
 * Where the native route is on, how much longer the JavaScript route waits
 * before it opens the menu itself: the native route's word comes through the
 * UI thread and may arrive a frame or two after half a second.
 */
export const NATIVE_GRACE_MS = 150

const MARK = 'flagshipLongPress'
const EVENT = 'flagshipLongPressed'
const TAP_EVENT = 'flagshipTappedNotHeld'
const NUMBERS_MARK = 'flagshipHoldNumbers'

type Point = Readonly<{ x: number; y: number }>

const pointOf = (event: ResponderEvent | unknown): Point | undefined => {
  const native = (event as { nativeEvent?: { pageX?: number; pageY?: number } })?.nativeEvent
  return typeof native?.pageX === 'number' && typeof native?.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : undefined
}

/** A scroll event: the engine ends a touch with one. Whether a finger did it, as React Native says. */
const scrollOf = (event: unknown): { byFinger: boolean } | undefined => {
  const native = (event as { nativeEvent?: { contentOffset?: unknown; responderIgnoreScroll?: unknown } })?.nativeEvent
  if (native?.contentOffset === undefined) return undefined
  return { byFinger: native.responderIgnoreScroll === false }
}

/** Attributes for a view that sends `message` when held, and `onTap` when only tapped. */
export const onLongPress = <Message>(message: Message, onTap?: Message) => [
  prop(MARK, true),
  // The native route needs a native view, and so does the responder.
  prop('collapsable', false),
  OnCustomEvent<Message>({ name: EVENT, f: () => Option.some(message) }),
  ...(onTap === undefined ? [] : [OnCustomEvent<Message>({ name: TAP_EVENT, f: () => Option.some(onTap) })]),
]

// THE NUMBERS LINE

const report = { route: 'no hold on screen yet', last: 'none yet' }
const lines = new Map<EngineNode, Readonly<{ engine: Engine; text: EngineNode }>>()

const reportText = (): string => `hold: ${report.route} | last: ${report.last}`

const writeLines = (): void => {
  const text = reportText()
  for (const line of lines.values()) line.engine.setText(line.text, text)
}

const say = (route: string, last: string): void => {
  report.route = route
  report.last = last
  writeLines()
}

const el = element<any>()

/** A text element that shows how the last hold went. For the developer's numbers. */
export const holdNumbers = (attributes: ReadonlyArray<unknown> = []): Html =>
  el('text')([...attributes, prop(NUMBERS_MARK, true)] as never, [])

/** How the last hold went, as `holdNumbers` shows it. */
export const holdReport = (): string => reportText()

// THE TWO ROUTES

/** One finger on the view, from the JavaScript route's side. */
type Touch = {
  readonly startedAt: number
  readonly start: Point | undefined
  /**
   * waiting: the view holds the responder. following: the engine took the
   * responder away for a scroll no finger did, and the raw touch events are
   * followed instead. awaitingNative: the phone cancelled the touch as the
   * native hold would start, and the native route's word is awaited.
   * done: recognised, a tap, or cancelled.
   */
  phase: 'waiting' | 'following' | 'awaitingNative' | 'done'
  timer: ReturnType<typeof setTimeout> | undefined
  /** Whether the list scrolled by itself under the finger. */
  scrolled: boolean
  /** How it ended, for the numbers. */
  outcome: string | undefined
}

type Native =
  | Readonly<{ kind: 'off'; reason: string }>
  | Readonly<{ kind: 'on'; tag: number; detach: () => void }>

type Wired = {
  touch: Touch | undefined
  native: Native
  /** What the native recogniser last said, since its last `began`. */
  nativeSaid: 'nothing' | 'began' | 'failed' | 'cancelled' | 'recognised'
  nativeBeganAt: number | undefined
  lastFiredAt: number
  stop: () => void
  onNative: (change: NativeHoldChange) => void
}

const isAndroid = (): boolean => {
  try {
    return String(nativePlatform()) === 'android'
  } catch {
    return false
  }
}

const routeOf = (wired: Wired): string =>
  wired.native.kind === 'on' ? 'native recogniser on, JS as backup' : `JS route (native off: ${wired.native.reason})`

const longPressModule: ModuleFactory = (engine: Engine, afterCommit) => {
  const wiredByNode = new Map<EngineNode, Wired>()

  const tagOf = (node: EngineNode): number | null =>
    (engine as { tagOf?: (node: EngineNode) => number | null }).tagOf?.(node) ??
    (node as { committed?: { tag?: number } | null }).committed?.tag ??
    null

  const wire = (node: EngineNode): void => {
    const wired: Wired = {
      touch: undefined,
      native: { kind: 'off', reason: 'not on the phone yet' },
      nativeSaid: 'nothing',
      nativeBeganAt: undefined,
      lastFiredAt: -Infinity,
      stop: () => {},
      onNative: () => {},
    }
    const send = (name: string): void => {
      const handler = handlersByNode.get(node)?.[name] as Handler | undefined
      handler?.(customEvent(name, {}))
    }
    const nativeNote = (): string =>
      wired.native.kind !== 'on' || wired.nativeSaid === 'nothing' || wired.nativeSaid === 'began'
        ? ''
        : `; native said ${wired.nativeSaid}`
    const tell = (touch: Touch): void => {
      if (wired.touch !== touch || touch.outcome === undefined) return
      say(routeOf(wired), touch.outcome + nativeNote())
    }
    const finish = (touch: Touch, outcome: string): void => {
      if (touch.phase === 'done') return
      if (touch.timer !== undefined) clearTimeout(touch.timer)
      touch.timer = undefined
      touch.phase = 'done'
      touch.outcome = outcome
      tell(touch)
    }
    const through = (touch: Touch): string => (touch.scrolled ? ', kept through the list scrolling by itself' : '')

    const fire = (route: 'native' | 'JS', note = ''): void => {
      const now = Date.now()
      const touch = wired.touch
      // When this finger came down, as the later of the two routes heard it.
      const began = Math.max(touch?.startedAt ?? -Infinity, wired.nativeBeganAt ?? -Infinity)
      const startedAt = Number.isFinite(began) ? began : now
      // One hold, heard by both routes, opens one menu.
      if (wired.lastFiredAt >= startedAt) return
      wired.lastFiredAt = now
      const outcome = `recognised by ${route} after ${now - startedAt} ms${note}${touch === undefined ? '' : through(touch)}`
      if (touch !== undefined && touch.phase !== 'done') finish(touch, outcome)
      else say(routeOf(wired), outcome)
      send(EVENT)
    }
    const fireFromJs = (touch: Touch, note: string): void => {
      if (wired.touch !== touch || touch.phase === 'done') return
      touch.timer = undefined
      fire('JS', note)
    }
    const jsNote = (): string =>
      wired.native.kind !== 'on'
        ? ''
        : wired.nativeSaid === 'nothing'
          ? ' (native said nothing)'
          : wired.nativeSaid === 'began'
            ? ' (native began but did not recognise it)'
            : ` (native said ${wired.nativeSaid})`

    const moved = (touch: Touch, event: unknown): void => {
      const now = pointOf(event)
      if (touch.start === undefined || now === undefined) return
      const distance = Math.hypot(now.x - touch.start.x, now.y - touch.start.y)
      if (distance > SLOP) finish(touch, `cancelled, moved ${Math.round(distance)} pt`)
    }
    const lifted = (touch: Touch): void => {
      if (touch.phase === 'done') return
      finish(touch, `a tap (lifted after ${Date.now() - touch.startedAt} ms)`)
      send(TAP_EVENT)
    }
    const cancelledByPhone = (touch: Touch): void => {
      if (touch.phase === 'done') return
      const elapsed = Date.now() - touch.startedAt
      // gesture-handler cancels the JavaScript touch the moment its hold
      // starts. If its own word does not follow, the hold is opened from here.
      if (wired.native.kind === 'on' && elapsed >= LONG_PRESS_MS - 50) {
        touch.phase = 'awaitingNative'
        if (touch.timer !== undefined) clearTimeout(touch.timer)
        touch.timer = setTimeout(
          () => fireFromJs(touch, ` (the phone cancelled the touch at ${elapsed} ms, as gesture-handler does when its hold starts, and its word never came)`),
          NATIVE_GRACE_MS,
        )
        return
      }
      finish(touch, `cancelled, the phone cancelled the touch after ${elapsed} ms`)
    }

    const stopResponder = engine.setResponder(node, {
      onStartShouldSetResponder: () => true,
      // A scroll or a swipe that starts takes the touch, and the hold is off.
      onResponderTerminationRequest: () => true,
      onResponderGrant: event => {
        const previous = wired.touch
        if (previous?.timer !== undefined) clearTimeout(previous.timer)
        const touch: Touch = {
          startedAt: Date.now(),
          start: pointOf(event),
          phase: 'waiting',
          timer: undefined,
          scrolled: false,
          outcome: undefined,
        }
        wired.touch = touch
        // What the native route said of an earlier finger is not about this one.
        // Its `began` for this finger may come a moment before or after this.
        if (wired.nativeBeganAt === undefined || touch.startedAt - wired.nativeBeganAt > 100) wired.nativeSaid = 'nothing'
        const wait =wired.native.kind === 'on' ? LONG_PRESS_MS + NATIVE_GRACE_MS : LONG_PRESS_MS
        touch.timer = setTimeout(() => fireFromJs(touch, jsNote()), wait)
      },
      onResponderMove: event => {
        const touch = wired.touch
        if (touch !== undefined && touch.phase === 'waiting') moved(touch, event)
      },
      onResponderTerminate: event => {
        const touch = wired.touch
        if (touch === undefined || touch.phase !== 'waiting') return
        const scroll = scrollOf(event)
        if (scroll !== undefined && !scroll.byFinger) {
          // The list moved by itself: the finger has not. Follow it from here.
          touch.phase = 'following'
          touch.scrolled = true
          return
        }
        if (scroll !== undefined) finish(touch, 'cancelled, terminated by a drag of the list')
        else if (engine.responder === node) finish(touch, 'cancelled, terminated: another view took the touch')
        else cancelledByPhone(touch)
      },
      onResponderRelease: () => {
        const touch = wired.touch
        if (touch !== undefined && touch.phase === 'waiting') lifted(touch)
      },
    })
    // The raw touch, once the engine has taken the responder away for a scroll
    // no finger did. Each still reaches the view it came down on, and bubbles.
    const following = (run: (touch: Touch, event: unknown) => void) => (event: unknown) => {
      const touch = wired.touch
      if (touch !== undefined && touch.phase === 'following') run(touch, event)
    }
    const stopListening = [
      engine.setEventListener(node, 'topTouchMove', following(moved)),
      engine.setEventListener(node, 'topTouchEnd', following(touch => lifted(touch))),
      engine.setEventListener(node, 'topTouchCancel', following(touch => cancelledByPhone(touch))),
    ]

    wired.stop = () => {
      const touch = wired.touch
      if (touch !== undefined && touch.phase !== 'done') finish(touch, 'cancelled, the view was taken away under the finger')
      if (touch?.timer !== undefined) clearTimeout(touch.timer)
      stopResponder()
      for (const stop of stopListening) stop()
      detachNative(wired)
    }

    wired.onNative = (change: NativeHoldChange): void => {
      if (change.state === HOLD_BEGAN) {
        wired.nativeSaid = 'began'
        wired.nativeBeganAt = Date.now()
        return
      }
      if (change.state === HOLD_ACTIVE) {
        wired.nativeSaid = 'recognised'
        fire('native')
        return
      }
      if (change.state === HOLD_FAILED || change.state === HOLD_CANCELLED) {
        wired.nativeSaid = change.state === HOLD_FAILED ? 'failed' : 'cancelled'
        const touch = wired.touch
        if (touch !== undefined) tell(touch)
      }
    }
    wiredByNode.set(node, wired)
  }

  const detachNative = (wired: Wired): void => {
    if (wired.native.kind === 'on') wired.native.detach()
  }

  /** Attaches the native recogniser to the view, again if the phone made the view afresh. */
  const syncNative = (node: EngineNode, wired: Wired): void => {
    const tag = tagOf(node)
    if (tag === null) return
    if (wired.native.kind === 'on' && wired.native.tag === tag) return
    const before = wired.native
    detachNative(wired)
    if (before.kind === 'on') {
      const touch = wired.touch
      if (touch !== undefined && touch.phase !== 'done') {
        touch.phase = 'done'
        if (touch.timer !== undefined) clearTimeout(touch.timer)
        touch.outcome = `cancelled, the view was re-created under the finger (tag ${before.tag} to ${tag})`
        say(routeOf(wired), touch.outcome)
      }
    }
    if (isAndroid()) {
      // gesture-handler needs its root view around the view on Android; Fold Chat has none.
      wired.native = { kind: 'off', reason: 'Android' }
      return
    }
    const check = nativeHoldCheck()
    if (!check.ok) {
      wired.native = { kind: 'off', reason: check.reason }
      return
    }
    const hold = attachNativeHold(tag, { minDurationMs: LONG_PRESS_MS, maxDist: SLOP }, change => wired.onNative(change))
    wired.native = hold.ok ? { kind: 'on', tag, detach: hold.detach } : { kind: 'off', reason: hold.reason }
    wired.nativeSaid = 'nothing'
    if (report.last === 'none yet') report.route = routeOf(wired)
  }

  const unwire = (node: EngineNode): void => {
    wiredByNode.get(node)?.stop()
    wiredByNode.delete(node)
  }

  const createLine = (node: EngineNode): void => {
    if (lines.has(node)) return
    const text = engine.createText(reportText())
    engine.appendChild(node, text)
    lines.set(node, { engine, text })
  }

  /** A view may gain or lose its hold between draws: a reply does when it finishes. */
  const sync = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const props = bagOf(vnode, 'props')
    if (props[NUMBERS_MARK] === true) createLine(node)
    const wants = props[MARK] === true
    if (wants && !wiredByNode.has(node)) wire(node)
    else if (!wants && wiredByNode.has(node)) unwire(node)
  }

  return {
    create: (_empty: VNode, vnode: VNode) => sync(vnode),
    update: (_old: VNode, vnode: VNode) => sync(vnode),
    destroy: (vnode: VNode) => {
      const node = nodeOf(vnode)
      if (node === undefined) return
      unwire(node)
      lines.delete(node)
    },
    // A view has no number until a draw has reached the phone.
    post: () => {
      if (wiredByNode.size === 0) return
      afterCommit(() => {
        for (const [node, wired] of [...wiredByNode]) {
          if (wiredByNode.get(node) === wired) syncNative(node, wired)
        }
      })
    },
  }
}

registerModule(longPressModule)
