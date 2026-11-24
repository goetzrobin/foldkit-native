/**
 * The phone's own menus, with no React.
 *
 *   contextMenu(settings, element)   press and hold a view for a menu
 *   menuButton(settings)             a button that opens a menu
 *   rightBarButtons([{ id, symbol, menu }])   a title bar button with a menu (iOS)
 *   navigationBar(h, device, { rightButton: { menu } })   the same, both phones
 *   ActionSheet.Show({...})          a list of choices, asked for from `update`
 *   menusStatus()                    where each of these comes from in this build
 *
 * Call `registerExpoUi()` (from `../controls`) once at startup. Without it,
 * and in a build without Expo UI, the menus fall back: see `menu.ts`.
 */
import type { RouteLine } from '../controls/controls.js'
import { platformName } from '../controls/expoUi.js'
import { menuRoute, menuRouteName } from './menu.js'
import { sheetRoute, sheetRouteName } from './sheet.js'

export { HOLD_MS, contextMenu, menuButton, menuRoute, menuRouteName } from './menu.js'
export type { ContextMenuSettings, MenuButtonSettings, MenuRoute, MenuSettings } from './menu.js'
export { barMenuData, checkedTitle, flatten, isSection, isSubmenu } from './items.js'
export type { FlatAction, MenuAction, MenuItem, MenuSection, MenuSubmenu } from './items.js'
export { configureSheets, presentSheet, sheetRoute, sheetRouteName } from './sheet.js'
export type {
  NativeModuleLookup,
  SheetAnswer,
  SheetOption,
  SheetRequest,
  SheetRoute,
} from './sheet.js'
export * as ActionSheet from './actionSheet.js'
// The title bar's part lives with the bar. It is listed here so the menus
// are found in one place.
export { onBarMenuItemPressed } from '../navigation/header.js'
export type { BarButtonMenu } from '../navigation/header.js'

/** Each kind of menu with where it comes from in this build. Never throws. */
export const menusStatus = (): ReadonlyArray<RouteLine> => {
  const route = menuRoute()
  const name = menuRouteName()
  const isNative = route !== 'in-app'
  const isAndroid = platformName() === 'android'
  return [
    {
      feature: 'context menu',
      route:
        route === 'compose'
          ? `${name}, opened by a long press, with no preview`
          : route === 'swiftui'
            ? `${name}, with a preview`
            : name,
      isNative,
    },
    { feature: 'pull-down menu', route: name, isNative },
    isAndroid
      ? { feature: 'title bar menu', route: `a view in the bar that opens: ${name}`, isNative }
      : platformName() === 'ios'
        ? { feature: 'title bar menu', route: "react-native-screens' bar button menu", isNative: true }
        : { feature: 'title bar menu', route: 'not available: this is not a phone', isNative: false },
    sheetRoute() === 'none'
      ? {
          feature: 'action sheet',
          route: "not available: React Native's sheet module is not in this build",
          isNative: false,
        }
      : { feature: 'action sheet', route: sheetRouteName(), isNative: true },
  ]
}
