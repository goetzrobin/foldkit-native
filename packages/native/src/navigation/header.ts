/**
 * The navigation bar at the top of a screen: its title, a large title, a
 * button on the right, what the back button says, and hiding the bar.
 *
 *   screen([h.Key('details')], [
 *     navigationBar(h, device, {
 *       title: 'Details',
 *       isLargeTitle: model.isLargeTitle,
 *       backTitle: 'List',
 *       rightButton: { label: 'Add', symbol: 'plus', onPress: PressedAdd() },
 *     }),
 *     safeArea(device, { hasHeader: true }, [...]),
 *   ])
 *
 * The bar is the phone's own. Its props are react-native-screens' own names.
 * It must be a direct child of its `screen`.
 *
 * The right button is drawn two ways, because the two phones differ:
 * on iOS it is a native bar button, described as data on the bar, and the
 * bar reports a press with the button's id. Android's bar ignores that data,
 * so there the button is a small view placed in the bar's right slot.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, element } from 'foldkit/renderTarget'

import { type Attributes, type Device, header, prop, style, title } from './stack.js'

const el = element<any>()

/** A view placed in one of the bar's slots. Children of a `header` only. */
const headerItem = el('native-header-item')
const view = el('view')
const text = el('text')

/** A large title under the bar, as in the iPhone's Settings. iOS only. */
export const largeTitle = (isLarge: boolean) => prop('largeTitle', isLarge)

/** Hides the whole bar. The screen keeps its swipe-back. */
export const headerHidden = (isHidden: boolean) => prop('hidden', isHidden)

/**
 * What this screen's back button says. Without it, iOS shows the title of
 * the screen below. Android shows an arrow and no words.
 */
export const backTitle = (value: string) => prop('backTitle', value)

/** Takes the back button away. Swipe-back still works. */
export const backButtonHidden = (isHidden: boolean) => prop('hideBackButton', isHidden)

/** One native button in the bar, as iOS reads it. */
export type BarButton = Readonly<{
  /** Comes back in `onBarButtonPressed`. Unique within the bar. */
  id: string
  label?: string
  /** An SF Symbol name, such as `plus`. Shown in place of the label. */
  symbol?: string
  isDisabled?: boolean
}>

const barButtonData = (buttons: ReadonlyArray<BarButton>) =>
  buttons.map((button, index) => {
    const data: Record<string, unknown> = { buttonId: button.id, index }
    if (button.label !== undefined) data['title'] = button.label
    if (button.symbol !== undefined) data['sfSymbolName'] = button.symbol
    if (button.isDisabled !== undefined) data['disabled'] = button.isDisabled
    return data
  })

/** iOS only: native buttons on the right of the bar. Android ignores it. */
export const rightBarButtons = (buttons: ReadonlyArray<BarButton>) =>
  prop('headerRightBarButtonItems', barButtonData(buttons))

/** iOS only: native buttons on the left of the bar. Android ignores it. */
export const leftBarButtons = (buttons: ReadonlyArray<BarButton>) =>
  prop('headerLeftBarButtonItems', barButtonData(buttons))

/** iOS only: one of the bar's native buttons was pressed. Put it on the `header`. */
export const onBarButtonPressed = <Message>(toMessage: (id: string) => Option.Option<Message>) =>
  OnCustomEvent<Message>({
    name: 'pressHeaderBarButtonItem',
    f: event => {
      const id = (event.detail as { buttonId?: unknown } | undefined)?.buttonId
      return typeof id === 'string' ? toMessage(id) : Option.none()
    },
  })

export type NavigationBarOptions<Message> = Readonly<{
  title: string
  isLargeTitle?: boolean
  isHidden?: boolean
  backTitle?: string
  isBackButtonHidden?: boolean
  /** One button on the right that sends a Message. */
  rightButton?: Readonly<{
    label: string
    /** iOS: an SF Symbol shown in place of the label. */
    symbol?: string
    /** For tests to find it: on the button's view (Android) or the bar (iOS). */
    testID?: string
    onPress: Message
    /** Android: the label's colour. The bar there does not tint a view. */
    color?: string
  }>
  /** Anything else for the bar: more `prop`s, a `testID`. */
  attributes?: Attributes<Message>
}>

const RIGHT_BUTTON_ID = 'right'

/**
 * A screen's navigation bar with the common options filled in for the phone
 * it runs on. For anything it does not cover, build one from `header` and
 * the single helpers in this file.
 */
export const navigationBar = <Message>(
  h: HtmlBuilder<Message>,
  device: Device,
  options: NavigationBarOptions<Message>,
): Html => {
  const isAndroid = device.platform === 'android'
  const isHidden = options.isHidden ?? false
  const button = options.rightButton
  const attributes: Array<unknown> = [title(options.title), headerHidden(isHidden)]
  if (options.isLargeTitle !== undefined) attributes.push(largeTitle(options.isLargeTitle))
  if (options.backTitle !== undefined) attributes.push(backTitle(options.backTitle))
  if (options.isBackButtonHidden !== undefined) {
    attributes.push(backButtonHidden(options.isBackButtonHidden))
  }
  // Android draws under the status bar, and its bar only makes room for the
  // clock when told to. react-native-screens' own wrapper tells every visible
  // bar that is not inside another one.
  if (isAndroid) attributes.push(prop('consumeTopInset', !isHidden))
  if (button !== undefined && !isAndroid) {
    const data: BarButton = { id: RIGHT_BUTTON_ID, label: button.label }
    attributes.push(
      rightBarButtons([button.symbol === undefined ? data : { ...data, symbol: button.symbol }]),
      onBarButtonPressed<Message>(id =>
        id === RIGHT_BUTTON_ID ? Option.some(button.onPress) : Option.none(),
      ),
    )
    // The bar's own button is not a view, so a test cannot find it by id.
    // The id goes on the bar instead.
    if (button.testID !== undefined) attributes.push(prop('testID', button.testID))
  }
  attributes.push(...(options.attributes ?? []))
  const children =
    button !== undefined && isAndroid
      ? [
          headerItem(
            [prop('type', 'right')],
            [
              view(
                [
                  ...(button.testID === undefined ? [] : [prop('testID', button.testID)]),
                  prop('accessibilityRole', 'button'),
                  h.OnClick(button.onPress),
                  style({ paddingVertical: 8, paddingHorizontal: 12 }),
                ] as never,
                [
                  text(
                    [style({ fontSize: 16, fontWeight: '600', color: button.color ?? '#0a66d8' })],
                    [button.label],
                  ),
                ],
              ),
            ],
          ),
        ]
      : []
  return header(attributes as never, children)
}
