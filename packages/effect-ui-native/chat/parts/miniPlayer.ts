/**
 * The mini player: one quiet row that shows which voice note the app's
 * player holds, with a button to pause or go on and one to close.
 *
 * It is drawn on the list of chats and in every chat. It shows while a note
 * is loading, playing or paused, and takes no room otherwise.
 *
 * It owns nothing. The player is an actor apart from every screen, and this
 * row is one of its listeners: it keeps the last state it heard, and its
 * buttons send the player an event with this row named as the sender. So a
 * note started in a chat can be paused here on the list, and the chat's own
 * row hears the same step.
 */
import { Command, UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native } from '../../src/index.js'
import { cross, pauseIcon, playIcon } from '../icons.js'
import { clockOf } from '../list.js'
import { NOTHING_PLAYING, PlayerEvent, PlayerState, PlayerStep, SendToPlayer, heardPlayer, sender } from '../playback.js'
import { RADIUS, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { roundButton } from '../ui.js'

export const MiniPlayerProps = Schema.Struct({
  scheme: Scheme,
  /** Where this row is drawn. It is part of the row's name as a sender, and of its testIDs. */
  place: Schema.Literals(['list', 'chat']),
})

export const MiniPlayerMessage = UiSchema.TaggedEnum({
  /** The player took a step. The whole step is here: what it was, what happened, who asked, what it is now. */
  HeardPlayer: { step: PlayerStep },
  PressedToggle: {},
  PressedClose: {},
  Sent: {},
})

const MiniPlayerModel = Schema.Struct({
  /** The player's state, as last heard. */
  player: PlayerState,
  /** How many events this row has sent. The next one's id is made from it. */
  sent: Schema.Number,
})

const sent = Command.as(MiniPlayerMessage.Sent())

export const MiniPlayer = Native.component({
  name: 'MiniPlayer',
  props: MiniPlayerProps,
  model: MiniPlayerModel,
  message: MiniPlayerMessage,
}).make({
  init: () => ({ player: NOTHING_PLAYING, sent: 0 }),
  update: {
    HeardPlayer: ($, { step }) => $.evolve({ player: step.after }),
    PressedToggle: $ => {
      const by = sender('mini-bar', `${$.props.place}#${$.model.sent + 1}`)
      const event = PlayerState.$match<PlayerEvent | null>($.model.player, {
        Stopped: () => null,
        Loading: () => null,
        Playing: () => PlayerEvent.Pause({ by }),
        Paused: () => PlayerEvent.Resume({ by }),
        // Try the same note again.
        Failed: ({ note }) => PlayerEvent.Play({ note, by }),
      })
      return event === null ? $.model : $.evolve({ sent: count => count + 1 }).run(SendToPlayer.make({ event }).pipe(sent))
    },
    PressedClose: $ =>
      PlayerState.$is('Stopped')($.model.player)
        ? $.model
        : $.evolve({ sent: count => count + 1 }).run(
            SendToPlayer.make({
              event: PlayerEvent.Stop({ by: sender('mini-bar', `${$.props.place}#${$.model.sent + 1}`) }),
            }).pipe(sent),
          ),
    Sent: $ => $.model,
  },
  subscriptions: () => [heardPlayer(step => MiniPlayerMessage.HeardPlayer({ step }))],
  view: (h, model) => {
    const { scheme, place } = h.props
    const palette = paletteOf(scheme)
    const player = model.player
    // Nothing to show: an empty view that takes no room.
    if (PlayerState.$is('Stopped')(player)) return h.view.testId(`mini-player-off-${place}`)
    const words = PlayerState.$match(player, {
      Stopped: () => '',
      Loading: () => 'Loading',
      Playing: each => clockOf(each.positionMs / 1000),
      Paused: each => `Paused at ${clockOf(each.positionMs / 1000)}`,
      Failed: () => 'Could not play',
    })
    const isPlaying = PlayerState.$is('Playing')(player)
    const canToggle = !PlayerState.$is('Loading')(player)
    return h.view
      .testId(`mini-player-${place}`)
      .set({ accessibilityLabel: `${player.note.label}. ${words}` })
      .style({
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.m,
        marginHorizontal: SPACE.m,
        marginBottom: SPACE.xs,
        paddingVertical: SPACE.s,
        paddingLeft: SPACE.m,
        paddingRight: SPACE.s,
        borderRadius: RADIUS.chip,
        backgroundColor: palette.surface,
      })
      .children(
        roundButton(
          h,
          {
            id: `mini-toggle-${place}`,
            label: isPlaying ? 'Pause the voice note' : 'Play the voice note',
            fill: palette.ink,
            size: 28,
            message: canToggle ? MiniPlayerMessage.PressedToggle() : undefined,
          },
          isPlaying ? pauseIcon(h, palette.bg) : playIcon(h, palette.bg),
        ),
        h.view.style({ flex: 1 }).children(
          h.text
            .testId(`mini-label-${place}`)
            .set({ numberOfLines: 1 })
            .style({ ...TYPE.meta, color: palette.ink })
            .children(player.note.label),
          h.text
            .testId(`mini-state-${place}`)
            .style({ ...TYPE.caption, color: PlayerState.$is('Failed')(player) ? palette.danger : palette.ink2 })
            .children(words),
        ),
        roundButton(
          h,
          { id: `mini-close-${place}`, label: 'Stop and close the player', fill: 'transparent', size: 28, message: MiniPlayerMessage.PressedClose() },
          cross(h, palette.ink2),
        ),
      )
  },
})
