/**
 * A bar that sits on top of the keyboard: a chat's composer.
 *
 *   KeyboardBar.view(h, {
 *     keyboardHeight: model.keyboardHeight,          // from Phone.keyboard
 *     listId: 'transcript',                          // an AnchoredList with `inset`
 *     above: Transcript(h, {...}),                   // what the bar lies over
 *     overBar: [scrollToEndButton],                  // rides on the bar's top edge
 *     bar: [Composer(h, {...})],
 *   })
 *
 * The phone moves the bar, not JavaScript. On an iPhone whose build has
 * react-native-keyboard-controller, that library's native view reports the
 * keyboard's height on every frame, and React Native's animation module
 * moves the bar by it on the native side. No JavaScript runs per frame, and
 * the bar follows a finger that drags the keyboard down.
 *
 * The list above is not made shorter. The bar lies over its bottom edge,
 * and the list is told how much the bar and the keyboard cover, so it can
 * make room with a bottom inset (`AnchoredList` with `inset`).
 *
 * Where the phone cannot do that (Android, or a build without the native
 * view) the bar is padded up by the keyboard's height from the Model, eased
 * over a quarter of a second, and the list above gets shorter.
 *
 * All of the behaviour is the host layer's
 * (`packages/native/src/host/keyboard/dock.ts`, unchanged). This file draws
 * the views in the places that controller expects and runs it from the
 * host's node hooks, before each commit. Put the result in a `safeArea` whose bottom edge is off: the bar
 * keeps clear of the home indicator by itself.
 */
import type * as View from '@effect/ui/View'
import type { EngineNode } from '@ng-native/fabric'

import { chatInsetAvailable } from '../../native/src/host/chat/chatScroll.js'
import { keyboardDockMode } from '../../native/src/host/keyboard/detect.js'
import type { NodeData } from '../../native/src/host/fabric/nodes.js'
import { type NodeHooksFactory, registerNodeHooks } from '../../native/src/host/fabric/registry.js'
import {
  BOTTOM_EDGE,
  DOCK_CONTENT_ID,
  DOCK_DATA,
  type DockField,
  type DockParts,
  KEYBOARD_CONTROLLER_TAG,
  KEYBOARD_GESTURE_TAG,
  type Marker,
  OUT_OF_FLOW,
  makeDockController,
} from '../../native/src/host/keyboard/dock.js'
import type * as Native from './Native.js'
import { NODE_DATA } from './NativeHost.js'

export { DOCK_CONTENT_ID as CONTENT_ID }
export { configureKeyboardDock as configure, keyboardDockMode as mode } from '../../native/src/host/keyboard/detect.js'

/** Whether the bar lies over the list and the list makes room with an inset. */
export const isInset = (): boolean => chatInsetAvailable()

const childAt = (node: EngineNode | undefined, index: number): EngineNode | undefined =>
  node?.childList[index] as EngineNode | undefined

/** The bar's views, by the places `view` puts them in. */
const partsOf = (outer: EngineNode, marker: Marker): DockParts => {
  const seat = childAt(childAt(outer, 1), 0)
  const bar = childAt(seat, marker.isNative ? 2 : 0)
  return {
    seat,
    bar,
    content: childAt(childAt(bar, 0), 0),
    controller: marker.isNative ? childAt(seat, 0) : undefined,
    gesture: marker.isNative ? childAt(seat, 1) : undefined,
    lift: marker.insetListId === undefined ? childAt(childAt(outer, 0), 0) : undefined,
  }
}

const fieldIn = (node: EngineNode | undefined): EngineNode | undefined => {
  if (node === undefined) return undefined
  if (node.tag === 'text-input') return node
  for (const child of node.childList) {
    const found = fieldIn(child as EngineNode)
    if (found !== undefined) return found
  }
  return undefined
}

/** On the bar's outermost view: the `nativeID` the program gave the bar's text field, if any. */
const FIELD_DATA = 'keyboardBarField'

/**
 * Runs the host's dock controller for every bar on a surface: started once
 * the draw that made the bar is done and before it goes to the phone, told
 * again on every later draw, stopped when the bar goes.
 */
const barHooks: NodeHooksFactory = (engine, afterCommit) => {
  const controller = makeDockController(engine, afterCommit)
  const fresh: Array<readonly [EngineNode, NodeData]> = []
  const fieldOf = (outer: EngineNode, marker: Marker, data: NodeData): DockField | undefined => {
    const node = fieldIn(partsOf(outer, marker).content)
    return node === undefined ? undefined : { node, own: data[FIELD_DATA] }
  }
  return {
    // A bar is mostly children, and they are made after it: it waits for `post`.
    create: (node, data) => {
      if (data[DOCK_DATA] !== undefined) fresh.push([node, data])
    },
    update: (node, _before, data) => {
      const marker = data[DOCK_DATA] as Marker | undefined
      if (marker !== undefined) controller.update(node, marker, () => fieldOf(node, marker, data))
    },
    destroy: (node, data) => {
      if (data[DOCK_DATA] !== undefined) controller.destroy(node)
    },
    post: () => {
      for (const [outer, data] of fresh.splice(0)) {
        const marker = data[DOCK_DATA] as Marker
        controller.start(outer, marker, partsOf(outer, marker), fieldOf(outer, marker, data))
      }
    },
  }
}

