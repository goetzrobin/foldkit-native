/**
 * The app's one audio player, seen from the screens on the simulated
 * phone: a voice note's row in a chat, the mini player in a chat and on the
 * list, and the chip above the composer. The pretend phone's audio is
 * behind it all.
 *
 * What these tests are about: the player is not part of any screen. A note
 * started in a chat goes on when the chat is closed, can be paused from the
 * list, and the chat's row says so when the chat is opened again.
 */
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import * as Timeline from '../chat/timeline.js'
import { REQUEST, start } from './chatSupport.js'
import { goBack, sendVoiceNote } from './playerSupport.js'
import { run } from './support.js'

const newChat = (options: Parameters<typeof start>[0] = {}) =>
  Effect.gen(function* () {
    const started = yield* start(options)
    // The phone cannot read the notes' words here: each keeps its line in the field.
    started.device.speech.setPermission('denied')
    yield* started.app.press('start-chat')
    yield* started.app.wait(REQUEST)
    return started
  })

const label = (app: { byTestId: (id: string) => { props: Record<string, unknown> } }, id: string) =>
  app.byTestId(id).props['accessibilityLabel']

describe('A voice note in a chat', () => {
  it('has a play button on its row. Playing it shows on the row and in the mini player', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, player } = started
        const note = yield* sendVoiceNote(started, 3)
        expect(app.has(`note-play-${note}`)).toBe(true)
        expect(app.has(`note-state-${note}`)).toBe(false)
        expect(app.has('mini-player-chat')).toBe(false)

        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        expect(player.state()._tag).toBe('Playing')
        expect(device.audio.players.at(-1)?.isPlaying).toBe(true)
        expect(app.text(`note-state-${note}`)).toBe('Playing')
        expect(label(app, `note-play-${note}`)).toBe('Pause the voice note')
        expect(app.text('mini-label-chat')).toBe('Voice note 0:03')
        // The mini player shows how far the sound has got.
        device.audio.advance(1000)
        yield* app.wait(REQUEST)
        expect(app.text('mini-state-chat')).toBe('0:01')

        // The row's own button pauses and goes on.
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        expect(app.text(`note-state-${note}`)).toBe('Paused')
        expect(device.audio.players.at(-1)?.isPlaying).toBe(false)
        expect(app.text('mini-state-chat')).toBe('Paused at 0:01')
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        expect(app.text(`note-state-${note}`)).toBe('Playing')
        expect(device.audio.players.at(-1)?.isPlaying).toBe(true)
      }),
    ))

  it('goes on playing when the chat is closed, is paused from the list, and its row says Paused when the chat is opened again', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, player } = started
        const note = yield* sendVoiceNote(started, 3)
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)

        // Back to the list. The chat's screen is gone, and the sound is not.
        yield* goBack(app)
        expect(app.has('screen-chat')).toBe(false)
        expect(app.has(`note-play-${note}`)).toBe(false)
        expect(player.state()._tag).toBe('Playing')
        expect(device.audio.players.at(-1)?.isPlaying).toBe(true)
        expect(app.has('mini-player-list')).toBe(true)
        expect(app.text('mini-label-list')).toBe('Voice note 0:03')
        expect(label(app, 'mini-toggle-list')).toBe('Pause the voice note')

        // Pause from the bar on the list.
        yield* app.press('mini-toggle-list')
        yield* app.wait(REQUEST)
        expect(player.state()._tag).toBe('Paused')
        expect(device.audio.players.at(-1)?.isPlaying).toBe(false)
        expect(app.text('mini-state-list')).toBe('Paused at 0:00')
        expect(label(app, 'mini-toggle-list')).toBe('Play the voice note')

        // Open the chat again: new rows, and the note's row knows at once.
        yield* app.press('chat-row-c1')
        yield* app.wait(REQUEST * 2)
        expect(app.text(`note-state-${note}`)).toBe('Paused')
        expect(label(app, `note-play-${note}`)).toBe('Go on playing the voice note')
        expect(app.has('mini-player-chat')).toBe(true)
        // And it goes on from the row, on the same native player: nothing was loaded again.
        const loaded = device.audio.players.length
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        expect(player.state()._tag).toBe('Playing')
        expect(device.audio.players.length).toBe(loaded)
      }),
    ))

  it('a second note stops the first, and the first row goes back to a plain play button', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, player } = started
        const first = yield* sendVoiceNote(started, 3)
        const second = yield* sendVoiceNote(started, 7)
        yield* app.press(`note-play-${first}`)
        yield* app.wait(REQUEST)
        const firstNative = device.audio.players.at(-1)
        expect(firstNative?.isPlaying).toBe(true)

        yield* app.press(`note-play-${second}`)
        yield* app.wait(REQUEST)
        expect(firstNative?.isPlaying).toBe(false)
        expect(firstNative?.isReleased).toBe(true)
        expect(device.audio.players.at(-1)?.isPlaying).toBe(true)
        expect(device.audio.players.filter(each => each.isPlaying).length).toBe(1)
        expect(player.state()).toMatchObject({ _tag: 'Playing', note: { label: 'Voice note 0:07' } })
        expect(app.has(`note-state-${first}`)).toBe(false)
        expect(app.text(`note-state-${second}`)).toBe('Playing')
        expect(app.text('mini-label-chat')).toBe('Voice note 0:07')
      }),
    ))

  it('Close on the mini player stops the sound, and the bar and the row both go quiet', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, player } = started
        const note = yield* sendVoiceNote(started, 3)
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        yield* app.press('mini-close-chat')
        yield* app.wait(REQUEST)
        expect(player.state()._tag).toBe('Stopped')
        expect(device.audio.players.at(-1)?.isReleased).toBe(true)
        expect(app.has('mini-player-chat')).toBe(false)
        expect(app.has(`note-state-${note}`)).toBe(false)
      }),
    ))

  it('a note that plays to its end closes the mini player by itself', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, player } = started
        const note = yield* sendVoiceNote(started, 3)
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        // The pretend phone's notes are ten seconds long.
        device.audio.advance(11_000)
        yield* app.wait(REQUEST)
        expect(player.state()._tag).toBe('Stopped')
        expect(app.has('mini-player-chat')).toBe(false)
        expect(app.has(`note-state-${note}`)).toBe(false)
      }),
    ))
})

