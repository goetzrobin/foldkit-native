/**
 * A row's live things: what must stay the same from one draw to the next.
 *
 * A view is drawn again and again, and each draw describes the row afresh.
 * The row's position, its UI thread values and the views that move are not
 * part of that description. They are kept here, one "stage" per row, found
 * by the row's group and id. The stage is dropped when the row's view is
 * removed, so a row that scrolls off a list and comes back starts closed.
 */
import type { EngineNode } from '@ng-native/fabric'

import type { Limits } from './core.js'
import type { SwipeRowSpec, SwipeSideSpec, SwipeStyle } from './types.js'
import type { UiParts } from './uiSide.js'

/** The two drivers in this folder. */
export type BuiltInKind = 'ui-thread' | 'javascript'

export type Stage = {
  readonly key: string
  spec: SwipeRowSpec<any>
  kind: BuiltInKind
  /** Made the first time the row is drawn with the UI thread driver. */
  ui: UiParts | null
  /** The view that moves with the finger. */
  content: EngineNode | null
  /** The tile views, by side and place: `leading:0`. */
  tiles: Map<string, EngineNode>
  /** The module's own record for the row. Its shape is the module's business. */
  row: unknown
}

const stages = new Map<string, Stage>()

const keyOf = (group: string, id: string): string => `${group}\u0000${id}`

/** The stage for a row, made if this is the row's first draw. */
export const stageFor = (spec: SwipeRowSpec<any>, kind: BuiltInKind): Stage => {
  const key = keyOf(spec.group, spec.id)
  let stage = stages.get(key)
  if (stage === undefined) {
    stage = { key, spec, kind, ui: null, content: null, tiles: new Map(), row: null }
    stages.set(key, stage)
  }
  stage.spec = spec
  stage.kind = kind
  return stage
}

export const dropStage = (stage: Stage): void => {
  if (stages.get(stage.key) === stage) stages.delete(stage.key)
}

/** How many rows have live things. For tests: it must fall back when rows go. */
export const stageCount = (): number => stages.size

export const countOf = (side: SwipeSideSpec<any> | null): number =>
  side === null ? 0 : side.kind === 'info' ? 1 : side.actions.length

const isPassive = (side: SwipeSideSpec<any> | null, style: SwipeStyle): boolean =>
  style.passive || side?.kind === 'info'

const openWidthOf = (side: SwipeSideSpec<any> | null, style: SwipeStyle): number => {
  if (side === null) return 0
  if (side.kind === 'info') return side.width ?? style.openWidth(1)
  return side.actions.length === 0 ? 0 : style.openWidth(side.actions.length)
}

const allowsFull = (side: SwipeSideSpec<any> | null, style: SwipeStyle): boolean =>
  side !== null &&
  side.kind === 'actions' &&
  side.allowsFullSwipe &&
  side.actions.length > 0 &&
  !isPassive(side, style)

const goesAway = (side: SwipeSideSpec<any> | null, style: SwipeStyle): boolean =>
  allowsFull(side, style) && side?.kind === 'actions' && side.actions[0]?.role === 'destructive'

/** What the row's sides allow, as the numbers the rules in `core.ts` read. */
export const limitsOf = (spec: SwipeRowSpec<any>, rowWidth: number, rowHeight: number): Limits => {
  const { leading, trailing, style } = spec
  const isOn = spec.enabled
  return {
    leadingOpen: isOn ? openWidthOf(leading, style) : 0,
    trailingOpen: isOn ? openWidthOf(trailing, style) : 0,
    leadingFull: isOn && allowsFull(leading, style),
    trailingFull: isOn && allowsFull(trailing, style),
    leadingPassive: isPassive(leading, style),
    trailingPassive: isPassive(trailing, style),
    leadingAway: isOn && goesAway(leading, style),
    trailingAway: isOn && goesAway(trailing, style),
    rowWidth,
    rowHeight,
    dir: spec.rightToLeft ? -1 : 1,
    reduceMotion: spec.reduceMotion,
  }
}
