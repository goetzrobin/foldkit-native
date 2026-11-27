/**
 * The app's one audio player, running: the rules of `player.ts` as an
 * actor, the phone's audio behind it, and a record of everything it was
 * told.
 *
 * An actor is a machine that runs on its own, apart from any screen. It
 * takes events one at a time, in the order they arrive. Screens come and
 * go. The actor stays for as long as the Layer that made it is built. In
 * the app that is from start to end, so a note goes on playing when you
 * leave the chat it is in.
 *
 * The service has three things:
 *
 * - `send(event)`: hands the actor an event. Every event names its sender.
 * - `latest()`: the last step that changed the state, or null before the
 *   first.
 * - `listen(listener)`: every later step that changes the state.
 *
 * A step is the whole story of one event: the state before, the event, the
 * state after, and a number from the shared clock. See `PlayerStep`.
 *
 * `log()` is the actor's own record: every event it received, in order,
 * with what it did to the state. Events it ignored are there too, marked
 * `changed: false`. Listeners are not told about those.
 *
 * From effect-machine: `Machine.spawn` makes the actor, `Machine.scoped`
 * stops it when the Layer closes, and the `inspect` hook reports each event
 * the actor takes and each transition it makes. The record, the numbering
 * and the listeners are built on that hook. Driving the sound is ours: on
 * each step that changed the state, `drive` tells the phone's player what
 * to do, and the phone's answers come back as events from the sender
 * `audio`.
 */
import { Context, Effect, Layer, Queue, Stream } from 'effect'
import { Machine, makeInspector } from 'effect-machine'

import * as Device from '../../../native/src/host/device/index.js'
import { SharedClock, type SharedClockService } from '../clock.js'
import { PlayerEvent, type PlayerMachine, PlayerState, type PlayerStep, type Sender, playerMachine } from './player.js'

export type PlayerService = Readonly<{
  /** Hands the actor an event. It is taken in turn, after the events sent before it. */
  send: (event: PlayerEvent) => Effect.Effect<void>
  /** The same, for code that is not an Effect. */
  sendNow: (event: PlayerEvent) => void
  /** The state right now. */
  state: () => PlayerState
  /** The last step that changed the state. Null before the first. */
  latest: () => PlayerStep | null
  /** Calls `listener` with each later step that changes the state. Returns the way to stop. */
  listen: (listener: (step: PlayerStep) => void) => () => void
  /** Each later step that changes the state. */
  steps: Stream.Stream<PlayerStep>
  /** Every event the actor received, oldest first, with what it did. The last `LOG_SIZE` are kept. */
  log: () => ReadonlyArray<PlayerStep>
}>

/** How many events the actor's record keeps. */
export const LOG_SIZE = 2000

/** What plays the sound: the phone's player, or nothing at all. */
export type Audio = Device.Player.PlayerService | 'none'

export type MakeOptions = Readonly<{
  machine?: PlayerMachine
  clock: SharedClockService
  /**
   * `'none'`: nothing is played and nothing answers. Replay uses it, and
   * feeds the recorded answers back itself.
   */
  audio: Audio
}>

const AUDIO = 'audio'

