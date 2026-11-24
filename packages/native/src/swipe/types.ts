/**
 * The words a swipe row is described with. Every driver (the UI thread one,
 * the JavaScript one, and any driver another folder registers) takes these
 * same shapes, so a row can change driver without its program changing.
 */
import type { Html } from 'foldkit/html'

import type { NativeStyle } from '../attributes.js'
import type { GestureTag } from '../worklets/index.js'

/**
 * What kind of action it is. A style colours each kind differently.
 * `destructive` removes something: after a full swipe the row slides away.
 * `cancel` backs out of something.
 */
export type SwipeRole = 'normal' | 'destructive' | 'cancel'

/** The side of the row the actions sit on. Leading is left, unless the app reads right to left. */
export type SwipeSide = 'leading' | 'trailing'

export type SwipeAction<Message> = Readonly<{
  /** Tells this action from the others on the row. */
  key: string
  /** Shown on the tile and read out by a screen reader. */
  label: string
  /** One short glyph shown above the label, for example an arrow. Optional. */
  symbol?: string
  role: SwipeRole
  /** A background colour in place of the style's colour for the role. */
  tint?: string
  /** Sent when the action is chosen: tile pressed, full swipe, or screen reader. */
  onTriggered: Message
}>

/** Makes an action. `role` is `normal` unless said. */
export const swipeAction = <Message>(
  action: Omit<SwipeAction<Message>, 'role'> & Readonly<{ role?: SwipeRole }>,
): SwipeAction<Message> => ({ ...action, role: action.role ?? 'normal' })

/**
 * One side of a row.
 *
 * - A list of actions, written from the row's outer edge inward. The first
 *   one sits at the edge. It is the one a full swipe triggers.
 * - `swipeActions(list, { allowsFullSwipe })` for the same with full swipe.
 * - `swipeInfo(html, { width })` to show something passive there instead,
 *   such as the time a message was sent.
 */
export type SwipeSideOption<Message> =
  | ReadonlyArray<SwipeAction<Message>>
  | Readonly<{ actions: ReadonlyArray<SwipeAction<Message>>; allowsFullSwipe?: boolean }>
  | Readonly<{ info: Html; width?: number }>

export const swipeActions = <Message>(
  actions: ReadonlyArray<SwipeAction<Message>>,
  options: Readonly<{ allowsFullSwipe?: boolean }> = {},
): SwipeSideOption<Message> => ({ actions, allowsFullSwipe: options.allowsFullSwipe ?? false })

export const swipeInfo = <Message>(
  info: Html,
  options: Readonly<{ width?: number }> = {},
): SwipeSideOption<Message> =>
  options.width === undefined ? { info } : { info, width: options.width }

/** What a style is asked for one tile, at one moment of the swipe. */
export type SwipeTileInput = Readonly<{
  /** 0 is the tile at the row's outer edge. */
  index: number
  /** How many tiles this side has. */
  count: number
  /** How far the row has moved off this side, in points. 0 is closed. */
  reveal: number
  /** `reveal` when the row rests open. */
  openWidth: number
  /** `reveal / openWidth`. Above 1 the row is pulled past open. */
  progress: number
  rowWidth: number
  rowHeight: number
  /** 0 to 1: how far the full swipe has taken over. Eased, not a jump. */
  full: number
  /** Whether this tile is the one a full swipe triggers. */
  isFullSwipeAction: boolean
}>

/** Where a tile is. All in points, measured from the row's outer edge on the tile's side. */
export type SwipeTileLayout = Readonly<{
  /** From the row's outer edge to the tile's outer edge. May be negative. */
  offset: number
  width: number
  /** 0 to 1. */
  opacity: number
  /** 1 is full size. */
  scale: number
}>

/** What decides a tile's colours and shape. */
export type SwipeTileLook = Readonly<{ role: SwipeRole; tint: string | undefined }>

/**
 * How swipe actions look and move, as a value, like a button style. Pass
 * one to `swipeRow`. Make your own with `swipeStyle(tiles, { ... })`.
 *
 * `openWidth` and `tile` run on every frame of a swipe. For the UI thread
 * driver they must be worklets: start each with the line `'worklet'` and
 * read nothing from outside but numbers.
 */
export type SwipeStyle = Readonly<{
  name: string
  /**
   * A passive style shows and never acts: the row springs back when let
   * go, nothing is triggered, and tiles take no presses.
   */
  passive: boolean
  /** How far the row rests open for `count` tiles. */
  openWidth: (count: number) => number
  /** The style itself: from how far the swipe has got to where a tile is. */
  tile: (input: SwipeTileInput) => SwipeTileLayout
  /** Space above and below each tile, in points. */
  tileInset: number
  /** A tile's background, corners and so on. Not its position or size. */
  tileStyle: (look: SwipeTileLook) => NativeStyle
  /** The label and glyph on a tile. */
  labelStyle: (look: SwipeTileLook) => NativeStyle
  /** Added to the moving part of the row, for example rounded corners. */
  contentStyle: NativeStyle
}>

