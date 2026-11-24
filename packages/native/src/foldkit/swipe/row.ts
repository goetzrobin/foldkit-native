/**
 * Drawing a swipe row.
 *
 *   swipeRow(h, {
 *     id: mail.id,
 *     trailing: swipeActions(
 *       [
 *         swipeAction({ key: 'delete', label: 'Delete', role: 'destructive',
 *                       onTriggered: Message.PressedDelete({ id: mail.id }) }),
 *         swipeAction({ key: 'flag', label: 'Flag',
 *                       onTriggered: Message.PressedFlag({ id: mail.id }) }),
 *       ],
 *       { allowsFullSwipe: true },
 *     ),
 *     onOpened: side => Message.OpenedRow({ id: mail.id, side }),
 *   }, [ ...what the row shows... ])
 *
 * What is drawn, for the two drivers in this folder:
 *
 *   row            the outer view: your attributes, the screen reader's
 *                  actions, and where the swipe's events are raised
 *     body         clips what moves
 *       tiles      one view per action, under the content
 *       content    your children. This is the part that moves.
 *
 * Nothing in the Model says how far a row is open. That lives outside the
 * view, in the row's stage, and the program only hears when something
 * worth a Message happens.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, Prop, element } from 'foldkit/renderTarget'

import { gesturesCheck, uiThread, workletCheck } from '../worklets/index.js'
import { type SwipeDriver, registerSwipeDriver, resolveSwipeDriver } from './drivers.js'
import { DEFAULT_GROUP } from './group.js'
import { PART_DATA, ROW_DATA, pressTile } from './module.js'
import { type BuiltInKind, type Stage, countOf, stageFor } from './stage.js'
import { tiles } from './styles.js'
import {
  SWIPE_ARMED,
  SWIPE_CLOSED,
  SWIPE_OPENED,
  SWIPE_TRIGGERED,
  type SwipeAction,
  type SwipeArmed,
  type SwipeOpened,
  type SwipeRowOptions,
  type SwipeRowSpec,
  type SwipeSide,
  type SwipeSideOption,
  type SwipeSideSpec,
  type SwipeTriggered,
} from './types.js'
import { makeTileStyle, makeUiParts, panStep } from './uiSide.js'

const el = element<any>()

const sideSpec = <Message>(
  side: SwipeSideOption<Message> | undefined,
): SwipeSideSpec<Message> | null => {
  if (side === undefined) return null
  if ('info' in side) return { kind: 'info', info: side.info, width: side.width }
  if ('actions' in side) {
    return { kind: 'actions', actions: side.actions, allowsFullSwipe: side.allowsFullSwipe ?? false }
  }
  return { kind: 'actions', actions: side, allowsFullSwipe: false }
}

/** A row's options with every default filled in. */
export const swipeRowSpec = <Message>(options: SwipeRowOptions<Message>): SwipeRowSpec<Message> => ({
  id: options.id,
  group: options.group ?? DEFAULT_GROUP,
  leading: sideSpec(options.leading),
  trailing: sideSpec(options.trailing),
  style: options.style ?? tiles,
  rightToLeft: options.rightToLeft ?? false,
  reduceMotion: options.reduceMotion ?? false,
  enabled: options.enabled ?? true,
  onOpened: options.onOpened,
  onClosed: options.onClosed,
  onFullSwipeArmed: options.onFullSwipeArmed,
  accessible: options.accessible ?? true,
  accessibilityLabel: options.accessibilityLabel,
  scrollGesture: options.scrollGesture,
  attributes: options.attributes ?? [],
})

const actionsOf = <Message>(spec: SwipeRowSpec<Message>): ReadonlyArray<SwipeAction<Message>> =>
  [spec.leading, spec.trailing].flatMap(side =>
    side !== null && side.kind === 'actions' && !spec.style.passive ? side.actions : [],
  )

/**
 * The attributes that turn a row's native events into the program's
 * Messages. Every driver puts these on the view it raises the events on.
 */
