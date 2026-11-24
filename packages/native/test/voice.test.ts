/**
 * Voice notes on the simulated phone.
 *
 * The first part drives the demo as a person would: press, wait, read the
 * screen. The phone's audio is `makeFakeAudio` from `src/device/audioNative`,
 * a stand-in for `globalThis.expo.modules.ExpoAudio` that behaves as
 * expo-audio's native code was read to behave. The recorder and player code
 * under test is the real code: only the native module under it is pretend.
 *
 * Time is the pretend phone's own clock. `pass(3000)` moves the recording,
 * the playing sound and the recorder's polling timer on by three seconds at
 * once, so no test waits for real seconds and none depends on timing.
 *
 * The second part tests the pieces in `src/device` on their own.
 */
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as Device from '../src/device/index.js'
import { registerNavigation } from '../src/index.js'
import { makeDemos } from './demos/index.js'
import { UPLOAD_LINE, clock, makeDemo, makeMeterScene, sizeText } from './demos/voice.js'
import {
  type Phone,
  byTestId,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

type Fakes = ReturnType<typeof Device.makeTest>

const { Native, Recorder, Player, VoiceNotes } = Device

describe('the voice notes demo on the simulated phone', () => {
  let phone: Phone
  let device: Fakes
  let handle: { dispose: () => void } | undefined
  let exit: ReturnType<typeof vi.fn<() => void>>

  const shown = (id: string): string => textOf(byTestId(phone.fabric, id))
  const has = (id: string): boolean => hasTestId(phone.fabric, id)
  const tap = (id: string): Promise<void> => press(phone.fabric, id)

  /** Lets time pass on the pretend phone, then lets the program catch up. */
  const pass = async (ms: number): Promise<void> => {
    device.audio.advance(ms)
    await settle()
  }

  const start = async (fakes: Fakes): Promise<void> => {
    device = fakes
    handle = Runtime.embed(
      makeDemo(phone.surface.container, { device: { platform: 'ios', osVersion: 26 }, exit }, device.layer),
    )
    await settle()
  }

  const stopProgram = async (): Promise<void> => {
    handle?.dispose()
    handle = undefined
    await settle()
  }

  /** Records for `ms` and saves. */
  const recordNote = async (ms: number): Promise<void> => {
    await tap('record')
    await pass(ms)
    await tap('stop')
  }

  const noteFiles = (): Array<string> =>
    [...device.files.entries.keys()].filter(uri => uri.endsWith('.m4a'))

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone()
    exit = vi.fn<() => void>()
    await start(Device.makeTest())
  })

  afterEach(async () => {
    await stopProgram()
    phone.surface.dispose()
  })

  describe('at rest', () => {
    it('says how the microphone is reached, what is allowed, and that nothing uploads', () => {
      expect(shown('voice-route')).toBe('test fake')
      expect(shown('voice-permission')).toBe('allowed')
      expect(shown('phase')).toBe('Idle')
      expect(shown('notes-count')).toBe('No notes yet')
      expect(shown('upload-line')).toBe(UPLOAD_LINE)
      expect(shown('voice-meter-renderer')).toBe('plain views (no Skia here)')
    })

    it('listens to nothing and holds no native object', () => {
      expect(device.recorder.listenerCount()).toBe(0)
      expect(device.player.listenerCount()).toBe(0)
      expect(device.audio.timerCount()).toBe(0)
      expect(device.audio.recorders).toHaveLength(0)
      expect(device.audio.players).toHaveLength(0)
    })

    it('is in the showcase menu as "Voice notes"', () => {
      const demos = makeDemos({ device: device.layer })
      expect(demos.find(demo => demo.id === 'voice')?.title).toBe('Voice notes')
    })
  })

  describe('recording', () => {
    it('asks, starts with a tap, counts seconds, stops, and saves a note', async () => {
      await tap('record')
      expect(shown('phase')).toBe('Recording')
      expect(shown('elapsed')).toBe('0:00')
      expect(device.haptics.calls).toEqual(['impact:medium'])
      // Reading the permission (at startup) asks the person nothing.
      expect(device.audio.calls.filter(call => call !== 'getRecordingPermissionsAsync')).toEqual([
        'requestRecordingPermissionsAsync',
        'new AudioRecorder',
        'prepareToRecordAsync',
        'record(forDuration: 900)',
      ])

      await pass(3000)
      expect(shown('elapsed')).toBe('0:03')

      await tap('stop')
      expect(shown('phase')).toBe('Idle')
      expect(shown('notes-count')).toBe('1 note')
      expect(shown('note-0-name')).toBe('Voice note 1')
      expect(shown('note-0-details')).toContain(`0:03, ${sizeText(24000)}`)
      expect(shown('last-event')).toBe('Saved "Voice note 1", 0:03, 24 KB')
      expect(device.haptics.calls).toEqual(['impact:medium', 'notification:success'])
    })

    it('moves the file out of the cache into the notes folder', async () => {
      await tap('record')
      expect(noteFiles()).toEqual(['file:///cache/ExpoAudio/recording-1.m4a'])
      await pass(1000)
      await tap('stop')
      expect(noteFiles()).toHaveLength(1)
      expect(noteFiles()[0]).toMatch(/^file:\/\/\/documents\/voice-notes\/note-.+\.m4a$/)
      expect(device.files.entries.has('file:///documents/voice-notes/index.json')).toBe(true)
    })

    it('sets the phone up for the microphone, then gives the speaker back', async () => {
      await recordNote(1000)
      expect(device.audio.modes[0]).toMatchObject({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: true,
      })
      expect(device.audio.modes.at(-1)).toMatchObject({
        allowsRecording: false,
        playsInSilentMode: true,
      })
    })

    it('pauses and carries on, and the timer waits while paused', async () => {
      await tap('record')
      await pass(2000)
      await tap('pause')
      expect(shown('phase')).toBe('Paused by you')
      await pass(5000)
      expect(shown('elapsed')).toBe('0:02')

      await tap('resume')
      await pass(1000)
      expect(shown('phase')).toBe('Recording')
      expect(shown('elapsed')).toBe('0:03')
      // The limit given at the start is kept: resume passes no new one.
      expect(device.audio.calls.filter(call => call.startsWith('record'))).toEqual([
        'record(forDuration: 900)',
        'record',
      ])

      await tap('stop')
      expect(shown('note-0-details')).toContain('0:03')
    })

    it('discard leaves no file and no note', async () => {
      await tap('record')
      await pass(2000)
      await tap('discard')
      expect(shown('phase')).toBe('Idle')
      expect(shown('last-event')).toBe('Discarded. No file was kept.')
      expect(noteFiles()).toEqual([])
      expect(shown('notes-count')).toBe('No notes yet')
      expect(device.audio.recorders[0]?.isReleased).toBe(true)
    })

    it('says so when stopping fails, and lets the recorder go', async () => {
      await tap('record')
      await pass(1000)
      device.audio.state.failNext = { method: 'stop', reason: 'disk full' }
      await tap('stop')
      expect(shown('phase')).toBe('Failed: disk full')
      expect(device.audio.recorders[0]?.isReleased).toBe(true)
      expect(device.audio.timerCount()).toBe(0)
      // And the next try works.
      await recordNote(1000)
      expect(shown('notes-count')).toBe('1 note')
    })

    it('says so when the recording breaks under it', async () => {
      await tap('record')
      await pass(1000)
      device.audio.breakRecording('The media server has crashed')
      await settle()
      expect(shown('phase')).toBe('Failed: The media server has crashed')
      expect(device.audio.recorders[0]?.isReleased).toBe(true)
      expect(device.recorder.listenerCount()).toBe(0)
    })
  })

  describe('permission', () => {
    it('denied: no recorder is made, and Record asks again', async () => {
      await stopProgram()
      const fakes = Device.makeTest()
      fakes.audio.state.permission = { status: 'undetermined', granted: false, canAskAgain: true }
      fakes.audio.state.permissionAfterAsking = { status: 'denied', granted: false, canAskAgain: true }
      await start(fakes)
      expect(shown('voice-permission')).toBe('not asked yet')

      await tap('record')
      expect(shown('phase')).toBe(
        'Failed: The microphone was not allowed. Press Record to be asked again.',
      )
      expect(shown('voice-permission')).toBe('not allowed, can be asked again')
      expect(device.audio.recorders).toHaveLength(0)
      expect(has('open-settings')).toBe(false)

      device.audio.state.permissionAfterAsking = { status: 'granted', granted: true, canAskAgain: true }
      await tap('record')
      expect(shown('phase')).toBe('Recording')
      expect(shown('voice-permission')).toBe('allowed')
    })

    it('blocked: offers Settings and opens it', async () => {
      await stopProgram()
      const fakes = Device.makeTest()
      fakes.audio.state.permission = { status: 'denied', granted: false, canAskAgain: false }
      await start(fakes)
      expect(shown('voice-permission')).toBe('blocked, only Settings can change it')
      expect(has('open-settings')).toBe(true)

      await tap('record')
      expect(shown('phase')).toContain('Open Settings')
      expect(device.audio.recorders).toHaveLength(0)

      await tap('open-settings')
      expect(device.audio.calls).toContain('openSettings')
      expect(shown('last-event')).toBe('Opened Settings')
    })

    it('reads the permission again on coming back from Settings', async () => {
      await stopProgram()
      const fakes = Device.makeTest()
      fakes.audio.state.permission = { status: 'denied', granted: false, canAskAgain: false }
      await start(fakes)
      device.audio.state.permission = { status: 'granted', granted: true, canAskAgain: true }
      device.appState.set('background')
      device.appState.set('active')
      await settle()
      expect(shown('voice-permission')).toBe('allowed')
    })
  })

  describe('the longest length', () => {
    it('warns before the end, then the phone stops by itself and the note is saved', async () => {
      await tap('record-five')
      expect(device.audio.calls).toContain('record(forDuration: 5)')
      expect(shown('limit')).toBe('Stops and saves by itself at 0:05.')

      await pass(3000)
      expect(shown('limit')).toBe(
        'Nearly at the longest length. 0:02 left, then it stops and saves by itself.',
      )
      expect(shown('last-event')).toBe('Nearly at the longest length')

      await pass(2500)
      expect(shown('phase')).toBe('Idle')
      expect(shown('notes-count')).toBe('1 note')
      expect(shown('note-0-details')).toContain('0:05')
      expect(device.audio.recorders[0]?.isReleased).toBe(true)
      // Nobody pressed stop: the phone did it.
      expect(device.audio.calls).not.toContain('stop')
    })

    it('the full recording is asked to stop at 15 minutes', async () => {
      await tap('record')
      expect(shown('limit')).toBe('Stops and saves by itself at 15:00.')
      await pass(14 * 60 * 1000 + 1000)
      expect(shown('limit')).toContain('Nearly at the longest length. 0:59 left')
      await pass(60 * 1000)
      expect(shown('note-0-details')).toContain('15:00')
    })
  })

  describe('interruptions', () => {
    it('shows a pause by the phone, and that the phone carried on', async () => {
      await tap('record')
      await pass(2000)
      device.audio.interrupt()
      await pass(200)
      expect(shown('phase')).toBe('Paused by the phone')
      expect(shown('last-event')).toBe('The phone paused the recording at 0:02')

      await pass(4000)
      expect(shown('elapsed')).toBe('0:02')

      device.audio.endInterruption()
      await pass(1000)
      expect(shown('phase')).toBe('Recording')
      expect(shown('last-event')).toBe('The phone carried on recording by itself')
      await pass(200)
      expect(shown('elapsed')).toBe('0:03')
    })

    it('lets the person carry on by hand when the phone does not', async () => {
      await tap('record')
      await pass(2000)
      device.audio.interrupt()
      await pass(200)
      await tap('resume')
      await pass(1000)
      expect(shown('phase')).toBe('Recording')
      expect(shown('elapsed')).toBe('0:03')
    })

    it('asks the recorder what is true when the app comes back to the front', async () => {
      await tap('record')
      await pass(2000)
      device.appState.set('background')
      await settle()
      const before = device.audio.calls.length
      device.appState.set('active')
      await settle()
      expect(shown('phase')).toBe('Recording')
      // Nothing was started or stopped by coming back.
      expect(device.audio.calls.slice(before)).toEqual(['getRecordingPermissionsAsync'])
    })

    it('records in front when the build refuses to record out of sight', async () => {
      await stopProgram()
      const files = Native.makeMemoryFiles()
      await start(
        Device.makeTest({ files, audio: Native.makeFakeAudio({ files, refusesBackground: true }) }),
      )
      await tap('record')
      expect(shown('phase')).toBe('Recording')
      expect(shown('voice-background')).toBe('off: the phone pauses the recording out of sight')
      // The first recorder was let go, and a second made without the request.
      expect(device.audio.recorders.map(recorder => recorder.isReleased)).toEqual([true, false])
      expect(device.audio.modes.map(mode => mode['allowsBackgroundRecording'])).toEqual([true, false])
    })
  })

  describe('leaving and coming back', () => {
    it('a recording carries on after the screen is left, and is found again', async () => {
      await tap('record')
      await pass(2000)
      await tap('exit')
      expect(exit).toHaveBeenCalledTimes(1)
      await stopProgram()
      expect(device.recorder.listenerCount()).toBe(0)
      expect(device.audio.recorders[0]?.isReleased).toBe(false)

      device.audio.advance(4000)
      await start(device)
      expect(shown('phase')).toBe('Recording')
      expect(shown('elapsed')).toBe('0:06')
      expect(shown('last-event')).toBe('Found a recording still running at 0:06')
      expect(device.audio.recorders).toHaveLength(1)

      await tap('stop')
      expect(shown('note-0-details')).toContain('0:06')
    })

    it('a recording that reached its length while the screen was closed is saved on return', async () => {
      await tap('record-five')
      await pass(1000)
      await tap('exit')
      await stopProgram()

      device.audio.advance(6000)
      expect(noteFiles()).toEqual(['file:///cache/ExpoAudio/recording-1.m4a'])

      await start(device)
      expect(shown('phase')).toBe('Idle')
      expect(shown('notes-count')).toBe('1 note')
      expect(shown('note-0-details')).toContain('0:05')
      expect(noteFiles()[0]).toContain('/documents/voice-notes/')
    })

    it('notes are still there after the app is closed and opened again', async () => {
      await recordNote(3000)
      await recordNote(1000)
      const files = device.files
      await stopProgram()

      await start(Device.makeTest({ files }))
      expect(shown('notes-count')).toBe('2 notes')
      // Newest first.
      expect(shown('note-0-name')).toBe('Voice note 2')
      expect(shown('note-1-name')).toBe('Voice note 1')
      expect(shown('note-1-details')).toContain('0:03')
    })
  })

  describe('playing', () => {
    beforeEach(async () => {
      await recordNote(10_000)
    })

    it('plays, shows where it has got to, jumps, changes speed, and ends', async () => {
      await tap('note-0-play')
      expect(device.audio.players).toHaveLength(1)
      expect(device.audio.players[0]?.uri).toContain('/documents/voice-notes/note-')
      expect(device.audio.players[0]?.isPlaying).toBe(true)
      expect(has('note-0-pause')).toBe(true)

      await pass(1000)
      expect(shown('playback-position')).toBe('0:01 of 0:10')

      // The seventh of twelve blocks starts half way.
      await tap('seek-6')
      expect(device.audio.calls).toContain('seekTo(5)')
      expect(shown('playback-position')).toBe('0:05 of 0:10')

      await tap('rate-2x')
      expect(device.audio.players[0]?.rate).toBe(2)
      await pass(1000)
      expect(shown('playback-position')).toBe('0:07 of 0:10')

      await pass(2000)
      expect(shown('last-event')).toBe('Played to the end')
      expect(shown('playback-position')).toBe('0:00 of 0:10')
      expect(has('note-0-play')).toBe(true)
      expect(device.audio.players[0]?.isPlaying).toBe(false)
    })

    it('pauses and carries on from the same place in the same player', async () => {
      await tap('note-0-play')
      await pass(2000)
      await tap('note-0-pause')
      expect(device.audio.players[0]?.isPlaying).toBe(false)
      await pass(3000)
      expect(shown('playback-position')).toBe('0:02 of 0:10')

      await tap('note-0-play')
      await pass(1000)
      expect(shown('playback-position')).toBe('0:03 of 0:10')
      expect(device.audio.players).toHaveLength(1)
    })

    it('starts at the chosen speed', async () => {
      await tap('rate-1-5x')
      await tap('note-0-play')
      expect(device.audio.players[0]?.rate).toBe(1.5)
      await pass(2000)
      expect(shown('playback-position')).toBe('0:03 of 0:10')
    })

    it('plays one note at a time: the first player is let go', async () => {
      await recordNote(4000)
      await tap('note-1-play')
      await tap('note-0-play')
      expect(device.audio.players).toHaveLength(2)
      expect(device.audio.players[0]).toMatchObject({ isReleased: true, isRemoved: true, isPlaying: false })
      expect(device.audio.players[1]).toMatchObject({ isReleased: false, isPlaying: true })
      expect(device.audio.players.filter(player => player.isPlaying)).toHaveLength(1)
    })

    it('recording lets the player go first', async () => {
      await tap('note-0-play')
      await tap('record')
      expect(device.audio.players[0]?.isReleased).toBe(true)
      expect(shown('phase')).toBe('Recording')
      expect(has('note-0-play')).toBe(false)
      expect(device.player.listenerCount()).toBe(0)
    })

    it('says so when the file cannot be played', async () => {
      device.audio.state.failNext = { method: 'AudioPlayer', reason: 'no such file' }
      await tap('note-0-play')
      expect(shown('last-event')).toBe('Could not play: no such file')
      expect(has('playback-position')).toBe(false)
    })
  })

  describe('the list', () => {
    const type = async (id: string, value: string): Promise<void> => {
      phone.fabric.emit(byTestId(phone.fabric, id), 'topChange', { text: value, eventCount: value.length })
      await settle()
    }

    it('renames a note, and the new name is what is saved', async () => {
      await recordNote(1000)
      await tap('note-0-rename')
      await type('name-field', 'Coach meeting')
      await tap('name-save')
      expect(shown('note-0-name')).toBe('Coach meeting')
      expect(has('name-field')).toBe(false)
      expect(device.files.entries.get('file:///documents/voice-notes/index.json')).toContain(
        '"name":"Coach meeting"',
      )
    })

    it('refuses an empty name and keeps the old one', async () => {
      await recordNote(1000)
      await tap('note-0-rename')
      await type('name-field', '   ')
      await tap('name-save')
      expect(shown('last-event')).toBe('Notes, could not rename: A note needs a name.')
      expect(shown('note-0-name')).toBe('Voice note 1')
    })

    it('deletes a note and its file, and lets go of the player if it was playing', async () => {
      await recordNote(1000)
      await tap('note-0-play')
      await tap('note-0-delete')
      expect(shown('notes-count')).toBe('No notes yet')
      expect(noteFiles()).toEqual([])
      expect(device.audio.players[0]?.isReleased).toBe(true)
      expect(device.player.listenerCount()).toBe(0)
    })
  })

  describe('listening and letting go', () => {
    it('listens to the recorder only while a recording is live', async () => {
      await tap('record')
      expect(device.recorder.listenerCount()).toBe(1)
      expect(device.audio.timerCount()).toBe(1)
      await tap('pause')
      expect(device.recorder.listenerCount()).toBe(1)
      await tap('stop')
      expect(device.recorder.listenerCount()).toBe(0)
      expect(device.audio.timerCount()).toBe(0)
    })

    it('listens to the player only while a note is loaded', async () => {
      await recordNote(1000)
      expect(device.player.listenerCount()).toBe(0)
      await tap('note-0-play')
      expect(device.player.listenerCount()).toBe(1)
      await tap('note-0-pause')
      expect(device.player.listenerCount()).toBe(1)
      await tap('exit')
      expect(device.player.listenerCount()).toBe(0)
    })

    it('every native recorder is released when its recording ends', async () => {
      await recordNote(1000)
      await tap('record')
      await tap('discard')
      await tap('record-five')
      await pass(6000)
      expect(device.audio.recorders.map(recorder => recorder.isReleased)).toEqual([true, true, true])
    })

    it('exit releases the player and calls exit', async () => {
      await recordNote(1000)
      await tap('note-0-play')
      await tap('exit')
      expect(device.audio.players[0]).toMatchObject({ isReleased: true, isRemoved: true })
      expect(exit).toHaveBeenCalledTimes(1)
    })

    it('stopping the program stops both Subscriptions', async () => {
      await recordNote(1000)
      await tap('note-0-play')
      await tap('record')
      await stopProgram()
      expect(device.recorder.listenerCount()).toBe(0)
      expect(device.player.listenerCount()).toBe(0)
    })
  })
})

