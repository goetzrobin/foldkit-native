/**
 * Swipe actions on rows: drag a row sideways and actions appear behind it.
 *
 *   swipeRow(h, {
 *     id: mail.id,
 *     leading: [swipeAction({ key: 'read', label: 'Read', onTriggered: ... })],
 *     trailing: swipeActions([del, flag], { allowsFullSwipe: true }),
 *     style: tiles,                    // or strip, info, or your own
 *     rightToLeft: I18nManager.isRTL,  // from the app
 *   }, [ ...the row... ])
 *
 *   closeSwipe(id), closeAllSwipes(group)     Effects, for a Command
 *
 * Read `row.ts` for what is drawn, `core.ts` for the rules of a swipe,
 * `styles.ts` for how to write a style, `drivers.ts` for what moves a row
 * and how another folder adds its own driver, and `module.ts` for the
 * finger and the motion.
 */
export {
  SWIPE_ARMED,
  SWIPE_CLOSED,
  SWIPE_OPENED,
  SWIPE_TRIGGERED,
  swipeAction,
  swipeActions,
  swipeInfo,
} from './types.js'
export type {
  SwipeAction,
  SwipeArmed,
  SwipeCheck,
  SwipeClosed,
  SwipeDriverName,
  SwipeOpened,
  SwipeRole,
  SwipeRowOptions,
  SwipeRowSpec,
  SwipeSide,
  SwipeSideOption,
  SwipeSideSpec,
  SwipeStyle,
  SwipeTileInput,
  SwipeTileLayout,
  SwipeTileLook,
  SwipeTriggered,
} from './types.js'
export { info, strip, swipeStyle, tiles } from './styles.js'
export {
  registerSwipeDriver,
  resolveSwipeDriver,
  setSwipeDriverOrder,
  swipeDriverOrder,
  swipeDrivers,
  unregisterSwipeDriver,
} from './drivers.js'
export type { ResolvedSwipeDriver, SwipeDriver, SwipeDriverStatus } from './drivers.js'
export {
  DEFAULT_GROUP,
  closeAllSwipes,
  closeOtherSwipes,
  closeSwipe,
  joinSwipeGroup,
  openSwipeCount,
} from './group.js'
export type { CloseOptions, SwipeMember } from './group.js'
export {
  swipeAccessibilityAttributes,
  swipeEventAttributes,
  swipeRow,
  swipeRowSpec,
} from './row.js'
export { stageCount as swipeStageCount } from './stage.js'
export {
  ASSUMED_ROW_WIDTH,
  FLICK_SPEED,
  armedSide,
  decide,
  dragTo,
  fullSwipeAt,
  restAt,
} from './core.js'
export type { Limits as SwipeLimits } from './core.js'
