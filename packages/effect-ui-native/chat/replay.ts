/**
 * Replay: run a recorded timeline again and see whether it ends where the
 * real session ended.
 *
 * A timeline (`timeline.ts`) holds two kinds of thing: what the screens did
 * and what the player did. Replay feeds each back to the code that handles
 * it, with nothing real behind that code. No server is asked and no sound
 * is played. The answers those once gave are in the timeline already, as
 * the Messages and events that followed, and replay feeds those back too.
 *
 * - **The player.** A new actor is started from its first state, with no
 *   audio behind it. Every event in the player's record is sent to it
 *   again, in order, each under its old number. That includes the phone's
 *   own answers (ready, position, finished), which were recorded as events
 *   from the sender `audio`. Each step it takes is held against the
 *   recorded one. The first that differs is reported.
 * - **The screens.** Each screen is run again by Effect UI's own
 *   `Story.fromLog`: it starts from the screen's first recorded state and
 *   gives its `update` every recorded Message, with the props and server
 *   data it saw then. Commands are compared and never run. The first
 *   Message that gives another result than was recorded is reported.
 *
 * A screen's log holds copies of the player's steps it heard. It does not
 * hold what the player was told. So the screens' log alone brings back the
 * screens and not the player: a replay with no player items leaves the
 * player in its first state. `test/replay.test.ts` has a test that says so.
 *
 * This file is for tests and for a tool that reads a timeline file. The
 * app itself does not load it.
 */
import { Story } from '@effect/ui/testing'
import { Effect, Schema } from 'effect'

import { makeClock } from './clock.js'
import { type PlayerMachine, type PlayerState, PlayerStep } from './machines/player.js'
import { makePlayer } from './machines/playerActor.js'
import type { Item, LogEntry } from './timeline.js'

type AnyComponent = Parameters<typeof Story.fromLog>[0]

export type ReplayOptions = Readonly<{
  /** The merged timeline, lowest number first. */
  items: ReadonlyArray<Item>
  /** The components whose instances are run again. One that is not listed is left out. */
  components: ReadonlyArray<AnyComponent>
  /** The player's rules. The app's own if left out. A test passes rules with a fault in them. */
  machine?: PlayerMachine
}>

/** A step of the replayed player that is not the step that was recorded. */
export type PlayerDifference = Readonly<{ n: number; recorded: PlayerStep; replayed: PlayerStep }>

export type ScreenReplay = Readonly<{
  component: string
  path: string
  /** The Model the replay ended with. */
  model: unknown
  /** How many Messages were run again. */
  replayed: number
  /** The first Message that did not give what was recorded, if any. */
  divergence: unknown
}>

export type ReplayResult = Readonly<{
  player: Readonly<{
    /** The state the replayed player ended in. */
    state: PlayerState
    /** How many events it was sent. */
    replayed: number
    /** The first step that differs from the recording. Null: every step was the same. */
    difference: PlayerDifference | null
  }>
  screens: ReadonlyArray<ScreenReplay>
  /** Nothing differed: not a step of the player, not a Message of a screen. */
  isSame: boolean
}>

const sameStep = Schema.toEquivalence(PlayerStep)

const componentOf = (entry: LogEntry): string | undefined => {
  const component = (entry as { readonly component?: unknown }).component
  return typeof component === 'string'
    ? component
    : (component as { readonly definition?: { readonly name?: string } } | undefined)?.definition?.name
}

export const replay = (options: ReplayOptions): Effect.Effect<ReplayResult> =>
  Effect.scoped(
    Effect.gen(function* () {
      // THE PLAYER: a new actor, no audio, the recorded events in order under their old numbers.
      const clock = makeClock()
      const player = yield* makePlayer({ clock, audio: 'none', ...(options.machine === undefined ? {} : { machine: options.machine }) })
      let difference: PlayerDifference | null = null
      let sent = 0
      for (const item of options.items) {
        if (item.from !== 'player') continue
        clock.set(item.n - 1)
        yield* player.send(item.step.event)
        sent += 1
        const replayed = player.log().at(-1) as PlayerStep
        if (difference === null && !sameStep(item.step, replayed)) difference = { n: item.n, recorded: item.step, replayed }
      }

      // THE SCREENS: each instance of each listed component, from its own entries.
      const entries = options.items.filter(item => item.from === 'screens').map(item => item.entry)
      const screens: Array<ScreenReplay> = []
      for (const component of options.components) {
        const name = (component as unknown as { readonly definition: { readonly name: string } }).definition.name
        const paths = new Set<string>()
        for (const entry of entries) {
          const path = (entry as { readonly path?: unknown }).path
          const tag = (entry as { readonly _tag: string })._tag
          if (componentOf(entry) === name && typeof path === 'string' && (tag === 'Mounted' || tag === 'Update')) paths.add(path)
        }
        for (const path of paths) {
          const result = Story.fromLog(component, entries as Parameters<typeof Story.fromLog>[1], { path })
          screens.push({ component: name, path, model: result.model, replayed: result.replayed, divergence: result.divergence })
        }
      }

      return {
        player: { state: player.state(), replayed: sent, difference },
        screens,
        isSame: difference === null && screens.every(screen => screen.divergence === undefined),
      }
    }),
  )
