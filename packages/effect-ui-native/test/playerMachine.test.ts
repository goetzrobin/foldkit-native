/**
 * The player's rules alone, with no actor and no sound: every rule the
 * machine has, and every event each state must ignore.
 */
import { describe, expect, it } from 'vitest'

import {
  PlayerEvent as E,
  PlayerState as S,
  PlayerSteps,
  type PlayerEvent,
  type PlayerState,
  isPaused,
  isPlaying,
  makePlayerMachine,
  noteOf,
  playerRules,
} from '../chat/machines/player.js'
import { stepper } from '../chat/machines/step.js'

const by = { name: 'test', id: 't1' }
const a = { uri: 'file:///a.m4a', label: 'Voice note 0:03' }
const b = { uri: 'file:///b.m4a', label: 'Voice note 0:07' }
const plain = (state: PlayerState) => JSON.parse(JSON.stringify(state)) as unknown

const states: Readonly<Record<PlayerState['_tag'], PlayerState>> = {
  Stopped: S.Stopped,
  Loading: S.Loading({ note: a }),
  Playing: S.Playing({ note: a, positionMs: 500 }),
  Paused: S.Paused({ note: a, positionMs: 750 }),
  Failed: S.Failed({ note: a, reason: 'The file is gone.' }),
}

/** Every event, about note `a` where it names one. */
const events: Readonly<Record<PlayerEvent['_tag'], PlayerEvent>> = {
  Play: E.Play({ note: b, by }),
  Pause: E.Pause({ by }),
  Resume: E.Resume({ by }),
  Stop: E.Stop({ by }),
  AudioReady: E.AudioReady({ uri: a.uri, by }),
  Position: E.Position({ uri: a.uri, positionMs: 1000, by }),
  Finished: E.Finished({ uri: a.uri, by }),
  AudioFailed: E.AudioFailed({ uri: a.uri, reason: 'It broke.', by }),
}

const loadingB = { _tag: 'Loading', note: b }
const table: Readonly<Record<string, unknown>> = {
  'Stopped/Play': loadingB,
  'Loading/Play': loadingB,
  'Playing/Play': loadingB,
  'Paused/Play': loadingB,
  'Failed/Play': loadingB,

  'Loading/AudioReady': { _tag: 'Playing', note: a, positionMs: 0 },
  'Loading/AudioFailed': { _tag: 'Failed', note: a, reason: 'It broke.' },
  'Loading/Stop': { _tag: 'Stopped' },

  'Playing/Pause': { _tag: 'Paused', note: a, positionMs: 500 },
  'Playing/Position': { _tag: 'Playing', note: a, positionMs: 1000 },
  'Playing/Finished': { _tag: 'Stopped' },
  'Playing/AudioFailed': { _tag: 'Failed', note: a, reason: 'It broke.' },
  'Playing/Stop': { _tag: 'Stopped' },

  'Paused/Resume': { _tag: 'Playing', note: a, positionMs: 750 },
  'Paused/Position': { _tag: 'Paused', note: a, positionMs: 1000 },
  'Paused/Stop': { _tag: 'Stopped' },

  'Failed/Stop': { _tag: 'Stopped' },
}

describe('The player machine: its rules', () => {
  it('has the rules in the table, and no others', () => {
    expect([...PlayerSteps.rules].sort()).toEqual(Object.keys(table).sort())
  })

  for (const [pair, next] of Object.entries(table)) {
    it(`${pair.replace('/', ' + ')} gives ${JSON.stringify(next)}`, () => {
      const [state, event] = pair.split('/') as [PlayerState['_tag'], PlayerEvent['_tag']]
      expect(plain(PlayerSteps.step(states[state], events[event]))).toEqual(next)
    })
  }

  it('every other pair of state and event is ignored: the state stays the very same', () => {
    let ignored = 0
    for (const state of Object.values(states)) {
      for (const event of Object.values(events)) {
        const pair = `${state._tag}/${event._tag}`
        if (pair in table) continue
        expect(PlayerSteps.handles(state, event), pair).toBe(false)
        expect(PlayerSteps.step(state, event), pair).toBe(state)
        ignored += 1
      }
    }
    // Five states and eight events: forty pairs in all.
    expect(ignored + Object.keys(table).length).toBe(40)
  })

  it('pause twice: the second one is ignored and the place is kept', () => {
    const paused = PlayerSteps.step(states.Playing, E.Pause({ by }))
    expect(PlayerSteps.step(paused, E.Pause({ by }))).toBe(paused)
  })

  it('an answer about a note that is no longer the current one is ignored', () => {
    // The first note's "finished" and "position" arrive after the second note has started.
    const second = S.Playing({ note: b, positionMs: 100 })
    expect(PlayerSteps.step(second, E.Finished({ uri: a.uri, by }))).toBe(second)
    expect(PlayerSteps.step(second, E.Position({ uri: a.uri, positionMs: 9000, by }))).toBe(second)
    expect(PlayerSteps.step(second, E.AudioFailed({ uri: a.uri, reason: 'late', by }))).toBe(second)
    const loading = S.Loading({ note: b })
    expect(PlayerSteps.step(loading, E.AudioReady({ uri: a.uri, by }))).toBe(loading)
  })

  it('a position the player already has changes nothing', () => {
    expect(PlayerSteps.step(states.Playing, E.Position({ uri: a.uri, positionMs: 500, by }))).toBe(states.Playing)
  })

  it('reads a state: its note, and whether a note is playing or paused', () => {
    expect(noteOf(S.Stopped)).toBeNull()
    expect(noteOf(states.Paused)).toEqual(a)
    expect(isPlaying(states.Playing, a.uri)).toBe(true)
    expect(isPlaying(states.Playing, b.uri)).toBe(false)
    expect(isPlaying(states.Paused, a.uri)).toBe(false)
    expect(isPaused(states.Paused, a.uri)).toBe(true)
    expect(isPaused(states.Paused, b.uri)).toBe(false)
  })

  it('a player built with one rule wrong behaves wrongly, and only there', () => {
    const broken = stepper(makePlayerMachine({ ...playerRules, pause: ({ state }) => state }))
    expect(broken.step(states.Playing, E.Pause({ by }))).toBe(states.Playing)
    expect(plain(broken.step(states.Paused, E.Resume({ by })))).toEqual(table['Paused/Resume'])
  })
})
