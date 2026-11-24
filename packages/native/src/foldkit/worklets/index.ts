/**
 * Code on the phone's UI thread, with no React.
 *
 *   configureWorklets({ load, nativeModule })   once at startup
 *   workletsStatus()                            what this build can do, and why not
 *   runOnUi(worklet, ...args)                   start a worklet on the UI thread
 *   const x = shared(0)                         a value both threads can use
 *   uiThread({ style, inputs, pan, panConfig, channel }, element)
 *                                               tie an element to worklets
 *   sendMessage(channel, name, detail)          from a worklet, back to Foldkit
 *   onUiMessage(name, detail => Message)        the Message for it
 *   springTo(x, 120)                            a spring, a step per frame, on the UI thread
 *
 * `host.ts` explains the three native pieces and how they are found,
 * `ui.ts` what a worklet is and holds the ones that ship, `run.ts` the two
 * threads, and `views.ts` how an element is tied to them.
 *
 * The app must build with the Babel plugin `react-native-worklets/plugin`.
 * Expo's preset adds it by itself when the package is installed.
 */
export {
  configureWorklets,
  gesturesCheck,
  isWorkletsAvailable,
  resetWorklets,
  uiRuntimeCheck,
  viewUpdatesCheck,
  workletsUnavailableReason,
} from '../../host/worklets/host.js'
export type { Check, WorkletsOptions, WorkletsPackage } from '../../host/worklets/host.js'
export {
  isCompiledWorklet,
  readShared,
  requireCompiledWorklets,
  runOnUi,
  runOnUiSync,
  shared,
  workletCheck,
  writeShared,
} from '../../host/worklets/run.js'
export type { Shared, UiResult } from '../../host/worklets/run.js'
export {
  PAN_ACTIVE,
  PAN_BEGAN,
  PAN_CANCELLED,
  PAN_END,
  PAN_FAILED,
  bounceBetween,
  measureView,
  probeView,
  sendMessage,
  springTo,
  stopAnimation,
} from '../../host/worklets/ui.js'
export type { Measured, PanEvent, Spring, UiTarget } from '../../host/worklets/ui.js'
export { listenToChannel, uiChannel } from '../../host/worklets/channel.js'
export type { UiChannel } from '../../host/worklets/channel.js'
export { gestureRoot, gestureTag, onUiMessage, uiRef, uiThread } from './views.js'
export type { GestureTag, PanConfig, PanRelations, UiConfig, UiRef, UiStyle } from './views.js'
export { ranOnUiCheck, sharedRoundTripCheck, workletsStatus } from '../../host/worklets/status.js'
export type { WorkletsStatus } from '../../host/worklets/status.js'
