/**
 * A bar that sits on top of the keyboard: a chat's composer, a comment box.
 *
 *   keyboardDock(h, {
 *     keyboardHeight: model.keyboardHeight,   // from Phone.Keyboard
 *     above: [list(h, {...})],                // what the bar pushes up
 *     children: [composer],                   // the bar
 *     backgroundColor: '#ffffff',
 *   })
 *
 * With `above`, the result fills its parent: the content on top, the bar at
 * the bottom. Without `above`, the result is the bar alone: put it last in a
 * column, under the content.
 *
 * The bar keeps clear of the home indicator by itself. Put it in a screen
 * whose own safe area leaves the bottom edge alone, or the gap is doubled.
 *
 * Put it directly in a container that is as tall as the area the bar may
 * move over, such as the screen's content. The bar is drawn outside its own
 * place in the layout while the keyboard is up, and on iOS a view only takes
 * touches inside its parent's frame.
 *
 * There are two modes, chosen once per app (see `detect.ts`).
 *
 * NATIVE. react-native-keyboard-controller has a native view that reports
 * the keyboard's height on every frame, including while a finger drags the
 * keyboard down. None of that library's JavaScript is used. React Native's
 * animation module connects the reports to the bar's position on the native
 * side (see `drive.ts`), so the bar moves with the keyboard and no JavaScript
 * runs per frame. The approach is ng-native's `keyboard-dock.ts`.
 *
 * FALLBACK. The program passes the keyboard's height from its Model. The bar
 * is padded up by that much, eased over a quarter of a second. The content
 * above gets shorter by the same amount, because the bar takes the room.
 *
 * In both modes the bar rises by the keyboard's height less `offset`: the
 * room under the bar that the keyboard may cover, which is the home
 * indicator's strip. Left out, the dock measures it: how far the bottom of
 * the bar's content is from the bottom of the window while the keyboard is
 * down.
 *
 * INSET. A third way, for a chat, on top of native mode: give `inset` and
 * `above`. The content above is then not moved and not padded at all. It
 * keeps its full height and the bar lies over its bottom edge. The list
 * named by `inset.listId` is told when the keyboard starts and stops, and
 * makes room with its scroll view's bottom inset (`../../host/chat/chatScroll.ts`).
 * Outside native mode `inset` is ignored.
 *
 * Android always uses the fallback. ng-native does not use
 * react-native-keyboard-controller there either: it has a native view of its
 * own for Android, in a package this project does not install.
 *
 * This file draws the dock and finds its views. What the dock does between
 * draws is the host layer's (`src/host/keyboard/dock.ts`).
 */
import type { EngineNode } from '@ng-native/fabric'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { type VNode, element } from 'foldkit/renderTarget'

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
} from '../../host/keyboard/dock.js'
import { keyboardDockMode } from '../../host/keyboard/detect.js'
import { prop, style } from '../attributes.js'
import { type ModuleFactory, registerModule } from '../extend.js'
import { bagOf, nodeOf } from '../modules.js'

export { DOCK_CONTENT_ID } from '../../host/keyboard/dock.js'

const el = element<any>()

const box = el('view')
const safeAreaView = el('screen-safe-area')
const controllerView = el(KEYBOARD_CONTROLLER_TAG)
const gestureArea = el(KEYBOARD_GESTURE_TAG)

export type KeyboardDock = Readonly<{
  /**
   * The keyboard's height in points, 0 while it is hidden. Keep it in the
   * Model from `Phone.Keyboard.changesEntry`. Read in fallback mode only.
   * On an Android app whose window shrinks for the keyboard by itself, pass 0.
   */
  keyboardHeight: number
  /** The bar: a text field, a Send button. */
  children: ReadonlyArray<Html>
  /**
   * What sits above the bar and should keep clear of the keyboard with it:
   * a list, a scroll view. Give it `style({ flex: 1 })`.
   */
  above?: ReadonlyArray<Html>
  /**
   * How much less than the keyboard's height the bar rises, in points. Leave
   * it out and the dock measures it. See the top of this file.
   */
  offset?: number
  /** The bar's color, which also fills the strip beside the home indicator. */
  backgroundColor?: string
  /**
   * Views that sit on the bar's top edge and move with the bar, frame by
   * frame, because they are inside the view the phone moves: a chat's round
   * "scroll to the end" button. They take no room: they are laid over what
   * is above the bar, stacked up from its top, across its width. Touches
   * that miss them go to what is under them.
   */
  overBar?: ReadonlyArray<Html>
  /**
   * Lay the bar over the bottom of `above` and leave `above` alone. The list
   * with this id (one with `keyboardInset`) is told about the keyboard and
   * the bar's height. See INSET at the top of this file.
   */
  inset?: Readonly<{ listId: string }>
}>

