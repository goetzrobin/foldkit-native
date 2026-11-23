export { createNativeSurface } from './mount.js'
export type { NativeSurface, NativeSurfaceOptions } from './mount.js'
export { image, pressable, scrollView, text, textInput, view } from './elements.js'
export * from './navigation.js'
export { registerModule } from './extend.js'
export type { ModuleFactory } from './extend.js'
export {
  accessibilityLabel,
  onPress,
  placeholder,
  pressedStyle,
  testId,
  value,
} from './attributes.js'
export type {
  AutoLength,
  Color,
  LayoutStyle,
  Length,
  LookStyle,
  NativeStyle,
  TextStyle,
} from './attributes.js'
export { crashView, nativeCrash } from './crash.js'
export * from './styling/index.js'
// The phone's own features: haptics, clipboard, storage, share and more.
// Named Phone here because Device is already the type for platform and OS version.
export * as Phone from './device/index.js'
// Reload that keeps the Model while developing. The dev loop has its own,
// fuller crash screen: import that one from './devLoop/index.js' directly.
export { hasFoldkitTransport, hotProgram, keepModel } from './devLoop/index.js'
export type { HotModule, HotProgram, HotProgramOptions, ProgramFactory } from './devLoop/index.js'
