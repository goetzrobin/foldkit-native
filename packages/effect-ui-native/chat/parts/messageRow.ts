/**
 * One of the person's own messages in the transcript: their words on a
 * rounded grey shape, on the right.
 *
 * It keeps no state and is drawn from its props. A message looks the same
 * before and after the server has saved it, so nothing moves when it is.
 *
 * A message that was sent just now rises into place as it fades in
 * (`rises`). The phone moves it, on its own thread. Only a new message
 * does: one that scrolls back into view is drawn where it belongs.
 *
 * A voice note that went with the message shows as a small chip above the
 * words, with a button to play it. Holding a message for its menu is the
 * transcript's: it listens on the row around this part.
 *
 * Playing is not this row's own. The app has one player, an actor apart
 * from every screen, and this row is one of its listeners: it keeps the
 * last state it heard, and its button sends the player an event with this
 * row named as the sender. So the chip says "Paused" when the note was
 * paused from somewhere else, and still says so when the chat is opened
 * again later. A row with no voice note listens to nothing.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Motion, Native } from '../../src/index.js'
import { pauseIcon, playIcon } from '../icons.js'
import {
  NOTHING_PLAYING,
  PlayerEvent,
  PlayerState,
  PlayerStep,
  SendToPlayer,
  heardPlayer,
  isPaused,
  isPlaying,
  sender,
} from '../playback.js'
import { ENTER_RISE, MOTION, RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { attachmentChip, roundButton } from '../ui.js'

export const MessageRowProps = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  /** The voice notes that went with it. One with no `uri` cannot be played. */
  attachments: Schema.Array(Schema.Struct({ name: Schema.String, uri: Schema.NullOr(Schema.String) })),
  scheme: Scheme,
  /** Sent a moment ago: it rises into place. */
  rises: Schema.Boolean,
})

/** Fast at first, then a long gentle stop. */
const RISE: Motion.Spec = {
  from: { opacity: 0, translateY: ENTER_RISE },
  to: { opacity: 1, translateY: 0 },
  ms: MOTION.messageEnter,
  easing: 'easeOutExpo',
}

export const MessageRowMessage = UiSchema.TaggedEnum({
  /** The play button of the voice note at `index`. */
  PressedNote: { index: Schema.Number },
  /** The player took a step. The whole step is here: what it was, what happened, who asked, what it is now. */
  HeardPlayer: { step: PlayerStep },
  Sent: {},
})

const MessageRowModel = Schema.Struct({
  /** The player's state, as last heard. */
  player: PlayerState,
  /** How many events this row has sent. The next one's id is made from it. */
  sent: Schema.Number,
})

const sent = Command.as(MessageRowMessage.Sent())

export const MessageRow = Native.component({
  name: 'MessageRow',
  props: MessageRowProps,
  model: MessageRowModel,
  message: MessageRowMessage,
}).make({
  init: () => ({ player: NOTHING_PLAYING, sent: 0 }),
  update: {
    HeardPlayer: ($, { step }) => $.evolve({ player: step.after }),
    PressedNote: ($, { index }) => {
      const note = $.props.attachments[index]
      if (note === undefined || note.uri === null) return $.model
      const by = sender('voice-row', `${$.props.id}#${$.model.sent + 1}`)
      const event = isPlaying($.model.player, note.uri)
        ? PlayerEvent.Pause({ by })
        : isPaused($.model.player, note.uri)
          ? PlayerEvent.Resume({ by })
          : PlayerEvent.Play({ note: { uri: note.uri, label: note.name }, by })
      return $.evolve({ sent: count => count + 1 }).run(SendToPlayer.make({ event }).pipe(sent))
    },
    Sent: $ => $.model,
  },
  subscriptions: ({ props }) => [
    props.attachments.some(note => note.uri !== null) &&
      heardPlayer(step => MessageRowMessage.HeardPlayer({ step }), { positions: false }),
  ],
  view: (h, model) => {
    const palette = paletteOf(h.props.scheme)
    return Motion.animate(
      h.view
        .testId(`message-${h.props.id}`)
        .style({ alignItems: 'flex-end', paddingHorizontal: SPACE.xl, paddingTop: SPACE.xxl }),
      h.props.rises ? RISE : undefined,
    ).children(
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
          h.props.attachments.map((note, index) => {
            const uri = note.uri
            if (uri === null) {
              return h.view.key(`note-${index}`).testId(`message-note-${h.props.id}`).children(attachmentChip(h, palette, note.name))
            }
            const playing = isPlaying(model.player, uri)
            const paused = isPaused(model.player, uri)
            return h.view
              .key(`note-${index}`)
              .testId(`message-note-${h.props.id}`)
              .children(
                attachmentChip(h, palette, note.name, [
                  playing || paused
                    ? h.text
                        .key('state')
                        .testId(`note-state-${h.props.id}`)
                        .style({ ...TYPE.caption, color: palette.ink2 })
                        .children(playing ? 'Playing' : 'Paused')
                    : null,
                  roundButton(
                    h,
                    {
                      id: `note-play-${h.props.id}`,
                      label: playing ? 'Pause the voice note' : paused ? 'Go on playing the voice note' : 'Play the voice note',
                      fill: 'transparent',
                      size: 20,
                      message: MessageRowMessage.PressedNote({ index }),
                    },
                    playing ? pauseIcon(h, palette.ink2) : playIcon(h, palette.ink2),
                  ),
                ]),
              )
          }),
          // Not selectable: a hold opens the message's menu, and Select text is in it.
          h.text.style({ ...TYPE.message, color: palette.ink }).children(h.props.text),
        ),
    )
  },
})