/** How a side came out of the options: ready to draw. */
export type SwipeSideSpec<Message> =
  | Readonly<{
      kind: 'actions'
      actions: ReadonlyArray<SwipeAction<Message>>
      allowsFullSwipe: boolean
    }>
  | Readonly<{ kind: 'info'; info: Html; width: number | undefined }>

/** Which code moves the row. Other folders may register more names. */
export type SwipeDriverName = 'ui-thread' | 'javascript' | 'native' | (string & {})

export type SwipeRowOptions<Message> = Readonly<{
  /** Names this row. Unique within its group. Use the item's id. */
  id: string
  /**
   * Rows with the same group share one rule: only one is open at a time.
   * Default `'default'`.
   */
  group?: string
  leading?: SwipeSideOption<Message>
  trailing?: SwipeSideOption<Message>
  /** Default `tiles`. */
  style?: SwipeStyle
  /**
   * Right-to-left layout: leading is on the right. Feed it from React
   * Native's `I18nManager.isRTL` in the app. Default false.
   */
  rightToLeft?: boolean
  /**
   * The user asked the phone for less motion: the row jumps to where it
   * rests in place of springing. Feed it from React Native's
   * `AccessibilityInfo.isReduceMotionEnabled()` in the app. Default false.
   */
  reduceMotion?: boolean
  /** `false` switches swiping off and closes the row. Default true. */
  enabled?: boolean
  /** Which driver moves the row. Default `'auto'`: the first that can run. */
  driver?: SwipeDriverName | 'auto'
  /** Sent when the row comes to rest open. */
  onOpened?: (side: SwipeSide) => Message
  /** Sent when an open row has closed, whatever closed it. */
  onClosed?: () => Message
  /**
   * Sent when a drag crosses the full swipe line (`true`) and when it comes
   * back (`false`). This is the moment for a haptic tap.
   */
  onFullSwipeArmed?: (isArmed: boolean) => Message
  /**
   * Makes the whole row one thing for a screen reader, with each action
   * offered as a custom action on it. Default true. With `false` the
   * actions are still offered, and what is inside the row is read part by
   * part.
   */
  accessible?: boolean
  /** What a screen reader says for the row. */
  accessibilityLabel?: string
  /**
   * UI thread driver only. The number of the scroll view's own gesture
   * (`uiThread({ nativeGesture })`), if the scroll view should wait until
   * the swipe has given up.
   */
  scrollGesture?: GestureTag
  /** More attributes for the row's outer view: `testId`, `style` and so on. */
  attributes?: ReadonlyArray<any>
}>

/** A row's options with every default filled in. What a driver is handed. */
export type SwipeRowSpec<Message> = Readonly<{
  id: string
  group: string
  leading: SwipeSideSpec<Message> | null
  trailing: SwipeSideSpec<Message> | null
  style: SwipeStyle
  rightToLeft: boolean
  reduceMotion: boolean
  enabled: boolean
  onOpened: ((side: SwipeSide) => Message) | undefined
  onClosed: (() => Message) | undefined
  onFullSwipeArmed: ((isArmed: boolean) => Message) | undefined
  accessible: boolean
  accessibilityLabel: string | undefined
  scrollGesture: GestureTag | undefined
  attributes: ReadonlyArray<any>
}>

/**
 * What a row tells the program, as the native events a driver raises on
 * the row's outer view. `swipeEventAttributes` turns them into Messages.
 *
 *   swipeOpened     { side }                 came to rest open
 *   swipeClosed     {}                       an open row closed
 *   swipeTriggered  { key, side, isFullSwipe }   an action was chosen
 *   swipeArmed      { isArmed, side }        crossed the full swipe line
 */
export type SwipeOpened = Readonly<{ side: SwipeSide }>
export type SwipeClosed = Readonly<Record<string, never>>
export type SwipeTriggered = Readonly<{ key: string; side: SwipeSide; isFullSwipe: boolean }>
export type SwipeArmed = Readonly<{ isArmed: boolean; side: SwipeSide }>

export const SWIPE_OPENED = 'swipeOpened'
export const SWIPE_CLOSED = 'swipeClosed'
export const SWIPE_TRIGGERED = 'swipeTriggered'
export const SWIPE_ARMED = 'swipeArmed'

/** Yes, or no with the reason, in words for a person. */
export type SwipeCheck = Readonly<{ ok: boolean; reason: string }>
