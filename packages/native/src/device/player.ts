/**
 * The player: plays one recorded sound at a time, as Foldkit Commands and
 * one Subscription.
 *
 *   // update
 *   PressedPlay:  commands: [lift(Player.Play({ uri, rate: 1 }))]
 *   PressedPause: commands: [lift(Player.Pause())]
 *   PressedSeek:  commands: [lift(Player.Seek({ positionMs }))]
 *   PressedSpeed: commands: [lift(Player.SetRate({ rate: 1.5 }))]
 *
 *   // subscriptions, only while something is loaded
 *   Player.positions   a Stream of ChangedPlayback / FinishedPlayback
 *
 * There is one player for the whole app. Playing a second sound lets go of
 * the first, so two never play over each other. The phone reports where
 * playback has got to four times a second while it plays, and that is how
 * often a Message is sent. Nothing is sent while it is paused.
 *
 * The player will not start while a recording is running: on iOS, setting
 * the phone up for the speaker would stop the recording.
 */
import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import {
  type AudioModule,
  type AudioSession,
  type FakeAudio,
  type NativePlayer,
  makeAudioSession,
  makeFakeAudio,
} from './audioNative.js'
import {
  DeviceError,
  type NativeSubscription,
  type Source,
  attempt,
  streamOf,
} from './common.js'

/** The speeds on offer. */
export const Rate = Schema.Literals([1, 1.5, 2])
export type Rate = typeof Rate.Type

export const Playback = Schema.Struct({
  uri: Schema.String,
  positionMs: Schema.Number,
  /** 0 until the phone has read the file. */
  durationMs: Schema.Number,
  isPlaying: Schema.Boolean,
})
export type Playback = typeof Playback.Type

export type PlayerEvent =
  | Readonly<{ _tag: 'Changed'; playback: Playback }>
  | Readonly<{ _tag: 'Finished'; uri: string }>

export type PlayerService = Readonly<{
  /** Plays `uri` from where it was left, loading it first if another sound, or none, is loaded. */
  play: (uri: string, rate: number) => Effect.Effect<void, DeviceError>
  pause: Effect.Effect<void, DeviceError>
  seek: (positionMs: number) => Effect.Effect<void, DeviceError>
  setRate: (rate: number) => Effect.Effect<void, DeviceError>
  /** Stops and frees the native player. Safe when nothing is loaded. */
  stop: Effect.Effect<void>
  events: Source<PlayerEvent>
}>

export class Player extends Context.Service<Player, PlayerService>()('foldkit-native/Player') {}

export type PlayerOptions = Readonly<{
  platform: string
  /** Shared with the recorder. Made here when left out. */
  session?: AudioSession
  /** How often the phone reports the position while playing. Default 250 ms. */
  updateMs?: number
}>

const CAPABILITY = 'player'

type Loaded = {
  uri: string
  player: NativePlayer
  subscription: NativeSubscription
  last: Playback
  /** After the end, the phone's reports are ignored until the next play. */
  hasEnded: boolean
}

