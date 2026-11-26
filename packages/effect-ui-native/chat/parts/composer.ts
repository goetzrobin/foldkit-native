/**
 * The composer: the text field and the round button beside it, at the
 * bottom of a chat.
 *
 * It owns the draft. When the person sends, it empties the field and tells
 * the chat screen the text (`Submitted`). It knows nothing about the server.
 *
 * The round button is Send. It is grey and does nothing while the field is
 * empty or a message is on its way. While a reply is being written it is
 * Stop, and a press tells the chat screen (`PressedStop`).
 *
 * The keyboard: the field has no `autoFocus`. The phone acts on that the
 * moment the field is drawn, which is in the middle of the push, and on a
 * real iPhone the keyboard came up, went down and came up again. The chat
 * screen asks for the caret once the push is over, by raising
 * `focusRequest`. A ref only resolves inside the component that owns the
 * element, so the composer runs the focus itself.
 *
 * The chat screen puts this part in a `KeyboardBar`, which the phone moves
 * with the keyboard. Nothing here knows where the keyboard is.
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Schema, Stream } from 'effect'

import { Native, NativeCommand } from '../../src/index.js'
import { arrowUp, stopSquare } from '../icons.js'
import { SPACE, Scheme, TYPE, paletteOf } from '../theme.js'

export const ComposerProps = Schema.Struct({
  scheme: Scheme,
  platform: Schema.String,
  /** A message is on its way to the server. Send is off. */
  isSending: Schema.Boolean,
  /** A reply is being written. The button is Stop. */
  isReplying: Schema.Boolean,
  /** Raised by one each time the field should take the caret. 0: never asked. */
  focusRequest: Schema.Number,
})

export const ComposerMessage = UiSchema.TaggedEnum({
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  PressedStop: {},
  RequestedFocus: {},
  Focused: {},
})

export const ComposerEvents = UiSchema.TaggedEnum({
  Submitted: { text: Schema.String },
  PressedStop: {},
})

const ComposerModel = Schema.Struct({ draft: Schema.String })

/** The composer's text field. */
export const DraftField = Native.ref('draft')
/** The field's name on the phone. The keyboard's drag finds the field by it. */
export const DRAFT_FIELD_ID = 'effect-chat-draft'

export const BUTTON_SIZE = 32
/** Under the pill, inside the composer: with the keyboard up, the gap between the pill and the keyboard. */
export const PILL_BOTTOM = SPACE.s

/** One Message each time the chat screen raises `focusRequest`. */
const focusRequests = (request: number) =>
  Subscription.make('chat/composer/focus', request, () => Stream.succeed(ComposerMessage.RequestedFocus()))

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
      return text === '' || $.props.isSending || $.props.isReplying
        ? $.model
        : $.evolve({ draft: '' }).emit(ComposerEvents.Submitted({ text }))
    },
    PressedStop: $ => ($.props.isReplying ? $.emit(ComposerEvents.PressedStop()) : $.model),
    RequestedFocus: $ => $.run(NativeCommand.focus(DraftField).pipe(Command.as(ComposerMessage.Focused()))),
    Focused: $ => $.model,
  },
  subscriptions: ({ props }) => [props.focusRequest > 0 && focusRequests(props.focusRequest)],
  view: (h, model) => {
    const { scheme, platform, isSending, isReplying } = h.props
    const palette = paletteOf(scheme)
    const canSend = model.draft.trim() !== '' && !isSending && !isReplying
    const round = (fill: string) =>
      ({
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        borderRadius: BUTTON_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: fill,
      }) as const
    const button = isReplying
      ? h.pressable
          .key('stop')
          .testId('stop')
          .set({ accessibilityRole: 'button', accessibilityLabel: 'Stop the reply', hitSlop: 8 })
          .style(round(palette.ink))
          .pressedStyle({ opacity: 0.6 })
          .on('press', ComposerMessage.PressedStop())
          .children(stopSquare(h, palette.bg))
      : h.pressable
          .key('send')
          .testId('send')
          .set({
            accessibilityRole: 'button',
            accessibilityLabel: 'Send',
            accessibilityState: { disabled: !canSend },
            hitSlop: 8,
          })
          .style(round(canSend ? palette.accent : palette.surface2))
          .pressedStyle(canSend ? { opacity: 0.6 } : {})
          .on('press', ComposerMessage.PressedSend())
          .children(arrowUp(h, canSend ? palette.onAccent : palette.ink3))
    return h.view.style({ paddingTop: SPACE.s }).children(
      h.view
        .testId('composer')
        .style({
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 6,
          marginHorizontal: SPACE.m,
          marginBottom: PILL_BOTTOM,
          padding: 6,
          borderRadius: 26,
          backgroundColor: palette.surface,
        })
        .children(
          h.textInput
            .testId('draft')
            .ref(DraftField)
            .style({
              ...TYPE.message,
              flex: 1,
              minHeight: 40,
              maxHeight: 5 * TYPE.message.lineHeight + 18,
              paddingHorizontal: SPACE.m,
              paddingTop: platform === 'ios' ? 10 : 8,
              paddingBottom: platform === 'ios' ? 10 : 8,
              color: palette.ink,
            })
            .set({
              multiline: true,
              placeholderTextColor: palette.ink3,
              selectionColor: palette.accent,
              keyboardAppearance: scheme,
            })
            .prop('nativeID', DRAFT_FIELD_ID)
            .placeholder('Message')
            .value(model.draft)
            .on('changeText', ({ text }) => ComposerMessage.ChangedDraft({ text })),
          h.view.style({ paddingBottom: 4, paddingRight: 2 }).children(button),
        ),
    )
  },
})