export const swipeEventAttributes = <Message>(spec: SwipeRowSpec<Message>): ReadonlyArray<any> => {
  const { onOpened, onClosed, onFullSwipeArmed } = spec
  const actions = actionsOf(spec)
  return [
    OnCustomEvent({
      name: SWIPE_TRIGGERED,
      f: event => {
        const { key } = event.detail as SwipeTriggered
        const action = actions.find(each => each.key === key)
        return action === undefined ? Option.none() : Option.some(action.onTriggered)
      },
    }),
    ...(onOpened === undefined
      ? []
      : [
          OnCustomEvent({
            name: SWIPE_OPENED,
            f: event => Option.some(onOpened((event.detail as SwipeOpened).side)),
          }),
        ]),
    ...(onClosed === undefined
      ? []
      : [OnCustomEvent({ name: SWIPE_CLOSED, f: () => Option.some(onClosed()) })]),
    ...(onFullSwipeArmed === undefined
      ? []
      : [
          OnCustomEvent({
            name: SWIPE_ARMED,
            f: event => Option.some(onFullSwipeArmed((event.detail as SwipeArmed).isArmed)),
          }),
        ]),
  ]
}

/**
 * What a screen reader is offered on the row: each action by name. Every
 * driver puts these on its row. The phone answers with the event
 * `topAccessibilityAction` and the action's `key` as `actionName`.
 */
export const swipeAccessibilityAttributes = <Message>(
  spec: SwipeRowSpec<Message>,
): ReadonlyArray<any> => {
  const actions = actionsOf(spec)
  return [
    ...(spec.accessible ? [Prop({ key: 'accessible', value: true })] : []),
    ...(spec.accessibilityLabel === undefined
      ? []
      : [Prop({ key: 'accessibilityLabel', value: spec.accessibilityLabel })]),
    ...(actions.length === 0 || !spec.enabled
      ? []
      : [
          Prop({
            key: 'accessibilityActions',
            value: actions.map(action => ({ name: action.key, label: action.label })),
          }),
        ]),
  ]
}

const FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const

const mark = (target: Html, name: string, value: unknown): Html => {
  if (target !== null) (target.data ??= {})[name] = value
  return target
}

/** Which edge of the screen a side's tiles hang from. */
const edgeOf = (side: SwipeSide, isRightToLeft: boolean): 'left' | 'right' =>
  (side === 'leading') !== isRightToLeft ? 'left' : 'right'

const tileStyleFor = (stage: Stage, side: SwipeSide, index: number, count: number) => {
  const ui = stage.ui
  if (ui === null) return undefined
  const { style } = stage.spec
  if (ui.tileStylesFor.style !== style) {
    // Another style has another `tile` function, so the worklets are made again.
    ui.tileStyles.clear()
    ui.tileStylesFor.style = style
  }
  const key = `${side}:${index}:${count}`
  let made = ui.tileStyles.get(key)
  if (made === undefined) {
    made = makeTileStyle(ui.values, style.tile, side === 'leading' ? 1 : -1, index, count)
    ui.tileStyles.set(key, made)
  }
  return made
}

const tileView = <Message>(
  stage: Stage,
  side: SwipeSide,
  index: number,
  count: number,
  action: SwipeAction<Message> | null,
  children: ReadonlyArray<Html>,
): Html => {
  const { spec } = stage
  const { style } = spec
  const look = { role: action?.role ?? 'normal', tint: action?.tint } as const
  const takesPresses = action !== null && !style.passive && spec.enabled
  const tile = el('view')(
    [
      Prop({
        key: 'style',
        value: {
          position: 'absolute',
          top: style.tileInset,
          bottom: style.tileInset,
          [edgeOf(side, spec.rightToLeft)]: 0,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          ...style.tileStyle(look),
        },
      }),
      Prop({ key: 'collapsable', value: false }),
      Prop({ key: 'testID', value: `${spec.id}-${side}-${action?.key ?? 'info'}` }),
      ...(takesPresses
        ? [
            Prop({ key: 'pressedStyle', value: { opacity: 0.7 } }),
            Prop({ key: 'accessibilityRole', value: 'button' }),
            Prop({ key: 'accessibilityLabel', value: action.label }),
            // A press goes to the row's own code, which sends the action's
            // Message and closes the row. Nothing is sent from here.
            OnCustomEvent({
              name: 'click',
              f: () => {
                pressTile(stage, side, index)
                return Option.none()
              },
            }),
          ]
        : [Prop({ key: 'pointerEvents', value: 'none' })]),
    ] as never,
    children as never,
  )
  if (tile !== null) tile.key = `${side}:${action?.key ?? 'info'}`
  mark(tile, PART_DATA, { stage, part: `${side}:${index}` })
  const worklet = stage.kind === 'ui-thread' ? tileStyleFor(stage, side, index, count) : undefined
  return worklet === undefined || stage.ui === null
    ? tile
    : uiThread({ style: worklet, inputs: stage.ui.inputs }, tile)
}

