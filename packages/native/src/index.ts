export { createNativeSurface } from './foldkit/mount.js'
export type { NativeSurface, NativeSurfaceOptions } from './foldkit/mount.js'
export { image, pressable, scrollView, text, textInput, view } from './foldkit/elements.js'
export * from './navigation.js'
export { registerModule } from './foldkit/extend.js'
export type { ModuleFactory } from './foldkit/extend.js'
export {
  accessibilityLabel,
  onPress,
  placeholder,
  pressedStyle,
  testId,
  value,
} from './foldkit/attributes.js'
export type {
  AutoLength,
  Color,
  LayoutStyle,
  Length,
  LookStyle,
  NativeStyle,
  TextStyle,
} from './foldkit/attributes.js'
export { crashView, nativeCrash } from './foldkit/crash.js'
export * from './host/styling/index.js'
// The phone's own features: haptics, clipboard, storage, share and more.
// Named Phone here because Device is already the type for platform and OS version.
export * as Phone from './foldkit/device/index.js'
// Reload that keeps the Model while developing. The dev loop has its own,
// fuller crash screen: import that one from './devLoop/index.js' directly.
export { hasFoldkitTransport, hotProgram, keepModel } from './foldkit/devLoop/index.js'
export type { HotModule, HotProgram, HotProgramOptions, ProgramFactory } from './foldkit/devLoop/index.js'
// Long lists that only draw the rows near the screen, and pull to refresh.
export {
  list,
  listRowCount,
  refreshScrollView,
  scrollListToEnd,
  scrollListToIndex,
} from './foldkit/list/index.js'
export type { AnchoredEndSpace, ListConfig, ListStats, Refresh, RowKey } from './foldkit/list/index.js'
// A chat screen: the composer above the keyboard, and the safe area around it.
export { chatSafeArea, composerDock } from './foldkit/chat/index.js'
export type { ComposerDock, ComposerDockMode } from './foldkit/chat/index.js'
// A bar that follows the keyboard frame by frame where the phone can do that.
export * from './foldkit/keyboard/index.js'
// Movement: eased style changes, enter and exit, and dragging.
export {
  animated,
  configureMotion,
  draggable,
  keepMoving,
  stopMotion,
  transition,
} from './foldkit/motion/index.js'
export type {
  Animated,
  Curve,
  Drag,
  Draggable,
  Easing,
  Enter,
  Exit,
  MotionOptions,
  Timing,
} from './foldkit/motion/index.js'
export {
  legendContainers,
  legendHandles,
  legendList,
  legendVisibleRange,
  scrollLegendListToEnd,
  scrollLegendListToIndex,
  setPixelRatio,
  setScreenReaderEnabled,
} from './foldkit/legend/index.js'
export type {
  AnchoredEndSpace as LegendAnchoredEndSpace,
  LegendListConfig,
  LegendPlatform,
} from './foldkit/legend/index.js'
export * from './foldkit/markdown/index.js'
export * as AiChat from './foldkit/aiChat/index.js'
