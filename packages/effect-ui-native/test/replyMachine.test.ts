/**
 * The reply's rules alone, with no screen: every rule the machine has, and
 * every event each state must ignore.
 *
 * The table below is the whole machine. A rule that is in the machine and
 * not in the table fails the first test, and so does one in the table that
 * the machine lacks.
 */
import { describe, expect, it } from 'vitest'

import { MAX_RECONNECTS as HOST_MAX, reconnectDelayMs as hostDelay } from '../../native/src/host/aiChat/turns.js'
import {
  MAX_RECONNECTS,
  NO_REASON,
  Reply,
  ReplyEvent as E,
  ReplyState as S,
  type ReplyEvent,
  type ReplyState,
  allowed,
  fromSaved,
  hasWords,
  reconnectDelayMs,
} from '../chat/machines/reply.js'

const tagged = <T extends { readonly _tag: string }>(value: T): T => ({ ...value })
const same = (state: ReplyState) => JSON.parse(JSON.stringify(state)) as unknown

const states: Readonly<Record<ReplyState['_tag'], ReplyState>> = {
  Waiting: S.Waiting,
  Thinking: S.Thinking,
  Streaming: S.Streaming,
  Reconnecting: S.Reconnecting({ attempt: 2, hasWords: true }),
  Lost: S.Lost({ hasWords: false }),
  Gone: S.Gone,
  Done: S.Done,
  Stopped: S.Stopped,
  Failed: S.Failed({ reason: 'The model is busy.' }),
}

const events: Readonly<Record<ReplyEvent['_tag'], ReplyEvent>> = {
  Started: E.Started,
  Words: E.Words,
  Worked: E.Worked,
  Finished: E.Finished({ wasStopped: false }),
  Failed: E.Failed({ reason: 'It broke.' }),
  LostConnection: E.LostConnection,
  Forgotten: E.Forgotten,
  Reconnect: E.Reconnect,
  CameBack: E.CameBack,
  TryAgain: E.TryAgain,
}

/** `State/Event` to the state that follows, for the sample states above. */
const table: Readonly<Record<string, unknown>> = {
  'Waiting/Started': { _tag: 'Thinking' },

  'Thinking/Words': { _tag: 'Streaming' },
  'Thinking/Worked': { _tag: 'Thinking' },
  'Thinking/LostConnection': { _tag: 'Reconnecting', attempt: 1, hasWords: false },
  'Thinking/CameBack': { _tag: 'Thinking' },
  'Thinking/Finished': { _tag: 'Done' },
  'Thinking/Failed': { _tag: 'Failed', reason: 'It broke.' },
  'Thinking/Forgotten': { _tag: 'Gone' },

  'Streaming/Words': { _tag: 'Streaming' },
  'Streaming/Worked': { _tag: 'Streaming' },
  'Streaming/LostConnection': { _tag: 'Reconnecting', attempt: 1, hasWords: true },
  'Streaming/CameBack': { _tag: 'Streaming' },
  'Streaming/Finished': { _tag: 'Done' },
  'Streaming/Failed': { _tag: 'Failed', reason: 'It broke.' },
  'Streaming/Forgotten': { _tag: 'Gone' },

  'Reconnecting/Words': { _tag: 'Streaming' },
  'Reconnecting/Worked': { _tag: 'Streaming' },
  'Reconnecting/LostConnection': { _tag: 'Reconnecting', attempt: 3, hasWords: true },
  'Reconnecting/CameBack': { _tag: 'Reconnecting', attempt: 2, hasWords: true },
  'Reconnecting/Finished': { _tag: 'Done' },
  'Reconnecting/Failed': { _tag: 'Failed', reason: 'It broke.' },
  'Reconnecting/Forgotten': { _tag: 'Gone' },

  'Lost/Reconnect': { _tag: 'Reconnecting', attempt: 0, hasWords: false },
  'Lost/Words': { _tag: 'Streaming' },
  'Lost/Worked': { _tag: 'Thinking' },
  'Lost/CameBack': { _tag: 'Lost', hasWords: false },
  'Lost/Finished': { _tag: 'Done' },
  'Lost/Failed': { _tag: 'Failed', reason: 'It broke.' },
  'Lost/Forgotten': { _tag: 'Gone' },

  'Failed/TryAgain': { _tag: 'Failed', reason: 'The model is busy.' },
}

