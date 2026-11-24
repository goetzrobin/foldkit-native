/**
 * The open sheet, as a screen of the stack. Settings and a reply's reasoning
 * are parts of their own (`parts/settingsSheet.ts`, `parts/reasoningSheet.ts`).
 * Rename and Select text are small enough to be the app's: their Messages
 * are the app's own.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { prop, pressedStyle, style } from '../src/foldkit/attributes.js'
import { scrollView, text, textInput, view } from '../src/foldkit/elements.js'
import { sheetContent, sheetHandle } from '../src/foldkit/navigation/sheets.js'
import type { Device } from '../src/foldkit/navigation/stack.js'
import { markdown } from '../src/markdown/index.js'
import { Message, type Model } from './appModel.js'
import { type Sheet, textOf } from './model.js'
import * as ChatScreen from './parts/chatScreen.js'
import * as ReasoningSheet from './parts/reasoningSheet.js'
import * as SettingsSheet from './parts/settingsSheet.js'
import { sheetScreen, sheetTitle } from './sheetChrome.js'
import { type Palette, RADIUS, SPACE, TYPE, paletteOf } from './theme.js'
import { StyleHairline } from './ui.js'

const findRow = (model: Model, rowKey: string) =>
  ChatScreen.rowsOf(model.chat, model.conversation).find(row => row.key === rowKey)

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
                colorScheme: model.shared.scheme,
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
            prop('keyboardAppearance', model.shared.scheme),
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
      const palette = paletteOf(model.shared.scheme)
      const context = { device, shared: model.shared }
      switch (open._tag) {
        case 'Settings':
          return [
            h.submodel({
              slotId: 'sheet-settings',
              view: SettingsSheet.view,
              model: {},
              viewInputs: context,
              toParentMessage: (message: SettingsSheet.Message) => Message.GotSettingsSheetMessage({ message }),
            }),
          ]
        case 'Reasoning': {
          const part = findRow(model, open.rowKey)?.parts.find(each => each._tag === 'Reasoning')
          return [
            h.submodel({
              slotId: 'sheet-reasoning',
              view: ReasoningSheet.view,
              model: { rowKey: open.rowKey },
              viewInputs: { ...context, reasoning: part?._tag === 'Reasoning' ? part : undefined },
              toParentMessage: (message: ReasoningSheet.Message) => Message.GotReasoningSheetMessage({ message }),
            }),
          ]
        }
        case 'SelectText':
          return [sheetScreen(h, device, palette, 'select', [0.6, 1], Message.ClosedSheet(), selectTextSheet(h, device, model, palette, open.rowKey))]
        case 'Rename':
          return [sheetScreen(h, device, palette, 'rename', 'fit', Message.ClosedSheet(), renameSheet(h, model, palette, open.title))]
      }
    },
  })
