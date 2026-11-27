/**
 * The app's audio player, as a screen reaches it: one Command to send it an
 * event, and one Subscription to hear what it did.
 *
 * The player itself is an actor that runs apart from every screen
 * (`machines/playerActor.ts`). A screen never holds it. A screen that plays
 * or pauses a note sends an event, and names itself as the sender. A screen
 * that shows what is playing listens. Both go through the `Player` service,
 * which the app provides once, where it starts.
 *
 * What a listener hears is a step: the state before, the event and who
 * sent it, the state after, and the step's number. The listener puts the
 * whole step into a Message, so its own timeline shows what caused the
 * change it drew.
 */
import { Command, Subscription } from '@effect/ui'
import { Effect, Layer, Queue, Schema, Stream } from 'effect'

import { PlayerEvent, PlayerState, type PlayerStep, type Sender } from './machines/player.js'
import { Player } from './machines/playerActor.js'

export { Player }
export { Note, PlayerEvent, PlayerState, PlayerStep, isPaused, isPlaying, noteOf } from './machines/player.js'

/** Hands the player an event. It answers once the player has dealt with it. */
export class SendToPlayer extends Command.Service<SendToPlayer>()('chat/SendToPlayer', {
  args: { event: PlayerEvent },
  success: Schema.Void,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const player = yield* Player
      return ({ event }) => player.send(event)
    }),
  )
}

/** Who a screen says it is when it sends: its name, and an id it counts up itself. */
export const sender = (name: string, id: string): Sender => ({ name, id })

/**
 * What the player does, as Messages. A listener that arrives late hears the
 * last step first, so it knows the state at once. Then every step that
 * changes the state.
 *
 * With `positions: false` the listener is not told each time the sound moves
 * on a quarter of a second. A row that only shows "Playing" or "Paused" has
 * no use for those.
 */
export const heardPlayer = <Msg>(
  toMessage: (step: PlayerStep) => Msg,
  options: Readonly<{ positions: boolean }> = { positions: true },
): Subscription.Subscription<Msg, Player> =>
  Subscription.make('chat/player', options.positions ? 'all' : 'changes', () =>
    Stream.unwrap(
      Effect.map(Effect.service(Player), player =>
        Stream.callback<Msg>(queue =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const latest = player.latest()
              if (latest !== null) Queue.offerUnsafe(queue, toMessage(latest))
              return player.listen(step => {
                if (!options.positions && step.event._tag === 'Position') return
                Queue.offerUnsafe(queue, toMessage(step))
              })
            }),
            stop => Effect.sync(stop),
          ),
        ),
      ),
    ),
  )

export type Services = SendToPlayer

/** The Command, over the `Player` service. */
export const layer: Layer.Layer<Services, never, Player> = SendToPlayer.layer

/** What a listener's Model starts with, before it has heard anything. */
export const NOTHING_PLAYING: PlayerState = PlayerState.Stopped
