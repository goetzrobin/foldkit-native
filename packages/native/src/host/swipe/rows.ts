/**
 * What happens to a swipe row after it is drawn: the finger, the motion,
 * and the events. This is the part that runs between draws.
 *
 * One record per row holds where the row rests (closed, or open on a side)
 * and joins the row to its group. Then one of two drivers moves it:
 *
 * - `javascript`: this file reads the touch through the adapter's own touch
 *   handling, works out where the row and each tile are with the rules in
 *   `core.ts`, and sets them on the views, a commit per finger movement and
 *   a commit per frame while the row springs to rest.
 * - `ui-thread`: the worklets in `uiSide.ts` do all of that on the phone's
 *   UI thread. This file only hears what they send back.
 *
 * Both share everything else here: tapping a tile, tapping away to close,
 * closing when the list scrolls, the screen reader's actions, and cleaning
 * up when the row's view goes.
 *
 * How a touch is shared with what is inside the row (JavaScript driver):
 * the row never asks for a touch when it starts, so a button in the row is
 * pressed as usual. As the finger moves, the row is asked again on every
 * movement. Once the finger has gone more than a few points sideways, and
 * more sideways than up or down, the row takes the touch, which calls the
 * button's press off. A finger that first goes up or down is the list's
 * for the rest of that touch.
 */
import type { EngineNode, ResponderEvent, ResponderHandlers } from '@ng-native/fabric'
import type { VNode } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../../foldkit/extend.js'
import { type Handler, customEvent, handlersByNode, nodeOf } from '../fabric/nodes.js'
import { onNextFrame } from '../motion/clock.js'
import { listenToChannel, runOnUi, writeShared } from '../../foldkit/worklets/index.js'
import {
  FULL_SPRING,
  type Limits,
  REST_SPRING,
  armedSide,
  awayAt,
  decide,
  dragTo,
  restAt,
  slidesAway,
  springStep,
  tileInput,
  tileProps,
} from './core.js'
import { type SwipeMember, closeOtherSwipes, joinSwipeGroup } from './group.js'
import { type BuiltInKind, type Stage, countOf, dropStage, limitsOf } from './stage.js'
import {
  SWIPE_ARMED,
  SWIPE_CLOSED,
  SWIPE_OPENED,
  SWIPE_TRIGGERED,
  type SwipeSide,
  type SwipeSideSpec,
} from './types.js'
import { closeOnUi } from './uiSide.js'

export const ROW_DATA = 'foldkitSwipeRow'
export const PART_DATA = 'foldkitSwipePart'

type PartData = Readonly<{ stage: Stage; part: string }>

/** How far a finger may drift, in points, and still count as a tap. */
const TAP_SLOP = 10
/** How far sideways before a touch is a swipe, and how far up or down before it is a scroll. */
const SWIPE_AFTER = 10
/** A list that has scrolled this far since the row opened closes the row. */
const SCROLL_CLOSES_AFTER = 4
/** The finger's speed is measured over this long, in milliseconds. */
const SPEED_WINDOW_MS = 100

type Touch = {
  x0: number
  y0: number
  decided: 'none' | 'swipe' | 'scroll'
  /** Whether the finger went far enough that this is not a tap. */
  hasMoved: boolean
  /** `s` minus the finger's movement, noted when the drag began. */
  base: number
  samples: Array<Readonly<{ x: number; ms: number }>>
}

type Row = {
  readonly node: EngineNode
  stage: Stage
  kind: BuiltInKind
  isAlive: boolean
  limits: Limits
  width: number
  height: number
  /** Where the row rests: 0 closed, 1 open on the leading side, -1 trailing. */
  rest: number
  /** Whether the program was told the row opened, and so must hear it close. */
  isAnnounced: boolean
  /** The row slid off after a destructive full swipe. */
  isAway: boolean
  isDragging: boolean
  touch: Touch | null
  // The JavaScript driver's motion. See `core.ts` for `s`.
  s: number
  velocity: number
  target: number | null
  full: number
  fullVelocity: number
  fullTarget: number
  armed: number
  isFrameAsked: boolean
  lastFrameMs: number
  whenSettled: (() => void) | null
  member: SwipeMember
  stops: Array<() => void>
  scroll: EngineNode | null
  /** Where the list was when it was first seen to scroll after the row opened. */
  scrollStart: number | null
  stopChannel: () => void
  /** The UI thread values that were last told this row's limits. */
  sentLimitsTo: object | null
  channelOf: object | null
  handlers: ResponderHandlers
}

