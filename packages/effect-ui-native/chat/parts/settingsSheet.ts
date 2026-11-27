/**
 * Settings, in the phone's own sheet: light or dark, the pretend server's
 * switches, the numbers strip, and what this build draws with.
 *
 * It keeps nothing. The settings are the app's: they come in as props, and
 * every press goes up as an event. The app changes them, saves them and
 * tells the phone.
 *
 * The sheet is a screen of the app's stack, so the app draws this part last
 * in the stack. A swipe down closes it, and so does Done in its footer. The
 * footer is the last thing in the sheet and stays at its bottom edge.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { KeyboardBar, Menus, Native, NativeHost, NativeViews, Phone } from '../../src/index.js'
import { Chaos, Speed } from '../data.js'
import { HAIRLINE, type Palette, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { segments, sheetTitle, solidButton, switchRow, textButton } from '../ui.js'

export const ChaosName = Schema.Literals(['failMidStream', 'dropConnection', 'slowFirstToken', 'refuseSend'])
export type ChaosName = typeof ChaosName.Type

export const SettingsSheetProps = Schema.Struct({
  platform: Schema.String,
  scheme: Scheme,
  theme: Phone.Theme,
  speed: Speed,
  chaos: Chaos,
  showsNumbers: Schema.Boolean,
  /** A development build that records its timeline: a row here copies it. */
  hasTimeline: Schema.Boolean,
})

const Presses = {
  PressedTheme: { theme: Phone.Theme },
  PressedSpeed: { speed: Speed },
  PressedChaos: { name: ChaosName },
  PressedNumbers: {},
  PressedCopyTimeline: {},
  Closed: {},
}

export const SettingsSheetMessage = UiSchema.TaggedEnum(Presses)
export const SettingsSheetEvents = UiSchema.TaggedEnum(Presses)

const CHAOS: ReadonlyArray<readonly [ChaosName, string]> = [
  ['failMidStream', 'Fail halfway through a reply'],
  ['dropConnection', 'Drop the connection once per reply'],
  ['slowFirstToken', 'Wait four seconds before the first word'],
  ['refuseSend', 'Refuse new messages'],
]

const group = <Msg>(
  h: Native.H<Msg>,
  palette: Palette,
  heading: string,
  note: string | undefined,
  children: Native.NoTextChildren<Msg, never>,
) =>
  h.view
    .key(heading)
    .style({ gap: SPACE.s, paddingHorizontal: SPACE.xl, paddingBottom: SPACE.xxl })
    .children(
      h.text.set({ accessibilityRole: 'header' }).style({ ...TYPE.section, color: palette.ink3 }).children(heading),
      note === undefined ? null : h.text.style({ ...TYPE.caption, color: palette.ink2 }).children(note),
      h.view.style({ gap: SPACE.s, marginTop: 2 }).children(...children),
    )

export const SettingsSheet = Native.component({
  name: 'SettingsSheet',
  props: SettingsSheetProps,
  model: Schema.Null,
  message: SettingsSheetMessage,
  events: SettingsSheetEvents,
}).make({
  init: () => null,
  update: {
    PressedTheme: ($, { theme }) => $.emit(SettingsSheetEvents.PressedTheme({ theme })),
    PressedSpeed: ($, { speed }) => $.emit(SettingsSheetEvents.PressedSpeed({ speed })),
    PressedChaos: ($, { name }) => $.emit(SettingsSheetEvents.PressedChaos({ name })),
    PressedNumbers: $ => $.emit(SettingsSheetEvents.PressedNumbers()),
    PressedCopyTimeline: $ => $.emit(SettingsSheetEvents.PressedCopyTimeline()),
    Closed: $ => $.emit(SettingsSheetEvents.Closed()),
  },
  view: h => {
    const { platform, scheme, theme, speed, chaos, showsNumbers, hasTimeline } = h.props
    const palette = paletteOf(scheme)
    const body = h.scrollView
      .key('settings-scroll')
      .style({ flex: 1 })
      .prop('nestedScrollEnabled', true)
      .children(
        sheetTitle(h, palette, 'Settings'),
        group(h, palette, 'Appearance', undefined, [
          segments(h, palette, {
            id: 'theme',
            choices: [
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ],
            value: theme,
            onChange: value => SettingsSheetMessage.PressedTheme({ theme: value }),
          }),
        ]),
        group(
          h,
          palette,
          'Demo controls',
          'Replies come from a pretend server inside this app. These change how it behaves, so you can see slow and broken days on purpose. A real server has none of them.',
          [
            h.text.style({ ...TYPE.rowTitle, fontWeight: '400', color: palette.ink }).children('Reply speed'),
            segments(h, palette, {
              id: 'speed',
              choices: [
                ['slow', 'Slow'],
                ['normal', 'Normal'],
                ['fast', 'Fast'],
              ],
              value: speed,
              onChange: value => SettingsSheetMessage.PressedSpeed({ speed: value }),
            }),
            ...CHAOS.map(([name, label]) =>
              switchRow(h, palette, {
                id: `chaos-${name}`,
                label,
                isOn: chaos[name],
                message: SettingsSheetMessage.PressedChaos({ name }),
              }),
            ),
          ],
        ),
        group(h, palette, 'Developer', 'Also: press and hold the title of a chat.', [
          switchRow(h, palette, {
            id: 'numbers-switch',
            label: 'Show list and keyboard numbers',
            isOn: showsNumbers,
            message: SettingsSheetMessage.PressedNumbers(),
          }),
          // Development builds only. What the screens and the audio player did, in order, as JSON.
          hasTimeline
            ? h.view
                .key('copy-timeline-row')
                .style({ alignSelf: 'flex-start' })
                .children(
                  textButton(h, 'copy-timeline', 'Copy timeline', palette.ink, SettingsSheetMessage.PressedCopyTimeline()),
                )
            : null,
        ]),
        group(h, palette, 'About', undefined, [
          h.text
            .style({ ...TYPE.rowPreview, color: palette.ink2 })
            .children(
              'Effect Chat is written in Effect UI and drawn with the phone’s own views. React does not draw any of it.',
            ),
          h.text
            .testId('about-pieces')
            .style({ ...TYPE.caption, color: palette.ink3 })
            .children(
              [
                `Replies: ${NativeViews.markdownStatus()}`,
                `Composer glass: ${NativeViews.isLiquidGlassAvailable() ? 'Liquid Glass' : 'plain fallback'}`,
                `Thinking label: ${NativeViews.isSkiaAvailable() ? 'Skia' : 'plain text'}`,
                `Keyboard: ${KeyboardBar.isInset() ? 'moved by the phone' : 'padded'}`,
                `Menus: ${Menus.routeName()}`,
                NativeHost.holdReport(),
              ].join('\n'),
            ),
        ]),
      )
    const footer = h.view
      .testId('settings-footer')
      .style({
        paddingHorizontal: SPACE.xl,
        paddingTop: SPACE.m,
        paddingBottom: SPACE.m,
        borderTopWidth: HAIRLINE,
        borderTopColor: palette.line,
        backgroundColor: palette.bg,
      })
      .children(solidButton(h, 'settings-done', 'Done', palette, SettingsSheetMessage.Closed()))
    return h.modalScreen
      .testId('sheet-settings')
      .set(NativeViews.sheet({ detents: [1], hasGrabber: true }))
      .style({ backgroundColor: palette.bg })
      .on('dismissed', SettingsSheetMessage.Closed())
      .children(
        ...NativeViews.sheetParts(h, { platform, testId: 'settings', body, footer, handleColor: palette.line }),
      )
  },
})
