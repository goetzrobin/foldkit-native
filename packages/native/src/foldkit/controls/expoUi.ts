/**
 * Expo UI with no React: the phone's own SwiftUI views on iOS and Jetpack
 * Compose views on Android, as Foldkit elements.
 *
 *   registerExpoUi()                       once at startup, after `import 'expo'`
 *   expoUiKind()                           'swiftui', 'compose' or 'none'
 *   expoUiHost({ match: 'both' }, [], [    the box SwiftUI or Compose draws in
 *     swiftUi('GaugeView')([prop('value', 0.4)], []),
 *   ])
 *
 * Expo ships these views as the package `@expo/ui`, and Expo Go includes
 * the native code (Expo's SDK 58 page for the package says "Included in
 * Expo Go"). The package's JavaScript is React components that pass props
 * to native views. None of it is used here. What it does was read from its
 * source (58.0.29) and is done by hand:
 *
 * - Every view is a view of the native module `ExpoUI`. Its name on the
 *   phone is `ViewManagerAdapter_ExpoUI_<View>`, plus the project's name in
 *   Expo Go (see `expoViewName`).
 * - SwiftUI and Compose views only draw inside a `HostView`. The host is an
 *   ordinary native view, laid out like any other. `matchContentsVertical`
 *   and `matchContentsHorizontal` make it as tall or as wide as what is
 *   drawn in it.
 * - Children are ordinary children. Where a view has named places for its
 *   children (a menu's label, a picker's choices) each goes inside a
 *   `SlotView` with a `name` (SwiftUI) or `slotName` (Compose).
 * - A view of the app's own goes inside SwiftUI or Compose content through
 *   an `RNHostView`.
 * - SwiftUI "modifiers" are a prop: a list of `{ $type: 'disabled', ... }`.
 * - Events arrive like any native event: `onButtonPress` is `topButtonPress`.
 *
 * Nothing in this file throws. Where Expo UI is missing, `expoUiKind()` is
 * `'none'` and `expoUiUnavailableReason()` says why in plain words.
 */
import { registerViewName } from '@ng-native/fabric'
import type { Html } from 'foldkit/html'
import { element } from 'foldkit/renderTarget'

import { platformName } from '../../host/platform.js'
import { prop } from '../attributes.js'

const el = element<any>()

/** The name Expo's native module is registered by. */
export const EXPO_UI_MODULE = 'ExpoUI'

/** The part of Expo's global object this file reads. */
export type ExpoGlobal = Readonly<{
  /** Expo Go's name for the project that is running. Empty in an app built on its own. */
  __expo_app_identifier__?: string
  modules?: Readonly<Record<string, unknown>>
  getViewConfig?: (moduleName: string, viewName?: string) => unknown
}>

export type ExpoUiKind = 'swiftui' | 'compose' | 'none'

export type ExpoUiOptions = Readonly<{
  /**
   * `false` switches every menu and control to its fallback. `true` says
   * Expo UI is there without looking. `'detect'` (the default) looks.
   */
  available?: boolean | 'detect'
  /** Expo's global object, in place of `globalThis.expo`. `null` says there is none. */
  expo?: ExpoGlobal | null | 'global'
}>

/**
 * The views this project uses, by a short name: the SwiftUI view on iOS and
 * the Compose view on Android. `null` where that phone has no such view.
 */
const VIEWS = {
  host: ['HostView', 'HostView'],
  'rn-host': ['RNHostView', 'RNHostView'],
  slot: ['SlotView', 'SlotView'],
  text: ['TextView', 'TextView'],
  button: ['Button', 'Button'],
  divider: ['DividerView', 'HorizontalDividerView'],
  menu: ['MenuView', 'DropdownMenuView'],
  'context-menu': ['ContextMenu', null],
  section: ['SectionView', null],
  toggle: ['ToggleView', 'SwitchView'],
  slider: ['SliderView', 'SliderView'],
  stepper: ['StepperView', null],
  picker: ['PickerView', null],
  'date-picker': ['DatePickerView', 'DateTimePickerView'],
  progress: ['ProgressView', 'LinearProgressIndicatorView'],
  'circular-progress': [null, 'CircularProgressIndicatorView'],
  'menu-item': [null, 'DropdownMenuItemView'],
  'segmented-row': [null, 'SingleChoiceSegmentedButtonRowView'],
  'segmented-button': [null, 'SegmentedButtonView'],
} as const satisfies Record<string, readonly [string | null, string | null]>

