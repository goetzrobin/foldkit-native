/**
 * The UI thread half of a swipe row: the worklets that follow the finger
 * and bring the row to rest, with no work on the JavaScript thread.
 *
 * They use the same rules as the JavaScript driver (`core.ts`). What they
 * send back, on the row's channel, is only what the program or the group
 * needs to know:
 *
 *   began       a finger started moving the row (the group closes the others)
 *   armed       the drag crossed the full swipe line, or came back
 *   rest        where the row is going to rest
 *   triggered   a full swipe chose the side's first action
 */
import {
  PAN_ACTIVE,
  PAN_END,
  type PanEvent,
  type Shared,
  sendMessage,
  shared,
  springTo,
  stopAnimation,
  uiChannel,
  type UiChannel,
} from '../../foldkit/worklets/index.js'
import type { SharedHost } from '../worklets/ui.js'
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
  tileInput,
  tileProps,
} from './core.js'
import type { SwipeStyle } from './types.js'

export const NO_LIMITS: Limits = {
  leadingOpen: 0,
  trailingOpen: 0,
  leadingFull: false,
  trailingFull: false,
  leadingPassive: false,
  trailingPassive: false,
  leadingAway: false,
  trailingAway: false,
  rowWidth: 0,
  rowHeight: 0,
  dir: 1,
  reduceMotion: false,
}

/** A row's live values on the UI thread. */
export type UiValues = Readonly<{
  /** Where the row is. See `core.ts`. */
  s: SharedHost<number>
  /** 0 to 1: how far the full swipe has taken over. */
  full: SharedHost<number>
  /** `s` minus the finger's movement, noted when the drag began. */
  base: SharedHost<number>
  /** 1 or -1 while past the full swipe line, else 0. */
  armed: SharedHost<number>
  /** Where the row last came to rest: 0, 1 or -1. */
  rest: SharedHost<number>
  limits: SharedHost<Limits>
}>

/** Moves `s` to `to`: a spring, or a jump when the user asked for less motion. */
const glide = (
  values: UiValues,
  to: number,
  velocity: number,
  finished?: () => void,
): void => {
  'worklet'
  if (values.limits.value.reduceMotion) {
    stopAnimation(values.s)
    values.s.value = to
    finished?.()
    return
  }
  springTo(
    values.s,
    to,
    {
      stiffness: REST_SPRING.stiffness,
      damping: REST_SPRING.damping,
      mass: REST_SPRING.mass,
      velocity,
    },
    finished,
  )
}

const relax = (values: UiValues): void => {
  'worklet'
  values.armed.value = 0
  if (values.limits.value.reduceMotion) {
    stopAnimation(values.full)
    values.full.value = 0
  } else springTo(values.full, 0, FULL_SPRING)
}

/** Called on the UI thread for every movement of a finger on the row. */
export const panStep = (event: PanEvent, values: UiValues, channel: UiChannel): void => {
  'worklet'
  const limits = values.limits.value
  if (event.state === PAN_ACTIVE) {
    const moved = limits.dir * event.translationX
    if (event.oldState !== undefined) {
      // The finger has the row now, whatever was moving it before. The row
      // carries on from where it is: no jump for the distance the finger
      // went before the gesture counted as a swipe.
      stopAnimation(values.s)
      values.base.value = values.s.value - moved
      sendMessage(channel, 'began')
    }
    const next = dragTo(values.base.value + moved, limits)
    values.s.value = next
    const armed = armedSide(next, limits)
    if (armed !== values.armed.value) {
      const side = armed !== 0 ? armed : values.armed.value
      values.armed.value = armed
      const to = armed === 0 ? 0 : 1
      if (limits.reduceMotion) values.full.value = to
      else springTo(values.full, to, FULL_SPRING)
      sendMessage(channel, 'armed', { isArmed: armed !== 0, side })
    }
    return
  }
  if (event.oldState !== PAN_ACTIVE) return
  if (event.state !== PAN_END) {
    // The phone took the touch away. Back to where the row was resting.
    relax(values)
    sendMessage(channel, 'rest', { rest: values.rest.value, isAway: false })
    glide(values, restAt(values.rest.value, limits), 0)
    return
  }
  const velocity = limits.dir * event.velocityX
  const decided = decide(values.s.value, velocity, limits)
  if (!decided.isFullSwipe) {
    relax(values)
    values.rest.value = decided.rest
    sendMessage(channel, 'rest', { rest: decided.rest, isAway: false })
    glide(values, restAt(decided.rest, limits), velocity)
    return
  }
  const side = decided.rest
  if (slidesAway(side, limits)) {
    // A destructive action: the row leaves, then the program hears.
    values.armed.value = 0
    values.rest.value = side
    sendMessage(channel, 'rest', { rest: side, isAway: true })
    const tell = (): void => {
      sendMessage(channel, 'triggered', { side })
    }
    glide(values, awayAt(side, limits), velocity, tell)
    return
  }
  sendMessage(channel, 'triggered', { side })
  relax(values)
  values.rest.value = 0
  sendMessage(channel, 'rest', { rest: 0, isAway: false })
  glide(values, 0, velocity)
}

/** Closes a row from the JavaScript thread. */
export const closeOnUi = (values: UiValues, isAnimated: boolean): void => {
  'worklet'
  values.rest.value = 0
  values.armed.value = 0
  if (isAnimated && !values.limits.value.reduceMotion) {
    springTo(values.full, 0, FULL_SPRING)
    springTo(values.s, 0, REST_SPRING)
    return
  }
  stopAnimation(values.full)
  stopAnimation(values.s)
  values.full.value = 0
  values.s.value = 0
}

/** Everything live a UI thread row owns. Made once per row, outside the view. */
export type UiParts = Readonly<{
  values: UiValues
  channel: UiChannel
  /** The shared values, as the JavaScript thread holds them. */
  s: Shared<number>
  full: Shared<number>
  limits: Shared<Limits>
  inputs: ReadonlyArray<Shared<any>>
  contentStyle: () => Record<string, unknown>
  pan: (event: PanEvent) => void
  /** One style worklet per tile, kept so each draw hands over the same function. */
  tileStyles: Map<string, () => Record<string, unknown>>
  tileStylesFor: { style: SwipeStyle | null }
}>

export const makeUiParts = (): UiParts => {
  const s = shared(0)
  const full = shared(0)
  const base = shared(0)
  const armed = shared(0)
  const rest = shared(0)
  const limits = shared<Limits>(NO_LIMITS)
  const channel = uiChannel()
  const values: UiValues = { s, full, base, armed, rest, limits }
  const contentStyle = () => {
    'worklet'
    return { transform: [{ translateX: limits.value.dir * s.value }] }
  }
  const pan = (event: PanEvent): void => {
    'worklet'
    panStep(event, values, channel)
  }
  return {
    values,
    channel,
    s,
    full,
    limits,
    inputs: [s, full, limits],
    contentStyle,
    pan,
    tileStyles: new Map(),
    tileStylesFor: { style: null },
  }
}

/** The style worklet for one tile. `layout` is the style's own `tile` function. */
export const makeTileStyle = (
  values: UiValues,
  layout: SwipeStyle['tile'],
  side: number,
  index: number,
  count: number,
) => {
  const { s, full, limits } = values
  return () => {
    'worklet'
    const now = limits.value
    const input = tileInput(side, index, count, s.value, full.value, now)
    return tileProps(layout(input), side * now.dir, input.reveal)
  }
}
