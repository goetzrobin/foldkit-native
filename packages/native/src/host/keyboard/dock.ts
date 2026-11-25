/**
 * What a keyboard dock does between draws: the bar that sits on top of the
 * keyboard, in its three ways (native, fallback, inset). The element the
 * program draws, and why the dock is laid out as it is, are explained in the
 * binding's `src/foldkit/keyboard/dock.ts`, which finds the dock's views and
 * calls the controller here.
 *
 * NATIVE. react-native-keyboard-controller has a native view that reports
 * the keyboard's height on every frame, including while a finger drags the
 * keyboard down. None of that library's JavaScript is used. React Native's
 * animation module connects the reports to the bar's position on the native
 * side (see `drive.ts`), so the bar moves with the keyboard and no JavaScript
 * runs per frame. The approach is ng-native's `keyboard-dock.ts`.
 *
 * FALLBACK. The program passes the keyboard's height from its Model. The bar
 * is padded up by that much, eased over a quarter of a second.
 *
 * INSET. The bar lies over the content, and the list named by the marker is
 * told when the keyboard starts and stops (`tellListKeyboard`).
 */
import {
  type Engine,
  type EngineNode,
  type ScrollDrive,
  type ScrollRange,
  registerViewName,
} from '@ng-native/fabric'

import type { AfterCommit } from '../fabric/registry.js'
import { tellListKeyboard } from '../list/controller.js'
import { keepMoving } from '../motion/clock.js'
import { dockAnimated, noteEngine } from './detect.js'
import { type EventDrive, driveByEvent } from './drive.js'
import { restUnderBar } from './geometry.js'

// react-native-keyboard-controller's two native views. Giving a tag a name
// does not need the view to exist. Only drawing one does, and the dock draws
// them in native mode alone.
export const KEYBOARD_CONTROLLER_TAG = 'keyboard-controller-view'
export const KEYBOARD_GESTURE_TAG = 'keyboard-gesture-area'
registerViewName(KEYBOARD_CONTROLLER_TAG, 'KeyboardControllerView')
registerViewName(KEYBOARD_GESTURE_TAG, 'KeyboardGestureArea')

/** Where a dock's element carries its `Marker`. */
export const DOCK_DATA = 'foldkitKeyboardDock'

/**
 * What the controller below needs to know about one dock. The binding finds
 * the dock's views by their places under the marked element, which its
 * `keyboardDock` fixes.
 */
export type Marker = Readonly<{
  keyboardHeight: number
  offset: number | undefined
  isNative: boolean
  hasAbove: boolean
  /** The list to tell, when the bar lies over the content. */
  insetListId: string | undefined
}>

/** A native view the dock draws for itself, out of the way of the layout. */
export const OUT_OF_FLOW = { position: 'absolute', width: 0, height: 0 } as const

export const BOTTOM_EDGE = { top: false, right: false, bottom: true, left: false } as const

/** Found by the simulated phone's measuring. It has no effect on a real one. */
export const DOCK_CONTENT_ID = 'foldkit-keyboard-dock-content'

/** A dock's own views, found by the binding. */
export type DockParts = Readonly<{
  seat: EngineNode | undefined
  bar: EngineNode | undefined
  /** The view around the bar's children, measured. */
  content: EngineNode | undefined
  /** Native mode: react-native-keyboard-controller's two views. */
  controller: EngineNode | undefined
  gesture: EngineNode | undefined
  /** The view around `above` that the phone moves, when there is one. */
  lift: EngineNode | undefined
}>

/** The text field in the bar, and the `nativeID` the program gave it, if any. */
export type DockField = Readonly<{ node: EngineNode; own: unknown }>

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
  /** How tall the bar's content is, once the phone has said. */
  contentHeight: number | undefined
  /** How tall the bar is, its safe area padding included, once the phone has said. */
  barHeight: number | undefined
  /** The strip under the content the bar and the list were last given. See `restOf`. */
  usedRest: number | undefined
  /** Inset: a finger is dragging the keyboard, and the list has been told. */
  isDragged: boolean
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
  /** Drives this file built itself, which connect once the views are on the phone. */
  ownDrives: Array<EventDrive>
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

/**
 * The dock's behaviour between draws, for every dock on one surface. The
 * binding finds each dock's views and calls `start` once the draw that made
 * it is done, `update` when it is drawn again, and `destroy` when it goes.
 */
