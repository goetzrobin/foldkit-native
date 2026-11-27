/**
 * The rules of one reply: which modes it can be in, and what moves it from
 * one to the next.
 *
 * This file is only the rules. It draws nothing and asks the phone for
 * nothing, so a browser or terminal app can use it as it is. The reply's
 * row (`parts/replyStream.ts`) keeps the current state in its Model and
 * asks these rules for the next one each time a Message arrives.
 *
 * The modes:
 *
 * - `Waiting`: the row knows a reply is coming and has heard nothing yet.
 * - `Thinking`: the server has started. No words yet.
 * - `Streaming`: words are arriving.
 * - `Reconnecting`: the connection dropped. The row has asked for the rest
 *   and waits. `attempt` counts the drops in a row.
 * - `Lost`: it dropped too many times in a row. The person decides when to
 *   try again.
 * - `Gone`: the server has forgotten the reply. The saved copy has its end.
 * - `Done`, `Stopped`, `Failed`: the reply has ended.
 *
 * An event that has no rule in the current state is ignored. Words that
 * arrive after Stop change nothing. A retry does nothing while a reply is
 * still being written.
 */
import { Schema } from 'effect'
import { Event, Machine, State } from 'effect-machine'

import { stepper } from './step.js'

/** Drops in a row before the row gives up and shows Reconnect. */
export const MAX_RECONNECTS = 4

/** How long to wait before asking again, after `attempt` drops in a row. */
export const reconnectDelayMs = (attempt: number): number => Math.min(4000, 250 * 2 ** Math.max(0, attempt - 1))

/** Said under a reply that failed with no reason given. */
export const NO_REASON = 'The reply stopped early.'

export const ReplyState = State({
  Waiting: {},
  Thinking: {},
  Streaming: {},
  Reconnecting: { attempt: Schema.Number, hasWords: Schema.Boolean },
  Lost: { hasWords: Schema.Boolean },
  Gone: {},
  Done: {},
  Stopped: {},
  Failed: { reason: Schema.String },
})
export type ReplyState = typeof ReplyState.Type

export const ReplyEvent = Event({
  /** The server started the reply. */
  Started: {},
  /** Words of the reply arrived. */
  Words: {},
  /** Something that is not words arrived: reasoning, or a tool at work. */
  Worked: {},
  Finished: { wasStopped: Schema.Boolean },
  Failed: { reason: Schema.String },
  /** The connection dropped before the reply ended. */
  LostConnection: {},
  /** The server no longer knows the reply. */
  Forgotten: {},
  /** The person pressed Reconnect. */
  Reconnect: {},
  /** The app came back to the front. */
  CameBack: {},
  /** The person pressed Try again. */
  TryAgain: {},
})
export type ReplyEvent = typeof ReplyEvent.Type

const S = ReplyState
const E = ReplyEvent

const ended = ({ event }: { readonly event: { readonly wasStopped: boolean } }) => (event.wasStopped ? S.Stopped : S.Done)
const failed = ({ event }: { readonly event: { readonly reason: string } }) => S.Failed({ reason: event.reason })

export const replyMachine = Machine.make({ state: ReplyState, event: ReplyEvent, initial: ReplyState.Waiting })
  .on(S.Waiting, E.Started, () => S.Thinking)

  .on(S.Thinking, E.Words, () => S.Streaming)
  .on(S.Thinking, E.Worked, () => S.Thinking)
  .on(S.Thinking, E.LostConnection, () => S.Reconnecting({ attempt: 1, hasWords: false }))
  .on(S.Thinking, E.CameBack, () => S.Thinking)

  .on(S.Streaming, E.Words, () => S.Streaming)
  .on(S.Streaming, E.Worked, () => S.Streaming)
  .on(S.Streaming, E.LostConnection, () => S.Reconnecting({ attempt: 1, hasWords: true }))
  .on(S.Streaming, E.CameBack, () => S.Streaming)

  .on(S.Reconnecting, E.Words, () => S.Streaming)
  .on(S.Reconnecting, E.Worked, ({ state }) => (state.hasWords ? S.Streaming : S.Thinking))
  .on(S.Reconnecting, E.LostConnection, ({ state }) =>
    state.attempt >= MAX_RECONNECTS
      ? S.Lost({ hasWords: state.hasWords })
      : S.Reconnecting({ attempt: state.attempt + 1, hasWords: state.hasWords }),
  )
  .on(S.Reconnecting, E.CameBack, ({ state }) => S.Reconnecting.with(state))

  .on(S.Lost, E.Reconnect, ({ state }) => S.Reconnecting({ attempt: 0, hasWords: state.hasWords }))
  .on(S.Lost, E.Words, () => S.Streaming)
  .on(S.Lost, E.Worked, ({ state }) => (state.hasWords ? S.Streaming : S.Thinking))
  .on(S.Lost, E.CameBack, ({ state }) => S.Lost.with(state))

  // A reply can end, fail or be forgotten from any mode in which it is still being written.
  .on([S.Thinking, S.Streaming, S.Reconnecting, S.Lost], E.Finished, ended)
  .on([S.Thinking, S.Streaming, S.Reconnecting, S.Lost], E.Failed, failed)
  .on([S.Thinking, S.Streaming, S.Reconnecting, S.Lost], E.Forgotten, () => S.Gone)

  // The row tells the chat to write the reply again. A new reply gets a new row.
  .on(S.Failed, E.TryAgain, ({ state }) => S.Failed.with(state))

export const Reply = stepper(replyMachine)

/** The state of a reply the server has saved as ended. */
export const fromSaved = (status: 'complete' | 'stopped' | 'failed', failure: string | null): ReplyState =>
  status === 'complete' ? S.Done : status === 'stopped' ? S.Stopped : S.Failed({ reason: failure ?? NO_REASON })

/** Whether words of this reply have been seen. The first words get a small tick under the finger. */
export const hasWords = (state: ReplyState): boolean =>
  S.$match(state, {
    Waiting: () => false,
    Thinking: () => false,
    Streaming: () => true,
    Reconnecting: each => each.hasWords,
    Lost: each => each.hasWords,
    Gone: () => true,
    Done: () => true,
    Stopped: () => true,
    Failed: () => true,
  })

/** What a state lets the row draw. */
export type Allowed = Readonly<{
  /** The reply is still being written: "Thinking" may show, and the words may grow. */
  isWriting: boolean
  /** The line "The connection was lost." and its Reconnect button. */
  reconnect: boolean
  /** The word "Stopped". */
  stopped: boolean
  /** Why it failed, with Try again under it. Null: it did not fail. */
  failure: string | null
  /** Copy, Share and Write again. */
  actions: boolean
}>

const writing: Allowed = { isWriting: true, reconnect: false, stopped: false, failure: null, actions: false }
const over: Allowed = { isWriting: false, reconnect: false, stopped: false, failure: null, actions: false }

export const allowed = (state: ReplyState): Allowed =>
  S.$match(state, {
    Waiting: () => writing,
    Thinking: () => writing,
    Streaming: () => writing,
    Reconnecting: () => writing,
    Lost: () => ({ ...writing, reconnect: true }),
    Gone: () => writing,
    Done: () => ({ ...over, actions: true }),
    Stopped: () => ({ ...over, stopped: true, actions: true }),
    Failed: each => ({ ...over, failure: each.reason }),
  })