/**
 * What rides on a bar's top edge: from the bar's top up, as wide as the bar,
 * out of the layout. On iOS a view outside its parent's frame still takes
 * touches when the parent's own layout reaches past it, which this does.
 */
export const overBarView = (children: ReadonlyArray<Html>): Html =>
  box(
    [
      prop('pointerEvents', 'box-none'),
      style({ position: 'absolute', left: 0, right: 0, bottom: '100%' }),
    ] as never,
    children as never,
  )

/** See the top of this file. */
export const keyboardDock = <Message>(
  _h: HtmlBuilder<Message>,
  config: KeyboardDock,
): Html => {
  const isNative = keyboardDockMode() === 'native'
  const background =
    config.backgroundColor === undefined
      ? []
      : [style({ backgroundColor: config.backgroundColor })]

  // Measured to learn how high the bar's content already stands.
  const content = box(
    [prop('collapsable', false), prop('nativeID', DOCK_CONTENT_ID)] as never,
    config.children as never,
  )
  // The view the phone moves. Its safe area view pads the home indicator's
  // strip, which the keyboard covers once it is up. What rides on the bar is
  // its second child, out of the layout.
  const bar = box([prop('collapsable', false), ...background] as never, [
    safeAreaView([prop('edges', BOTTOM_EDGE), style({ flex: 0 })] as never, [content]),
    ...(config.overBar === undefined ? [] : [overBarView(config.overBar)]),
  ])
  const controller = isNative
    ? controllerView([prop('enabled', true), style(OUT_OF_FLOW as never)] as never, [])
    : null
  const gesture = isNative ? gestureArea([style(OUT_OF_FLOW as never)] as never, []) : null
  // The module below writes this view's style. Nothing else may.
  //
  // This view and the one around it carry layout only: no color, no
  // listeners. The phone therefore makes no native view for them, and that
  // matters. On iOS a native view ignores touches outside its own frame, and
  // the bar is drawn far above where the layout has it once the keyboard is
  // up. With these two left out, the bar's nearest native parent is the
  // caller's own container, which is as tall as the screen area.
  const seat = box([], [controller, gesture, bar].filter(part => part !== null) as never)
  const insetListId =
    isNative && config.above !== undefined ? config.inset?.listId : undefined
  if (insetListId !== undefined) {
    // The content fills the whole area and the bar is laid over its bottom
    // edge. Neither view around the bar becomes a native view (see below),
    // so the bar still takes touches where it is drawn.
    const over = box(
      [style({ position: 'absolute', left: 0, right: 0, bottom: 0 })] as never,
      [seat],
    )
    const whole = box([style({ flex: 1 })] as never, [
      box([style({ flex: 1 })] as never, config.above as never),
      over,
    ])
    if (whole !== null) {
      const marker: Marker = {
        keyboardHeight: Math.max(0, config.keyboardHeight),
        offset: config.offset,
        isNative,
        hasAbove: true,
        insetListId,
      }
      ;(whole.data ??= {})[DOCK_DATA] = marker
      whole.key = 'keyboard-dock-inset'
    }
    return whole
  }
  const host = box([], [seat])

  // Also styled by the module alone. Kept as a real view, for the phone to move.
  const lift =
    config.above === undefined
      ? null
      : box([prop('collapsable', false)] as never, config.above as never)
  const outer =
    lift === null
      ? host
      : box(
          [style({ flex: 1 })] as never,
          [
            // Content that rises past the top is cut off here instead of
            // being drawn over what is above the dock.
            box([style({ flex: 1, overflow: 'hidden' })] as never, [lift]),
            host,
          ],
        )

  if (outer !== null) {
    const marker: Marker = {
      keyboardHeight: Math.max(0, config.keyboardHeight),
      offset: config.offset,
      isNative,
      hasAbove: lift !== null,
      insetListId: undefined,
    }
    ;(outer.data ??= {})[DOCK_DATA] = marker
    // The two modes are built from different views. If the mode is switched
    // while a dock is on screen, the dock is made again, not patched.
    outer.key = isNative ? 'keyboard-dock-native' : 'keyboard-dock-fallback'
  }
  return outer
}

