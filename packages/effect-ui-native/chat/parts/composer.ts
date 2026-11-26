/**
 * The composer: the text field and the Send button at the bottom of a chat.
 *
 * It owns the draft. When the person sends, it empties the field and tells
 * the chat screen the text (`Submitted`). It knows nothing about the server.
 *
 * Step 1 keeps it plain. The moves with the keyboard, the glass behind it,
 * Stop and voice notes come later, and they go in this part.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native } from '../../src/index.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'

export const ComposerProps = Schema.Struct({
  scheme: Scheme,
  /** A message is being sent or a reply is being written. Send is off. */
  isBusy: Schema.Boolean,
})

export const ComposerMessage = UiSchema.TaggedEnum({
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
})

export const ComposerEvents = UiSchema.TaggedEnum({
  Submitted: { text: Schema.String },
})

const ComposerModel = Schema.Struct({ draft: Schema.String })

const SEND_SIZE = 36

export const Composer = Native.component({
  name: 'Composer',
  props: ComposerProps,
  model: ComposerModel,
  message: ComposerMessage,
  events: ComposerEvents,
}).make({
  init: () => ({ draft: '' }),
  update: {
    ChangedDraft: ($, { text }) => $.evolve({ draft: text }),
    PressedSend: $ => {
      const text = $.model.draft.trim()
      return text === '' || $.props.isBusy
        ? $.model
        : $.evolve({ draft: '' }).emit(ComposerEvents.Submitted({ text }))
    },
  },
  view: (h, model) => {
    const palette = paletteOf(h.props.scheme)
    const canSend = model.draft.trim() !== '' && !h.props.isBusy
    return h.view
      .testId('composer')
      .style({
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: SPACE.s,
        paddingHorizontal: SPACE.m,
        paddingVertical: SPACE.s,
        backgroundColor: palette.bg,
      })
      .children(
        h.textInput
          .testId('draft')
          .style({
            ...TYPE.message,
            flex: 1,
            minHeight: 44,
            maxHeight: 140,
            paddingHorizontal: SPACE.l,
            paddingTop: 11,
            paddingBottom: 11,
            borderRadius: RADIUS.field,
            backgroundColor: palette.surface,
            color: palette.ink,
          })
          .set({ multiline: true, placeholderTextColor: palette.ink3, selectionColor: palette.accent })
          .placeholder('Message')
          .value(model.draft)
          .on('changeText', ({ text }) => ComposerMessage.ChangedDraft({ text })),
        h.pressable
          .testId('send')
          .set({ accessibilityRole: 'button', accessibilityLabel: 'Send', hitSlop: 6 })
          .style({
            width: SEND_SIZE,
            height: SEND_SIZE,
            marginBottom: 4,
            borderRadius: SEND_SIZE / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: canSend ? palette.accent : palette.surface2,
          })
          .pressedStyle({ opacity: 0.6 })
          .on('press', ComposerMessage.PressedSend())
          .children(
            h.text
              .style({ fontSize: 18, lineHeight: 22, fontWeight: '600', color: canSend ? palette.onAccent : palette.ink3 })
              .children('↑'),
          ),
      )
  },
})