export const make = (audio: AudioModule, options: PlayerOptions): PlayerService => {
  const audioSession = options.session ?? makeAudioSession(audio, options.platform)
  const listeners = new Set<(event: PlayerEvent) => void>()
  let loaded: Loaded | undefined

  const send = (event: PlayerEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }

  const letGo = (): void => {
    const current = loaded
    if (current === undefined) return
    loaded = undefined
    try {
      current.subscription.remove()
    } catch {
      // The listener is gone either way.
    }
    try {
      current.player.pause()
    } catch {
      // A player that will not pause is removed below all the same.
    }
    try {
      // What expo-audio's hook does when its component goes away.
      current.player.remove()
      current.player.release?.()
    } catch {
      // Already released.
    }
  }

  const load = (uri: string): Loaded => {
    letGo()
    const player = new audio.AudioPlayer({ uri }, options.updateMs ?? 250, false, 0, true)
    const current: Loaded = {
      uri,
      player,
      subscription: { remove: () => {} },
      last: { uri, positionMs: 0, durationMs: 0, isPlaying: false },
      hasEnded: false,
    }
    current.subscription = player.addListener('playbackStatusUpdate', status => {
      if (loaded !== current || current.hasEnded) return
      if (status.didJustFinish) {
        // Back to the start, ready to be played again. Paused first: on
        // Android a player left "playing" at its end starts again on seek.
        current.hasEnded = true
        current.last = { ...current.last, positionMs: 0, isPlaying: false }
        try {
          player.pause()
          void player.seekTo(0).catch(() => {})
        } catch {
          // The note still shows as finished.
        }
        send({ _tag: 'Finished', uri })
        return
      }
      const duration = Number.isFinite(status.duration) ? status.duration : 0
      current.last = {
        uri,
        positionMs: Math.round((Number.isFinite(status.currentTime) ? status.currentTime : 0) * 1000),
        durationMs: Math.round(duration * 1000),
        isPlaying: status.playing,
      }
      send({ _tag: 'Changed', playback: current.last })
    })
    loaded = current
    return current
  }

  const current = (): Loaded => {
    if (loaded === undefined) throw new Error('Nothing is loaded.')
    return loaded
  }

  return {
    play: (uri, rate) =>
      attempt(CAPABILITY, async () => {
        if (audioSession.isRecording()) {
          throw new Error('A recording is running. Stop it before playing a note.')
        }
        await audioSession.forPlayback()
        const target = loaded?.uri === uri ? loaded : load(uri)
        target.hasEnded = false
        target.player.setPlaybackRate(rate)
        target.player.play()
      }),
    pause: attempt(CAPABILITY, () => {
      current().player.pause()
    }),
    seek: positionMs =>
      attempt(CAPABILITY, async () => {
        const target = current()
        await target.player.seekTo(Math.max(0, positionMs) / 1000)
        // A paused player sends no status, so the new place is reported here.
        if (loaded === target && !target.last.isPlaying) {
          target.last = { ...target.last, positionMs: Math.max(0, positionMs) }
          send({ _tag: 'Changed', playback: target.last })
        }
      }),
    setRate: rate =>
      attempt(CAPABILITY, () => {
        // One argument: Android's native method takes no second one.
        current().player.setPlaybackRate(rate)
      }),
    stop: Effect.sync(letGo),
    events: {
      subscribe: listener => {
        listeners.add(listener)
        if (loaded !== undefined) listener({ _tag: 'Changed', playback: loaded.last })
        return () => {
          listeners.delete(listener)
        }
      },
    },
  }
}

export const unavailable = (reason: string): PlayerService => {
  const failed = Effect.fail(new DeviceError({ capability: CAPABILITY, reason }))
  return {
    play: () => failed,
    pause: failed,
    seek: () => failed,
    setRate: () => failed,
    stop: Effect.void,
    events: { subscribe: () => () => {} },
  }
}

/** `Player.live(audioModuleFromGlobal(), { platform: Platform.OS })`. */
export const live = (
  audio: AudioModule | null | undefined,
  options: PlayerOptions,
): Layer.Layer<Player> =>
  Layer.succeed(
    Player,
    audio === null || audio === undefined
      ? unavailable('this build has no expo-audio (globalThis.expo.modules.ExpoAudio is missing)')
      : make(audio, options),
  )

/**
 * The real player code over a pretend phone. `audio.advance(1000)` lets a
 * second of sound play. `audio.players` lists every native player made.
 */
export const makeTest = (
  options: Readonly<{ audio?: FakeAudio; session?: AudioSession; platform?: string }> = {},
) => {
  const audio = options.audio ?? makeFakeAudio()
  const service = make(audio.module, {
    platform: options.platform ?? 'ios',
    ...(options.session === undefined ? {} : { session: options.session }),
  })
  let listening = 0
  const counted: PlayerService = {
    ...service,
    events: {
      subscribe: listener => {
        listening += 1
        const stop = service.events.subscribe(listener)
        return () => {
          listening -= 1
          stop()
        }
      },
    },
  }
  return {
    layer: Layer.succeed(Player, counted),
    service: counted,
    audio,
    listenerCount: () => listening,
  }
}

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
