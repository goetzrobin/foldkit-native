/**
 * Small pieces every Fold Chat screen uses: icons drawn with plain views,
 * round buttons, a spinner, text styles, and the navigation bar.
 *
 * The icons are drawn from boxes, not taken from a font or an icon set, so
 * they look the same on both phones and need nothing from the build. The
 * two arrows (Send, scroll to end) are the phone's own SF Symbols where the
 * build has Expo UI's SwiftUI views. The bar buttons on iOS are the phone's
 * own, with SF Symbols. `test/flagship/icons.test.ts` checks that each
 * turned bar stays inside its icon and that bars meant to meet do.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { element } from 'foldkit/renderTarget'

import { type NativeStyle, prop, pressedStyle, style } from '../src/foldkit/attributes.js'
import { expoUiHost, expoUiKind, modifiers, swiftUi } from '../src/foldkit/controls/expoUi.js'
import { text, view } from '../src/foldkit/elements.js'
import { type BarButton, leftBarButtons, onBarButtonPressed, rightBarButtons } from '../src/foldkit/navigation/header.js'
import { onBarMenuItemPressed } from '../src/foldkit/navigation/header.js'
import { type Device, header, title } from '../src/foldkit/navigation/stack.js'
import { type MenuItem, menuButton } from '../src/menus/index.js'
import { type Palette, SPACE, TYPE } from './theme.js'

const el = element<any>()

// ICONS

const bar = (look: NativeStyle): Html => view([style({ position: 'absolute', ...look })], [])

/**
 * An SF Symbol drawn by SwiftUI, where the build has Expo UI's SwiftUI
 * views, or undefined. The button around it takes the touch.
 */
const sfSymbol = (name: string, color: string, size: number): Html | undefined =>
  expoUiKind() === 'swiftui'
    ? expoUiHost({ match: 'both' }, [prop('pointerEvents', 'none'), prop('accessibilityElementsHidden', true)], [
        swiftUi('ImageView')(
          [
            prop('systemName', name),
            modifiers([
              { $type: 'font', size, weight: 'semibold' },
              { $type: 'foregroundStyle', style: { type: 'color', color } },
            ]),
          ],
          [],
        ),
      ])
    : undefined

/**
 * An arrow pointing up, 16 points square, drawn from three bars. Each side
 * of the head is turned so that its rounded end sits exactly on the stem's
 * rounded end: the three meet in one point, the tip. (They used to end side
 * by side, which drew the tip as a notch.)
 */
const drawnArrowUp = (color: string): Html =>
  view(
    [style({ width: 16, height: 16 })],
    [
      bar({ left: 6.75, top: 1.75, width: 2.5, height: 12.5, borderRadius: 1.25, backgroundColor: color }),
      bar({ left: 4.45, top: 0.8, width: 2.5, height: 9, borderRadius: 1.25, backgroundColor: color, transform: [{ rotate: '45deg' }] }),
      bar({ left: 9.05, top: 0.8, width: 2.5, height: 9, borderRadius: 1.25, backgroundColor: color, transform: [{ rotate: '-45deg' }] }),
    ],
  )

/** An arrow pointing up: the phone's own symbol where it can be drawn, else bars. */
export const arrowUp = (color: string): Html => sfSymbol('arrow.up', color, 15) ?? drawnArrowUp(color)

/** An arrow pointing down: the phone's own symbol, or the drawn up arrow turned over. */
export const arrowDown = (color: string): Html =>
  sfSymbol('arrow.down', color, 15) ??
  view([style({ width: 16, height: 16, transform: [{ rotate: '180deg' }] })], [drawnArrowUp(color)])

/** A filled square, for Stop. */
export const stopSquare = (color: string): Html =>
  view([style({ width: 11, height: 11, borderRadius: 2.5, backgroundColor: color })], [])

/** A microphone: a capsule in a cradle on a stem. */
export const microphone = (color: string): Html =>
  view(
    [style({ width: 16, height: 18 })],
    [
      bar({ left: 4.5, top: 0, width: 7, height: 11, borderRadius: 3.5, backgroundColor: color }),
      bar({
        left: 1.5,
        top: 5,
        width: 13,
        height: 9,
        borderWidth: 1.8,
        borderTopWidth: 0,
        borderColor: color,
        borderBottomLeftRadius: 6.5,
        borderBottomRightRadius: 6.5,
      }),
      bar({ left: 7.1, top: 13.5, width: 1.8, height: 4, borderRadius: 0.9, backgroundColor: color }),
    ],
  )

/** An x, 12 points square. */
export const cross = (color: string): Html =>
  view(
    [style({ width: 12, height: 12 })],
    [
      bar({ left: 5.2, top: -0.5, width: 1.6, height: 13, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '45deg' }] }),
      bar({ left: 5.2, top: -0.5, width: 1.6, height: 13, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-45deg' }] }),
    ],
  )

