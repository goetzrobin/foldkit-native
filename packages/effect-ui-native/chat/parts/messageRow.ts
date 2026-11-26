/**
 * One of the person's own messages in the transcript: their words on a
 * rounded grey shape, on the right.
 *
 * It keeps no state and is drawn from its props. A message looks the same
 * before and after the server has saved it, so nothing moves when it is.
 *
 * A voice note that went with the message shows as a small chip above the
 * words. Holding a message for its menu is the transcript's: it listens on
 * the row around this part.
 */
import { Schema } from 'effect'

import { Native } from '../../src/index.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { attachmentChip } from '../ui.js'

export const MessageRowProps = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  /** The names of the voice notes that went with it. */
  attachments: Schema.Array(Schema.String),
  scheme: Scheme,
})

export const MessageRow = Native.component({
  name: 'MessageRow',
  props: MessageRowProps,
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: $ => $.model,
  view: h => {
    const palette = paletteOf(h.props.scheme)
    return h.view
      .testId(`message-${h.props.id}`)
      .style({ alignItems: 'flex-end', paddingHorizontal: SPACE.xl, paddingTop: SPACE.xxl })
      .children(
        h.view
          .style({
            maxWidth: '85%',
            paddingHorizontal: SPACE.l,
            paddingVertical: 10,
            borderRadius: RADIUS.bubble,
            backgroundColor: palette.surface,
            gap: SPACE.s,
          })
          .children(
            h.props.attachments.map((name, index) =>
              h.view.key(`note-${index}`).testId(`message-note-${h.props.id}`).children(attachmentChip(h, palette, name)),
            ),
            // Not selectable: a hold opens the message's menu, and Select text is in it.
            h.text.style({ ...TYPE.message, color: palette.ink }).children(h.props.text),
          ),
      )
  },
})