export const makeDockController = (engine: Engine, afterCommit: AfterCommit) => {
  noteEngine(canDrive(engine))
  const docks = new Map<EngineNode, Dock>()

  /** The strip under the bar's content that the keyboard covers anyway. See `geometry.ts`. */
  const restOf = (dock: Dock): number =>
    restUnderBar({
      offset: dock.marker.offset,
      measured: dock.measuredRest,
      barHeight: dock.barHeight,
      contentHeight: dock.contentHeight,
    })

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
    // With an inset nothing is laid out again: the list makes its own room.
    if (dock.marker.insetListId !== undefined) return
    const covered = Math.max(0, dock.reported - restOf(dock))
    if (dock.lift !== undefined) {
      engine.setProp(dock.lift, 'style', { flex: 1, paddingBottom: covered })
      dock.liftDrive?.shift(covered)
    } else {
      engine.setProp(dock.seat, 'style', { paddingBottom: covered, top: covered })
    }
  }

  /** The native tag a view was sent to the phone with, or null before that. */
  const tagOf = (node: EngineNode): number | null =>
    (engine as { tagOf?: (node: EngineNode) => number | null }).tagOf?.(node) ??
    (node as { committed?: { tag?: number } | null }).committed?.tag ??
    null

  /**
   * Has the phone move `view` by the keyboard's height. The engine does it
   * when it was started with the animation module. Otherwise the module the
   * app handed to the dock does. See `drive.ts`.
   */
  const drive = (
    dock: Dock,
    view: EngineNode,
    controller: EngineNode,
    range: ScrollRange,
    shift: number | null,
  ): ScrollDrive | null => {
    if (canDrive(engine)) {
      return engine.driveByEvent(view, controller, KEYBOARD_FEED, 'translateY', range, [], shift)
    }
    const native = dockAnimated()
    if (native === null) return null
    const own = driveByEvent(
      native,
      () => {
        const [viewTag, sourceTag] = [tagOf(view), tagOf(controller)]
        return viewTag === null || sourceTag === null ? null : { view: viewTag, source: sourceTag }
      },
      KEYBOARD_FEED,
      range,
      shift,
    )
    dock.ownDrives.push(own)
    return own
  }

  const startNative = (dock: Dock): void => {
    const controller = dock.controller
    if (controller === undefined) return
    const range = rangeFor(restOf(dock))
    dock.barDrive = drive(dock, dock.bar, controller, range, null)
    if (dock.lift !== undefined) dock.liftDrive = drive(dock, dock.lift, controller, range, 0)
    const moved =
      (phase: 'start' | 'end') =>
      (event: unknown): void => {
        const height = (event as NativeEvent | undefined)?.nativeEvent?.height
        if (!dock.isAlive || typeof height !== 'number') return
        dock.reported = height
        const listId = dock.marker.insetListId
        if (listId !== undefined) {
          if (phase === 'end') dock.isDragged = false
          // The list commits what it changes, and scrolls after that.
          tellListKeyboard(listId, { type: phase, height })
          return
        }
        settleNative(dock)
        engine.commit()
      }
    dock.stops.push(
      // The start says where the keyboard is going, the end where it stopped.
      engine.setEventListener(controller, 'topKeyboardMoveStart', moved('start')),
      engine.setEventListener(controller, 'topKeyboardMoveEnd', moved('end')),
    )
    if (dock.marker.insetListId !== undefined) {
      dock.stops.push(
        // Sent on every frame of a drag on the keyboard. The first one of a
        // drag is passed on, as a flag and no more. The rest do nothing.
        engine.setEventListener(controller, 'topKeyboardMoveInteractive', () => {
          const listId = dock.marker.insetListId
          if (!dock.isAlive || dock.isDragged || listId === undefined) return
          dock.isDragged = true
          tellListKeyboard(listId, { type: 'interactive' })
        }),
      )
    }
  }

  /**
   * The field in the bar, by name. react-native-keyboard-controller's drag
   * area finds it by `nativeID`, so a field without one is given one.
   */
  const nameField = (dock: Dock, field: DockField | undefined): void => {
    if (dock.gesture === undefined) return
    if (field === undefined) return
    const { node, own } = field
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

  /** Inset: the list makes room for the bar, so it is told how tall the bar is. */
  const tellBar = (dock: Dock): void => {
    const listId = dock.marker.insetListId
    if (listId === undefined || dock.contentHeight === undefined) return
    const rest = restOf(dock)
    tellListKeyboard(listId, { type: 'bar', height: dock.contentHeight + rest, rest })
  }

  const useRest = (dock: Dock): void => {
    dock.usedRest = restOf(dock)
    if (dock.controller === undefined) {
      padFallback(dock, false)
      return
    }
    tellBar(dock)
    const range = rangeFor(restOf(dock))
    dock.barDrive?.update(range)
    dock.liftDrive?.update(range)
  }

  /** Gives the bar and the list the strip under the content, when a new reading changed it. */
  const refreshRest = (dock: Dock): boolean => {
    if (!dock.isAlive || restOf(dock) === dock.usedRest) return false
    useRest(dock)
    return true
  }

  /**
   * How far the bottom of the bar's content is from the bottom of the window,
   * while the keyboard is down. That is how much of the keyboard's height
   * the bar does not need to rise by. One reading of two: see `restOf`.
   */
  const measureRest = (dock: Dock): void => {
    if (!dock.isAlive || dock.marker.offset !== undefined || !isKeyboardDown(dock)) return
    let windowBottom: number | undefined
    let contentBottom: number | undefined
    const use = (): void => {
      if (windowBottom === undefined || contentBottom === undefined || !dock.isAlive) return
      dock.measuredRest = Math.max(0, Math.round(windowBottom - contentBottom))
      if (refreshRest(dock)) engine.commit()
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

  /** A dock whose whole draw is done: its views exist. */
  const start = (
    outer: EngineNode,
    marker: Marker,
    parts: DockParts,
    field: DockField | undefined,
  ): void => {
    const { seat, bar, content } = parts
    if (seat === undefined || bar === undefined || content === undefined) return
    const dock: Dock = {
      outer,
      marker,
      seat,
      bar,
      content,
      controller: parts.controller,
      gesture: parts.gesture,
      lift: parts.lift,
      measuredRest: undefined,
      reported: 0,
      contentHeight: undefined,
      barHeight: undefined,
      usedRest: undefined,
      isDragged: false,
      pad: null,
      quietAfter: 0,
      barDrive: null,
      liftDrive: null,
      givenFieldId: undefined,
      namedFieldId: undefined,
      ownDrives: [],
      stops: [],
      isAlive: true,
    }
    docks.set(outer, dock)
    if (dock.lift !== undefined) engine.setProp(dock.lift, 'style', { flex: 1 })
    if (dock.controller !== undefined) startNative(dock)
    // A keyboard that is already up puts the bar in place with no easing.
    else padFallback(dock, false)
    dock.usedRest = restOf(dock)
    nameField(dock, field)
    dock.stops.push(
      engine.setEventListener(dock.content, 'topLayout', event => {
        const height = (event as NativeEvent | undefined)?.nativeEvent?.layout?.height
        // A drag takes the keyboard from the top of the bar, as Messages does.
        if (dock.gesture !== undefined && typeof height === 'number') {
          engine.setProp(dock.gesture, 'offset', height)
        }
        if (typeof height === 'number') {
          dock.contentHeight = height
          tellBar(dock)
          if (refreshRest(dock)) engine.commit()
        }
        measureRest(dock)
      }),
      // The bar is its content and the safe area view's padding under it. On
      // an iPhone that padding arrives after the first layout, and the
      // content's own layout does not change when it does: the bar's does.
      engine.setEventListener(dock.bar, 'topLayout', event => {
        const height = (event as NativeEvent | undefined)?.nativeEvent?.layout?.height
        if (typeof height !== 'number' || height === dock.barHeight) return
        dock.barHeight = height
        if (refreshRest(dock)) engine.commit()
        measureRest(dock)
      }),
    )
    // Connecting and the first measurement need the views to be on the phone.
    afterCommit(() => {
      for (const own of dock.ownDrives) own.connect()
      measureRest(dock)
    })
  }

  /** A dock drawn again. `field` finds its text field once the draw is done. */
  const update = (
    outer: EngineNode,
    marker: Marker,
    field: () => DockField | undefined,
  ): void => {
    const dock = docks.get(outer)
    if (dock === undefined) return
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
      // A list made again since the last time hears the bar's height anew.
      tellBar(dock)
      nameField(dock, field())
      if (before.offset !== marker.offset) measureRest(dock)
    })
  }

  const destroy = (outer: EngineNode): void => {
    const dock = docks.get(outer)
    if (dock === undefined) return
    dock.isAlive = false
    docks.delete(outer)
    dock.barDrive?.stop()
    dock.liftDrive?.stop()
    for (const stop of dock.stops.splice(0)) stop()
  }

  return { start, update, destroy }
}

export type DockController = ReturnType<typeof makeDockController>