/** Makes a running player. It stops when the scope it was made in closes. */
export const makePlayer = (options: MakeOptions) =>
  Effect.gen(function* () {
    const { clock, audio } = options
    const machine = options.machine ?? playerMachine
    const log: Array<PlayerStep> = []
    const listeners = new Set<(step: PlayerStep) => void>()
    let latest: PlayerStep | null = null
    let answers = 0
    const fromAudio = (): Sender => ({ name: AUDIO, id: `${AUDIO}-${++answers}` })

    // Late bound: the inspector below is made before the actor it reports on.
    let sendNow: (event: PlayerEvent) => void = () => {}

    /** What the phone's player is told after a step that changed the state. */
    const drive = (step: PlayerStep): Effect.Effect<void> => {
      if (audio === 'none') return Effect.void
      const { before, after } = step
      if (PlayerState.$is('Loading')(after)) {
        const { uri } = after.note
        // From the start, whatever was loaded before.
        return audio.stop.pipe(
          Effect.andThen(audio.play(uri, 1)),
          Effect.match({
            onSuccess: () => sendNow(PlayerEvent.AudioReady({ uri, by: fromAudio() })),
            onFailure: error => sendNow(PlayerEvent.AudioFailed({ uri, reason: error.reason, by: fromAudio() })),
          }),
        )
      }
      if (PlayerState.$is('Paused')(after) && PlayerState.$is('Playing')(before)) return Effect.ignore(audio.pause)
      if (PlayerState.$is('Playing')(after) && PlayerState.$is('Paused')(before)) {
        const { uri } = after.note
        return audio.play(uri, 1).pipe(
          Effect.catch(error => Effect.sync(() => sendNow(PlayerEvent.AudioFailed({ uri, reason: error.reason, by: fromAudio() })))),
        )
      }
      // Stopped, finished or failed: the phone's player is let go.
      if (PlayerState.$is('Stopped')(after) || PlayerState.$is('Failed')(after)) return audio.stop
      return Effect.void
    }

    const keep = (step: PlayerStep, replacesLast: boolean): void => {
      if (replacesLast) log[log.length - 1] = step
      else log.push(step)
      if (log.length > LOG_SIZE) log.splice(0, log.length - LOG_SIZE)
    }

    /** The event the actor is working on, as it was written into the record. */
    let open: PlayerStep | null = null

    const inspect = makeInspector<typeof PlayerState, typeof PlayerEvent>(inspected => {
      if (inspected.type === '@machine.event') {
        // The actor has taken an event. It gets its number now, in the order events are really handled.
        open = { seq: clock.next(), before: inspected.state, event: inspected.event, after: inspected.state, changed: false }
        keep(open, false)
        return
      }
      if (inspected.type !== '@machine.transition' || open === null || inspected.event !== open.event) return
      // A rule that hands back the state it was given has ignored the event.
      if (inspected.toState === inspected.fromState) return
      const step: PlayerStep = { ...open, after: inspected.toState, changed: true }
      open = null
      keep(step, true)
      latest = step
      for (const listener of [...listeners]) listener(step)
      return drive(step)
    })

    const actor = yield* Machine.spawn(machine, { id: 'player', inspect })
    yield* actor.start
    sendNow = event => actor.client.send(event)

    if (audio !== 'none') {
      // The phone's own reports: where the sound has got to, and that it reached its end.
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          audio.events.subscribe(report => {
            if (report._tag === 'Finished') sendNow(PlayerEvent.Finished({ uri: report.uri, by: fromAudio() }))
            else if (report.playback.isPlaying) {
              sendNow(PlayerEvent.Position({ uri: report.playback.uri, positionMs: report.playback.positionMs, by: fromAudio() }))
            }
          }),
        ),
        stop => Effect.andThen(Effect.sync(stop), audio.stop),
      )
    }

    const service: PlayerService = {
      // `call` answers once the actor has dealt with the event.
      send: event => Effect.asVoid(actor.call(event)),
      sendNow: event => sendNow(event),
      state: () => actor.client.getSnapshot(),
      latest: () => latest,
      listen: listener => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
      steps: Stream.callback<PlayerStep>(queue =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (step: PlayerStep): void => void Queue.offerUnsafe(queue, step)
            listeners.add(listener)
            return listener
          }),
          listener => Effect.sync(() => void listeners.delete(listener)),
        ),
      ),
      log: () => log.slice(),
    }
    return service
  }).pipe(Machine.scoped)

export class Player extends Context.Service<Player, PlayerService>()('chat/Player') {
  /**
   * The player over the phone's audio. Provide it once where the app starts
   * and there is one player for the whole app. Provide it around one screen
   * and that screen has a player of its own, which stops when the screen goes.
   */
  static readonly Live: Layer.Layer<Player, never, Device.Player.Player | SharedClock> = Layer.effect(
    Player,
    Effect.gen(function* () {
      const audio = yield* Device.Player.Player
      const clock = yield* SharedClock
      return yield* makePlayer({ clock, audio })
    }),
  )
}
