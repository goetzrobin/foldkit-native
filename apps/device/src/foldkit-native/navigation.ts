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
 * A swipe-back, or Android's Back button, pops the screen on the phone first
 * and reports it after. `onDismissed` turns that report into a Message so the
 * Model can drop the same screens and agree with the phone again.
 *
 * The views are react-native-screens' native ones. None of its JavaScript is
 * used. Expo Go includes the native half. An app built on its own needs
 * `react-native-screens` installed.
 */
import { registerViewName } from '@ng-native/fabric'
import { Option } from 'effect'
import { OnCustomEvent, Prop, element } from 'foldkit/renderTarget'

const el = element<any>()

/** Asks React Native for react-native-screens' native module, which on
 *  Android installs the listener that animates a removed screen away. */
const loadScreensModule = (): void => {
  const host = globalThis as {
    __turboModuleProxy?: (name: string) => unknown
    nativeModuleProxy?: Record<string, unknown>
  }
  void (host.__turboModuleProxy?.('RNSModule') ?? host.nativeModuleProxy?.['RNSModule'])
}

let isRegistered = false

/** Call once at startup, before the first draw. */
export const registerNavigation = (): void => {
  if (isRegistered) return
  isRegistered = true
  loadScreensModule()
  registerViewName('stack', 'RNSScreenStack', { flex: 1 })
  registerViewName('screen', 'RNSScreen')
  // The absolute position matters: without it the header takes part in the
  // screen's layout and every page starts a header's height too far down.
  registerViewName('native-header', 'RNSScreenStackHeaderConfig', {
    position: 'absolute',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  })
  registerViewName('screen-safe-area', 'RNSSafeAreaView', { flex: 1 })
}

/** The stack of screens. Its children are `screen`s, the last one on top. */
export const stack = el('stack')
/** One screen. Give each a stable `h.Key`. */
export const screen = el('screen')
/** A screen's navigation bar. A direct child of its `screen`. */
export const header = el('native-header')

/** A native prop with any value, where `h.Attribute` takes only text. */
export const prop = (key: string, value: unknown) => Prop({ key, value })

/**
 * Native styles, as React Native names them: `style({ paddingVertical: 12 })`.
 * `h.Style` accepts web CSS names only, so native-only ones go through here.
 */
export const style = (value: Readonly<Record<string, string | number>>) =>
  prop('style', value)

/** The navigation bar's title. */
export const title = (value: string) => prop('title', value)

/** The phone popped `count` screens by itself: drop the same from the Model. */
export const onDismissed = <Message>(toMessage: (count: number) => Message) =>
  OnCustomEvent<Message>({
    name: 'dismissed',
    f: event =>
      Option.some(
        toMessage((event.detail as { dismissCount?: number } | undefined)?.dismissCount ?? 1),
      ),
  })

export type Device = Readonly<{
  platform: 'ios' | 'android' | string
  /** The major OS version, such as 26. */
  osVersion: number
}>

/**
 * Keeps a screen's content clear of the notch, the home indicator and the
 * navigation bar. Wrap each screen's content in one.
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
) => {
  const isTopTaken = options.hasHeader && device.platform === 'android'
  return el('screen-safe-area')(
    [prop('edges', { top: !isTopTaken, right: true, bottom: true, left: true })],
    children as never,
  )
}
