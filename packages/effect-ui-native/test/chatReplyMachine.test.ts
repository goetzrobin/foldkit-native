/**
 * The reply's row with the machine inside it.
 *
 * The first group runs the row's `update` alone, with Effect UI's `Story`:
 * Messages in, Model and Commands out. It checks the cases that were bugs
 * or close to one: an event the current state has no rule for must change
 * nothing and start nothing.
 *
 * The second group runs the whole app on the simulated phone and reads
 * Effect UI's message log: every change of the reply's state is in the log
 * as the result of one Message, which is what the dev tools page shows.
 */
import * as MessageLog from '@effect/ui/MessageLog'
import { Story } from '@effect/ui/testing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import type { TurnUpdate } from '../../native/src/host/aiChat/turns.js'
import { ResumeTurn } from '../chat/data.js'
import { ReplyStream, ReplyStreamEvents, ReplyStreamMessage } from '../chat/parts/replyStream.js'
import { Phone } from '../src/index.js'
import { REPLY, replies, send, start, until } from './chatSupport.js'
import { run } from './support.js'

const props = {
  id: 'm2',
  conversationId: 'c1',
  parts: [],
  status: 'streaming' as const,
  failure: null,
  followTurnId: 't1',
  scheme: 'light' as const,
  platform: 'ios',
  isLast: true,
  copyRequest: 0,
}

const got = (update: TurnUpdate) => ReplyStreamMessage.ReceivedTurnUpdate({ update })
const started = got({ _tag: 'TurnStarted', seq: 1, turnId: 't1', conversationId: 'c1', messageId: 'm2', userMessageId: 'm1' })
const words = (fromSeq: number, ...pieces: Array<string>) => got({ _tag: 'TextBatch', fromSeq, pieces })
const finished = (seq: number, reason: 'complete' | 'stopped') =>
  got({ _tag: 'TurnFinished', seq, reason, usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 } })
const lost = got({ _tag: 'ConnectionLost', reason: 'The stream ended early.' })

const story = () => Story.make(ReplyStream, props)
const textOf = (model: { readonly turn: { readonly parts: ReadonlyArray<any> } | null }): string =>
  (model.turn?.parts ?? []).map(part => (part._tag === 'Text' ? part.text : '')).join('')
const commands = (s: { readonly pending: ReadonlyArray<{ readonly command: { readonly name: string } }> }) =>
  s.pending.map(each => each.command.name)