describe('the recorder service', () => {
  const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

  it('sends about one status a second, not one per reading, and keeps the level out of them', async () => {
    const meter = Recorder.makeMeter()
    const fake = Recorder.makeTest({ meter })
    const events: Array<Device.Recorder.RecorderEvent> = []
    fake.service.events.subscribe(event => events.push(event))
    await run(fake.service.start({ maxSeconds: 900, warnSeconds: 60 }))
    events.length = 0

    for (let step = 0; step < 100; step++) {
      fake.audio.setLevel(-60 + (step % 60))
      fake.audio.advance(100)
    }
    // Ten seconds, one hundred readings of the phone: ten Messages.
    expect(events).toHaveLength(10)
    expect(events.every(event => event._tag === 'Status')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('level')
    // The level went to the meter instead.
    expect(meter.read()).toBeCloseTo(Recorder.levelOf(-60 + (99 % 60)))
    expect(meter.read()).toBeGreaterThan(0)
  })

  it('turns decibels into 0 to 1', () => {
    expect(Recorder.levelOf(-160)).toBe(0)
    expect(Recorder.levelOf(-60)).toBe(0)
    expect(Recorder.levelOf(-30)).toBe(0.5)
    expect(Recorder.levelOf(0)).toBe(1)
    expect(Recorder.levelOf(undefined)).toBe(0)
  })

  it('clears the meter when the recording ends', async () => {
    const meter = Recorder.makeMeter()
    const fake = Recorder.makeTest({ meter })
    await run(fake.service.start({ maxSeconds: 900, warnSeconds: 60 }))
    fake.audio.advance(500)
    expect(meter.read()).toBeGreaterThan(0)
    await run(fake.service.stop)
    expect(meter.read()).toBe(0)
  })

  it('refuses a second recording while one runs', async () => {
    const fake = Recorder.makeTest()
    await run(fake.service.start({ maxSeconds: 900, warnSeconds: 60 }))
    const error = await run(Effect.flip(fake.service.start({ maxSeconds: 900, warnSeconds: 60 })))
    expect(error.reason).toBe('A recording is already running.')
    expect(fake.audio.recorders).toHaveLength(1)
  })

  it('stops the phone itself if the phone runs past the limit', async () => {
    const fake = Recorder.makeTest()
    const events: Array<Device.Recorder.RecorderEvent> = []
    fake.service.events.subscribe(event => events.push(event))
    await run(fake.service.start({ maxSeconds: 5, warnSeconds: 2 }))
    // A phone that ignores the length it was given.
    fake.audio.recorders[0]!.limitSeconds = undefined
    fake.audio.advance(7000)
    await settle()
    expect(fake.audio.calls).toContain('stop')
    expect(events.at(-1)).toMatchObject({ _tag: 'Finished', recording: { endedBy: 'limit', durationMs: 5000 } })
    expect(fake.audio.recorders[0]?.isReleased).toBe(true)
  })

  it('releases the recorder when starting fails', async () => {
    const fake = Recorder.makeTest({ backgroundRecording: false })
    fake.audio.state.failNext = { method: 'prepareToRecordAsync', reason: 'microphone busy' }
    const error = await run(Effect.flip(fake.service.start({ maxSeconds: 900, warnSeconds: 60 })))
    expect(error.reason).toBe('microphone busy')
    expect(fake.audio.recorders[0]?.isReleased).toBe(true)
    expect(fake.audio.timerCount()).toBe(0)
  })

  it('writes recording options flat, per platform, as native expects', () => {
    expect(Native.recordingOptions('ios')).toEqual({
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 1,
      bitRate: 64000,
      isMeteringEnabled: true,
      outputFormat: 'aac ',
      audioQuality: 96,
    })
    expect(Native.recordingOptions('android')).toMatchObject({
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
      isMeteringEnabled: true,
    })
    expect(Native.recordingOptions('android')).not.toHaveProperty('audioQuality')
  })

  it('leaves the key Android does not know out of the audio mode', async () => {
    const fake = Recorder.makeTest({ platform: 'android' })
    await run(fake.service.start({ maxSeconds: 900, warnSeconds: 60 }))
    expect(fake.audio.modes[0]).not.toHaveProperty('allowsRecording')
    expect(fake.audio.modes[0]).toMatchObject({ allowsBackgroundRecording: true })
  })

  it('answers every call with a reason where the build has no audio module', async () => {
    const service = Recorder.unavailable(Recorder.NO_AUDIO_MODULE)
    const error = await run(Effect.flip(service.start({ maxSeconds: 1, warnSeconds: 0 })))
    expect(error.reason).toContain('globalThis.expo.modules.ExpoAudio is missing')
    expect((await run(service.snapshot)).route).toContain('not available')
  })

  it('finds the native modules by name on the global, or says there are none', () => {
    const host = globalThis as { expo?: unknown }
    expect(Native.audioModuleFromGlobal()).toBeNull()
    expect(Native.fileSystemFromGlobal()).toBeNull()
    const fake = Native.makeFakeAudio()
    host.expo = { modules: { ExpoAudio: fake.module, FileSystem: { FileSystemFile: class {} } } }
    try {
      expect(Native.audioModuleFromGlobal()).toBe(fake.module)
      expect(Native.fileSystemFromGlobal()).not.toBeNull()
    } finally {
      delete host.expo
    }
  })
})

describe('the audio session shared by recorder and player', () => {
  it('the player does not take the session while a recording runs', async () => {
    const fake = Native.makeFakeAudio()
    const session = Native.makeAudioSession(fake.module, 'ios')
    const recorder = Recorder.makeTest({ audio: fake, session })
    const player = Player.makeTest({ audio: fake, session })
    await Effect.runPromise(recorder.service.start({ maxSeconds: 900, warnSeconds: 60 }))
    const modes = fake.modes.length

    const error = await Effect.runPromise(Effect.flip(player.service.play('file:///a.m4a', 1)))
    expect(error.reason).toBe('A recording is running. Stop it before playing a note.')
    expect(fake.modes).toHaveLength(modes)
    expect(fake.players).toHaveLength(0)
    // The recording was not disturbed.
    expect(fake.recorders[0]?.getStatus().isRecording).toBe(true)
  })

  it('sets the phone up for the speaker once, before the first play', async () => {
    const player = Player.makeTest()
    await Effect.runPromise(player.service.play('file:///a.m4a', 1))
    await Effect.runPromise(player.service.play('file:///b.m4a', 1))
    expect(player.audio.modes).toEqual([
      {
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
        allowsRecording: false,
      },
    ])
  })
})

describe('the meter', () => {
  it('reads the level box when it draws and asks for no frames when not live', () => {
    const meter = Recorder.makeMeter()
    const scene = makeMeterScene(meter)
    const drawn: Array<Array<number>> = []
    let frames: Array<(now: number) => void> = []
    const surface = {
      renderer: 'views' as const,
      size: () => ({ width: 360, height: 50 }),
      draw: (paint: (pen: never, size: { width: number; height: number }) => void) => {
        const heights: Array<number> = []
        const pen = { rect: (_x: number, _y: number, _w: number, height: number) => heights.push(height) }
        paint(pen as never, { width: 360, height: 50 })
        drawn.push(heights)
      },
      frame: (run: (now: number) => void) => void frames.push(run),
      now: () => 0,
      emit: () => {},
    }
    const run = scene.start(surface, { mode: 'flat', color: '#c00', quiet: '#ccc' })
    expect(frames).toHaveLength(0)

    run.update?.({ mode: 'live', color: '#c00', quiet: '#ccc' })
    expect(frames).toHaveLength(1)
    meter.write(0.5)
    const next = frames
    frames = []
    next.forEach(frame => frame(1000))
    // The newest bar is half the height of the canvas.
    expect(drawn.at(-1)?.at(-1)).toBe(25)
    expect(frames).toHaveLength(1)

    run.update?.({ mode: 'held', color: '#c00', quiet: '#ccc' })
    const last = frames
    frames = []
    last.forEach(frame => frame(2000))
    expect(frames).toHaveLength(0)
    // Held: the bars stay as they were.
    expect(drawn.at(-1)?.at(-1)).toBe(25)

    run.update?.({ mode: 'flat', color: '#c00', quiet: '#ccc' })
    expect(drawn.at(-1)?.every(height => height === 2)).toBe(true)
  })
})

describe('the notes store', () => {
  const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect)

  it('drops a note whose file has gone', async () => {
    const store = VoiceNotes.makeTest()
    store.files.entries.set('file:///cache/a.m4a', 'aaaa')
    store.files.entries.set('file:///cache/b.m4a', 'bb')
    await run(store.service.add({ uri: 'file:///cache/a.m4a', durationMs: 1000, sizeBytes: 0 }))
    const notes = await run(
      store.service.add({ uri: 'file:///cache/b.m4a', durationMs: 2000, sizeBytes: 0 }),
    )
    expect(notes.map(note => [note.name, note.sizeBytes])).toEqual([
      ['Voice note 2', 2],
      ['Voice note 1', 4],
    ])
    store.files.entries.delete(notes[0]!.uri)
    expect((await run(store.service.list)).map(note => note.name)).toEqual(['Voice note 1'])
  })

  it('treats a list it cannot read as empty, and does not crash', async () => {
    const store = VoiceNotes.makeTest()
    store.files.entries.set('file:///documents/voice-notes/index.json', '{not json')
    expect(await run(store.service.list)).toEqual([])
  })

  it('fails, and adds nothing, when the recording is not where it was said to be', async () => {
    const store = VoiceNotes.makeTest()
    const error = await run(
      Effect.flip(store.service.add({ uri: 'file:///cache/missing.m4a', durationMs: 1, sizeBytes: 1 })),
    )
    expect(error.reason).toContain('No file at')
    expect(await run(store.service.list)).toEqual([])
  })

  it('does not reuse the number of a deleted note', async () => {
    const store = VoiceNotes.makeTest()
    for (const name of ['a', 'b']) store.files.entries.set(`file:///cache/${name}.m4a`, 'x')
    const first = await run(store.service.add({ uri: 'file:///cache/a.m4a', durationMs: 1, sizeBytes: 1 }))
    await run(store.service.add({ uri: 'file:///cache/b.m4a', durationMs: 1, sizeBytes: 1 }))
    await run(store.service.remove(first[0]!.id))
    store.files.entries.set('file:///cache/c.m4a', 'x')
    const notes = await run(store.service.add({ uri: 'file:///cache/c.m4a', durationMs: 1, sizeBytes: 1 }))
    expect(notes.map(note => note.name)).toEqual(['Voice note 3', 'Voice note 2'])
  })

  it('works over the shape of expo-file-system\'s native module', async () => {
    const disk = new Map<string, string>()
    const made: Array<string> = []
    class FileSystemFile {
      uri: string
      constructor(uri: string) {
        this.uri = uri
      }
      get exists(): boolean {
        return disk.has(this.uri)
      }
      get size(): number {
        return disk.get(this.uri)?.length ?? 0
      }
      textSync(): string {
        return disk.get(this.uri) ?? ''
      }
      writeSync(content: string): void {
        disk.set(this.uri, content)
      }
      delete(): void {
        disk.delete(this.uri)
      }
      moveSync(destination: FileSystemFile): void {
        disk.set(destination.uri, disk.get(this.uri) ?? '')
        disk.delete(this.uri)
      }
    }
    class FileSystemDirectory {
      uri: string
      constructor(uri: string) {
        this.uri = uri
      }
      get exists(): boolean {
        return made.includes(this.uri)
      }
      create(): void {
        made.push(this.uri)
      }
    }
    const files = Native.filesFrom({
      documentDirectory: 'file:///var/app/Documents/',
      FileSystemFile,
      FileSystemDirectory,
    })
    const store = VoiceNotes.make(files, { now: () => 1000 })
    disk.set('file:///var/app/Caches/ExpoAudio/r.m4a', 'audio!')
    const notes = await run(
      store.add({ uri: 'file:///var/app/Caches/ExpoAudio/r.m4a', durationMs: 5000, sizeBytes: 0 }),
    )
    expect(made).toEqual(['file:///var/app/Documents/voice-notes/'])
    expect(notes[0]?.uri).toMatch(/^file:\/\/\/var\/app\/Documents\/voice-notes\/note-.+\.m4a$/)
    expect(notes[0]?.sizeBytes).toBe(6)
    expect(disk.has('file:///var/app/Caches/ExpoAudio/r.m4a')).toBe(false)
    await run(store.remove(notes[0]!.id))
    expect([...disk.keys()]).toEqual(['file:///var/app/Documents/voice-notes/index.json'])
  })
})

describe('words on screen', () => {
  it('writes times and sizes the way a person reads them', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65)).toBe('1:05')
    expect(clock(900)).toBe('15:00')
    expect(sizeText(512)).toBe('512 bytes')
    expect(sizeText(24_000)).toBe('24 KB')
    expect(sizeText(7_200_000)).toBe('7.2 MB')
  })
})
