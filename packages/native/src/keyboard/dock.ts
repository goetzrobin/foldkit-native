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
 * There are two modes, chosen once per app (see `detect.ts`).
 *
 * NATIVE. react-native-keyboard-controller has a native view that reports
 * the keyboard's height on every frame, including while a finger drags the
 * keyboard down. None of that library's JavaScript is used. The engine
 * connects the reports to the bar's position on the native side, so the bar
 * moves with the keyboard and no JavaScript runs per frame. The approach is
 * ng-native's `keyboard-dock.ts`.
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
 * Android always uses the fallback. ng-native does not use
 * react-native-keyboard-controller there either: it has a native view of its
 * own for Android, in a package this project does not install.
 */
import {
  type Engine,
  type EngineNode,
  type ScrollDrive,
  type ScrollRange,
  registerViewName,
} from '@ng-native/fabric'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { type VNode, element } from 'foldkit/renderTarget'

import { prop, style } from '../attributes.js'
import { type ModuleFactory, registerModule } from '../extend.js'
import { bagOf, nodeOf } from '../modules.js'
import { keepMoving } from '../motion/clock.js'
import { keyboardDockMode, noteEngine } from './detect.js'

const el = element<any>()

const box = el('view')
const safeAreaView = el('screen-safe-area')
const controllerView = el('keyboard-controller-view')
const gestureArea = el('keyboard-gesture-area')

// react-native-keyboard-controller's two native views. Giving a tag a name
// does not need the view to exist. Only drawing one does, and the dock draws
// them in native mode alone.
registerViewName('keyboard-controller-view', 'KeyboardControllerView')
registerViewName('keyboard-gesture-area', 'KeyboardGestureArea')

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
}>

const DOCK_DATA = 'foldkitKeyboardDock'

/**
 * What the module below needs to know about one dock. It finds the dock's
 * views by their places under the marked element, which `keyboardDock` fixes.
 */
type Marker = Readonly<{
  keyboardHeight: number
  offset: number | undefined
  isNative: boolean
  hasAbove: boolean
}>

/** A native view the dock draws for itself, out of the way of the layout. */
const OUT_OF_FLOW = { position: 'absolute', width: 0, height: 0 } as const

const BOTTOM_EDGE = { top: false, right: false, bottom: true, left: false } as const

/** Found by the simulated phone's measuring. It has no effect on a real one. */
export const DOCK_CONTENT_ID = 'foldkit-keyboard-dock-content'

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
  // strip, which the keyboard covers once it is up.
  const bar = box([prop('collapsable', false), ...background] as never, [
    safeAreaView([prop('edges', BOTTOM_EDGE), style({ flex: 0 })] as never, [content]),
  ])
  const controller = isNative
    ? controllerView([prop('enabled', true), style(OUT_OF_FLOW as never)] as never, [])
    : null
  const gesture = isNative ? gestureArea([style(OUT_OF_FLOW as never)] as never, []) : null
  // The module below writes this view's style. Nothing else may.
  const seat = box([], [controller, gesture, bar].filter(part => part !== null) as never)
  const host = box(background as never, [seat])

  // Also styled by the module alone.
  const lift = config.above === undefined ? null : box([], config.above as never)
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
    }
    ;(outer.data ??= {})[DOCK_DATA] = marker
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

/** What carries the keyboard's height, frame by frame, in react-native-keyboard-controller. */
const KEYBOARD_FEED = {
  events: ['onKeyboardMove', 'onKeyboardMoveInteractive', 'onKeyboardMoveEnd'],
  path: ['height'],
} as const

/** Taller than any keyboard. The native side wants numbers, not infinity. */
const FAR = 10_000

/** The bar rises by the keyboard's height less what it already stands above. */
const rangeFor = (rest: number): ScrollRange => ({
  input: [rest, rest + FAR],
  output: [0, -FAR],
})

/** How the bar eases in fallback mode: about as long as the keyboard takes. */
const FALLBACK_MS = 250
const FALLBACK_TIMING = {
  paddingBottom: { duration: FALLBACK_MS, delay: 0, easing: [0.17, 0.59, 0.4, 0.77] },
} as const
const TRANSITION = '$transition'

type Dock = {
  outer: EngineNode
  marker: Marker
  seat: EngineNode
  bar: EngineNode
  content: EngineNode
  controller: EngineNode | undefined
  gesture: EngineNode | undefined
  lift: EngineNode | undefined
  /** How high the bar's content stands above the bottom of the window, measured. */
  measuredRest: number | undefined
  /** Native mode: the keyboard's height as the phone last reported it. */
  reported: number
  /** Fallback mode: how far the bar is padded up now, or null before the first time. */
  pad: number | null
  /** Fallback mode: no measuring before this time, because the bar is still easing. */
  quietAfter: number
  barDrive: ScrollDrive | null
  liftDrive: ScrollDrive | null
  /** The name the dock gave a field that had none. */
  givenFieldId: string | undefined
  /** The name the drag area was last told. */
  namedFieldId: string | undefined
  stops: Array<() => void>
  isAlive: boolean
}

type NativeEvent = Readonly<{
  nativeEvent?: { height?: number; layout?: { height?: number } }
}>