export type ExpoUiView = keyof typeof VIEWS

/** The element name the engine knows one of the views by. */
export const expoUiTag = (view: ExpoUiView): string => `fk-ui-${view}`

let given: boolean | 'detect' = 'detect'
let expoSource: ExpoGlobal | null | 'global' = 'global'
let isRegistered = false
let found: { kind: ExpoUiKind; reason: string } | undefined
const viewChecks = new Map<string, boolean>()

/** Optional. Call at startup, before the first draw. */
export const configureExpoUi = (options: ExpoUiOptions): void => {
  if (options.available !== undefined) given = options.available
  if (options.expo !== undefined) expoSource = options.expo
  found = undefined
  viewChecks.clear()
}

const expoGlobal = (): ExpoGlobal | undefined => {
  if (expoSource !== 'global') return expoSource ?? undefined
  const expo = (globalThis as { expo?: ExpoGlobal | null }).expo
  return expo === null || expo === undefined ? undefined : expo
}

/** `ios`, `android`, or whatever else the engine was told. Never throws. */
export { platformName }

const isAndroid = (): boolean => platformName() === 'android'

/**
 * The name the phone knows a view of an Expo module by: the one Expo's own
 * JavaScript works out (`requireNativeView` in `expo-modules-core`). Expo Go
 * adds the running project's name to it.
 */
export const expoViewName = (moduleName: string, viewName: string): string => {
  let identifier = ''
  try {
    identifier = expoGlobal()?.__expo_app_identifier__ ?? ''
  } catch {
    identifier = ''
  }
  return `ViewManagerAdapter_${moduleName}_${viewName}${identifier === '' ? '' : `_${identifier}`}`
}

type Named = { name: string; undo: unknown }
const named = new Map<string, Named>()

const nameOne = (tag: string, ios: string | null, android: string | null): void => {
  // A view one phone lacks is a plain view there, not a view the phone has
  // never heard of.
  const names = {
    ios: ios === null ? 'View' : expoViewName(EXPO_UI_MODULE, ios),
    android: android === null ? 'View' : expoViewName(EXPO_UI_MODULE, android),
  }
  const key = `${names.ios}|${names.android}`
  const current = named.get(tag)
  if (current?.name === key) return
  if (typeof current?.undo === 'function') current.undo()
  named.set(tag, { name: key, undo: registerViewName(tag, names) })
}

/**
 * Names every view, again if Expo's project name has changed since. In Expo
 * Go the name may only be known after `registerExpoUi` ran, so the element
 * builders call this before they draw.
 */
const nameAll = (): void => {
  for (const view of Object.keys(VIEWS) as Array<ExpoUiView>) {
    const [ios, android] = VIEWS[view]
    nameOne(expoUiTag(view), ios, android)
  }
  for (const [tag, viewName] of others) nameOne(tag, viewName, viewName)
}

/**
 * Call once at startup, before the first draw, and after `import 'expo'`.
 * It only names the native views. It does not need them to exist: a build
 * without them draws the fallbacks.
 */
export const registerExpoUi = (): void => {
  try {
    nameAll()
    isRegistered = true
    found = undefined
    viewChecks.clear()
  } catch {
    // Not registered means every menu and control is its fallback.
  }
}

/** Back to the state before `registerExpoUi` and `configureExpoUi`. For tests. */
export const resetExpoUi = (): void => {
  given = 'detect'
  expoSource = 'global'
  isRegistered = false
  found = undefined
  viewChecks.clear()
}

