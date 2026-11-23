/**
 * Everything navigation offers a program, gathered from the files beside
 * this one:
 *
 *   stack.ts   the screen stack, modals and sheets, blocking back, safe area
 *   header.ts  the navigation bar
 *   tabs.ts    the tab bar
 *   back.ts    Android's Back button
 *   route.ts   a stack of routes in the Model
 */
export {
  backBlocked,
  header,
  modalScreen,
  onBackRefused,
  onDismissed,
  onHeaderBackPressed,
  presentation,
  prop,
  registerNavigation,
  safeArea,
  screen,
  sheet,
  stack,
  style,
  title,
} from './stack.js'
export type { Attributes, Device, Presentation, SheetOptions } from './stack.js'
export {
  backButtonHidden,
  backTitle,
  headerHidden,
  largeTitle,
  leftBarButtons,
  navigationBar,
  onBarButtonPressed,
  rightBarButtons,
} from './header.js'
export type { BarButton, NavigationBarOptions } from './header.js'
export { tab, tabs } from './tabs.js'
export type { TabOptions, TabsOptions } from './tabs.js'
export { backSourceFrom, hardwareBack, noBackSource } from './back.js'
export type { BackHandlerLike, BackSource, HardwareBackConfig } from './back.js'
export { canPop, pop, popByPhone, popTo, popToRoot, push, replace, stackOf } from './route.js'
export type { Place, Routes, ScreenView, StackOfOptions } from './route.js'