/** A tick, 12 points square. */
export const tick = (color: string): Html =>
  view(
    [style({ width: 12, height: 12 })],
    [
      bar({ left: 2.2, top: 5.57, width: 1.6, height: 5.5, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-45deg' }] }),
      bar({ left: 6.6, top: 0.6, width: 1.6, height: 11, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '40deg' }] }),
    ],
  )

/** Two sheets of paper, one over the other: Copy. 16 points square. */
export const copyIcon = (color: string, paper: string): Html =>
  view(
    [style({ width: 16, height: 16 })],
    [
      bar({ left: 5, top: 1, width: 10, height: 11, borderRadius: 2.5, borderWidth: 1.6, borderColor: color }),
      bar({ left: 1, top: 4.5, width: 10, height: 11, borderRadius: 2.5, borderWidth: 1.6, borderColor: color, backgroundColor: paper }),
    ],
  )

/** A tray with an arrow leaving it: Share. 16 points square. */
export const shareIcon = (color: string): Html =>
  view(
    [style({ width: 16, height: 16 })],
    [
      bar({ left: 1.5, top: 6, width: 13, height: 10, borderWidth: 1.6, borderTopWidth: 0, borderColor: color, borderBottomLeftRadius: 2.5, borderBottomRightRadius: 2.5 }),
      bar({ left: 7.2, top: 0.5, width: 1.6, height: 10, borderRadius: 0.8, backgroundColor: color }),
      bar({ left: 6.07, top: 0.03, width: 1.6, height: 4.8, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '45deg' }] }),
      bar({ left: 8.33, top: 0.03, width: 1.6, height: 4.8, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-45deg' }] }),
    ],
  )

