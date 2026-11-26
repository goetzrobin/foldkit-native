/**
 * The words of a reply: Markdown, drawn by the phone's own Markdown view.
 *
 * Two things in it can be tapped. A link opens in the phone's browser,
 * through the Linking service. A code block has a Copy button: the code goes
 * on the clipboard, with a light tap under the finger and "Copied" above the
 * composer for a moment. Both work while the reply is still being written.
 *
 * The native view finds the tap and says which link or which code it was.
 * This part only acts on it. It keeps no state.
 *
 * A hold on a link is left to the row around it, which opens the message's
 * menu: the phone's own link preview is switched off, so one finger never
 * opens two things. The message's menu has no "Copy link".
 *
 * "Copied" is said through the events service, so the chat screen shows it
 * in its line above the composer. Where the build has no native Markdown
 * view the reply is plain text, and nothing in it can be tapped.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native, NativeViews, Phone } from '../../src/index.js'
import { Announce } from '../events.js'
import { Scheme, TYPE, paletteOf } from '../theme.js'

export const ReplyTextProps = Schema.Struct({
  text: Schema.String,
  scheme: Scheme,
  /** The reply is still being written: half-written Markdown is finished before it is drawn. */
  isStreaming: Schema.Boolean,
})

export const ReplyTextMessage = UiSchema.TaggedEnum({
  PressedLink: { url: Schema.String },
  CompletedOpen: { outcome: Phone.Outcome },
  PressedCopyCode: { code: Schema.String },
  CompletedCopy: { outcome: Phone.Outcome },
  Settled: {},
})

const settled = Command.as(ReplyTextMessage.Settled())

export const ReplyText = Native.component({
  name: 'ReplyText',
  props: ReplyTextProps,
  model: Schema.Null,
  message: ReplyTextMessage,
}).make({
  init: () => null,
  update: {
    PressedLink: ($, { url }) =>
      $.run(Phone.OpenUrl.make({ url }).pipe(Command.map(outcome => ReplyTextMessage.CompletedOpen({ outcome })))),
    CompletedOpen: ($, { outcome }) =>
      outcome._tag === 'Done'
        ? $.model
        : $.run(Announce.make({ text: 'Could not open the link.', tone: 'error' }).pipe(settled)),
    PressedCopyCode: ($, { code }) =>
      $.run(Phone.Copy.make({ text: code }).pipe(Command.map(outcome => ReplyTextMessage.CompletedCopy({ outcome })))),
    CompletedCopy: ($, { outcome }) =>
      outcome._tag === 'Done'
        ? $.run(
            Phone.Impact.make({ style: 'light' }).pipe(settled),
            Announce.make({ text: 'Copied', tone: 'info' }).pipe(settled),
          )
        : $.run(Announce.make({ text: 'Could not copy the code.', tone: 'error' }).pipe(settled)),
    Settled: $ => $.model,
  },
  view: h => {
    const props = h.props
    return NativeViews.markdown(h, {
      text: props.text,
      scheme: props.scheme,
      isStreaming: props.isStreaming,
      style: { ...TYPE.replyBody, color: paletteOf(props.scheme).ink } as Native.ViewStyle,
      onLink: url => ReplyTextMessage.PressedLink({ url }),
      onCopyCode: ({ code }) => ReplyTextMessage.PressedCopyCode({ code }),
    })
  },
})
