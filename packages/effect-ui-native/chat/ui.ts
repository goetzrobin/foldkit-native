/**
 * Small pieces of view the parts share: the title bar, buttons, words in
 * the middle of a screen, the two controls in Settings, and a sheet's title.
 */
import { type Menus, Native, NativeViews } from '../src/index.js'
import { microphone } from './icons.js'
import { HAIRLINE, type Palette, RADIUS, SPACE, TYPE } from './theme.js'

/** One button in the title bar. */
export type BarAction<Msg> = Readonly<{
  id: string
  /** What a screen reader says, and the word Android shows. */
  label: string
  /** iOS: the name of an SF Symbol, the phone's own icon set. */
  symbol: string
  /** Sent on a press. Left out for a button that opens a menu. */
  message?: Msg
  /**
   * iOS: a press opens this menu, the phone's own. Android has no such menu
   * here, so the button sends `message` and the screen shows a list.
   */
  menu?: Readonly<{ items: ReadonlyArray<Menus.MenuItem>; onSelected: (key: string) => Msg }>
}>

/**
 * A screen's title bar in the app's colours.
 *
 * On iOS the buttons are the phone's own bar buttons, made from data, and a
 * press comes back as an event of the bar. On Android each is a word in one
 * of the bar's slots.
 */
export const navBar = <Msg>(
  h: Native.H<Msg>,
  platform: string,
  palette: Palette,
  options: Readonly<{
    title: string
    testId: string
    isLargeTitle?: boolean
    left?: BarAction<Msg>
    right?: BarAction<Msg>
    /** Sent for a press the bar cannot place. Changes nothing. */
    ignored: Msg
    /** Sent when the title is held for half a second. The title is then a view of its own in the bar. */
    onHoldTitle?: Msg
    /** iOS: the phone's own search field under the large title. */
    onSearch?: (text: string) => Msg
  }>,
) => {
  const isAndroid = platform === 'android'
  const actions = [options.left, options.right].filter((each): each is BarAction<Msg> => each !== undefined)
  let bar = h.header
    .testId(options.testId)
    .set({ title: options.title, color: palette.ink, largeTitle: !isAndroid && options.isLargeTitle === true })
    .prop('titleColor', palette.ink)
    .prop('largeTitleColor', palette.ink)
    // The back button shows its arrow alone.
    .prop('backButtonDisplayMode', 'minimal')
  if (isAndroid) {
    bar = bar.set({ backgroundColor: palette.bg }).prop('hideShadow', true)
  } else if (actions.length > 0) {
    const data = (action: BarAction<Msg>): NativeViews.BarButton => ({
      id: action.id,
      label: action.label,
      symbol: action.symbol,
      ...(action.menu === undefined ? {} : { menu: action.menu.items }),
    })
    bar = NativeViews.barButtons(bar as never, {
      ...(options.left === undefined ? {} : { left: [data(options.left)] }),
      ...(options.right === undefined ? {} : { right: [data(options.right)] }),
      onPress: id => actions.find(each => each.id === id)?.message ?? options.ignored,
      onMenu: key => {
        const owner = actions.find(each => NativeViewsKeys(each.menu?.items ?? []).includes(key))
        return owner?.menu === undefined ? options.ignored : owner.menu.onSelected(key)
      },
    }) as typeof bar
  }
  const androidButton = (slot: 'left' | 'right', action: BarAction<Msg>) =>
    h.headerItem
      .key(`bar-item-${action.id}`)
      .set({ type: slot })
      .children(
        h.pressable
          .testId(`bar-${action.id}`)
          .set({ accessibilityRole: 'button', accessibilityLabel: action.label })
          .style({ paddingVertical: SPACE.s, paddingHorizontal: SPACE.m })
          .pressedStyle({ opacity: 0.6 })
          .on('press', action.message ?? options.ignored)
          .children(h.text.style({ ...TYPE.button, color: palette.ink }).children(action.label)),
      )
  const onHoldTitle = options.onHoldTitle
  const onSearch = options.onSearch
  return bar.children(
    isAndroid && options.left !== undefined ? androidButton('left', options.left) : null,
    onHoldTitle === undefined
      ? null
      : h.headerItem.key('title').set({ type: 'center' }).children(
          h.pressable
            .testId(`${options.testId}-title`)
            .style({ maxWidth: 220, paddingVertical: 6, paddingHorizontal: SPACE.s })
            .on('longPress', onHoldTitle)
            .children(
              h.text.set({ numberOfLines: 1 }).style({ fontSize: 17, lineHeight: 22, fontWeight: '600', color: palette.ink }).children(options.title),
            ),
        ),
    isAndroid && options.right !== undefined ? androidButton('right', options.right) : null,
    !isAndroid && onSearch !== undefined
      ? NativeViews.searchBar(h, { placeholder: 'Search', onChange: onSearch, testId: 'search' })
      : null,
  )
}

/** Every key a menu can answer with. */
const NativeViewsKeys = (items: ReadonlyArray<Menus.MenuItem>): ReadonlyArray<string> =>
  items.flatMap(item =>
    'section' in item
      ? NativeViewsKeys(item.section)
      : 'submenu' in item
        ? item.submenu.map(action => action.key)
        : [item.key],
  )

/** The one main button of an empty screen: ink on paper, turned round. */
export const solidButton = <Msg>(h: Native.H<Msg>, id: string, label: string, palette: Palette, message: Msg) =>
  h.pressable
    .testId(id)
    .set({ accessibilityRole: 'button' })
    .style({
      alignSelf: 'center',
      paddingVertical: SPACE.m,
      paddingHorizontal: SPACE.xxl,
      borderRadius: 999,
      backgroundColor: palette.ink,
    })
    .pressedStyle({ opacity: 0.6 })
    .on('press', message)
    .children(h.text.style({ ...TYPE.button, color: palette.bg }).children(label))