/**
 * For the scroll view or list above a dock: dragging it puts the keyboard
 * away. In native mode the keyboard follows the finger down and the bar goes
 * with it. In fallback mode the keyboard leaves as the drag starts, because
 * there the bar could not follow a keyboard that is dragged.
 */
export const dismissKeyboardOnDrag = () =>
  prop('keyboardDismissMode', keyboardDockMode() === 'native' ? 'interactive' : 'on-drag')

/** A child element by its place. Text and gaps are not elements. */
const childAt = (vnode: VNode | undefined, index: number): VNode | undefined => {
  const child = vnode?.children?.[index]
  return child === undefined || typeof child === 'string' ? undefined : child
}

const nodeFor = (part: VNode | undefined): EngineNode | undefined =>
  part === undefined ? undefined : nodeOf(part)

/** The dock's elements, by the places `keyboardDock` puts them in. */
const partsOf = (outer: VNode, marker: Marker) => {
  const host = marker.hasAbove ? childAt(outer, 1) : outer
  const seat = childAt(host, 0)
  const bar = childAt(seat, marker.isNative ? 2 : 0)
  return {
    seat,
    bar,
    content: childAt(childAt(bar, 0), 0),
    controller: marker.isNative ? childAt(seat, 0) : undefined,
    gesture: marker.isNative ? childAt(seat, 1) : undefined,
    lift:
      marker.hasAbove && marker.insetListId === undefined
        ? childAt(childAt(outer, 0), 0)
        : undefined,
  }
}

const nodesOf = (outer: VNode, marker: Marker): DockParts => {
  const parts = partsOf(outer, marker)
  return {
    seat: nodeFor(parts.seat),
    bar: nodeFor(parts.bar),
    content: nodeFor(parts.content),
    controller: nodeFor(parts.controller),
    gesture: nodeFor(parts.gesture),
    lift: nodeFor(parts.lift),
  }
}

/**
 * The field in the bar, and the name the program gave it. react-native-
 * keyboard-controller's drag area finds a field by `nativeID`.
 */
const fieldIn = (contentVNode: VNode | undefined): DockField | undefined => {
  const find = (vnode: VNode | string | null | undefined): VNode | undefined => {
    if (vnode === null || vnode === undefined || typeof vnode === 'string') return undefined
    if (vnode.sel === 'text-input') return vnode
    for (const child of vnode.children ?? []) {
      const found = find(child as VNode | string)
      if (found !== undefined) return found
    }
    return undefined
  }
  const field = find(contentVNode)
  const node = field === undefined ? undefined : nodeOf(field)
  if (field === undefined || node === undefined) return undefined
  return { node, own: bagOf(field, 'props')['nativeID'] ?? bagOf(field, 'attrs')['nativeID'] }
}

const dockModule: ModuleFactory = (engine, afterCommit) => {
  const controller = makeDockController(engine, afterCommit)

  /**
   * Docks drawn for the first time in the draw now under way. An element is
   * announced before its children are made, and a dock is mostly children,
   * so each waits here until the whole draw is done.
   */
  const fresh: Array<VNode> = []

  return {
    create: (_empty, vnode) => {
      if (vnode.data?.[DOCK_DATA] !== undefined) fresh.push(vnode)
    },
    update: (_old, vnode) => {
      const marker = vnode.data?.[DOCK_DATA] as Marker | undefined
      const outer = nodeOf(vnode)
      if (marker === undefined || outer === undefined) return
      controller.update(outer, marker, () => fieldIn(partsOf(vnode, marker).content))
    },
    destroy: vnode => {
      if (vnode.data?.[DOCK_DATA] === undefined) return
      const outer = nodeOf(vnode)
      if (outer !== undefined) controller.destroy(outer)
    },
    // After the draw and before it is sent to the phone.
    post: () => {
      for (const vnode of fresh.splice(0)) {
        const marker = vnode.data?.[DOCK_DATA] as Marker | undefined
        const outer = nodeOf(vnode)
        if (marker === undefined || outer === undefined) continue
        const parts = partsOf(vnode, marker)
        controller.start(outer, marker, nodesOf(vnode, marker), fieldIn(parts.content))
      }
    },
  }
}

registerModule(dockModule)
