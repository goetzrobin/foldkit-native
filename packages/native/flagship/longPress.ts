/**
 * A press and hold on a view, as a Message.
 *
 *   view([...onLongPress(Message.LongPressedMessage({ rowKey })), style(...)], [...])
 *
 * The adapter has presses (`onPress`) but no hold. Fold Chat holds a message
 * to open its action sheet (Copy, Share, Regenerate, Select text). This file
 * listens for the finger with the engine's responder, as the menus' own hold
 * does (`src/menus/menu.ts`): half a second without moving more than ten
 * points. A scroll that starts takes the touch away and cancels the hold.
 *
 * A short touch that is not a hold can send a second Message, `onTap`:
 * Fold Chat puts the keyboard away when a message is tapped, as it does for
 * a tap anywhere else on the transcript. A view that is also pressed for
 * something else keeps its own `onPress` on a child.
 */
import type { Engine, EngineNode, ResponderEvent } from '@ng-native/fabric'
import { Option } from 'effect'
import { OnCustomEvent, type VNode } from 'foldkit/renderTarget'

import { prop } from '../src/attributes.js'
import { type ModuleFactory, registerModule } from '../src/extend.js'
import { type Handler, bagOf, customEvent, handlersByNode, nodeOf } from '../src/modules.js'

/** How long a finger rests before it is a hold, as on the phone's own menus. */
export const LONG_PRESS_MS = 500
/** How far it may drift meanwhile, in points. */
const SLOP = 10

const MARK = 'flagshipLongPress'
const EVENT = 'flagshipLongPressed'
const TAP_EVENT = 'flagshipTappedNotHeld'

type Point = Readonly<{ x: number; y: number }>

const pointOf = (event: ResponderEvent | unknown): Point | undefined => {
  const native = (event as { nativeEvent?: { pageX?: number; pageY?: number } })?.nativeEvent
  return typeof native?.pageX === 'number' && typeof native?.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : undefined
}

/** Attributes for a view that sends `message` when held, and `onTap` when only tapped. */
export const onLongPress = <Message>(message: Message, onTap?: Message) => [
  prop(MARK, true),
  OnCustomEvent<Message>({ name: EVENT, f: () => Option.some(message) }),
  ...(onTap === undefined ? [] : [OnCustomEvent<Message>({ name: TAP_EVENT, f: () => Option.some(onTap) })]),
]

const longPressModule: ModuleFactory = (engine: Engine) => {
  const stops = new WeakMap<EngineNode, () => void>()

  const wire = (node: EngineNode): void => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: Point | undefined
    /** Still a tap: not held long enough, not moved, not taken by a scroll. */
    let isTap = false
    const cancel = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      isTap = false
    }
    const send = (name: string): void => {
      const handler = handlersByNode.get(node)?.[name] as Handler | undefined
      handler?.(customEvent(name, {}))
    }
    const fire = (): void => {
      timer = undefined
      isTap = false
      send(EVENT)
    }
    const stop = engine.setResponder(node, {
      onStartShouldSetResponder: () => true,
      // A scroll or a swipe that starts takes the touch, and the hold is off.
      onResponderTerminationRequest: () => true,
      onResponderGrant: event => {
        start = pointOf(event)
        cancel()
        isTap = true
        timer = setTimeout(fire, LONG_PRESS_MS)
      },
      onResponderMove: event => {
        const now = pointOf(event)
        if (start === undefined || now === undefined) return
        if (Math.hypot(now.x - start.x, now.y - start.y) > SLOP) cancel()
      },
      onResponderTerminate: cancel,
      onResponderRelease: () => {
        const wasTap = isTap
        cancel()
        if (wasTap) send(TAP_EVENT)
      },
    })
    stops.set(node, () => {
      cancel()
      stop()
    })
  }

  const unwire = (node: EngineNode): void => {
    stops.get(node)?.()
    stops.delete(node)
  }

  /** A view may gain or lose its hold between draws: a reply does when it finishes. */
  const sync = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const wants = bagOf(vnode, 'props')[MARK] === true
    if (wants && !stops.has(node)) wire(node)
    else if (!wants && stops.has(node)) unwire(node)
  }

  const create = (_empty: VNode, vnode: VNode): void => sync(vnode)
  const update = (_old: VNode, vnode: VNode): void => sync(vnode)

  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node !== undefined) unwire(node)
  }

  return { create, update, destroy }
}

registerModule(longPressModule)