/** Engines since 0.25.0 have this. One without it gets the fallback. */
const canDrive = (engine: Engine): boolean =>
  (engine as { drivesScroll?: boolean }).drivesScroll === true &&
  typeof (engine as { driveByEvent?: unknown }).driveByEvent === 'function'

let fieldCount = 0

const dockModule: ModuleFactory = (engine, afterCommit) => {
  noteEngine(canDrive(engine))
  const docks = new Map<EngineNode, Dock>()

  /** A child element by its place. Text and gaps are not elements. */
  const childAt = (vnode: VNode | undefined, index: number): VNode | undefined => {
    const child = vnode?.children?.[index]
    return child === undefined || typeof child === 'string' ? undefined : child
  }

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
      lift: marker.hasAbove ? childAt(childAt(outer, 0), 0) : undefined,
    }
  }

  const nodeFor = (part: VNode | undefined): EngineNode | undefined =>
    part === undefined ? undefined : nodeOf(part)

  const restOf = (dock: Dock): number => dock.marker.offset ?? dock.measuredRest ?? 0

  /** The view that fills the window: the one the surface made under the root. */
  const windowView = (from: EngineNode): EngineNode => {
    let at = from
    for (;;) {
      const parent = engine.parentNode(at)
      if (parent === null || parent === engine.root) return at
      at = parent
    }
  }

  // ---- Fallback mode -------------------------------------------------

  const padFallback = (dock: Dock, isEased: boolean): void => {
    const pad = Math.max(0, dock.marker.keyboardHeight - restOf(dock))
    if (pad === dock.pad) return
    const isFirst = dock.pad === null
    dock.pad = pad
    const eases = isEased && !isFirst
    engine.setProp(dock.seat, TRANSITION, eases ? FALLBACK_TIMING : undefined)
    engine.setProp(dock.seat, 'style', { paddingBottom: pad })
    if (eases) dock.quietAfter = Date.now() + FALLBACK_MS * 2
  }

  // ---- Native mode ---------------------------------------------------

  /**
   * Once the phone says where the keyboard is going, the layout catches up,
   * so that the content above ends where the bar's top will be.
   *
   * Without `above`: the bar's seat grows by the covered height, which makes
   * the content above shorter, and is drawn lower by the same amount, which
   * leaves the bar where it was. One commit does both.
   *
   * With `above`: that content is padded by the covered height, and its
   * movement is shifted back down by as much. This is ng-native's rule, and
   * its reason is copied with it: since iOS 26 a scroll view that the
   * keyboard overlaps in the layout draws a frosted edge over that part.
   */
  const settleNative = (dock: Dock): void => {
    const covered = Math.max(0, dock.reported - restOf(dock))
    if (dock.lift !== undefined) {
      engine.setProp(dock.lift, 'style', { flex: 1, paddingBottom: covered })
      dock.liftDrive?.shift(covered)
    } else {
      engine.setProp(dock.seat, 'style', { paddingBottom: covered, top: covered })
    }
  }

  const startNative = (dock: Dock): void => {
    const controller = dock.controller
    if (controller === undefined) return
    const range = rangeFor(restOf(dock))
    dock.barDrive = engine.driveByEvent(dock.bar, controller, KEYBOARD_FEED, 'translateY', range)
    if (dock.lift !== undefined) {
      dock.liftDrive = engine.driveByEvent(
        dock.lift,
        controller,
        KEYBOARD_FEED,
        'translateY',
        range,
        [],
        0,
      )
    }
    const moved = (event: unknown): void => {
      const height = (event as NativeEvent | undefined)?.nativeEvent?.height
      if (!dock.isAlive || typeof height !== 'number') return
      dock.reported = height
      settleNative(dock)
      engine.commit()
    }
    dock.stops.push(
      // The start says where the keyboard is going, the end where it stopped.
      engine.setEventListener(controller, 'topKeyboardMoveStart', moved),
      engine.setEventListener(controller, 'topKeyboardMoveEnd', moved),
    )
  }

  /**
   * The field in the bar, by name. react-native-keyboard-controller's drag
   * area finds it by `nativeID`, so a field without one is given one.
   */
  const nameField = (dock: Dock, contentVNode: VNode | undefined): void => {
    if (dock.gesture === undefined) return
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
    if (field === undefined || node === undefined) return
    const own = bagOf(field, 'props')['nativeID'] ?? bagOf(field, 'attrs')['nativeID']
    let id = typeof own === 'string' && own !== '' ? own : undefined
    if (id === undefined) {
      id = dock.givenFieldId ?? `foldkit-keyboard-field-${++fieldCount}`
      if (id !== dock.givenFieldId) engine.setProp(node, 'nativeID', id)
      dock.givenFieldId = id
    }
    if (id === dock.namedFieldId) return
    dock.namedFieldId = id
    engine.setProp(dock.gesture, 'textInputNativeID', id)
  }

  // ---- Both modes ----------------------------------------------------

  const isKeyboardDown = (dock: Dock): boolean =>
    dock.controller !== undefined
      ? dock.reported === 0
      : dock.marker.keyboardHeight === 0 && (dock.pad ?? 0) === 0 && Date.now() >= dock.quietAfter

  const useRest = (dock: Dock): void => {
    if (dock.controller === undefined) {
      padFallback(dock, false)
      return
    }
    const range = rangeFor(restOf(dock))
    dock.barDrive?.update(range)
    dock.liftDrive?.update(range)
  }

  /**
   * How far the bottom of the bar's content is from the bottom of the window,
   * while the keyboard is down. That is how much of the keyboard's height
   * the bar does not need to rise by.
   */
  const measureRest = (dock: Dock): void => {
    if (!dock.isAlive || dock.marker.offset !== undefined || !isKeyboardDown(dock)) return
    let windowBottom: number | undefined
    let contentBottom: number | undefined
    const use = (): void => {
      if (windowBottom === undefined || contentBottom === undefined || !dock.isAlive) return
      const rest = Math.max(0, Math.round(windowBottom - contentBottom))
      if (rest === dock.measuredRest) return
      dock.measuredRest = rest
      useRest(dock)
      engine.commit()
    }
    engine.measure(windowView(dock.outer), frame => {
      windowBottom = frame.y + frame.height
      use()
    })
    engine.measure(dock.content, frame => {
      contentBottom = frame.y + frame.height
      use()
    })
  }

  /**
   * Docks drawn for the first time in the draw now under way. An element is
   * announced before its children are made, and a dock is mostly children,
   * so each waits here until the whole draw is done.
   */
  const fresh: Array<VNode> = []

  const create = (_empty: VNode, vnode: VNode): void => {
    if (vnode.data?.[DOCK_DATA] !== undefined) fresh.push(vnode)
  }

  const start = (vnode: VNode): void => {
    const marker = vnode.data?.[DOCK_DATA] as Marker | undefined
    const outer = nodeOf(vnode)
    if (marker === undefined || outer === undefined) return
    const parts = partsOf(vnode, marker)
    const seat = nodeFor(parts.seat)
    const bar = nodeFor(parts.bar)
    const content = nodeFor(parts.content)
    if (seat === undefined || bar === undefined || content === undefined) return
    const dock: Dock = {
      outer,
      marker,
      seat,
      bar,
      content,
      controller: nodeFor(parts.controller),
      gesture: nodeFor(parts.gesture),
      lift: nodeFor(parts.lift),
      measuredRest: undefined,
      reported: 0,
      pad: null,
      quietAfter: 0,
      barDrive: null,
      liftDrive: null,
      givenFieldId: undefined,
      namedFieldId: undefined,
      stops: [],
      isAlive: true,
    }
    docks.set(outer, dock)
    if (dock.lift !== undefined) engine.setProp(dock.lift, 'style', { flex: 1 })
    if (dock.controller !== undefined) startNative(dock)
    // A keyboard that is already up puts the bar in place with no easing.
    else padFallback(dock, false)
    nameField(dock, parts.content)
    dock.stops.push(
      engine.setEventListener(dock.content, 'topLayout', event => {
        const height = (event as NativeEvent | undefined)?.nativeEvent?.layout?.height
        // A drag takes the keyboard from the top of the bar, as Messages does.
        if (dock.gesture !== undefined && typeof height === 'number') {
          engine.setProp(dock.gesture, 'offset', height)
        }
        measureRest(dock)
      }),
      // A rotation moves the bar without changing its content's size.
      engine.setEventListener(dock.seat, 'topLayout', () => measureRest(dock)),
    )
    // The first measurement needs the views to be on the phone.
    afterCommit(() => measureRest(dock))
  }

  const update = (_old: VNode, vnode: VNode): void => {
    const marker = vnode.data?.[DOCK_DATA] as Marker | undefined
    const outer = nodeOf(vnode)
    const dock = outer === undefined ? undefined : docks.get(outer)
    if (marker === undefined || dock === undefined) return
    const before = dock.marker
    dock.marker = marker
    if (dock.controller === undefined) {
      padFallback(dock, true)
      // The draw that follows starts the easing. Frames must then keep coming.
      afterCommit(() => keepMoving(engine))
    } else if (before.offset !== marker.offset) {
      useRest(dock)
      settleNative(dock)
    }
    // The bar's children are drawn after this runs, so look once they are.
    afterCommit(() => {
      if (!dock.isAlive) return
      nameField(dock, partsOf(vnode, marker).content)
      if (before.offset !== marker.offset) measureRest(dock)
    })
  }

  const destroy = (vnode: VNode): void => {
    if (vnode.data?.[DOCK_DATA] === undefined) return
    const outer = nodeOf(vnode)
    const dock = outer === undefined ? undefined : docks.get(outer)
    if (outer === undefined || dock === undefined) return
    dock.isAlive = false
    docks.delete(outer)
    dock.barDrive?.stop()
    dock.liftDrive?.stop()
    for (const stop of dock.stops.splice(0)) stop()
  }

  // After the draw and before it is sent to the phone.
  const post = (): void => {
    for (const vnode of fresh.splice(0)) start(vnode)
  }

  return { create, update, destroy, post }
}

registerModule(dockModule)
