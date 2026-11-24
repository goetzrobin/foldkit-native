/**
 * Code on the phone's UI thread, with no React.
 *
 *   configureWorklets({ load, nativeModule })   once at startup
 *   workletsStatus()                            what this build can do, and why not
 *   runOnUi(worklet, ...args)                   start a worklet on the UI thread
 *   const x = shared(0)                         a value both threads can use
 *   uiThread({ style, inputs, pan, channel }, element)
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
} from './host.js'
export type { Check, WorkletsOptions, WorkletsPackage } from './host.js'
export {
  isCompiledWorklet,
  readShared,
  requireCompiledWorklets,
  runOnUi,
  runOnUiSync,
  shared,
  workletCheck,
  writeShared,
} from './run.js'
export type { Shared, UiResult } from './run.js'
export {
  PAN_ACTIVE,
  PAN_END,
  bounceBetween,
  measureView,
  probeView,
  sendMessage,
  springTo,
  stopAnimation,
} from './ui.js'
export type { Measured, PanEvent, Spring, UiTarget } from './ui.js'
export { listenToChannel, uiChannel } from './channel.js'
export type { UiChannel } from './channel.js'
export { gestureRoot, onUiMessage, uiRef, uiThread } from './views.js'
export type { UiConfig, UiRef, UiStyle } from './views.js'
export { ranOnUiCheck, sharedRoundTripCheck, workletsStatus } from './status.js'
export type { WorkletsStatus } from './status.js'