registerNodeHooks(barHooks)

export type ViewOptions<Msg, R, RAbove = R, ROver = R> = Readonly<{
  /** The keyboard's height from the Model, 0 while it is down. Read only where the phone cannot move the bar. */
  keyboardHeight: number
  /** The bar: the composer. */
  bar: Native.NoTextInput<Msg, R>
  /** What the bar lies over: the list, filling the area. */
  above: Native.NoTextContent<Msg, RAbove>
  /** Views on the bar's top edge that move with it. They take no room. */
  overBar?: Native.NoTextInput<Msg, ROver>
  /** The `AnchoredList` above, which makes room with a bottom inset. */
  listId: string
  /** The `nativeID` of the text field in the bar. */
  fieldId?: string | undefined
  backgroundColor?: string | undefined
}>

/** Draws the bar over (or under) what is above it. See the top of this file. */
export const view = <Msg, R = never, RAbove = never, ROver = never>(
  h: Native.H<Msg>,
  // Each of the three may need different services. What the bar's view needs is all of them.
  options: ViewOptions<Msg, R, RAbove, ROver>,
): View.ElementBuilder<Msg, R | RAbove | ROver, any, any> => {
  const isNative = keyboardDockMode() === 'native'
  const insets = isNative && chatInsetAvailable()
  // Measured to learn how high the bar's content already stands.
  const content = h.view.key('content').set({ collapsable: false }).prop('nativeID', DOCK_CONTENT_ID).children(options.bar as never)
  const riders =
    options.overBar === undefined
      ? null
      : h.view
          .key('over-bar')
          .set({ pointerEvents: 'box-none' })
          // From the bar's top up, as wide as the bar, out of the layout.
          .style({ position: 'absolute', left: 0, right: 0, bottom: '100%' })
          .children(options.overBar as never)
  // The view the phone moves. Its safe area view pads the home indicator's
  // strip, which the keyboard covers once it is up.
  const bar = h.view
    .key('bar')
    .set({ collapsable: false })
    .style(options.backgroundColor === undefined ? {} : { backgroundColor: options.backgroundColor })
    .children(h.safeArea.key('strip').set({ edges: BOTTOM_EDGE }).style({ flex: 0 }).children(content), riders)
  // The seat and the views around it carry layout only: no colour and no
  // listeners. The phone then makes no native view for them, and the bar's
  // nearest native parent is the caller's own container, which is as tall as
  // the screen area. A native view ignores touches outside its parent's frame,
  // and the bar is drawn far above its place in the layout once the keyboard is up.
  const seat = h.view.key('seat').children(
    isNative ? h.el(KEYBOARD_CONTROLLER_TAG).key('controller').prop('enabled', true).prop('style', OUT_OF_FLOW) : null,
    isNative ? h.el(KEYBOARD_GESTURE_TAG).key('gesture').prop('style', OUT_OF_FLOW) : null,
    bar,
  )
  const marker: Marker = {
    keyboardHeight: Math.max(0, Math.round(options.keyboardHeight)),
    offset: undefined,
    isNative,
    hasAbove: true,
    insetListId: insets ? options.listId : undefined,
  }
  const data = { [DOCK_DATA]: marker, [FIELD_DATA]: options.fieldId }
  if (insets) {
    // The list fills the whole area and the bar is laid over its bottom edge.
    return h.view
      .key('keyboard-bar-inset')
      .style({ flex: 1 })
      .prop(NODE_DATA, data)
      .children(
        h.view.key('above').style({ flex: 1 }).children(options.above),
        h.view.key('over').style({ position: 'absolute', left: 0, right: 0, bottom: 0 }).children(seat),
      ) as View.ElementBuilder<Msg, R | RAbove | ROver, any, any>
  }
  return h.view
    .key(isNative ? 'keyboard-bar-native' : 'keyboard-bar-fallback')
    .style({ flex: 1 })
    .prop(NODE_DATA, data)
    .children(
      // What rises past the top is cut off here.
      h.view
        .key('above')
        .style({ flex: 1, overflow: 'hidden' })
        // The host writes this view's style. Nothing else may.
        .children(h.view.key('lift').set({ collapsable: false }).children(options.above)),
      h.view.key('host').children(seat),
    ) as View.ElementBuilder<Msg, R | RAbove | ROver, any, any>
}

/**
 * For the list above a bar: dragging it puts the keyboard away. Where the
 * phone moves the bar, the keyboard follows the finger down and the bar
 * goes with it.
 */
export const dismissOnDrag = (): 'interactive' | 'on-drag' => (keyboardDockMode() === 'native' ? 'interactive' : 'on-drag')
