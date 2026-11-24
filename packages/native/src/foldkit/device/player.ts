/**
 * The voice note player as Foldkit Commands and one Subscription.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/player.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema, Stream } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError, streamOf } from '../../host/device/common.js'
import { CAPABILITY, Player, Playback, type PlayerEvent } from '../../host/device/player.js'

export * from '../../host/device/player.js'

export const Message = defineMessageUnion({
  StartedPlayback: { uri: Schema.String },
  PausedPlayback: {},
  SoughtPlayback: { positionMs: Schema.Number },
  ChangedPlaybackRate: { rate: Schema.Number },
  StoppedPlayback: {},
  /** `action` is play, pause, seek or rate. */
  FailedPlayback: { action: Schema.String, reason: Schema.String },
  /** From the Subscription: where playback has got to. */
  ChangedPlayback: { playback: Playback },
  /** From the Subscription: the sound played to its end. */
  FinishedPlayback: { uri: Schema.String },
})
export type Message = typeof Message.Type

const action = <A>(name: string, effect: Effect.Effect<A, DeviceError, Player>) =>
  Effect.catch(effect, error =>
    Effect.succeed(Message.FailedPlayback({ action: name, reason: error.reason })),
  )

export const Play = Command.define('Player.Play', {
  args: { uri: Schema.String, rate: Schema.Number },
  messages: [Message.StartedPlayback, Message.FailedPlayback],
  execute: ({ uri, rate }) =>
    action(
      'play',
      Player.use(player => player.play(uri, rate)).pipe(
        Effect.as(Message.StartedPlayback({ uri })),
      ),
    ),
})

export const Pause = Command.define('Player.Pause', {
  messages: [Message.PausedPlayback, Message.FailedPlayback],
  execute: action(
    'pause',
    Player.use(player => player.pause).pipe(Effect.as(Message.PausedPlayback())),
  ),
})

export const Seek = Command.define('Player.Seek', {
  args: { positionMs: Schema.Number },
  messages: [Message.SoughtPlayback, Message.FailedPlayback],
  execute: ({ positionMs }) =>
    action(
      'seek',
      Player.use(player => player.seek(positionMs)).pipe(
        Effect.as(Message.SoughtPlayback({ positionMs })),
      ),
    ),
})

export const SetRate = Command.define('Player.SetRate', {
  args: { rate: Schema.Number },
  messages: [Message.ChangedPlaybackRate, Message.FailedPlayback],
  execute: ({ rate }) =>
    action(
      'rate',
      Player.use(player => player.setRate(rate)).pipe(
        Effect.as(Message.ChangedPlaybackRate({ rate })),
      ),
    ),
})

/** Stops and frees the player. */
export const Stop = Command.define('Player.Stop', {
  messages: [Message.StoppedPlayback],
  execute: Player.use(player => player.stop).pipe(Effect.as(Message.StoppedPlayback())),
})

const messageOf = (event: PlayerEvent): Message =>
  event._tag === 'Changed'
    ? Message.ChangedPlayback({ playback: event.playback })
    : Message.FinishedPlayback({ uri: event.uri })

/**
 * Where playback has got to, as a Stream, for a Subscription that runs only
 * while a note is loaded. Four Messages a second while it plays.
 */
export const positions: Stream.Stream<Message, never, Player> = Stream.unwrap(
  Player.useSync(player => Stream.map(streamOf(CAPABILITY, player.events), messageOf)),
)
