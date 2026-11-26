/**
 * Small pieces of view the parts share: the title bar, two kinds of button,
 * and words in the middle of a screen.
 */
import { Native } from '../src/index.js'
import { type Palette, SPACE, TYPE } from './theme.js'

/** One button in the title bar. */
export type BarButton<Msg> = Readonly<{
  id: string
  /** What a screen reader says, and the word Android shows. */
  label: string
  /** iOS: the name of an SF Symbol, the phone's own icon set. */
  symbol: string
  message: Msg
}>

/**
 * A screen's title bar in the app's colours.
 *
 * On iOS the button is the phone's own bar button, made from data, and its
 * press comes back as an event of the bar. On Android it is a word in the
 * bar's right slot.
 */
export const navBar = <Msg>(
  h: Native.H<Msg>,
  platform: string,
  palette: Palette,
  options: Readonly<{
    title: string
    testId: string
    isLargeTitle?: boolean
    right?: BarButton<Msg>
    /** Sent when the title is held for half a second. The title is then a view of its own in the bar. */
    onHoldTitle?: Msg
  }>,
) => {
  const isAndroid = platform === 'android'
  const right = options.right
  let bar = h.header
    .testId(options.testId)
    .set({ title: options.title, color: palette.ink, largeTitle: !isAndroid && options.isLargeTitle === true })
    .prop('titleColor', palette.ink)
    .prop('largeTitleColor', palette.ink)
    // The back button shows its arrow alone.
    .prop('backButtonDisplayMode', 'minimal')
  if (isAndroid) {
    bar = bar.set({ backgroundColor: palette.bg }).prop('hideShadow', true)
  } else if (right !== undefined) {
    bar = bar
      .prop('headerRightBarButtonItems', [
        { buttonId: right.id, index: 0, title: right.label, sfSymbolName: right.symbol },
      ])
      // Not one of the vocabulary's events: the host passes the name through to the phone.
      .on('pressHeaderBarButtonItem' as never, right.message as never)
  }
  const onHoldTitle = options.onHoldTitle
  return bar.children(
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
    isAndroid && right !== undefined
      ? h.headerItem.set({ type: 'right' }).children(
          h.pressable
            .testId(`bar-${right.id}`)
            .set({ accessibilityRole: 'button', accessibilityLabel: right.label })
            .style({ paddingVertical: SPACE.s, paddingHorizontal: SPACE.m })
            .pressedStyle({ opacity: 0.6 })
            .on('press', right.message)
            .children(h.text.style({ ...TYPE.button, color: palette.ink }).children(right.label)),
        )
      : null,
  )
}

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
