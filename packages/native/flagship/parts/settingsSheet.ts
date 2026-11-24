/**
 * Settings, in a sheet: the theme, the pretend server's dials, the
 * developer's numbers, and what this build is drawn with. It keeps nothing:
 * the settings are shared, read from above and changed by the app, which
 * hears each press as an OutMessage.
 */
import { Schema } from 'effect'
import { Submodel, type Update } from 'foldkit'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import { chatInsetAvailable, chatInsetFallbackReason } from '../../src/chat/index.js'
import { segmentedControl, switchControl } from '../../src/controls/index.js'
import { prop, style } from '../../src/foldkit/attributes.js'
import { scrollView, text, view as box } from '../../src/foldkit/elements.js'
import { sheetContent, sheetHandle } from '../../src/foldkit/navigation/sheets.js'
import { isLiquidGlassAvailable } from '../../src/glass/index.js'
import { markdownStatus } from '../../src/markdown/index.js'
import { isSkiaAvailable } from '../../src/skia/index.js'
import type { Context, Resources } from '../context.js'
import { ChaosName, Speed, ThemePref } from '../model.js'
import { sheetScreen, sheetTitle } from '../sheetChrome.js'
import { type Palette, SPACE, TYPE, paletteOf } from '../theme.js'

// MODEL: none. The settings are the app's.

export const Model = Schema.Struct({})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedTheme: { theme: ThemePref },
  PressedSpeed: { speed: Speed },
  PressedChaos: { name: ChaosName },
  PressedNumbers: {},
  PressedDone: {},
  /** Swiped down. */
  Dismissed: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  PressedTheme: { theme: ThemePref },
  PressedSpeed: { speed: Speed },
  PressedChaos: { name: ChaosName },
  PressedNumbers: {},
  Closed: {},
})
export type OutMessage = typeof OutMessage.Type

// UPDATE

export const update = (model: Model, message: Message): Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources> => ({
  model,
  outMessage: Message.match<OutMessage>(message, {
    PressedTheme: ({ theme }) => OutMessage.PressedTheme({ theme }),
    PressedSpeed: ({ speed }) => OutMessage.PressedSpeed({ speed }),
    PressedChaos: ({ name }) => OutMessage.PressedChaos({ name }),
    PressedNumbers: () => OutMessage.PressedNumbers(),
    PressedDone: () => OutMessage.Closed(),
    Dismissed: () => OutMessage.Closed(),
  }),
})

// VIEW

const group = (palette: Palette, heading: string, note: string | undefined, children: ReadonlyArray<Html>): Html =>
  box(
    [style({ gap: SPACE.s, paddingHorizontal: SPACE.xl, paddingBottom: SPACE.xxl })],
    [
      text([prop('accessibilityRole', 'header'), style({ ...TYPE.section, color: palette.ink3 })], [heading]),
      ...(note === undefined ? [] : [text([style({ ...TYPE.caption, color: palette.ink2 })], [note])]),
      box([style({ gap: SPACE.s, marginTop: 2 })], children),
    ],
  )

const switchRow = (palette: Palette, id: string, label: string, isOn: boolean, onChanged: (isOn: boolean) => Message): Html =>
  box(
    [style({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, gap: SPACE.m })],
    [
      text([style({ ...TYPE.rowTitle, fontWeight: '400', color: palette.ink, flex: 1 })], [label]),
      switchControl({ value: isOn, onChanged, testID: id }),
    ],
  )

const CHAOS: ReadonlyArray<readonly [ChaosName, string]> = [
  ['failMidStream', 'Fail halfway through a reply'],
  ['dropConnection', 'Drop the connection once per reply'],
  ['slowFirstToken', 'Wait four seconds before the first word'],
  ['refuseSend', 'Refuse new messages'],
]

export type ViewInputs = Context

export const view = Submodel.defineView<Model, Message, ViewInputs>((_model, inputs, h) => {
  const { device, shared } = inputs
  const palette = paletteOf(shared.scheme)
  return sheetScreen(h, device, palette, 'settings', [1], Message.Dismissed(), [
    sheetHandle(device, palette.line),
    sheetContent({ attributes: [prop('testID', 'settings')] }, [
      sheetTitle(h, palette, 'Settings', { id: 'settings-done', label: 'Done', message: Message.PressedDone() }),
      scrollView(
        [style({ flex: 1 }), prop('nestedScrollEnabled', true)],
        [
          group(palette, 'Appearance', undefined, [
            segmentedControl({
              options: [
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ],
              value: shared.settings.theme,
              onChanged: value => Message.PressedTheme({ theme: value === 'light' || value === 'dark' ? value : 'system' }),
              testID: 'theme',
            }),
          ]),
          group(
            palette,
            'Demo controls',
            'Replies come from a pretend server inside this app. These change how it behaves, so you can see slow, broken and offline days on purpose. A real server has none of them.',
            [
              text([style({ ...TYPE.rowTitle, fontWeight: '400', color: palette.ink })], ['Reply speed']),
              segmentedControl({
                options: [
                  { value: 'slow', label: 'Slow' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'fast', label: 'Fast' },
                ],
                value: shared.settings.speed,
                onChanged: value => Message.PressedSpeed({ speed: value === 'slow' || value === 'fast' ? value : 'normal' }),
                testID: 'speed',
              }),
              ...CHAOS.map(([name, label]) =>
                switchRow(palette, `chaos-${name}`, label, shared.chaos[name], () => Message.PressedChaos({ name })),
              ),
            ],
          ),
          group(palette, 'Developer', 'Also: press and hold the title of a chat.', [
            switchRow(palette, 'numbers-switch', 'Show list and keyboard numbers', shared.showsNumbers, () => Message.PressedNumbers()),
          ]),
          group(palette, 'About', undefined, [
            text(
              [style({ ...TYPE.rowPreview, color: palette.ink2 })],
              [
                'Fold Chat is written in Foldkit, an Elm-style TypeScript framework on Effect, and drawn ' +
                  'with the phone’s own views through Foldkit Native. React does not draw any of it.',
              ],
            ),
            text(
              [prop('testID', 'about-pieces'), style({ ...TYPE.caption, color: palette.ink3 })],
              [
                [
                  markdownStatus(),
                  `Composer glass: ${isLiquidGlassAvailable() ? 'Liquid Glass' : 'plain fallback'}`,
                  `Thinking label: ${isSkiaAvailable() ? 'Skia' : 'plain text'}`,
                  `Keyboard: ${chatInsetAvailable() ? 'inset' : `follow (${chatInsetFallbackReason()})`}`,
                ].join('\n'),
              ],
            ),
          ]),
        ],
      ),
    ]),
  ])
})
