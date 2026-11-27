/**
 * Replay across the player and the screens.
 *
 * A session is recorded on the simulated phone: start a chat, send a voice
 * note, play it, go back to the list, pause from the mini player, open the
 * chat again. The record is one merged timeline: the screens' log and the
 * player's own record, numbered by one clock.
 *
 * The three tests the brief asks for are named (a), (b) and (c).
 */
import { UiSchema } from '@effect/ui'
import * as MessageLog from '@effect/ui/MessageLog'
import { Effect, Layer, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { App } from '../chat/app.js'
import { makePlayerMachine, playerRules } from '../chat/machines/player.js'
import { ChatScreen } from '../chat/parts/chatScreen.js'
import { Composer } from '../chat/parts/composer.js'
import { ConversationList } from '../chat/parts/conversationList.js'
import { MessageRow } from '../chat/parts/messageRow.js'
import { MiniPlayer } from '../chat/parts/miniPlayer.js'
import { ReplyStream } from '../chat/parts/replyStream.js'
import { ReplyText } from '../chat/parts/replyText.js'
import { Transcript } from '../chat/parts/transcript.js'
import { replay } from '../chat/replay.js'
import * as Timeline from '../chat/timeline.js'
import * as TimelineFile from '../chat/timelineFile.js'
import { makeClock } from '../chat/clock.js'
import { Native } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { REQUEST, start } from './chatSupport.js'
import { goBack, sendVoiceNote } from './playerSupport.js'
import { provideForTest, run } from './support.js'

/** Every component the session draws. */
const COMPONENTS = [App, ConversationList, ChatScreen, Transcript, MessageRow, ReplyStream, ReplyText, Composer, MiniPlayer]

/** The session of the brief, recorded. */
const session = () =>
  Effect.gen(function* () {
    const started = yield* start({ records: true })
    const { app, device, player, timeline } = started
    device.speech.setPermission('denied')
    yield* app.press('start-chat')
    yield* app.wait(REQUEST)
    const note = yield* sendVoiceNote(started, 3)
    yield* app.press(`note-play-${note}`)
    yield* app.wait(REQUEST)
    device.audio.advance(1500)
    yield* app.wait(REQUEST)
    yield* goBack(app)
    yield* app.press('mini-toggle-list')
    yield* app.wait(REQUEST)
    yield* app.press('chat-row-c1')
    yield* app.wait(REQUEST * 2)
    expect(app.text(`note-state-${note}`)).toBe('Paused')
    return { ...started, note, items: timeline(), finalState: player.state() }
  })

/** The last Model the log holds for each component and place in the tree. */
const lastModels = (items: ReadonlyArray<Timeline.Item>): Map<string, unknown> => {
  const models = new Map<string, unknown>()
  for (const item of items) {
    if (item.from !== 'screens') continue
    const entry = item.entry as { _tag: string; path?: string; model?: unknown; component?: { definition: { name: string } } }
    if ((entry._tag === 'Mounted' || entry._tag === 'Update') && entry.path !== undefined && entry.component !== undefined) {
      models.set(`${entry.component.definition.name} ${entry.path}`, entry.model)
    }
  }
  return models
}

describe('Replay', () => {
  it('(a) a recorded session, run again, ends with every screen and the player where they were', () =>
    run(
      Effect.gen(function* () {
        const { items, finalState } = yield* session()
        expect(finalState).toMatchObject({ _tag: 'Paused', note: { label: 'Voice note 0:03' }, positionMs: 1500 })
        expect(items.some(item => item.from === 'player')).toBe(true)
        expect(items.some(item => item.from === 'screens')).toBe(true)

        const result = yield* replay({ items, components: COMPONENTS })

        // The player: every recorded event was sent again, every step was the same, and it ends Paused at the same place.
        expect(result.player.replayed).toBe(items.filter(item => item.from === 'player').length)
        expect(result.player.difference).toBeNull()
        expect(JSON.parse(JSON.stringify(result.player.state))).toEqual(JSON.parse(JSON.stringify(finalState)))

        // The screens: every instance of every component, with no Message that gave another result.
        const names = new Set(result.screens.map(screen => screen.component))
        expect([...names].sort()).toEqual(COMPONENTS.map(each => each.definition.name).sort())
        expect(result.screens.filter(screen => screen.divergence !== undefined)).toEqual([])
        // And each ends with the Model the real one ended with.
        const recorded = lastModels(items)
        expect(result.screens.length).toBe(recorded.size)
        for (const screen of result.screens) {
          expect(screen.model, `${screen.component} ${screen.path}`).toEqual(recorded.get(`${screen.component} ${screen.path}`))
        }
        // Messages were really run again, the listeners' among them.
        expect(result.screens.reduce((sum, screen) => sum + screen.replayed, 0)).toBeGreaterThan(40)
        const bar = result.screens.find(screen => screen.component === 'MiniPlayer') as { model: { player: { _tag: string } } }
        expect(bar.model.player._tag).toBe('Paused')
        expect(result.isSame).toBe(true)
      }),
    ))

  it('(a) the same from a timeline that was written out as JSON and read back', () =>
    run(
      Effect.gen(function* () {
        const { items, finalState } = yield* session()
        const text = TimelineFile.toJson(items)
        const read = TimelineFile.fromJson(text)
        expect(read.length).toBe(items.length)
        // The written timeline reads the same for a person.
        expect(Timeline.lines(read)).toEqual(Timeline.lines(items))
        const result = yield* replay({ items: read, components: COMPONENTS })
        expect(result.isSame).toBe(true)
        expect(JSON.parse(JSON.stringify(result.player.state))).toEqual(JSON.parse(JSON.stringify(finalState)))
      }),
    ))

  it('(b) a fault in the player rules shows up: the replay ends in another state, and names the step', () =>
    run(
      Effect.gen(function* () {
        const { items, finalState } = yield* session()
        // The fault: Pause does nothing.
        const faulty = makePlayerMachine({ ...playerRules, pause: ({ state }) => state })
        const result = yield* replay({ items, components: COMPONENTS, machine: faulty })
        expect(finalState._tag).toBe('Paused')
        expect(result.player.state._tag).toBe('Playing')
        expect(result.isSame).toBe(false)
        // The first step that differs is the Pause from the mini player on the list.
        expect(result.player.difference).toMatchObject({
          recorded: { event: { _tag: 'Pause', by: { name: 'mini-bar', id: 'list#1' } }, after: { _tag: 'Paused' }, changed: true },
          replayed: { event: { _tag: 'Pause' }, after: { _tag: 'Playing' }, changed: false },
        })
        expect(result.player.difference?.n).toBe(result.player.difference?.recorded.seq)
      }),
    ))

  it('(c) the limit: the screens log alone brings back the screens and not the player', () =>
    run(
      Effect.gen(function* () {
        const { items, finalState } = yield* session()
        const screensOnly = items.filter(item => item.from === 'screens')
        const result = yield* replay({ items: screensOnly, components: COMPONENTS })
        // Every screen is back, the listeners with the Paused they heard.
        expect(result.screens.filter(screen => screen.divergence !== undefined)).toEqual([])
        const bar = result.screens.find(screen => screen.component === 'MiniPlayer') as { model: { player: { _tag: string } } }
        expect(bar.model.player._tag).toBe('Paused')
        // The player was sent nothing, so it is where it began. The real one ended Paused.
        expect(result.player.replayed).toBe(0)
        expect(result.player.state._tag).toBe('Stopped')
        expect(finalState._tag).toBe('Paused')
      }),
    ))
})

describe('The timeline leaves the app', () => {
  it('Copy timeline in Settings puts the merged list on the clipboard as JSON', () =>
    run(
      Effect.gen(function* () {
        const { app, device, items } = yield* session()
        yield* goBack(app)
        yield* app.emit('bar-chats', 'topPressHeaderBarButtonItem', { buttonId: 'settings' })
        yield* app.wait(REQUEST)
        expect(app.has('copy-timeline')).toBe(true)
        yield* app.press('copy-timeline')
        yield* app.wait(REQUEST * 2)
        const copied = device.clipboard.contents()
        const read = TimelineFile.fromJson(copied)
        expect(read.length).toBeGreaterThanOrEqual(items.length)
        expect(read.some(item => item.from === 'player' && item.step.event._tag === 'Pause')).toBe(true)
        expect(read.some(item => item.from === 'screens')).toBe(true)
        // The sheet has closed, and the list says what happened.
        expect(app.has('sheet-settings')).toBe(false)
        expect(app.text('list-notice')).toMatch(/^Timeline copied: \d+ entries\.$/)
      }),
    ))

  it('a build that does not record has no such row', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.emit('bar-chats', 'topPressHeaderBarButtonItem', { buttonId: 'settings' })
        yield* app.wait(REQUEST)
        expect(app.has('sheet-settings')).toBe(true)
        expect(app.has('copy-timeline')).toBe(false)
      }),
    ))

  it('the recorder reads the log beside the dev tools, and each still gets every entry', () =>
    run(
      Effect.gen(function* () {
        const Message = UiSchema.TaggedEnum({ Pressed: {} })
        const Counter = Native.component({ name: 'Counter', model: Schema.Number, message: Message }).make({
          init: () => 0,
          update: { Pressed: $ => $.model + 1 },
          view: h => h.pressable.testId('add').on('press', Message.Pressed()).children(h.text('add')),
        })
        // What the dev tools Layer provides, as far as the log goes: a log of its own.
        const devTools = MessageLog.makeMemory()
        const clock = makeClock(100)
        const kit = TimelineFile.kit(clock)
        const app = yield* NativeTest.mount(Counter, {}).pipe(
          provideForTest(kit.logs(Layer.succeed(MessageLog.MessageLog, devTools))),
        )
        yield* app.press('add')
        yield* app.press('add')
        const recorded = kit.recorder.entries()
        expect(recorded.map(item => item.entry)).toEqual(devTools.entries())
        expect(recorded.filter(item => (item.entry as { _tag: string })._tag === 'Update').length).toBe(2)
        // Numbered from the shared clock, which started at 100 here.
        expect(recorded[0]?.n).toBe(101)
        expect(recorded.map(item => item.n)).toEqual(recorded.map((_, index) => 101 + index))
      }),
    ))
})
