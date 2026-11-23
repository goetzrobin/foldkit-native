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
} from './stack'
export type { Attributes, Device, Presentation, SheetOptions } from './stack'
export {
  backButtonHidden,
  backTitle,
  headerHidden,
  largeTitle,
  leftBarButtons,
  navigationBar,
  onBarButtonPressed,
  rightBarButtons,
} from './header'
export type { BarButton, NavigationBarOptions } from './header'
export { tab, tabs } from './tabs'
export type { TabOptions, TabsOptions } from './tabs'
export { backSourceFrom, hardwareBack, noBackSource } from './back'
export type { BackHandlerLike, BackSource, HardwareBackConfig } from './back'
export { canPop, pop, popByPhone, popTo, popToRoot, push, replace, stackOf } from './route'
export type { Place, Routes, ScreenView, StackOfOptions } from './route'