describe('The note above the composer uses the same player', () => {
  it('playing it shows in the mini player, and starting it stops a note from a row', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, player } = started
        const note = yield* sendVoiceNote(started, 3)
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        // A new note, not sent yet.
        yield* app.press('record')
        yield* app.wait(REQUEST)
        device.audio.advance(5000)
        yield* app.settle
        yield* app.press('finish-recording')
        yield* app.wait(REQUEST)
        yield* app.press('play-note')
        yield* app.wait(REQUEST)
        expect(player.state()).toMatchObject({ _tag: 'Playing', note: { label: 'Voice note 0:05' } })
        expect(app.text('mini-label-chat')).toBe('Voice note 0:05')
        expect(app.has(`note-state-${note}`)).toBe(false)
        expect(device.audio.players.filter(each => each.isPlaying).length).toBe(1)
        // Removing the waiting note stops it.
        yield* app.press('remove-note')
        yield* app.wait(REQUEST)
        expect(player.state()._tag).toBe('Stopped')
        expect(app.has('mini-player-chat')).toBe(false)
      }),
    ))
})

describe('Every listener says in its own Messages what caused the change', () => {
  it('the merged timeline reads: a row sent Pause, the player went from Playing to Paused, the listeners heard that step', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat({ records: true })
        const { app, timeline } = started
        const note = yield* sendVoiceNote(started, 3)
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)
        const from = timeline().length
        yield* app.press(`note-play-${note}`)
        yield* app.wait(REQUEST)

        const items = timeline().slice(from)
        const lines = Timeline.lines(items)
        const sentAt = lines.findIndex(line => /MessageRow {2}PressedNote, sends Pause to the player$/.test(line))
        const stepAt = lines.findIndex(line => /player {2}Playing to Paused, on Pause by voice-row$/.test(line))
        expect(sentAt).toBeGreaterThanOrEqual(0)
        expect(stepAt).toBeGreaterThan(sentAt)
        const step = Number((lines[stepAt] as string).split(' ')[0])
        // Three listeners are on screen: the row, the mini player in the chat, the mini player on the list under it.
        const heard = lines.slice(stepAt + 1).filter(line => line.endsWith(`HeardPlayer, step ${step}`))
        expect(heard.map(line => line.split(/\s+/)[1]).sort()).toEqual(['MessageRow', 'MiniPlayer', 'MiniPlayer'])
        // The numbers only go up: one clock numbered the screens and the player.
        const numbers = items.map(item => item.n)
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
        expect(new Set(numbers).size).toBe(numbers.length)

        // The listener's Message carries the whole step, sender and all.
        const update = items.find(
          item =>
            item.from === 'screens' &&
            (item.entry as { _tag: string })._tag === 'Update' &&
            (item.entry as { message?: { _tag?: string; step?: { seq?: number } } }).message?.step?.seq === step,
        ) as Timeline.ScreenItem
        expect((update.entry as { message: unknown }).message).toMatchObject({
          _tag: 'HeardPlayer',
          step: {
            seq: step,
            before: { _tag: 'Playing' },
            event: { _tag: 'Pause', by: { name: 'voice-row', id: `${note}#2` } },
            after: { _tag: 'Paused' },
            changed: true,
          },
        })
      }),
    ))
})