describe('The reply row: its state is the machine state', () => {
  it('goes Waiting, Thinking, Streaming, Done as the reply arrives', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        expect(s.model.reply._tag).toBe('Waiting')
        s.send(started)
        expect(s.model.reply._tag).toBe('Thinking')
        s.send(words(2, 'Hello', ' there')).resolve(Phone.Selection, { _tag: 'Done' })
        expect(s.model.reply._tag).toBe('Streaming')
        expect(textOf(s.model)).toBe('Hello there')
        s.send(finished(4, 'complete'))
        expect(s.model.reply._tag).toBe('Done')
      }),
    ))

  it('the first words come with one tick, and later words with none', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started)
        expect(commands(s)).toEqual([])
        s.send(words(2, 'Hello'))
        expect(commands(s)).toEqual([Phone.Selection.make({}).name])
        s.resolve(Phone.Selection, { _tag: 'Done' })
        s.send(words(3, ' there'))
        expect(commands(s)).toEqual([])
      }),
    ))

  it('words that arrive after Stop are ignored: the text and the state stay as they were', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started).send(words(2, 'Hello')).resolve(Phone.Selection, { _tag: 'Done' })
        s.send(finished(3, 'stopped'))
        expect(s.model.reply._tag).toBe('Stopped')
        const before = s.model
        s.send(words(4, ' and more'))
        expect(s.model).toBe(before)
        expect(textOf(s.model)).toBe('Hello')
        expect(commands(s)).toEqual([])
      }),
    ))

  it('Try again while the reply is still being written is ignored: the chat is not asked to write again', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started).send(words(2, 'Hello')).resolve(Phone.Selection, { _tag: 'Done' })
        s.send(ReplyStreamMessage.PressedTryAgain())
        expect(s.model.reply._tag).toBe('Streaming')
        expect(s.current.emitted).toEqual([])
        // Once it has failed, the same press does ask.
        s.send(got({ _tag: 'TurnFailed', seq: 3, reason: 'The model is busy.', isRetryable: true }))
        expect(s.model.reply).toMatchObject({ _tag: 'Failed', reason: 'The model is busy.' })
        s.resolve(Phone.Notify, { _tag: 'Done' })
        s.send(ReplyStreamMessage.PressedTryAgain())
        s.emitted(ReplyStreamEvents.PressedTryAgain())
      }),
    ))

  it('Reconnect while the connection is fine is ignored: no second connection is opened', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started).send(words(2, 'Hello')).resolve(Phone.Selection, { _tag: 'Done' })
        const before = s.model
        s.send(ReplyStreamMessage.PressedReconnect())
        expect(s.model).toBe(before)
        expect(commands(s)).toEqual([])
      }),
    ))

  it('a connection that drops is asked for again four times, each wait longer, and then the row gives up', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started).send(words(2, 'Hello')).resolve(Phone.Selection, { _tag: 'Done' })
        const waits: Array<number> = []
        for (let drop = 1; drop <= 4; drop++) {
          s.send(lost)
          expect(s.model.reply).toMatchObject({ _tag: 'Reconnecting', attempt: drop })
          const pending = s.pending[0]?.command as { readonly args: { readonly delayMs: number } }
          waits.push(pending.args.delayMs)
          s.resolve(ResumeTurn, undefined)
        }
        expect(waits).toEqual([250, 500, 1000, 2000])
        s.send(lost)
        expect(s.model.reply._tag).toBe('Lost')
        expect(commands(s)).toEqual([])
        // Reconnect asks at once and starts the count again.
        s.send(ReplyStreamMessage.PressedReconnect())
        expect(s.model.reply).toMatchObject({ _tag: 'Reconnecting', attempt: 0 })
        expect((s.pending[0]?.command as { readonly args: { readonly delayMs: number } }).args.delayMs).toBe(0)
        s.resolve(ResumeTurn, undefined)
      }),
    ))

  it('a lost connection after the reply has ended asks for nothing', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started).send(words(2, 'Hello')).resolve(Phone.Selection, { _tag: 'Done' })
        s.send(finished(3, 'complete'))
        const before = s.model
        s.send(lost)
        expect(s.model).toBe(before)
        expect(commands(s)).toEqual([])
      }),
    ))

  it('an event the server sends twice is applied once', () =>
    run(
      Effect.gen(function* () {
        const s = yield* story()
        s.send(started).send(words(2, 'Hello', ' there')).resolve(Phone.Selection, { _tag: 'Done' })
        s.send(words(2, 'Hello', ' there', ' again'))
        expect(textOf(s.model)).toBe('Hello there again')
      }),
    ))

  it('a saved reply that has ended is drawn from its saved status, whatever the live state says', () =>
    run(
      Effect.gen(function* () {
        const s = yield* Story.make(ReplyStream, { ...props, status: 'failed', failure: 'No credit.', followTurnId: null })
        expect(s.model.reply._tag).toBe('Waiting')
        // Its state on screen is Failed, so Try again is taken.
        s.send(ReplyStreamMessage.PressedTryAgain())
        s.emitted(ReplyStreamEvents.PressedTryAgain())
        // And a late update of the old turn is not.
        const before = s.model
        s.send(words(2, 'late'))
        expect(s.model).toBe(before)
      }),
    ))
})

describe('The reply row in the message log', () => {
  it('every change of the reply state is the result of one Message in the log', () =>
    run(
      Effect.gen(function* () {
        const log = MessageLog.makeMemory({ size: 5000 })
        const { app } = yield* start({ override: Layer.succeed(MessageLog.MessageLog, log) as Layer.Layer<any> })
        yield* app.press('start-chat')
        yield* app.wait(100)
        yield* send(app, 'Hello')
        yield* until(app, () => replies(app).length === 1 && !app.has('stop'), REPLY * 2, 'the reply to end')

        const entries = log.entries()
        const row = entries.filter(
          (entry): entry is MessageLog.Mounted | MessageLog.Update =>
            (entry._tag === 'Mounted' || entry._tag === 'Update') && entry.component.definition.name === 'ReplyStream',
        )
        const states = row.map(entry => (entry.model as { readonly reply: { readonly _tag: string } }).reply._tag)
        expect(states[0]).toBe('Waiting')
        // The states it passed through, in order, each once.
        expect(states.filter((state, index) => state !== states[index - 1])).toEqual(['Waiting', 'Thinking', 'Streaming', 'Done'])
        // Each change is an Update entry that names the Message that made it.
        const changes = row.filter((entry, index) => index > 0 && states[index] !== states[index - 1])
        expect(changes.every(entry => entry._tag === 'Update')).toBe(true)
        expect(
          changes.map(entry => {
            const update = entry as MessageLog.Update
            const message = update.message as { readonly _tag: string; readonly update: { readonly _tag: string } }
            return `${update.source._tag}: ${message._tag} ${message.update._tag}`
          }),
        ).toEqual([
          'Subscription: ReceivedTurnUpdate TurnStarted',
          'Subscription: ReceivedTurnUpdate TextBatch',
          'Subscription: ReceivedTurnUpdate TurnFinished',
        ])
      }),
    ))
})
