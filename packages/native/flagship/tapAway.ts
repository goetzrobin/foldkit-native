/**
 * A tap on a scroll view that nothing inside it took, as a Message.
 *
 *   list(h, { ..., attributes: [onTapAway(Message.TappedTranscript())] })
 *
 * Fold Chat puts the keyboard away when the transcript is tapped, as
 * Messages does. React Native's own scroll view does that in its
 * JavaScript (`keyboardShouldPersistTaps`), which this project does not
 * run, so it is done here.
 *
 * The scroll view only gets the touch when no row, button or held message
 * inside it asked for it first: the engine offers a touch to the deepest
 * view first. A drag is not a tap. The engine takes a touch away from a
 * view inside a list that starts to scroll, but not from the list itself,
 * so this file listens for the scroll starting and lets the tap go. The
 * keyboard's own drag (it follows the finger down) is the phone's and is
 * left alone.
 */
import type { Engine, EngineNode, ResponderEvent } from '@ng-native/fabric'
import { Option } from 'effect'
import { OnCustomEvent, type VNode } from 'foldkit/renderTarget'

import { prop } from '../src/foldkit/attributes.js'
import { type ModuleFactory, registerModule } from '../src/foldkit/extend.js'
import { type Handler, bagOf, customEvent, handlersByNode, nodeOf } from '../src/foldkit/modules.js'

/** How far a finger may drift and still tap, in points, as for a press. */
const SLOP = 10

const MARK = 'flagshipTapAway'
const EVENT = 'flagshipTappedAway'

type Point = Readonly<{ x: number; y: number }>

const pointOf = (event: ResponderEvent | unknown): Point | undefined => {
  const native = (event as { nativeEvent?: { pageX?: number; pageY?: number } })?.nativeEvent
  return typeof native?.pageX === 'number' && typeof native?.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : undefined
}

/** Attributes for a scroll view that sends `message` when tapped where nothing else is. */
export const onTapAway = <Message>(message: Message) => [
  prop(MARK, true),
  OnCustomEvent<Message>({ name: EVENT, f: () => Option.some(message) }),
]

const tapAwayModule: ModuleFactory = (engine: Engine) => {
  const stops = new WeakMap<EngineNode, () => void>()

  const wire = (node: EngineNode): void => {
    let start: Point | undefined
    let isTap = false
    const letGo = (): void => {
      isTap = false
    }
    const stopResponder = engine.setResponder(node, {
      onStartShouldSetResponder: () => true,
      onResponderTerminationRequest: () => true,
      onResponderGrant: event => {
        start = pointOf(event)
        isTap = true
      },
      onResponderMove: event => {
        const now = pointOf(event)
        if (start === undefined || now === undefined) return
        if (Math.hypot(now.x - start.x, now.y - start.y) > SLOP) letGo()
      },
      onResponderTerminate: letGo,
      onResponderRelease: () => {
        const wasTap = isTap
        letGo()
        if (!wasTap) return
        const handler = handlersByNode.get(node)?.[EVENT] as Handler | undefined
        handler?.(customEvent(EVENT, {}))
      },
    })
    // The list starting to scroll under the finger: a drag, not a tap.
    const stopDrag = engine.setEventListener(node, 'topScrollBeginDrag', letGo)
    stops.set(node, () => {
      stopResponder()
      stopDrag()
    })
  }

  const unwire = (node: EngineNode): void => {
    stops.get(node)?.()
    stops.delete(node)
  }

  const sync = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const wants = bagOf(vnode, 'props')[MARK] === true
    if (wants && !stops.has(node)) wire(node)
    else if (!wants && stops.has(node)) unwire(node)
  }

  return {
    create: (_empty: VNode, vnode: VNode) => sync(vnode),
    update: (_old: VNode, vnode: VNode) => sync(vnode),
    destroy: (vnode: VNode) => {
      const node = nodeOf(vnode)
      if (node !== undefined) unwire(node)
    },
  }
}

registerModule(tapAwayModule)