/** A button that is only a word. */
export const textButton = <Msg>(h: Native.H<Msg>, id: string, label: string, color: string, message: Msg) =>
  h.pressable
    .testId(id)
    .set({ accessibilityRole: 'button', hitSlop: 8 })
    .pressedStyle({ opacity: 0.6 })
    .on('press', message)
    .children(h.text.style({ ...TYPE.meta, color }).children(label))

/**
 * A round button with a drawn icon in it. With no `message` it is drawn
 * the same and does nothing.
 */
export const roundButton = <Msg>(
  h: Native.H<Msg>,
  options: Readonly<{ id: string; label: string; fill: string; size?: number; message: Msg | undefined; border?: string }>,
  icon: Native.NoTextContent<Msg>,
) => {
  const size = options.size ?? 32
  const button = h.pressable
    .key(options.id)
    .testId(options.id)
    .set({
      accessibilityRole: 'button',
      accessibilityLabel: options.label,
      accessibilityState: { disabled: options.message === undefined },
      // A finger is wider than the circle.
      hitSlop: 8,
    })
    .style({
      width: size,
      height: size,
      borderRadius: size / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: options.fill,
      ...(options.border === undefined ? {} : { borderWidth: 1, borderColor: options.border }),
    })
  return (options.message === undefined ? button : button.pressedStyle({ opacity: 0.6 }).on('press', options.message)).children(icon)
}

/** Content in the upper middle of a screen, over whatever is behind it. */
export const centred = <Msg>(h: Native.H<Msg>, id: string, children: Native.NoTextChildren<Msg, never>) =>
  h.view
    .testId(id)
    .set({ pointerEvents: 'box-none' })
    .style({
      position: 'absolute',
      left: 0,
      right: 0,
      top: '30%',
      alignItems: 'center',
      gap: SPACE.m,
      paddingHorizontal: SPACE.xxxl,
    })
    .children(...children)

/** A voice note's name in a small rounded chip, with what comes after it. */
export const attachmentChip = <Msg>(
  h: Native.H<Msg>,
  palette: Palette,
  name: string,
  trailing: Native.NoTextChildren<Msg, never> = [],
) =>
  h.view
    .style({
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.s,
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: RADIUS.chip,
      backgroundColor: palette.surface2,
    })
    .children(microphone(h, palette.ink2), h.text.style({ ...TYPE.caption, color: palette.ink }).children(name), ...trailing)

/** A sheet's title, with an optional button beside it. */
export const sheetTitle = <Msg>(
  h: Native.H<Msg>,
  palette: Palette,
  title: string,
  action?: Readonly<{ id: string; label: string; message: Msg }>,
) =>
  h.view
    .key('sheet-title')
    .set({ collapsable: false })
    .style({
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACE.xl,
      paddingTop: SPACE.xl,
      paddingBottom: SPACE.m,
    })
    .children(
      h.text
        .set({ accessibilityRole: 'header' })
        .style({ fontSize: 20, lineHeight: 25, fontWeight: '600', color: palette.ink, flexShrink: 1 })
        .children(title),
      action === undefined ? null : textButton(h, action.id, action.label, palette.ink, action.message),
    )

/** A row of choices where one is picked: the picked one is ink on paper. */
export const segments = <Msg, Value extends string>(
  h: Native.H<Msg>,
  palette: Palette,
  options: Readonly<{
    id: string
    choices: ReadonlyArray<readonly [Value, string]>
    value: Value
    onChange: (value: Value) => Msg
  }>,
) =>
  h.view
    .testId(options.id)
    .set({ accessibilityRole: 'radiogroup' })
    .style({ flexDirection: 'row', padding: 2, borderRadius: RADIUS.chip, backgroundColor: palette.surface })
    .children(
      options.choices.map(([value, label]) => {
        const isPicked = value === options.value
        return h.pressable
          .key(value)
          .testId(`${options.id}-${value}`)
          .set({ accessibilityRole: 'radio', accessibilityState: { selected: isPicked } })
          .style({
            flex: 1,
            alignItems: 'center',
            paddingVertical: SPACE.s,
            borderRadius: RADIUS.chip - 2,
            backgroundColor: isPicked ? palette.bg : 'transparent',
            ...(isPicked ? { borderWidth: HAIRLINE, borderColor: palette.line } : {}),
          })
          .pressedStyle({ opacity: 0.6 })
          .on('press', options.onChange(value))
          .children(h.text.style({ ...TYPE.meta, color: isPicked ? palette.ink : palette.ink2 }).children(label))
      }),
    )

/** A line of words with an on and off switch at its end. A press anywhere on the line turns it. */
export const switchRow = <Msg>(
  h: Native.H<Msg>,
  palette: Palette,
  options: Readonly<{ id: string; label: string; isOn: boolean; message: Msg }>,
) =>
  h.pressable
    .key(options.id)
    .testId(options.id)
    .set({ accessibilityRole: 'switch', accessibilityLabel: options.label, accessibilityState: { selected: options.isOn } })
    .style({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, gap: SPACE.m })
    .pressedStyle({ opacity: 0.6 })
    .on('press', options.message)
    .children(
      h.text.style({ ...TYPE.rowTitle, fontWeight: '400', color: palette.ink, flex: 1 }).children(options.label),
      h.view
        .set({ pointerEvents: 'none' })
        .style({
          width: 46,
          height: 28,
          borderRadius: 14,
          padding: 2,
          backgroundColor: options.isOn ? palette.accent : palette.surface2,
          alignItems: options.isOn ? 'flex-end' : 'flex-start',
        })
        .children(h.view.style({ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' })),
    )