describe('The reply machine: its rules', () => {
  it('has the rules in the table, and no others', () => {
    expect([...Reply.rules].sort()).toEqual(Object.keys(table).sort())
  })

  for (const [pair, next] of Object.entries(table)) {
    it(`${pair.replace('/', ' + ')} gives ${JSON.stringify(next)}`, () => {
      const [state, event] = pair.split('/') as [ReplyState['_tag'], ReplyEvent['_tag']]
      expect(Reply.handles(states[state], events[event])).toBe(true)
      expect(same(Reply.step(states[state], events[event]))).toEqual(next)
    })
  }

  it('every other pair of state and event is ignored: the state stays the very same', () => {
    const ignored: Array<string> = []
    for (const state of Object.values(states)) {
      for (const event of Object.values(events)) {
        const pair = `${state._tag}/${event._tag}`
        if (pair in table) continue
        expect(Reply.handles(state, event), pair).toBe(false)
        expect(Reply.step(state, event), pair).toBe(state)
        ignored.push(pair)
      }
    }
    // Nine states and ten events: ninety pairs in all.
    expect(ignored.length + Object.keys(table).length).toBe(90)
  })

  it('a reply that has ended takes nothing more: not words, not a lost connection, not Reconnect', () => {
    for (const end of [S.Done, S.Stopped, S.Gone]) {
      for (const event of Object.values(events)) expect(Reply.step(end, event)).toBe(end)
    }
    for (const event of [E.Words, E.Worked, E.LostConnection, E.Reconnect, E.Finished({ wasStopped: true })]) {
      expect(Reply.step(states.Failed, event)).toBe(states.Failed)
    }
  })

  it('Finished says whether the reply was stopped', () => {
    expect(same(Reply.step(S.Streaming, E.Finished({ wasStopped: true })))).toEqual({ _tag: 'Stopped' })
    expect(same(Reply.step(S.Streaming, E.Finished({ wasStopped: false })))).toEqual({ _tag: 'Done' })
  })

  it(`the connection may drop ${MAX_RECONNECTS} times in a row, and the next drop gives up`, () => {
    let state: ReplyState = S.Streaming
    const seen: Array<string> = []
    for (let drop = 1; drop <= MAX_RECONNECTS + 1; drop++) {
      state = Reply.step(state, E.LostConnection)
      seen.push(state._tag === 'Reconnecting' ? `Reconnecting ${state.attempt}` : state._tag)
    }
    expect(seen).toEqual(['Reconnecting 1', 'Reconnecting 2', 'Reconnecting 3', 'Reconnecting 4', 'Lost'])
    // Reconnect starts the count again, and words put the reply back to Streaming.
    state = Reply.step(state, E.Reconnect)
    expect(same(state)).toEqual({ _tag: 'Reconnecting', attempt: 0, hasWords: true })
    expect(same(Reply.step(state, E.LostConnection))).toEqual({ _tag: 'Reconnecting', attempt: 1, hasWords: true })
    expect(same(Reply.step(state, E.Words))).toEqual({ _tag: 'Streaming' })
  })

  it('work that is not words puts a reconnecting reply back where it was', () => {
    expect(same(Reply.step(S.Reconnecting({ attempt: 1, hasWords: false }), E.Worked))).toEqual({ _tag: 'Thinking' })
    expect(same(Reply.step(S.Lost({ hasWords: true }), E.Worked))).toEqual({ _tag: 'Streaming' })
  })

  it('keeps the same numbers as the host layer Fold Chat uses', () => {
    expect(MAX_RECONNECTS).toBe(HOST_MAX)
    for (let attempt = 0; attempt <= 8; attempt++) expect(reconnectDelayMs(attempt)).toBe(hostDelay(attempt))
  })
})

describe('The reply machine: what a state lets the row draw', () => {
  it('a reply being written may show Thinking and growing words, and nothing of an ended one', () => {
    for (const state of [S.Waiting, S.Thinking, S.Streaming, states.Reconnecting, S.Gone]) {
      expect(allowed(state)).toEqual({ isWriting: true, reconnect: false, stopped: false, failure: null, actions: false })
    }
  })

  it('only Lost may show Reconnect', () => {
    const withReconnect = Object.values(states).filter(state => allowed(state).reconnect)
    expect(withReconnect.map(state => state._tag)).toEqual(['Lost'])
  })

  it('only Done and Stopped may show Copy and Share, and only Failed its reason', () => {
    expect(Object.values(states).filter(state => allowed(state).actions).map(state => state._tag)).toEqual(['Done', 'Stopped'])
    expect(allowed(S.Stopped).stopped).toBe(true)
    expect(allowed(S.Done).stopped).toBe(false)
    expect(Object.values(states).filter(state => allowed(state).failure !== null).map(state => state._tag)).toEqual(['Failed'])
    expect(allowed(states.Failed).failure).toBe('The model is busy.')
  })

  it('a saved reply has the state its status names', () => {
    expect(same(fromSaved('complete', null))).toEqual({ _tag: 'Done' })
    expect(same(fromSaved('stopped', null))).toEqual({ _tag: 'Stopped' })
    expect(same(fromSaved('failed', 'No credit.'))).toEqual({ _tag: 'Failed', reason: 'No credit.' })
    expect(same(fromSaved('failed', null))).toEqual({ _tag: 'Failed', reason: NO_REASON })
  })

  it('knows whether words have been seen', () => {
    expect(hasWords(S.Thinking)).toBe(false)
    expect(hasWords(S.Streaming)).toBe(true)
    expect(hasWords(S.Reconnecting({ attempt: 1, hasWords: false }))).toBe(false)
    expect(hasWords(S.Lost({ hasWords: true }))).toBe(true)
    expect(tagged(S.Waiting)._tag).toBe('Waiting')
  })
})
