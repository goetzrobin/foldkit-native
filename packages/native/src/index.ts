export { createNativeSurface } from './mount.js'
export type { NativeSurface, NativeSurfaceOptions } from './mount.js'
export { image, pressable, scrollView, text, textInput, view } from './elements.js'
export {
  header,
  onDismissed,
  prop,
  registerNavigation,
  safeArea,
  screen,
  stack,
  style,
  title,
} from './navigation.js'
export type { Device } from './navigation.js'
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
