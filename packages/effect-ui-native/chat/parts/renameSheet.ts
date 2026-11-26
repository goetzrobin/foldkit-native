/**
 * Rename a chat, in a sheet as tall as its content: one text field, Cancel
 * and Save.
 *
 * It owns the title being typed. Save tells the app the new title (`Saved`),
 * and the app runs the rename. Cancel and a swipe down close it (`Closed`).
 * Save does nothing while the field is empty.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native, NativeViews } from '../../src/index.js'
import { HAIRLINE, RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { sheetTitle } from '../ui.js'

export const RenameSheetProps = Schema.Struct({
  platform: Schema.String,
  scheme: Scheme,
  /** The chat's title now. The field starts with it. */
  title: Schema.String,
})

export const RenameSheetMessage = UiSchema.TaggedEnum({
  ChangedTitle: { text: Schema.String },
  PressedSave: {},
  Closed: {},
})

export const RenameSheetEvents = UiSchema.TaggedEnum({
  Saved: { title: Schema.String },
  Closed: {},
})

export const RenameSheet = Native.component({
  name: 'RenameSheet',
  props: RenameSheetProps,
  model: Schema.Struct({ title: Schema.String }),
  message: RenameSheetMessage,
  events: RenameSheetEvents,
}).make({
  init: $ => ({ title: $.props.title }),
  update: {
    ChangedTitle: ($, { text }) => $.evolve({ title: text }),
    PressedSave: $ =>
      $.model.title.trim() === '' ? $.model : $.emit(RenameSheetEvents.Saved({ title: $.model.title.trim() })),
    Closed: $ => $.emit(RenameSheetEvents.Closed()),
  },
  view: (h, model) => {
    const { platform, scheme } = h.props
    const palette = paletteOf(scheme)
    const canSave = model.title.trim() !== ''
    const button = (id: string, label: string, isSolid: boolean, message: typeof RenameSheetMessage.Type) =>
      h.pressable
        .key(id)
        .testId(id)
        .set({ accessibilityRole: 'button', accessibilityState: { disabled: isSolid && !canSave } })
        .style({
          flex: 1,
          height: 48,
          borderRadius: 24,
          alignItems: 'center',
          justifyContent: 'center',
          ...(isSolid
            ? { backgroundColor: palette.ink, opacity: canSave ? 1 : 0.4 }
            : { borderWidth: HAIRLINE, borderColor: palette.line }),
        })
        .pressedStyle({ opacity: 0.6 })
        .on('press', message)
        .children(h.text.style({ ...TYPE.button, color: isSolid ? palette.bg : palette.ink }).children(label))
    const body = h.view.key('rename-body').children(
      sheetTitle(h, palette, 'Rename chat'),
      h.view.style({ paddingHorizontal: SPACE.xl }).children(
        h.textInput
          .testId('rename-field')
          .style({
            height: 48,
            borderRadius: RADIUS.chip,
            paddingHorizontal: SPACE.m,
            backgroundColor: palette.surface,
            color: palette.ink,
            fontSize: 17,
          })
          .set({ autoFocus: true, returnKeyType: 'done', selectionColor: palette.accent, keyboardAppearance: scheme })
          .prop('selectTextOnFocus', true)
          .value(model.title)
          .on('changeText', ({ text }) => RenameSheetMessage.ChangedTitle({ text }))
          .on('submit', RenameSheetMessage.PressedSave()),
      ),
    )
    const footer = h.view
      .testId('rename-footer')
      .style({ flexDirection: 'row', gap: SPACE.m, paddingHorizontal: SPACE.xl, paddingTop: SPACE.l, paddingBottom: SPACE.xl })
      .children(
        button('rename-cancel', 'Cancel', false, RenameSheetMessage.Closed()),
        button('rename-save', 'Save', true, RenameSheetMessage.PressedSave()),
      )
    return h.modalScreen
      .testId('sheet-rename')
      .set(NativeViews.sheet({ hasGrabber: true }))
      .style({ backgroundColor: palette.bg })
      .on('dismissed', RenameSheetMessage.Closed())
      .children(...NativeViews.sheetParts(h, { platform, testId: 'rename', fit: true, body, footer, handleColor: palette.line }))
  },
})
