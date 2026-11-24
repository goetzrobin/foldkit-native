/**
 * The phone's own screen stack, driven from a Foldkit view.
 *
 *   stack([], model.screens.map(screen_ =>
 *     screen([h.Key(screen_.id), onDismissed(count => PoppedByPhone({ count }))], [
 *       header([title('Notes')], []),
 *       safeArea(device, { hasHeader: true }, [...]),
 *     ])))
 *
 * The Model holds the list of screens. The last one is on top. Adding one
 * pushes it and removing the last pops it, with the phone's animation.
 *
 * A swipe-back pops the screen on the phone first and reports it after.
 * `onDismissed` turns that report into a Message so the Model can drop the
 * same screens and agree with the phone again.
 *
 * A screen can also arrive as a modal or a sheet: see `modalScreen`,
 * `presentation` and `sheet`. Sheets have more in `sheets.ts`. And it can refuse to be closed by the phone:
 * see `backBlocked`.
 *
 * The views are react-native-screens' native ones. None of its JavaScript is
 * used. Expo Go includes the native half. An app built on its own needs
 * `react-native-screens` installed.
 */
import { Option } from 'effect'
import type { Attribute, ChildAttribute, Html } from 'foldkit/html'
import { OnCustomEvent, element } from 'foldkit/renderTarget'

import { MODAL_SCREEN } from '../../host/navigation/tags.js'
import { prop } from '../attributes.js'
// Sheets first, then the native view names: the modal screen's hooks
// register after the sheet's, as they did when both were in this folder.
import './sheets.js'

export { registerNavigation } from '../../host/navigation/views.js'

const el = element<any>()

/** What an element takes as its first argument. */
export type Attributes<Message> = ReadonlyArray<Attribute<Message> | ChildAttribute>

/** The stack of screens. Its children are `screen`s, the last one on top. */
export const stack = el('stack')
/** One screen. Give each a stable `h.Key`. */
export const screen = el('screen')
/**
 * A screen shown over the others: a modal or a sheet. Give it a
 * `presentation` or a `sheet`. It is a child of the `stack` like any screen,
 * and `onDismissed` reports a swipe-down the same way.
 *
 * A presented screen has no navigation bar on iOS. Its content draws its own
 * title and its own way out.
 */
export const modalScreen = el(MODAL_SCREEN)
/** A screen's navigation bar. A direct child of its `screen`. */
export const header = el('native-header')

// `prop` and `style` live with the other native attributes.
export { prop, style } from '../attributes.js'

/** The navigation bar's title. Also a tab's title, on a `tab`. */
export const title = (value: string) => prop('title', value)

const countOf = (event: { detail?: unknown }): number =>
  (event.detail as { dismissCount?: number } | undefined)?.dismissCount ?? 1

/** The phone popped `count` screens by itself: drop the same from the Model. */
export const onDismissed = <Message>(toMessage: (count: number) => Message) =>
  OnCustomEvent<Message>({
    name: 'dismissed',
    f: event => Option.some(toMessage(countOf(event))),
  })

/** How a screen arrives. The names are react-native-screens' own. */
export type Presentation =
  | 'push'
  | 'modal'
  | 'fullScreenModal'
  | 'transparentModal'
  | 'pageSheet'
  | 'formSheet'

/**
 * How a screen arrives: `presentation('modal')`. Set it when the screen is
 * created and leave it. The phone reads it as the screen joins the stack.
 */
export const presentation = (kind: Presentation) => prop('stackPresentation', kind)

/** How the edge of a scrolling list fades under a bar. */
export type ScrollEdgeEffect = 'automatic' | 'hard' | 'soft' | 'hidden'

/**
 * iOS 26 and later: how this screen's scrolling content meets the bars at
 * each edge. `soft` fades it out under the glass, `hard` draws a firmer
 * line, `hidden` does nothing. An edge left out is the phone's choice.
 * Spread it into the screen's attributes:
 *
 *   screen([h.Key(key), ...scrollEdgeEffects({ top: 'soft', bottom: 'hidden' })], ...)
 */
export const scrollEdgeEffects = (
  edges: Readonly<{
    top?: ScrollEdgeEffect
    bottom?: ScrollEdgeEffect
    left?: ScrollEdgeEffect
    right?: ScrollEdgeEffect
  }>,
) => [
  prop('topScrollEdgeEffect', edges.top ?? 'automatic'),
  prop('bottomScrollEdgeEffect', edges.bottom ?? 'automatic'),
  prop('leftScrollEdgeEffect', edges.left ?? 'automatic'),
  prop('rightScrollEdgeEffect', edges.right ?? 'automatic'),
]

// Sheets have a file of their own. `sheet` is exported from here as before.
export { sheet } from './sheets.js'
export type { SheetOptions } from './sheets.js'

/**
 * The phone tried to close this screen (swipe, the bar's back button, a tap
 * beside a sheet) and was refused because of `backBlocked`.
 */
export const onBackRefused = <Message>(toMessage: () => Message) =>
  OnCustomEvent<Message>({
    name: 'nativeDismissCancelled',
    f: () => Option.some(toMessage()),
  })

/**
 * Android only: the arrow in the navigation bar was pressed while
 * `backBlocked` had taken the arrow away from the phone.
 */
export const onHeaderBackPressed = <Message>(toMessage: () => Message) =>
  OnCustomEvent<Message>({
    name: 'headerBackButtonClicked',
    f: () => Option.some(toMessage()),
  })

/**
 * Lets the Model decide whether this screen may be closed by the phone, for
 * unsaved changes and the like. Spread it into the screen's attributes:
 *
 *   screen([h.Key(key), ...backBlocked(model.isDirty, () => TriedToGoBack())], ...)
 *
 * While `isBlocked` is true the phone does not close the screen. Each attempt
 * sends the Message, and `update` decides: ask first, or pop anyway.
 *
 * iOS refuses the swipe and the bar's back button itself and reports the
 * attempt. Android's arrow is handed to the program while blocked. Android's
 * hardware Back button never closes a screen by itself: see `hardwareBack`.
 *
 * Both props are sent whether blocked or not. Left out, Android's arrow would
 * fall back to a default that differs from the one it starts with.
 */
export const backBlocked = <Message>(isBlocked: boolean, toMessage: () => Message) => [
  prop('preventNativeDismiss', isBlocked),
  prop('nativeBackButtonDismissalEnabled', !isBlocked),
  onBackRefused(toMessage),
  onHeaderBackPressed(toMessage),
]

export type Device = Readonly<{
  platform: 'ios' | 'android' | string
  /** The major OS version, such as 26. */
  osVersion: number
}>

/**
 * Keeps a screen's content clear of the notch, the home indicator, the
 * navigation bar and the tab bar. Wrap each screen's content in one.
 *
 * On iOS a screen runs under its navigation bar, so the top is inset there.
 * Measured on an iPhone: without it the content started at the very top of
 * the screen, 113 points of it hidden behind the bar. On Android a screen
 * with a navigation bar already starts below it.
 */
export const safeArea = (
  device: Device,
  options: Readonly<{ hasHeader: boolean }>,
  children: ReadonlyArray<any>,
): Html => {
  const isTopTaken = options.hasHeader && device.platform === 'android'
  return el('screen-safe-area')(
    [prop('edges', { top: !isTopTaken, right: true, bottom: true, left: true })],
    children as never,
  )
}
