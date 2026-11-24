/**
 * Swipe actions drawn by this project's own native view, with no React.
 *
 *   registerNativeSwipe()                once at startup: names the native view
 *   nativeSwipeRow(attributes, children) a row that swipes to show actions
 *   nativeSwipeOptions({...})            actions, full swipe, mode, group, Messages
 *   swipeAction({...})                   one action
 *   closeNativeSwipes(group)             an Effect that closes a group's open rows
 *   isNativeSwipeAvailable()             whether this build has the native view
 *
 * `detect.ts` explains how the answer is found, `swipeNative.ts` the row.
 * The native code is in `apps/showcase/modules/foldkit-swipe`, and
 * `docs/NATIVE_VIEWS.md` explains it.
 */
export {
  ACTION_TRIGGERED,
  NATIVE_SWIPE_TAG,
  SWIPE_CLOSED,
  SWIPE_OPENED,
  closeNativeSwipes,
  closeNativeSwipesNow,
  nativeSwipeOptions,
  nativeSwipeRow,
  nativeSwipeViewName,
  registerNativeSwipe,
  resetNativeSwipeName,
  swipeAction,
} from './swipeNative.js'
export type {
  NativeSwipeActionProp,
  NativeSwipeSettings,
  SwipeAction,
  SwipeActionRole,
  SwipeMode,
  SwipeSide,
  SwipeTriggerInfo,
} from './swipeNative.js'
export {
  NEEDS_PREBUILT,
  SWIPE_MODULE,
  SWIPE_VIEW,
  configureNativeSwipe,
  isNativeSwipeAvailable,
  nativeSwipeStatus,
  nativeSwipeUnavailableReason,
  resetNativeSwipeDetection,
  swipeExpoGlobal,
  swipeModule,
} from '../../host/swipeNative/detect.js'
export type { NativeSwipeOptions, SwipeExpoGlobal, SwipeModule } from '../../host/swipeNative/detect.js'
