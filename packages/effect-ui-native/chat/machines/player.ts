/**
 * The rules of the app's one audio player: which modes it can be in, and
 * what moves it from one to the next.
 *
 * This file is only the rules. It plays nothing and draws nothing, so a
 * browser or terminal app can use it as it is. `playerActor.ts` runs these
 * rules as an actor and plays the sound.
 *
 * The modes:
 *
 * - `Stopped`: nothing is loaded.
 * - `Loading`: a note was asked for, and the phone has not started it yet.
 * - `Playing` and `Paused`: a note, and how far into it the player is.
 * - `Failed`: the phone could not play the note.
 *
 * Every event says who sent it (`by`): a short name, and an id the sender
 * makes up, so the sender can find its own event again in a timeline.
 *
 * An event that has no rule in the current state is ignored. So is an
 * answer from the phone about a note that is no longer the current one: a
 * late "finished" for the first note must not stop the second.
 */
import { Schema } from 'effect'
import { Event, Machine, State } from 'effect-machine'

import { stepper } from './step.js'

/** A voice note the player can play. */
export const Note = Schema.Struct({
  uri: Schema.String,
  /** What the mini player shows, such as "Voice note 0:03". */
  label: Schema.String,
})
export type Note = typeof Note.Type

/** Who sent an event: a short name, and an id the sender attaches. */
export const Sender = Schema.Struct({ name: Schema.String, id: Schema.String })
export type Sender = typeof Sender.Type

export const PlayerState = State({
  Stopped: {},
  Loading: { note: Note },
  Playing: { note: Note, positionMs: Schema.Number },
  Paused: { note: Note, positionMs: Schema.Number },
  Failed: { note: Note, reason: Schema.String },
})
export type PlayerState = typeof PlayerState.Type

export const PlayerEvent = Event({
  // From the screens
  Play: { note: Note, by: Sender },
  Pause: { by: Sender },
  Resume: { by: Sender },
  Stop: { by: Sender },
  // From the phone's audio
  AudioReady: { uri: Schema.String, by: Sender },
  Position: { uri: Schema.String, positionMs: Schema.Number, by: Sender },
  Finished: { uri: Schema.String, by: Sender },
  AudioFailed: { uri: Schema.String, reason: Schema.String, by: Sender },
})
export type PlayerEvent = typeof PlayerEvent.Type

const S = PlayerState
const E = PlayerEvent

type WithNote = Extract<PlayerState, { readonly note: Note }>
type At<Tag extends PlayerState['_tag']> = Extract<PlayerState, { readonly _tag: Tag }>
type On<Tag extends PlayerEvent['_tag']> = Extract<PlayerEvent, { readonly _tag: Tag }>

/** An answer from the phone counts only if it is about the note the player holds now. */
const isCurrent = (state: WithNote, event: { readonly uri: string }): boolean => state.note.uri === event.uri

/**
 * The rules, each with a name. `makePlayerMachine` puts them together. A
 * test that wants a player with one rule wrong passes its own copy.
 */
export const playerRules = {
  play: ({ event }: { readonly event: On<'Play'> }): PlayerState => S.Loading({ note: event.note }),
  ready: ({ state, event }: { readonly state: At<'Loading'>; readonly event: On<'AudioReady'> }): PlayerState =>
    isCurrent(state, event) ? S.Playing({ note: state.note, positionMs: 0 }) : state,
  pause: ({ state }: { readonly state: At<'Playing'> }): PlayerState => S.Paused.with(state),
  resume: ({ state }: { readonly state: At<'Paused'> }): PlayerState => S.Playing.with(state),
  stop: (): PlayerState => S.Stopped,
  position: ({
    state,
    event,
  }: {
    readonly state: At<'Playing'> | At<'Paused'>
    readonly event: On<'Position'>
  }): PlayerState =>
    !isCurrent(state, event) || event.positionMs === state.positionMs
      ? state
      : state._tag === 'Playing'
        ? S.Playing.with(state, { positionMs: event.positionMs })
        : S.Paused.with(state, { positionMs: event.positionMs }),
  finished: ({ state, event }: { readonly state: At<'Playing'>; readonly event: On<'Finished'> }): PlayerState =>
    isCurrent(state, event) ? S.Stopped : state,
  failed: ({
    state,
    event,
  }: {
    readonly state: At<'Loading'> | At<'Playing'>
    readonly event: On<'AudioFailed'>
  }): PlayerState => (isCurrent(state, event) ? S.Failed({ note: state.note, reason: event.reason }) : state),
}
export type PlayerRules = typeof playerRules

export const makePlayerMachine = (rules: PlayerRules = playerRules) =>
  Machine.make({ state: PlayerState, event: PlayerEvent, initial: PlayerState.Stopped })
    // Playing a note takes the place of whatever was there: a second note stops the first.
    .on([S.Stopped, S.Loading, S.Playing, S.Paused, S.Failed], E.Play, rules.play)
    .on(S.Loading, E.AudioReady, rules.ready)
    .on(S.Playing, E.Pause, rules.pause)
    .on(S.Paused, E.Resume, rules.resume)
    .on([S.Loading, S.Playing, S.Paused, S.Failed], E.Stop, rules.stop)
    .on([S.Playing, S.Paused], E.Position, rules.position)
    .on(S.Playing, E.Finished, rules.finished)
    .on([S.Loading, S.Playing], E.AudioFailed, rules.failed)

export const playerMachine = makePlayerMachine()
export type PlayerMachine = typeof playerMachine

/** The rules as a function, for a test or a screen that wants the next state with no actor. */
export const PlayerSteps = stepper(playerMachine)

/**
 * One step of the player, with the whole story: the state before, the
 * event (which names its sender), the state after, and a number from the
 * app's shared clock. `changed` is false for an event that was ignored.
 */
export const PlayerStep = Schema.Struct({
  seq: Schema.Number,
  before: PlayerState,
  event: PlayerEvent,
  after: PlayerState,
  changed: Schema.Boolean,
})
export type PlayerStep = typeof PlayerStep.Type

/** The note a state holds, if it holds one. */
export const noteOf = (state: PlayerState): Note | null => (S.$is('Stopped')(state) ? null : state.note)

/** Whether `uri` is the note being played right now. */
export const isPlaying = (state: PlayerState, uri: string): boolean => S.$is('Playing')(state) && state.note.uri === uri

/** Whether `uri` is the note the player holds, paused. */
export const isPaused = (state: PlayerState, uri: string): boolean => S.$is('Paused')(state) && state.note.uri === uri