const detect = (): { kind: ExpoUiKind; reason: string } => {
  const no = (reason: string) => ({ kind: 'none' as const, reason })
  try {
    if (!isRegistered) return no('the app did not call registerExpoUi()')
    const platform = platformName()
    if (platform !== 'ios' && platform !== 'android') {
      return no(`Expo UI draws on iOS and Android, and this is ${platform}`)
    }
    const kind: ExpoUiKind = platform === 'android' ? 'compose' : 'swiftui'
    if (given === true) return { kind, reason: '' }
    const expo = expoGlobal()
    if (expo === undefined) return no("Expo's native modules are not in this build")
    const module = expo.modules?.[EXPO_UI_MODULE]
    if (module === undefined || module === null) {
      return no("@expo/ui's native code is not in this build")
    }
    if (typeof expo.getViewConfig === 'function') {
      const config = expo.getViewConfig(EXPO_UI_MODULE, 'HostView')
      if (config === undefined || config === null) {
        return no('the native view HostView is missing from this build')
      }
    }
    return { kind, reason: '' }
  } catch (error) {
    return no(
      `looking for Expo UI failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

const resolved = (): { kind: ExpoUiKind; reason: string } => {
  if (given === false) return { kind: 'none', reason: 'switched off by the app' }
  // Asked once: a build does not gain or lose native code while it runs.
  if (found === undefined) found = detect()
  return found
}

/** Which Expo UI this build draws with. Never throws. */
export const expoUiKind = (): ExpoUiKind => resolved().kind

/** Why Expo UI is not there, in plain words. Empty when it is. */
export const expoUiUnavailableReason = (): string => resolved().reason

/** "SwiftUI" or "Jetpack Compose", for a line on screen. */
export const expoUiName = (): string =>
  expoUiKind() === 'swiftui' ? 'Expo UI (SwiftUI)' : 'Expo UI (Jetpack Compose)'

const hasNativeView = (viewName: string): boolean => {
  const known = viewChecks.get(viewName)
  if (known !== undefined) return known
  let has = true
  try {
    const expo = expoGlobal()
    if (given !== true && typeof expo?.getViewConfig === 'function') {
      const config = expo.getViewConfig(EXPO_UI_MODULE, viewName)
      has = config !== undefined && config !== null
    }
  } catch {
    has = false
  }
  viewChecks.set(viewName, has)
  return has
}

/**
 * Whether this build can draw one of the views: Expo UI is there, this
 * phone's kind has such a view, and the build has it. Never throws.
 */
export const hasExpoUiView = (view: ExpoUiView): boolean => {
  const kind = expoUiKind()
  if (kind === 'none') return false
  const viewName = VIEWS[view][kind === 'compose' ? 1 : 0]
  return viewName !== null && hasNativeView(viewName)
}

const ready = (): boolean => {
  try {
    nameAll()
    return true
  } catch {
    return false
  }
}

/** The element builder for one of the views. Call only after `hasExpoUiView`. */
export const ui = (view: ExpoUiView) => {
  ready()
  return el(expoUiTag(view))
}

// SMALL PIECES

/** One SwiftUI or Compose modifier, as Expo UI's own functions build them. */
export type Modifier = Readonly<{ $type: string; [key: string]: unknown }>

const modifierLists = new Map<string, ReadonlyArray<Modifier>>()

/**
 * The `modifiers` prop. A view builds its list again on every draw, so equal
 * lists are handed out as one and the same list: the phone is then only
 * told when something changed.
 */
export const modifiers = (list: ReadonlyArray<Modifier | false | undefined>) => {
  const kept = list.filter((each): each is Modifier => each !== false && each !== undefined)
  const key = JSON.stringify(kept)
  let known = modifierLists.get(key)
  if (known === undefined) {
    if (modifierLists.size > 500) modifierLists.clear()
    modifierLists.set(key, (known = kept))
  }
  return prop('modifiers', known)
}

/** SwiftUI's `disabled`, or nothing. */
export const disabledModifier = (isDisabled: boolean | undefined): Modifier | false =>
  isDisabled === true && { $type: 'disabled', disabled: true }

/** A named place for children. SwiftUI reads `name`, Compose reads `slotName`. */
export const slot = (name: string, children: ReadonlyArray<Html>): Html =>
  ui('slot')([prop(isAndroid() ? 'slotName' : 'name', name)] as never, children as never)

/** A line of text drawn by SwiftUI or Compose. */
export const uiText = (content: string, attributes: ReadonlyArray<unknown> = []): Html =>
  ui('text')([prop('text', content), ...attributes] as never, [])

export type HostSettings = Readonly<{
  /**
   * Which sides of the host take their size from what is drawn in it. The
   * other sides come from the layout, like any view. `both` unless said.
   */
  match?: 'both' | 'vertical' | 'horizontal' | 'none'
  /** Light or dark, where it should not follow the phone's setting. */
  colorScheme?: 'light' | 'dark'
}>

/**
 * The box SwiftUI or Compose views are drawn in. Give it `style` like any
 * view. Every other Expo UI view must be inside one.
 */
export const expoUiHost = (
  settings: HostSettings,
  attributes: ReadonlyArray<unknown>,
  children: ReadonlyArray<Html>,
): Html => {
  const match = settings.match ?? 'both'
  return ui('host')(
    [
      prop('matchContentsVertical', match === 'both' || match === 'vertical'),
      prop('matchContentsHorizontal', match === 'both' || match === 'horizontal'),
      // Expo's own Host always sends one. Right-to-left is not handled here yet.
      prop('layoutDirection', 'leftToRight'),
      ...(settings.colorScheme === undefined ? [] : [prop('colorScheme', settings.colorScheme)]),
      ...attributes,
    ] as never,
    children as never,
  )
}

/**
 * A view of the app's own inside SwiftUI or Compose content: a menu's
 * trigger, a context menu's preview. It holds one view.
 *
 * The view is wrapped in one that is never optimised away, because the
 * native side sizes itself from the first real view inside it.
 */
export const hostedView = (
  match: 'both' | 'vertical',
  child: Html,
  attributes: ReadonlyArray<unknown> = [],
): Html =>
  ui('rn-host')(
    [
      prop('matchContentsVertical', true),
      prop('matchContentsHorizontal', match === 'both'),
      prop('expoInternalSizeFromChildren', true),
      prop('layoutRoot', false),
    ] as never,
    [el('view')([prop('collapsable', false), ...attributes] as never, [child] as never)],
  )

// THE GENERAL DOOR

const others = new Map<string, string>()

const other = (viewName: string) => {
  const tag = `fk-ui-x-${viewName.toLowerCase()}`
  if (!others.has(tag)) others.set(tag, viewName)
  ready()
  return el(tag)
}

const nothing = (_attributes: ReadonlyArray<any>, _children: ReadonlyArray<any>): Html =>
  el('view')([prop('accessibilityElementsHidden', true)] as never, [])

/**
 * Any SwiftUI view of Expo UI, by the name its native code registers it
 * under (`GaugeView`, `ColorPickerView`, `LabelView`: see the package's
 * `ios/ExpoUIModule.swift`). Its props and events are the native view's own.
 * Use it inside an `expoUiHost`.
 *
 * On a phone that does not draw SwiftUI it is an empty view, so check
 * `expoUiKind() === 'swiftui'` and draw something else there.
 */
export const swiftUi = (viewName: string) =>
  expoUiKind() === 'swiftui' && hasNativeView(viewName) ? other(viewName) : nothing

/**
 * Any Jetpack Compose view of Expo UI, by its native name (`CheckboxView`,
 * `FilterChipView`: see the package's `ExpoUIModule.kt`). An empty view on
 * a phone that does not draw Compose.
 */
export const compose = (viewName: string) =>
  expoUiKind() === 'compose' && hasNativeView(viewName) ? other(viewName) : nothing