/** A circle that does not close, with a point at its end: Regenerate. 16 points square. */
export const regenerateIcon = (color: string): Html =>
  view(
    [style({ width: 16, height: 16 })],
    [
      bar({ left: 1.5, top: 1.5, width: 13, height: 13, borderRadius: 6.5, borderWidth: 1.6, borderColor: color, borderTopColor: 'transparent', transform: [{ rotate: '45deg' }] }),
      bar({ left: 10.62, top: 0.5, width: 1.6, height: 5, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-20deg' }] }),
      bar({ left: 11.11, top: 3.29, width: 4.6, height: 1.6, borderRadius: 0.8, backgroundColor: color, transform: [{ rotate: '-20deg' }] }),
    ],
  )

/**
 * The phone's own spinner. It has no size of its own, so it is given one:
 * without it the box would swallow touches across its parent.
 */
export const spinner = (device: Device, color: string, size = 20): Html =>
  el('activity-indicator')(
    [
      prop('size', 'small'),
      prop('animating', true),
      prop('color', color),
      // Android's progress bar stops the app without these two.
      ...(device.platform === 'android' ? [prop('styleAttr', 'Normal'), prop('indeterminate', true)] : []),
      style({ width: size, height: size }),
    ] as never,
    [],
  )

// BUTTONS

/** A round button. `fill` is its colour, `size` its width. */
export const roundButton = <Message>(
  h: HtmlBuilder<Message>,
  options: Readonly<{
    id: string
    label: string
    fill: string
    size?: number
    onPress: Message | undefined
    border?: string
    extra?: NativeStyle
  }>,
  icon: Html,
): Html => {
  const size = options.size ?? 32
  return view(
    [
      h.Key(options.id),
      prop('testID', options.id),
      prop('accessibilityRole', 'button'),
      prop('accessibilityLabel', options.label),
      ...(options.onPress === undefined ? [prop('accessibilityState', { disabled: true })] : [h.OnClick(options.onPress)]),
      pressedStyle({ opacity: 0.6 }),
      // A finger is wider than the circle: the touch area reaches past it.
      prop('hitSlop', { top: 8, bottom: 8, left: 8, right: 8 }),
      style({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: options.fill,
        // Written out, so a fade in has a value to ease to.
        opacity: 1,
        alignItems: 'center',
        justifyContent: 'center',
        ...(options.border === undefined
          ? {}
          : { borderWidth: StyleHairline, borderColor: options.border }),
        ...options.extra,
      }),
    ],
    [icon],
  )
}

/** A hairline, as thin as the screen draws. Close enough on every iPhone. */
export const StyleHairline = 0.5

/** A button that is only words, in ink or in the accent. */
export const textButton = <Message>(
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  color: string,
  message: Message,
): Html =>
  view(
    [
      h.Key(id),
      prop('testID', id),
      prop('accessibilityRole', 'button'),
      h.OnClick(message),
      pressedStyle({ opacity: 0.5 }),
      prop('hitSlop', { top: 8, bottom: 8, left: 8, right: 8 }),
      style({ alignSelf: 'flex-start', paddingVertical: SPACE.xs }),
    ],
    [text([style({ ...TYPE.meta, color })], [label])],
  )

/** A pill button in ink, the strongest button the app has. */
export const solidButton = <Message>(
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  palette: Palette,
  message: Message,
): Html =>
  view(
    [
      h.Key(id),
      prop('testID', id),
      prop('accessibilityRole', 'button'),
      h.OnClick(message),
      pressedStyle({ opacity: 0.7 }),
      style({
        alignSelf: 'center',
        paddingVertical: SPACE.m,
        paddingHorizontal: SPACE.xxl,
        borderRadius: 999,
        backgroundColor: palette.ink,
      }),
    ],
    [text([style({ ...TYPE.button, color: palette.bg })], [label])],
  )

// THE NAVIGATION BAR

export type BarAction<Message> = Readonly<{
  id: string
  /** iOS: an SF Symbol. */
  symbol: string
  /** What VoiceOver says, and the word Android shows. */
  label: string
  onPress?: Message
  menu?: Readonly<{ items: ReadonlyArray<MenuItem>; onSelected: (key: string) => Message }>
}>

export type BarOptions<Message> = Readonly<{
  title: string
  isLargeTitle?: boolean
  left?: BarAction<Message>
  right?: BarAction<Message>
  /** A view of the app's own in the middle, in place of the title's words. */
  center?: Html
  /** More children for the header, such as the search field. */
  children?: ReadonlyArray<Html>
  testID?: string
}>

const iosButton = <Message>(action: BarAction<Message>): BarButton => ({
  id: action.id,
  symbol: action.symbol,
  label: action.label,
  ...(action.menu === undefined ? {} : { menu: { items: action.menu.items } }),
})

/** On Android a bar button is a view in one of the bar's slots. */
const androidButton = <Message>(
  h: HtmlBuilder<Message>,
  palette: Palette,
  slot: 'left' | 'right',
  action: BarAction<Message>,
): Html => {
  const label = text([style({ ...TYPE.button, color: palette.ink })], [action.label])
  const padded = (child: Html) =>
    view([prop('accessibilityRole', 'button'), style({ paddingVertical: SPACE.s, paddingHorizontal: SPACE.m })], [child])
  return el('native-header-item')(
    [prop('type', slot)] as never,
    [
      action.menu === undefined
        ? view(
            [prop('testID', `bar-${action.id}`), ...(action.onPress === undefined ? [] : [h.OnClick(action.onPress)])],
            [padded(label)],
          )
        : menuButton<Message>({
            items: action.menu.items,
            onSelected: action.menu.onSelected,
            testID: `bar-${action.id}`,
            trigger: padded(label),
          }),
    ],
  )
}

/**
 * A screen's navigation bar in the app's colours. iOS uses its own bar
 * buttons, menus and SF Symbols; Android gets words in the bar's slots.
 */
export const navBar = <Message>(
  h: HtmlBuilder<Message>,
  device: Device,
  palette: Palette,
  options: BarOptions<Message>,
): Html => {
  const isAndroid = device.platform === 'android'
  const actions = [options.left, options.right].filter((each): each is BarAction<Message> => each !== undefined)
  const attributes: Array<unknown> = [
    title(options.title),
    // The tint: the bar's buttons are ink, not the phone's blue.
    prop('color', palette.ink),
    prop('titleColor', palette.ink),
    prop('largeTitle', options.isLargeTitle ?? false),
    prop('largeTitleColor', palette.ink),
    // The back button shows its arrow alone, as in Messages.
    prop('backButtonDisplayMode', 'minimal'),
    ...(options.testID === undefined ? [] : [prop('testID', options.testID)]),
  ]
  if (isAndroid) {
    attributes.push(prop('consumeTopInset', true), prop('backgroundColor', palette.bg), prop('hideShadow', true))
  } else {
    if (options.left !== undefined) attributes.push(leftBarButtons([iosButton(options.left)]))
    if (options.right !== undefined) attributes.push(rightBarButtons([iosButton(options.right)]))
    attributes.push(
      onBarButtonPressed<Message>(id => {
        const action = actions.find(each => each.id === id)
        return action?.onPress === undefined ? Option.none() : Option.some(action.onPress)
      }),
      onBarMenuItemPressed<Message>(key => {
        const action = actions.find(each => each.menu?.items.some(item => 'key' in item && item.key === key))
        return action?.menu === undefined ? Option.none() : Option.some(action.menu.onSelected(key))
      }),
    )
  }
  const children: Array<Html> = []
  if (isAndroid && options.left !== undefined) children.push(androidButton(h, palette, 'left', options.left))
  if (options.center !== undefined) {
    children.push(el('native-header-item')([prop('type', 'center')] as never, [options.center]))
  }
  if (isAndroid && options.right !== undefined) children.push(androidButton(h, palette, 'right', options.right))
  children.push(...(options.children ?? []))
  return header(attributes as never, children)
}