const sideTiles = <Message>(stage: Stage, side: SwipeSide): ReadonlyArray<Html> => {
  const spec = stage.spec as SwipeRowSpec<Message>
  const given = side === 'leading' ? spec.leading : spec.trailing
  if (given === null) return []
  if (given.kind === 'info') return [tileView(stage, side, 0, 1, null, [given.info])]
  const count = countOf(given)
  const labelStyle = (action: SwipeAction<Message>) =>
    Prop({ key: 'style', value: spec.style.labelStyle({ role: action.role, tint: action.tint }) })
  // Drawn from the row inward to the edge, so the tile at the edge is on top
  // when they are stacked.
  return given.actions
    .map((action, index) =>
      tileView(stage, side, index, count, action, [
        ...(action.symbol === undefined
          ? []
          : [el('text')([labelStyle(action)] as never, [action.symbol] as never)]),
        el('text')(
          [labelStyle(action), Prop({ key: 'numberOfLines', value: 1 })] as never,
          [action.label] as never,
        ),
      ]),
    )
    .reverse()
}

/** Starts a swipe after 12 points sideways. Gives up after 10 up or down, so a list scrolls. */
const PAN_CONFIG = { activeOffsetX: 12, failOffsetY: 10 } as const

const builtIn = (wanted: BuiltInKind): SwipeDriver['row'] => (_h, spec, children) => {
  // A style whose `tile` is not a worklet cannot be asked on the UI thread.
  const kind: BuiltInKind =
    wanted === 'ui-thread' && !workletCheck(spec.style.tile).ok ? 'javascript' : wanted
  const stage = stageFor(spec, kind)
  if (kind === 'ui-thread' && stage.ui === null) stage.ui = makeUiParts()
  const ui = kind === 'ui-thread' ? stage.ui : null

  const plainContent = mark(
    el('view')(
      [
        Prop({ key: 'style', value: { overflow: 'hidden', ...spec.style.contentStyle } }),
        Prop({ key: 'collapsable', value: false }),
        Prop({ key: 'testID', value: `${spec.id}-content` }),
      ] as never,
      children as never,
    ),
    PART_DATA,
    { stage, part: 'content' },
  )
  if (plainContent !== null) plainContent.key = 'content'
  const content =
    ui === null ? plainContent : uiThread({ style: ui.contentStyle, inputs: ui.inputs }, plainContent)

  const plainBody = el('view')(
    [
      Prop({ key: 'style', value: { overflow: 'hidden' } }),
      Prop({ key: 'collapsable', value: false }),
      Prop({ key: 'testID', value: `${spec.id}-body` }),
    ] as never,
    [
      el('view')(
        [Prop({ key: 'style', value: FILL }), Prop({ key: 'pointerEvents', value: 'box-none' })] as never,
        [...sideTiles(stage, 'leading'), ...sideTiles(stage, 'trailing')] as never,
      ),
      content,
    ] as never,
  )
  // A new key when the driver changes, so the moving views are made afresh:
  // a view the UI thread has moved stays under its control until it is gone.
  if (plainBody !== null) plainBody.key = kind
  const body =
    ui === null || !spec.enabled
      ? plainBody
      : uiThread(
          {
            pan: ui.pan,
            panConfig: PAN_CONFIG,
            ...(spec.scrollGesture === undefined
              ? {}
              : { panRelations: { blocks: [spec.scrollGesture] } }),
          },
          plainBody,
        )

  return mark(
    el('view')(
      [
        ...spec.attributes,
        ...swipeAccessibilityAttributes(spec),
        ...swipeEventAttributes(spec),
      ] as never,
      [body] as never,
    ),
    ROW_DATA,
    stage,
  )
}

const uiThreadCheck = () => {
  const gestures = gesturesCheck()
  return gestures.ok ? workletCheck(panStep) : gestures
}

registerSwipeDriver('ui-thread', {
  label: 'UI thread',
  check: uiThreadCheck,
  row: builtIn('ui-thread'),
})

registerSwipeDriver('javascript', {
  label: 'JavaScript',
  check: () => ({ ok: true, reason: '' }),
  row: builtIn('javascript'),
})

/** See the top of this file. */
export const swipeRow = <Message>(
  h: HtmlBuilder<Message>,
  options: SwipeRowOptions<Message>,
  children: ReadonlyArray<Html>,
): Html => resolveSwipeDriver(options.driver).driver.row(h, swipeRowSpec(options), children)
