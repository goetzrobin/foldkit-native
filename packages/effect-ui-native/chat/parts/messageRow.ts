/**
 * One of the person's own messages in the transcript: their words on a
 * rounded grey shape, on the right.
 *
 * It keeps no state and is drawn from its props. A message looks the same
 * before and after the server has saved it, so nothing moves when it is.
 *
 * Holding a message for its menu comes in step 3, and goes in this part.
 */
import { Schema } from 'effect'

import { Native } from '../../src/index.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'

export const MessageRowProps = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
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
          })
          .children(h.text.style({ ...TYPE.message, color: palette.ink }).set({ selectable: true }).children(h.props.text)),
      )
  },
})
