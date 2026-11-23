/**
 * The phone's own tab bar: a `UITabBarController` on iOS, a bottom
 * navigation bar on Android.
 *
 *   tabs({ selected: model.tab, onSelected: key => SelectedTab({ key }) }, [
 *     tab({ key: 'home', title: 'Home', symbol: 'house' }, [stack(...)]),
 *     tab({ key: 'inbox', title: 'Inbox', symbol: 'tray', badge: '3' }, [stack(...)]),
 *   ])
 *
 * Every tab stays mounted, so a tab is found as it was left: its scroll
 * position, its text, its own stack of screens.
 *
 * Who decides which tab shows. A tap changes the tab on the phone at once,
 * so the bar never lags the finger, and then reports it. `onSelected` turns
 * the report into a Message and the Model catches up, exactly as it does
 * after a swipe-back. The Model changing `selected` changes the phone's tab.
 * So `update` should accept the tab it is told about. A tab that must ask
 * first (unsaved changes) is marked `isLocked`: the phone then leaves the
 * choice to the Model and only reports the tap.
 *
 * Each change on the phone has a number that counts up. A request to change
 * tab must carry the last number the phone reported, which is how the phone
 * tells a current request from one that crossed a tap in flight. The Model
 * does not need to know about the number. The module at the bottom of this
 * file keeps it.
 *
 * These are react-native-screens' tab views (4.30). Expo Go includes them.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { type Module, OnCustomEvent, type VNode, element } from 'foldkit/renderTarget'

import { registerModule } from '../extend.js'
import { bagOf, nodeOf } from '../modules.js'
import { prop } from '../attributes.js'
import type { Attributes } from './stack.js'

const el = element<any>()

const TAB_BAR = 'tab-bar'
const REQUEST = 'navStateRequest'

export type TabsOptions<Message> = Readonly<{
  /** The key of the tab to show. */
  selected: string
  /** The phone changed tab, by a tap or by itself. Make the Model agree. */
  onSelected: (key: string) => Message
  /**
   * The tab already showing was tapped again. Apps usually pop that tab's
   * stack to its first screen. The phone does not do it by itself here, so
   * that the Model stays the one place that changes a stack.
   */
  onReselected?: (key: string) => Message
  /** A tab marked `isLocked` was tapped. The phone did not change tab. */
  onLockedTabPressed?: (key: string) => Message
  /** Hides the bar and keeps the tabs. */
  isBarHidden?: boolean
  /** iOS: the colour of the selected item. */
  tintColor?: string
  /** Anything else for the tab bar's view: a `testID`, more `prop`s. */
  attributes?: Attributes<Message>
}>

type Selection = Readonly<{
  selectedScreenKey?: string
  preventedScreenKey?: string
  isRepeated?: boolean
  /** `user` for a tap. `programmatic-js` is the phone doing what it was told. */
  actionOrigin?: string
}>

/** The tab bar and the screens behind it. Its children are `tab`s. */
export const tabs = <Message>(
  options: TabsOptions<Message>,
  children: ReadonlyArray<Html>,
): Html => {
  const attributes: Array<unknown> = [
    // The number is filled in by the module below.
    prop(REQUEST, { selectedScreenKey: options.selected, baseProvenance: 0 }),
    OnCustomEvent<Message>({
      name: 'tabSelected',
      f: event => {
        const selection = event.detail as Selection | undefined
        const key = selection?.selectedScreenKey
        // The phone answering the Model's own request is nothing to follow.
        if (key === undefined || selection?.actionOrigin === 'programmatic-js') {
          return Option.none()
        }
        if (selection?.isRepeated === true) {
          return options.onReselected === undefined
            ? Option.none()
            : Option.some(options.onReselected(key))
        }
        return Option.some(options.onSelected(key))
      },
    }),
  ]
  const onLockedTabPressed = options.onLockedTabPressed
  if (onLockedTabPressed !== undefined) {
    attributes.push(
      OnCustomEvent<Message>({
        name: 'tabSelectionPrevented',
        f: event => {
          const key = (event.detail as Selection | undefined)?.preventedScreenKey
          return key === undefined ? Option.none() : Option.some(onLockedTabPressed(key))
        },
      }),
    )
  }
  if (options.isBarHidden !== undefined) attributes.push(prop('tabBarHidden', options.isBarHidden))
  if (options.tintColor !== undefined) attributes.push(prop('tabBarTintColor', options.tintColor))
  attributes.push(...(options.attributes ?? []))
  return el(TAB_BAR)(attributes as never, children)
}

