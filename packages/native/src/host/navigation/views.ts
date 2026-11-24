/**
 * The native views of navigation, by tag: react-native-screens' stack,
 * screens, title bar, sheets and tabs. None of its JavaScript is used. Also
 * what a modal screen needs before it joins a stack. The elements that draw
 * these tags are the binding's (`src/foldkit/navigation`).
 */
import { type Engine, type EngineNode, registerViewName } from '@ng-native/fabric'

import type { NodeHooks } from '../fabric/nodes.js'
import { registerNodeHooks } from '../fabric/registry.js'
import { MODAL_SCREEN } from './tags.js'

import { SHEET_CONTENT, SHEET_FOOTER } from './tags.js'

/** Asks React Native for react-native-screens' native module, which on
 *  Android installs the listener that animates a removed screen away. */
const loadScreensModule = (): void => {
  const host = globalThis as {
    __turboModuleProxy?: (name: string) => unknown
    nativeModuleProxy?: Record<string, unknown>
  }
  void (host.__turboModuleProxy?.('RNSModule') ?? host.nativeModuleProxy?.['RNSModule'])
}


/** Fills the stack, as the core does for `screen`. */
const SCREEN_FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const

/** No limit on where a swipe may start. An edge left out is 0 natively. */
const UNLIMITED_SWIPE = { start: -1, end: -1, top: -1, bottom: -1 } as const

/** Set once and never lowered: react-native-screens rejects a decrease. */
const ACTIVE = 2

/**
 * A `modalScreen` needs the same three things before it joins the stack that
 * the core gives a `screen`. The core only knows the `screen` tag, so this
 * does it for the other one.
 */
const modalScreenHooks = (engine: Engine): NodeHooks => ({
  create: (node: EngineNode): void => {
    if (node.tag !== MODAL_SCREEN) return
    engine.setDefaultStyle(node, SCREEN_FILL)
    engine.setProp(node, 'activityState', ACTIVE)
    engine.setProp(node, 'gestureResponseDistance', UNLIMITED_SWIPE)
  },
})

registerNodeHooks(modalScreenHooks)

let isRegistered = false

/** Call once at startup, before the first draw. */
export const registerNavigation = (): void => {
  if (isRegistered) return
  isRegistered = true
  loadScreensModule()
  registerViewName('stack', 'RNSScreenStack', { flex: 1 })
  registerViewName('screen', 'RNSScreen')
  // react-native-screens' own JavaScript uses a second native view for a
  // screen that is presented over the others on iOS (a modal or a sheet),
  // because such a screen is not laid out inside the stack's frame. Android
  // has one view for both.
  registerViewName(MODAL_SCREEN, { ios: 'RNSModalScreen', android: 'RNSScreen' })
  // The absolute position matters: without it the header takes part in the
  // screen's layout and every page starts a header's height too far down.
  registerViewName('native-header', 'RNSScreenStackHeaderConfig', {
    position: 'absolute',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  })
  // A view placed in one of the navigation bar's slots. The styles are the
  // ones react-native-screens' own wrapper gives it.
  registerViewName('native-header-item', 'RNSScreenStackHeaderSubview', {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  })
  registerViewName('screen-safe-area', 'RNSSafeAreaView', { flex: 1 })
  // What goes inside a sheet: see the binding's `navigation/sheets.ts`. The footer is Android's. iOS
  // has a view of that name that does nothing, and `sheetFooter` does not
  // draw it there.
  // No default styles here: the engine keeps one default per native view, not
  // per name, and the content view needs two sets. `sheetContent` sends them.
  registerViewName(SHEET_CONTENT, 'RNSScreenContentWrapper')
  registerViewName(SHEET_FOOTER, 'RNSScreenFooter')
  // Tabs have one native view per platform. The fills are the ones
  // react-native-screens' wrappers give them. A tab's screen is absolute
  // because all of them share one space, with one visible at a time.
  registerViewName(
    'tab-bar',
    { ios: 'RNSTabsHostIOS', android: 'RNSTabsHostAndroid' },
    { flex: 1, width: '100%', height: '100%' },
  )
  registerViewName(
    'tab-screen',
    { ios: 'RNSTabsScreenIOS', android: 'RNSTabsScreenAndroid' },
    { position: 'absolute', flex: 1, width: '100%', height: '100%' },
  )
  // iOS 26 and later: the strip above the tab bar. See `bottomAccessory` in
  // the binding's `navigation/tabs.ts`, which draws them on no other phone.
  registerViewName('tab-bar-accessory', 'RNSTabsBottomAccessory')
  registerViewName('tab-bar-accessory-content', 'RNSTabsBottomAccessoryContent')
}

/** The search field in the title bar. */
export const SEARCH_BAR = 'native-search-bar'

let isSearchBarRegistered = false

/** Names the search field's native view. Call once at startup. */
export const registerSearchBar = (): void => {
  if (isSearchBarRegistered) return
  isSearchBarRegistered = true
  registerViewName(SEARCH_BAR, 'RNSSearchBar')
}