const sideName = (side: number): SwipeSide => (side > 0 ? 'leading' : 'trailing')

const sideOf = (row: Row, side: number): SwipeSideSpec<any> | null =>
  side > 0 ? row.stage.spec.leading : row.stage.spec.trailing

const pointOf = (event: ResponderEvent): Readonly<{ x: number; y: number; ms: number }> => {
  const native = event?.nativeEvent
  return {
    x: native?.pageX ?? 0,
    y: native?.pageY ?? 0,
    ms: typeof native?.timestamp === 'number' ? native.timestamp : Date.now(),
  }
}

/** The row a touch that is starting now landed on, if any. Read by the tap-away listener. */
let touchedRow: Row | null = null

/** The rows of every surface, by stage, so a tile's press can find its row. */
const rowOf = (stage: Stage): Row | null => stage.row as Row | null

/** Set by the module of the surface that owns the row. */
const tilePresses = new WeakMap<Row, (side: SwipeSide, index: number) => void>()

/** A tile was pressed. Called from the tile's own press handler in `row.ts`. */
export const pressTile = (stage: Stage, side: SwipeSide, index: number): void => {
  const row = rowOf(stage)
  if (row !== null) tilePresses.get(row)?.(side, index)
}

const swipeModule: ModuleFactory = engine => {
  const rows = new Map<EngineNode, Row>()
  const changed = new Set<Row>()
  /** What was last set on each moving view, as text, so nothing is set twice. */
  const applied = new WeakMap<EngineNode, string>()
  const scrollListeners = new Map<EngineNode, Readonly<{ stop: () => void; rows: Set<Row> }>>()
  let stopTapAway: (() => void) | null = null

  const emit = (row: Row, name: string, detail: object): void => {
    if (!row.isAlive) return
    const handler = handlersByNode.get(row.node)?.[name] as Handler | undefined
    handler?.(customEvent(name, detail))
  }

  // THE JAVASCRIPT DRIVER'S MOTION

  const setOn = (node: EngineNode | null | undefined, props: Readonly<Record<string, unknown>>): boolean => {
    if (node === null || node === undefined) return false
    const text = JSON.stringify(props)
    if (applied.get(node) === text) return false
    applied.set(node, text)
    for (const name in props) engine.setProp(node, name, props[name])
    return true
  }

  /** Puts the content and every tile where `row.s` says. Answers whether anything changed. */
  const place = (row: Row): boolean => {
    const { stage, limits } = row
    let hasChanged = setOn(stage.content, { transform: [{ translateX: limits.dir * row.s }] })
    for (const side of [1, -1]) {
      const count = countOf(sideOf(row, side))
      for (let index = 0; index < count; index++) {
        const input = tileInput(side, index, count, row.s, row.full, limits)
        const props = tileProps(stage.spec.style.tile(input), side * limits.dir, input.reveal)
        if (setOn(stage.tiles.get(`${sideName(side)}:${index}`), props)) hasChanged = true
      }
    }
    return hasChanged
  }

  const show = (row: Row): void => {
    if (place(row)) engine.commit()
  }

  const frame = (row: Row): void => {
    row.isFrameAsked = false
    if (!row.isAlive || row.kind !== 'javascript') return
    const now = Date.now()
    // Between a short frame and a long one, so a stalled clock cannot make a jump.
    const seconds = Math.min(Math.max(now - row.lastFrameMs, 8), 64) / 1000
    row.lastFrameMs = now
    let isMoving = false
    let hasSettled = false
    if (row.target !== null) {
      const next = springStep(row.s, row.velocity, row.target, seconds, REST_SPRING)
      row.s = next.position
      row.velocity = next.velocity
      if (next.isAtRest) {
        row.target = null
        hasSettled = true
      } else isMoving = true
    }
    if (row.full !== row.fullTarget) {
      const next = springStep(row.full, row.fullVelocity, row.fullTarget, seconds, FULL_SPRING)
      row.full = next.position
      row.fullVelocity = next.velocity
      if (!next.isAtRest) isMoving = true
    }
    show(row)
    if (hasSettled) {
      const then = row.whenSettled
      row.whenSettled = null
      then?.()
    }
    if (isMoving) askFrame(row)
  }

  const askFrame = (row: Row): void => {
    if (row.isFrameAsked) return
    row.isFrameAsked = true
    row.lastFrameMs = Date.now() - 16
    onNextFrame(engine, () => frame(row))
  }

  /** Sends the row to `to`: a spring, or a jump when the user asked for less motion. */
  const moveTo = (
    row: Row,
    to: number,
    velocity: number,
    isAnimated: boolean,
    then?: () => void,
  ): void => {
    row.whenSettled = null
    if (!isAnimated || row.limits.reduceMotion) {
      row.s = to
      row.velocity = 0
      row.target = null
      row.full = row.fullTarget
      row.fullVelocity = 0
      show(row)
      then?.()
      return
    }
    row.target = to
    row.velocity = velocity
    row.whenSettled = then ?? null
    askFrame(row)
  }

  const setFull = (row: Row, to: number): void => {
    row.fullTarget = to
    if (row.limits.reduceMotion) {
      row.full = to
      row.fullVelocity = 0
    } else if (row.full !== to) askFrame(row)
  }

  // WHAT BOTH DRIVERS SHARE

  const isOpen = (row: Row): boolean =>
    row.rest !== 0 || row.isDragging || (row.kind === 'javascript' && (row.s !== 0 || row.target !== null))

  /** Notes where the row rests now and tells the program and the group. */
  const setRest = (row: Row, rest: number, isAway = false): void => {
    const before = row.rest
    row.rest = rest
    row.isAway = isAway
    row.scrollStart = null
    if (rest !== 0 && !isAway && (before !== rest || !row.isAnnounced)) {
      row.isAnnounced = true
      closeOtherSwipes(row.member)
      emit(row, SWIPE_OPENED, { side: sideName(rest) })
    }
    if (rest === 0 && row.isAnnounced) {
      row.isAnnounced = false
      emit(row, SWIPE_CLOSED, {})
    }
  }

  const trigger = (row: Row, side: number, index: number, isFullSwipe: boolean): void => {
    const given = sideOf(row, side)
    if (given === null || given.kind !== 'actions' || row.stage.spec.style.passive) return
    const action = given.actions[index]
    if (action === undefined) return
    emit(row, SWIPE_TRIGGERED, { key: action.key, side: sideName(side), isFullSwipe })
  }

  const close = (row: Row, isAnimated: boolean): void => {
    if (!row.isAlive) return
    row.isDragging = false
    row.touch = null
    row.armed = 0
    if (row.kind === 'ui-thread') {
      const ui = row.stage.ui
      if (ui !== null) runOnUi(closeOnUi, ui.values, isAnimated)
    } else {
      row.fullTarget = 0
      moveTo(row, 0, 0, isAnimated)
    }
    setRest(row, 0)
  }

  const onTilePress = (row: Row, side: SwipeSide, index: number): void => {
    trigger(row, side === 'leading' ? 1 : -1, index, false)
    close(row, true)
  }

  const onAccessibilityAction = (row: Row, name: unknown): void => {
    for (const side of [1, -1]) {
      const given = sideOf(row, side)
      if (given === null || given.kind !== 'actions') continue
      const index = given.actions.findIndex(action => action.key === name)
      if (index < 0) continue
      trigger(row, side, index, false)
      close(row, false)
      return
    }
  }

  // THE FINGER (JAVASCRIPT DRIVER), AND THE TAP THAT CLOSES AN OPEN ROW

  const isOnTile = (row: Row, target: EngineNode): boolean => {
    const tiles = new Set(row.stage.tiles.values())
    for (let at: EngineNode | null = target; at !== null && at !== row.node; at = engine.parentNode(at)) {
      if (tiles.has(at)) return true
    }
    return false
  }

  const hasSides = (row: Row): boolean => row.limits.leadingOpen > 0 || row.limits.trailingOpen > 0

  /** Follows the finger and answers whether this touch is a swipe the row should take. */
  const follow = (row: Row, event: ResponderEvent): boolean => {
    const at = pointOf(event)
    const touch = (row.touch ??= { x0: at.x, y0: at.y, decided: 'none', hasMoved: false, base: 0, samples: [] })
    const dx = Math.abs(at.x - touch.x0)
    const dy = Math.abs(at.y - touch.y0)
    if (Math.hypot(dx, dy) > TAP_SLOP) touch.hasMoved = true
    if (row.kind !== 'javascript' || !hasSides(row)) return false
    if (touch.decided === 'none') {
      if (dy > SWIPE_AFTER && dy >= dx) touch.decided = 'scroll'
      else if (dx > SWIPE_AFTER && dx > dy) {
        touch.decided = 'swipe'
        // From here the list must not scroll under the finger.
        row.handlers.blockNativeResponder = true
      }
    }
    return touch.decided === 'swipe'
  }

  const beginDrag = (row: Row, event: ResponderEvent): void => {
    const touch = row.touch
    if (touch === null || row.isDragging) return
    row.isDragging = true
    row.isAway = false
    // The row carries on from where it is, even in the middle of a spring.
    row.target = null
    row.velocity = 0
    row.whenSettled = null
    touch.base = row.s - row.limits.dir * (pointOf(event).x - touch.x0)
    closeOtherSwipes(row.member)
  }

  const drag = (row: Row, event: ResponderEvent): void => {
    const touch = row.touch
    if (touch === null) return
    const at = pointOf(event)
    touch.samples.push({ x: at.x, ms: at.ms })
    if (touch.samples.length > 12) touch.samples.shift()
    row.s = dragTo(touch.base + row.limits.dir * (at.x - touch.x0), row.limits)
    const armed = armedSide(row.s, row.limits)
    if (armed !== row.armed) {
      const side = armed !== 0 ? armed : row.armed
      row.armed = armed
      setFull(row, armed === 0 ? 0 : 1)
      emit(row, SWIPE_ARMED, { isArmed: armed !== 0, side: sideName(side) })
    }
    show(row)
  }

  /** The finger's speed at the end, in points a second, the same way round as `s`. */
  const speedOf = (row: Row, touch: Touch): number => {
    const last = touch.samples[touch.samples.length - 1]
    if (last === undefined) return 0
    const first = touch.samples.find(sample => last.ms - sample.ms <= SPEED_WINDOW_MS) ?? last
    const ms = last.ms - first.ms
    return ms <= 0 ? 0 : (row.limits.dir * (last.x - first.x) * 1000) / ms
  }

  const release = (row: Row): void => {
    const touch = row.touch
    row.isDragging = false
    row.touch = null
    if (touch === null) return
    const velocity = speedOf(row, touch)
    const decided = decide(row.s, velocity, row.limits)
    row.armed = 0
    if (!decided.isFullSwipe) {
      row.fullTarget = 0
      setRest(row, decided.rest)
      moveTo(row, restAt(decided.rest, row.limits), velocity, true)
      return
    }
    const side = decided.rest
    if (slidesAway(side, row.limits)) {
      // A destructive action: the row leaves, then the program hears.
      setRest(row, side, true)
      moveTo(row, awayAt(side, row.limits), velocity, true, () => trigger(row, side, 0, true))
      return
    }
    trigger(row, side, 0, true)
    row.fullTarget = 0
    setRest(row, 0)
    moveTo(row, 0, velocity, true)
  }

  /** The phone took the touch away. Back to where the row was resting. */
  const cancel = (row: Row): void => {
    row.isDragging = false
    row.touch = null
    row.armed = 0
    row.fullTarget = 0
    moveTo(row, restAt(row.rest, row.limits), 0, true)
  }

  const handlersFor = (row: Row): ResponderHandlers => ({
    onStartShouldSetResponderCapture: (event, target) => {
      touchedRow = row
      const at = pointOf(event)
      row.touch = {
        x0: at.x,
        y0: at.y,
        decided: 'none',
        hasMoved: false,
        base: 0,
        samples: [{ x: at.x, ms: at.ms }],
      }
      row.handlers.blockNativeResponder = false
      // An open row takes the touch itself, so a tap on it closes it and
      // presses nothing inside. Its tiles are still pressed as usual.
      return row.rest !== 0 && !row.isAway && !isOnTile(row, target)
    },
    onMoveShouldSetResponder: event => follow(row, event),
    onResponderGrant: event => {
      if (row.touch?.decided === 'swipe') beginDrag(row, event)
    },
    onResponderMove: event => {
      if (!follow(row, event)) return
      beginDrag(row, event)
      drag(row, event)
    },
    // Once the row is being dragged, a scroll view may not take the touch.
    onResponderTerminationRequest: () => !(row.kind === 'javascript' && row.isDragging),
    onResponderRelease: () => {
      if (row.kind === 'javascript' && row.isDragging) {
        release(row)
        return
      }
      const wasTap = row.touch !== null && !row.touch.hasMoved
      row.touch = null
      if (wasTap && !row.isDragging && row.rest !== 0 && !row.isAway) close(row, true)
    },
    onResponderTerminate: () => {
      // With the UI thread driver the touch is taken away whenever the
      // native gesture starts, and the worklets carry on with the row.
      if (row.kind === 'javascript' && row.isDragging) cancel(row)
      row.touch = null
    },
    blockNativeResponder: false,
  })

  // TAP AWAY, AND SCROLL

  const listenForTapAway = (): void => {
    if (stopTapAway !== null) return
    // Every touch on this surface passes its root on the way up. By then the
    // row it landed on, if any, has put its name in `touchedRow`.
    stopTapAway = engine.setEventListener(engine.root, 'topTouchStart', () => {
      const touched = touchedRow
      touchedRow = null
      for (const row of [...rows.values()]) {
        if (row === touched || row.isDragging || !isOpen(row)) continue
        // A touch on a row of another group is that group's business.
        if (touched !== null && touched.member.group !== row.member.group) continue
        close(row, true)
      }
    })
  }

  const scrollOffsetOf = (event: unknown): number | null => {
    const offset = (event as { nativeEvent?: { contentOffset?: { x?: number; y?: number } } })
      ?.nativeEvent?.contentOffset
    return offset === undefined ? null : (offset.y ?? 0) + (offset.x ?? 0)
  }

  const scrollAround = (node: EngineNode): EngineNode | null => {
    for (let at = engine.parentNode(node); at !== null; at = engine.parentNode(at)) {
      if (at.tag === 'scroll-view') return at
    }
    return null
  }

  const leaveScroll = (row: Row): void => {
    const scroll = row.scroll
    row.scroll = null
    if (scroll === null) return
    const heard = scrollListeners.get(scroll)
    if (heard === undefined) return
    heard.rows.delete(row)
    if (heard.rows.size > 0) return
    heard.stop()
    scrollListeners.delete(scroll)
  }

  const joinScroll = (row: Row): void => {
    const scroll = scrollAround(row.node)
    if (scroll === row.scroll) return
    leaveScroll(row)
    row.scroll = scroll
    if (scroll === null) return
    let heard = scrollListeners.get(scroll)
    if (heard === undefined) {
      const inside = new Set<Row>()
      const closeOpen = (): void => {
        for (const each of [...inside]) {
          if (!each.isDragging && isOpen(each)) close(each, true)
        }
      }
      const stopBegin = engine.setEventListener(scroll, 'topScrollBeginDrag', closeOpen)
      // A list also reports scrolling it did itself, to keep its place. Only
      // a real movement since the row opened closes the row.
      const stopScroll = engine.setEventListener(scroll, 'topScroll', event => {
        const offset = scrollOffsetOf(event)
        if (offset === null) return
        for (const each of [...inside]) {
          if (each.isDragging || !isOpen(each)) continue
          if (each.scrollStart === null) each.scrollStart = offset
          else if (Math.abs(offset - each.scrollStart) > SCROLL_CLOSES_AFTER) close(each, true)
        }
      })
      heard = {
        rows: inside,
        stop: () => {
          stopBegin()
          stopScroll()
        },
      }
      scrollListeners.set(scroll, heard)
    }
    heard.rows.add(row)
  }

  // THE UI THREAD DRIVER'S MESSAGES

  const hear = (row: Row, name: string, detail: unknown): void => {
    if (!row.isAlive || row.kind !== 'ui-thread') return
    const said = (detail ?? {}) as { rest?: number; isAway?: boolean; side?: number; isArmed?: boolean }
    if (name === 'began') {
      row.isDragging = true
      closeOtherSwipes(row.member)
    } else if (name === 'armed') {
      emit(row, SWIPE_ARMED, { isArmed: said.isArmed === true, side: sideName(said.side ?? 1) })
    } else if (name === 'rest') {
      row.isDragging = false
      setRest(row, said.rest ?? 0, said.isAway === true)
    } else if (name === 'triggered') {
      trigger(row, said.side ?? 1, 0, true)
    }
  }

  const listenToUi = (row: Row): void => {
    const channel = row.kind === 'ui-thread' ? (row.stage.ui?.channel ?? null) : null
    if (channel === row.channelOf) return
    row.stopChannel()
    row.channelOf = channel
    row.stopChannel =
      channel === null ? () => {} : listenToChannel(channel, (name, detail) => hear(row, name, detail))
  }

  // A ROW'S LIFE

  const sameLimits = (a: Limits, b: Limits): boolean =>
    (Object.keys(a) as Array<keyof Limits>).every(name => a[name] === b[name])

  /** Brings the row in line with what the view last said about it. */
  const sync = (row: Row): void => {
    if (!row.isAlive) return
    const { stage } = row
    if (row.kind !== stage.kind) {
      // Another driver took over. The moving views were made afresh, closed.
      const wasAnnounced = row.isAnnounced
      row.kind = stage.kind
      row.s = 0
      row.velocity = 0
      row.target = null
      row.full = 0
      row.fullVelocity = 0
      row.fullTarget = 0
      row.armed = 0
      row.isDragging = false
      row.touch = null
      row.whenSettled = null
      row.rest = 0
      row.isAway = false
      row.isAnnounced = false
      if (wasAnnounced) emit(row, SWIPE_CLOSED, {})
    }
    listenToUi(row)
    const limits = limitsOf(stage.spec, row.width, row.height)
    if (!sameLimits(limits, row.limits) || row.sentLimitsTo !== stage.ui) {
      row.limits = limits
      row.sentLimitsTo = stage.ui
      if (stage.ui !== null) writeShared(stage.ui.limits, limits)
    }
    // The side the row is open on is gone, or swiping was switched off.
    const open = row.rest > 0 ? limits.leadingOpen : row.rest < 0 ? limits.trailingOpen : 0
    if (row.rest !== 0 && open <= 0) close(row, false)
    else if (row.kind === 'javascript' && row.rest !== 0 && !row.isAway && !row.isDragging && row.target === null) {
      // Its open width may have changed with its actions.
      row.s = restAt(row.rest, limits)
    }
    // Set in the same commit as the draw. A view the UI thread has taken
    // over ignores this, which is right.
    place(row)
    joinScroll(row)
    listenForTapAway()
  }

  const make = (node: EngineNode, stage: Stage): Row => {
    const row: Row = {
      node,
      stage,
      kind: stage.kind,
      isAlive: true,
      limits: limitsOf(stage.spec, 0, 0),
      width: 0,
      height: 0,
      rest: 0,
      isAnnounced: false,
      isAway: false,
      isDragging: false,
      touch: null,
      s: 0,
      velocity: 0,
      target: null,
      full: 0,
      fullVelocity: 0,
      fullTarget: 0,
      armed: 0,
      isFrameAsked: false,
      lastFrameMs: 0,
      whenSettled: null,
      member: { group: stage.spec.group, id: stage.spec.id, isOpen: () => isOpen(row), close: isAnimated => close(row, isAnimated) },
      stops: [],
      scroll: null,
      scrollStart: null,
      stopChannel: () => {},
      sentLimitsTo: null,
      channelOf: null,
      handlers: {},
    }
    row.handlers = handlersFor(row)
    stage.row = row
    tilePresses.set(row, (side, index) => onTilePress(row, side, index))
    row.stops.push(
      joinSwipeGroup(row.member),
      engine.setResponder(node, row.handlers),
      engine.setEventListener(node, 'topLayout', event => {
        const layout = (event as { nativeEvent?: { layout?: { width?: number; height?: number } } })
          ?.nativeEvent?.layout
        if (layout === undefined) return
        row.width = layout.width ?? 0
        row.height = layout.height ?? 0
        sync(row)
        engine.commit()
      }),
      engine.setEventListener(node, 'topAccessibilityAction', event => {
        const name = (event as { nativeEvent?: { actionName?: unknown } })?.nativeEvent?.actionName
        onAccessibilityAction(row, name)
      }),
    )
    rows.set(node, row)
    changed.add(row)
    return row
  }

  const unmake = (row: Row): void => {
    if (!row.isAlive) return
    row.isAlive = false
    rows.delete(row.node)
    changed.delete(row)
    if (touchedRow === row) touchedRow = null
    for (const stop of row.stops.splice(0)) stop()
    row.stopChannel()
    leaveScroll(row)
    tilePresses.delete(row)
    if (row.stage.row === row) {
      row.stage.row = null
      dropStage(row.stage)
    }
    if (rows.size === 0 && stopTapAway !== null) {
      stopTapAway()
      stopTapAway = null
    }
  }

  const notePart = (vnode: VNode): void => {
    const data = vnode.data?.[PART_DATA] as PartData | undefined
    const node = nodeOf(vnode)
    if (data === undefined || node === undefined) return
    if (data.part === 'content') data.stage.content = node
    else data.stage.tiles.set(data.part, node)
  }

  const forgetPart = (vnode: VNode): void => {
    const data = vnode.data?.[PART_DATA] as PartData | undefined
    const node = nodeOf(vnode)
    if (data === undefined || node === undefined) return
    // Only if this view still holds the place: a newer one may have taken it.
    if (data.part === 'content') {
      if (data.stage.content === node) data.stage.content = null
    } else if (data.stage.tiles.get(data.part) === node) data.stage.tiles.delete(data.part)
  }

  const noteRow = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const stage = vnode.data?.[ROW_DATA] as Stage | undefined
    const row = rows.get(node)
    if (stage === undefined) {
      // The updater reused this view for something that is not a swipe row.
      if (row !== undefined) unmake(row)
      return
    }
    if (row !== undefined && row.stage !== stage) {
      // The updater reused this view for another row. That row starts closed.
      unmake(row)
      make(node, stage)
      return
    }
    if (row === undefined) make(node, stage)
    else changed.add(row)
  }

  return {
    create: (_empty, vnode) => {
      notePart(vnode)
      noteRow(vnode)
    },
    update: (old, vnode) => {
      if (old.data?.[PART_DATA] !== vnode.data?.[PART_DATA]) forgetPart(old)
      notePart(vnode)
      noteRow(vnode)
    },
    destroy: vnode => {
      forgetPart(vnode)
      const node = nodeOf(vnode)
      const row = node === undefined ? undefined : rows.get(node)
      if (row !== undefined) unmake(row)
    },
    // After the whole draw, when a row's new tiles and content exist.
    post: () => {
      if (changed.size === 0) return
      const due = [...changed]
      changed.clear()
      for (const row of due) sync(row)
    },
  }
}

registerModule(swipeModule)
