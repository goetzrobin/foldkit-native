/**
 * The sheets: Settings, a reply's reasoning, Rename, and Select text. Each
 * is the phone's own bottom sheet (src/navigation/sheets.ts), a screen in
 * the stack that the Model adds and takes away. A swipe down closes it and
 * reports `ClosedSheet`.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import { prop, pressedStyle, style } from '../src/attributes.js'
import { segmentedControl, switchControl } from '../src/controls/index.js'
import { scrollView, text, textInput, view } from '../src/elements.js'
import { isLiquidGlassAvailable } from '../src/glass/index.js'
import { markdown, markdownStatus } from '../src/markdown/index.js'
import { type Device, modalScreen, onDismissed } from '../src/navigation/stack.js'
import { sheet, sheetContent, sheetHandle } from '../src/navigation/sheets.js'
import { isSkiaAvailable } from '../src/skia/index.js'
import { chatInsetAvailable, chatInsetFallbackReason } from '../src/chat/index.js'
import { type ChaosName, Message, type Model, type Sheet, chatRows, textOf, thoughtFor } from './model.js'
import { type Palette, RADIUS, SPACE, TYPE, paletteOf } from './theme.js'
import { StyleHairline } from './ui.js'

const sheetTitle = (h: HtmlBuilder<Message>, palette: Palette, title: string, action?: Readonly<{ id: string; label: string; message: Message }>): Html =>
  view(
    [
      prop('collapsable', false),
      style({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.xl, paddingTop: SPACE.xl, paddingBottom: SPACE.m }),
    ],
    [
      text([prop('accessibilityRole', 'header'), style({ fontSize: 20, lineHeight: 25, fontWeight: '600', color: palette.ink, flexShrink: 1 })], [title]),
      ...(action === undefined
        ? []
        : [
            view(
              [h.Key(action.id), prop('testID', action.id), prop('accessibilityRole', 'button'), h.OnClick(action.message), pressedStyle({ opacity: 0.5 }), prop('hitSlop', { top: 10, bottom: 10, left: 10, right: 10 })],
              [text([style({ ...TYPE.button, color: palette.ink })], [action.label])],
            ),
          ]),
    ],
  )

const group = (palette: Palette, heading: string, note: string | undefined, children: ReadonlyArray<Html>): Html =>
  view(
    [style({ gap: SPACE.s, paddingHorizontal: SPACE.xl, paddingBottom: SPACE.xxl })],
    [
      text([prop('accessibilityRole', 'header'), style({ ...TYPE.section, color: palette.ink3 })], [heading]),
      ...(note === undefined ? [] : [text([style({ ...TYPE.caption, color: palette.ink2 })], [note])]),
      view([style({ gap: SPACE.s, marginTop: 2 })], children),
    ],
  )

const switchRow = (palette: Palette, id: string, label: string, isOn: boolean, onChanged: (isOn: boolean) => Message): Html =>
  view(
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

const settingsSheet = (h: HtmlBuilder<Message>, device: Device, model: Model, palette: Palette): ReadonlyArray<Html> => [
  sheetHandle(device, palette.line),
  sheetContent({ attributes: [prop('testID', 'settings')] }, [
    sheetTitle(h, palette, 'Settings', { id: 'settings-done', label: 'Done', message: Message.ClosedSheet() }),
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
            value: model.settings.theme,
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
              value: model.settings.speed,
              onChanged: value => Message.PressedSpeed({ speed: value === 'slow' || value === 'fast' ? value : 'normal' }),
              testID: 'speed',
            }),
            ...CHAOS.map(([name, label]) =>
              switchRow(palette, `chaos-${name}`, label, model.chaos[name], () => Message.PressedChaos({ name })),
            ),
          ],
        ),
        group(palette, 'Developer', 'Also: press and hold the title of a chat.', [
          switchRow(palette, 'numbers-switch', 'Show list and keyboard numbers', model.showsNumbers, () => Message.PressedNumbers()),
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
]

const findRow = (model: Model, rowKey: string) => chatRows(model).find(row => row.key === rowKey)

const reasoningSheet = (h: HtmlBuilder<Message>, device: Device, model: Model, palette: Palette, rowKey: string): ReadonlyArray<Html> => {
  const part = findRow(model, rowKey)?.parts.find(each => each._tag === 'Reasoning')
  const reasoning = part?._tag === 'Reasoning' ? part : undefined
  const title =
    reasoning === undefined || reasoning.seconds === 0 ? 'Thinking' : thoughtFor(reasoning.seconds)
  return [
    sheetHandle(device, palette.line),
    sheetContent({ attributes: [prop('testID', 'reasoning')] }, [
      sheetTitle(h, palette, title),
      scrollView(
        [style({ flex: 1 }), prop('nestedScrollEnabled', true)],
        [
          text(
            [prop('testID', 'reasoning-text'), prop('selectable', true), style({ ...TYPE.replyBody, color: palette.ink2, paddingHorizontal: SPACE.xl, paddingBottom: SPACE.huge })],
            [reasoning?.text ?? ''],
          ),
        ],
      ),
    ]),
  ]
}

const selectTextSheet = (h: HtmlBuilder<Message>, device: Device, model: Model, palette: Palette, rowKey: string): ReadonlyArray<Html> => {
  const row = findRow(model, rowKey)
  const words = row === undefined ? '' : textOf(row.parts)
  return [
    sheetHandle(device, palette.line),
    sheetContent({ attributes: [prop('testID', 'select-text')] }, [
      sheetTitle(h, palette, 'Select text', { id: 'select-done', label: 'Done', message: Message.ClosedSheet() }),
      scrollView(
        [style({ flex: 1 }), prop('nestedScrollEnabled', true)],
        [
          row?.role === 'assistant'
            ? markdown(h, {
                id: `select-${rowKey}`,
                text: words,
                isStreaming: false,
                colorScheme: model.scheme,
                selectable: true,
                layout: { marginHorizontal: SPACE.xl, marginBottom: SPACE.huge },
              })
            : text([prop('selectable', true), style({ ...TYPE.replyBody, color: palette.ink, paddingHorizontal: SPACE.xl })], [words]),
        ],
      ),
    ]),
  ]
}

const renameSheet = (h: HtmlBuilder<Message>, model: Model, palette: Palette, title: string): ReadonlyArray<Html> => [
  sheetContent({ fit: true, attributes: [prop('testID', 'rename'), style({ paddingBottom: SPACE.xl })] }, [
    sheetTitle(h, palette, 'Rename chat'),
    view(
      [style({ paddingHorizontal: SPACE.xl, gap: SPACE.l })],
      [
        textInput(
          [
            h.Key('rename-field'),
            prop('testID', 'rename-field'),
            h.Attribute('value', title),
            prop('autoFocus', true),
            prop('selectTextOnFocus', true),
            prop('returnKeyType', 'done'),
            prop('cursorColor', palette.accent),
            prop('selectionColor', palette.accent),
            prop('keyboardAppearance', model.scheme),
            h.OnInput(value => Message.ChangedRenameDraft({ text: value })),
            style({ height: 48, borderRadius: RADIUS.chip, paddingHorizontal: SPACE.m, backgroundColor: palette.surface, color: palette.ink, fontSize: 17 }),
          ],
          [],
        ),
        view(
          [style({ flexDirection: 'row', gap: SPACE.m })],
          [
            view(
              [h.Key('rename-cancel'), prop('testID', 'rename-cancel'), prop('accessibilityRole', 'button'), h.OnClick(Message.ClosedSheet()), pressedStyle({ opacity: 0.6 }), style({ flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: StyleHairline, borderColor: palette.line })],
              [text([style({ ...TYPE.button, color: palette.ink })], ['Cancel'])],
            ),
            view(
              [h.Key('rename-save'), prop('testID', 'rename-save'), prop('accessibilityRole', 'button'), h.OnClick(Message.PressedSaveRename()), pressedStyle({ opacity: 0.7 }), style({ flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.ink, opacity: title.trim() === '' ? 0.4 : 1 })],
              [text([style({ ...TYPE.button, color: palette.bg })], ['Save'])],
            ),
          ],
        ),
      ],
    ),
  ]),
]

/** The open sheet as a screen of the stack, or nothing. */
export const sheetScreens = (h: HtmlBuilder<Message>, device: Device, model: Model): ReadonlyArray<Html> =>
  Option.match(model.sheet, {
    onNone: () => [],
    onSome: (open: Sheet) => {
      const palette = paletteOf(model.scheme)
      const shared = (detents: ReadonlyArray<number> | 'fit') => [
        onDismissed(() => Message.ClosedSheet()),
        ...sheet<Message>({ device, detents, hasGrabber: true, background: palette.bg }),
      ]
      switch (open._tag) {
        case 'Settings':
          return [modalScreen([h.Key('sheet-settings'), prop('testID', 'sheet-settings'), ...shared([1])] as never, settingsSheet(h, device, model, palette))]
        case 'Reasoning':
          return [modalScreen([h.Key('sheet-reasoning'), prop('testID', 'sheet-reasoning'), ...shared([0.5, 1])] as never, reasoningSheet(h, device, model, palette, open.rowKey))]
        case 'SelectText':
          return [modalScreen([h.Key('sheet-select'), prop('testID', 'sheet-select'), ...shared([0.6, 1])] as never, selectTextSheet(h, device, model, palette, open.rowKey))]
        case 'Rename':
          return [modalScreen([h.Key('sheet-rename'), prop('testID', 'sheet-rename'), ...shared('fit')] as never, renameSheet(h, model, palette, open.title))]
      }
    },
  })