export type TabOptions<Message> = Readonly<{
  /** Names the tab. Unique in the bar, and not empty. */
  key: string
  /** The words under the icon. */
  title?: string
  /**
   * iOS: an SF Symbol name, such as `house` or `gearshape`. SF Symbols come
   * with iOS, so an icon needs no image file and no extra package.
   */
  symbol?: string
  /**
   * Android: the name of a drawable resource built into the app. Expo Go has
   * none of an app's own, so there a tab shows its title alone.
   */
  drawable?: string
  /** A small label on the item: a count, or one character for a dot. */
  badge?: string
  /** Taps on this tab are reported and the phone does not change tab. */
  isLocked?: boolean
  /** Anything else for the tab's view: a `testID`, more `prop`s. */
  attributes?: Attributes<Message>
}>

/**
 * A second tap on the tab in front would, by default, pop that tab's stack on
 * the phone. That is turned off: the tap is reported through `onReselected`
 * and the Model pops. Scrolling a list to its top stays the phone's.
 */
const REPEATED_TAP = { repeatedTabSelection: { popToRoot: false, scrollToTop: true } } as const

/** One item in the bar and the screen behind it. A child of `tabs`. */
export const tab = <Message>(options: TabOptions<Message>, children: ReadonlyArray<Html>): Html => {
  const attributes: Array<unknown> = [
    prop('screenKey', options.key),
    // Not a synonym for "no title": with a title set and this left at its
    // default, iOS draws the icon with a gap where the words belong.
    prop('isTitleUndefined', options.title === undefined),
    prop('specialEffects', REPEATED_TAP),
    prop('preventNativeSelection', options.isLocked ?? false),
  ]
  if (options.title !== undefined) attributes.push(prop('title', options.title))
  if (options.symbol !== undefined) {
    attributes.push(prop('iconType', 'sfSymbol'), prop('iconResourceName', options.symbol))
  }
  if (options.drawable !== undefined) {
    attributes.push(prop('drawableIconResourceName', options.drawable))
  }
  if (options.badge !== undefined) attributes.push(prop('badgeValue', options.badge))
  attributes.push(...(options.attributes ?? []))
  return el('tab-screen')(attributes as never, children)
}

type Bar = {
  /** The number of the last change the phone reported. 0 before the first. */
  provenance: number
  stops: Array<() => void>
}

const bars = new WeakMap<EngineNode, Bar>()

const selectedOf = (vnode: VNode): string | undefined =>
  (bagOf(vnode, 'props')[REQUEST] as { selectedScreenKey?: string } | undefined)
    ?.selectedScreenKey

/** Every report that carries the phone's current number. */
const REPORTS = ['topTabSelected', 'topTabSelectionRejected', 'topTabSelectionPrevented'] as const

/**
 * Keeps the phone's change number for each tab bar and puts it on every
 * request to change tab.
 */
const tabsModule = (engine: Engine): Partial<Module> => {
  const request = (node: EngineNode, bar: Bar, key: string): void =>
    engine.setProp(node, REQUEST, { selectedScreenKey: key, baseProvenance: bar.provenance })

  const create = (_empty: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined || node.tag !== TAB_BAR) return
    const bar: Bar = { provenance: 0, stops: [] }
    bars.set(node, bar)
    for (const report of REPORTS) {
      bar.stops.push(
        engine.setEventListener(node, report, event => {
          const provenance = (event as { nativeEvent?: { provenance?: number } })?.nativeEvent
            ?.provenance
          if (typeof provenance === 'number') bar.provenance = provenance
        }),
      )
    }
  }
  const update = (oldVnode: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const bar = bars.get(node)
    const selected = selectedOf(vnode)
    if (bar === undefined || selected === undefined) return
    // Only a change of tab is a request. Sending the same tab again on every
    // draw would ask the phone to select what it already shows.
    if (selectedOf(oldVnode) !== selected) request(node, bar, selected)
  }
  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    for (const stop of bars.get(node)?.stops ?? []) stop()
    bars.delete(node)
  }
  return { create, update, destroy }
}

registerModule(tabsModule)
