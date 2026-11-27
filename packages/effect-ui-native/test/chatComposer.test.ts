/**
 * Effect Chat, step 3: the composer. Listening (speech recognition), voice
 * notes, a refused message coming back, haptics, glass, the offline line,
 * and the round button's fade. End to end on the simulated phone.
 */
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetGlass } from '../../native/src/host/glass/detect.js'
import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { NativeViews } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { REPLY, REQUEST, type Started, ids, lastSetText, pressBarButton, replies, send, start, textIn, until } from './chatSupport.js'
import { run } from './support.js'

beforeEach(() => {
  NativeViews.configureMarkdown({ native: true })
})
afterEach(() => {
  resetMarkdownSetup()
  resetGlass()
})

const newChat = (options: Parameters<typeof start>[0] = {}) =>
  Effect.gen(function* () {
    const started = yield* start(options)
    yield* started.app.press('start-chat')
    yield* started.app.wait(REQUEST)
    return started
  })

const notice = (started: Started): string => (started.app.has('chat-notice') ? started.app.text('chat-notice') : '')
const micLabel = (started: Started) => started.app.byTestId('mic').props['accessibilityLabel']

describe('listening: the microphone button writes what the phone hears into the field', () => {
  it('asks the phone for leave, starts, shows the words as they are spoken, and stops on a second press', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device } = started
        expect(micLabel(started)).toBe('Speak your message')
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        expect(device.speech.calls).toEqual(['requestPermission', 'start'])
        // Words while they are spoken, across pauses, with punctuation, from the microphone.
        expect(device.speech.starts[0]).toMatchObject({ interimResults: true, continuous: true })
        expect(device.speech.starts[0]?.['audioSource']).toBeUndefined()
        expect(micLabel(started)).toBe('Stop listening')
        expect(app.byTestId('draft').props['placeholder']).toBe('Listening')
        expect(device.haptics.calls).toContain('impact:light')
        device.speech.hear('How do')
        yield* app.settle
        expect(lastSetText(app)).toBe('How do')
        // Each result holds everything heard so far: the newest takes the place of the one before.
        device.speech.hear('How do I start running')
        yield* app.settle
        expect(lastSetText(app)).toBe('How do I start running')
        // The button is still the microphone while the phone listens, though there is text now.
        expect(app.has('send')).toBe(false)
        yield* app.press('mic')
        yield* app.settle
        expect(device.speech.calls).toEqual(['requestPermission', 'start', 'stop'])
        expect(device.speech.isListening()).toBe(false)
        // What was heard stays, and can be sent.
        expect(app.has('send')).toBe(true)
        expect(app.byTestId('draft').props['placeholder']).toBe('Ask anything')
        yield* app.press('send')
        yield* until(app, () => replies(app).length === 1, REPLY, 'a reply')
        expect(ids(app).filter(id => id.startsWith('message-')).map(id => app.text(id))).toEqual(['How do I start running'])
        // Nothing listens for the phone's words any more.
        expect(device.speech.listenerCount()).toBe(0)
      }),
    ))

  it('a second session puts its words after what the first left in the field', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* newChat()
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        device.speech.hear('Tell me')
        yield* app.settle
        yield* app.press('mic')
        yield* app.settle
        expect(lastSetText(app)).toBe('Tell me')
        // With text in the field the microphone is still there, beside Send.
        expect(app.has('send')).toBe(true)
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        expect(device.speech.calls.filter(call => call === 'start')).toHaveLength(2)
        // A new session starts its count of words from nothing.
        device.speech.hear('about bread')
        yield* app.settle
        expect(lastSetText(app)).toBe('Tell me about bread')
      }),
    ))

  it('a refused permission shows a short notice, starts nothing, and leaves the field as it was', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device } = started
        device.speech.setPermission('denied')
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        expect(device.speech.calls).toEqual(['requestPermission'])
        expect(notice(started)).toBe('Speech recognition is off. Turn it on in the Settings app.')
        expect(micLabel(started)).toBe('Speak your message')
        expect(lastSetText(app)).toBe('')
        // It can be asked again.
        device.speech.setPermission('granted')
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        expect(device.speech.isListening()).toBe(true)
      }),
    ))

  it('a failure while listening shows a short notice and puts the field back as it was', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device } = started
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        device.speech.hear('half a sent')
        yield* app.settle
        expect(lastSetText(app)).toBe('half a sent')
        device.speech.fail('network', 'The recogniser could not be reached.')
        yield* app.settle
        expect(notice(started)).toBe('Could not listen: The recogniser could not be reached.')
        // Empty again, as before the press.
        expect(lastSetText(app)).toBe('')
        expect(app.has('send')).toBe(false)
        expect(micLabel(started)).toBe('Speak your message')
        // The line goes when the person writes.
        yield* app.typeText('draft', 'x')
        expect(app.has('chat-notice')).toBe(false)
      }),
    ))

  it('a build without the native module says so and leaves the field as it was', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device } = started
        device.speech.failNext('this build has no expo-speech-recognition')
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        expect(notice(started)).toBe('Could not listen: this build has no expo-speech-recognition')
        expect(micLabel(started)).toBe('Speak your message')
        expect(device.speech.isListening()).toBe(false)
      }),
    ))

  it('typing while the phone listens ends the listening, and the typed text stays', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* newChat()
        yield* app.press('mic')
        yield* app.wait(REQUEST)
        device.speech.hear('hello')
        yield* app.settle
        yield* app.typeText('draft', 'hello there')
        yield* app.settle
        expect(device.speech.calls).toContain('abort')
        // A late word from the phone does not write over what was typed.
        device.speech.hear('hello something else')
        yield* app.settle
        expect(lastSetText(app)).toBe('hello there')
        expect(app.has('send')).toBe(true)
      }),
    ))
})

describe('a voice note', () => {
  it('records with a clock, waits above the field as a chip, plays back, and goes with the message', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, server } = started
        // The phone cannot read this note's words: the line stays.
        device.speech.setPermission('denied')
        yield* app.press('record')
        yield* app.wait(REQUEST)
        expect(app.has('recording')).toBe(true)
        expect(app.has('draft')).toBe(false)
        expect(device.haptics.calls).toContain('impact:medium')
        expect(app.text('recording-time')).toBe('Recording 0:00')
        device.audio.advance(3000)
        yield* app.settle
        expect(app.text('recording-time')).toBe('Recording 0:03')
        yield* app.press('finish-recording')
        yield* app.wait(REQUEST)
        expect(app.has('recording')).toBe(false)
        expect(app.text('voice-note')).toBe('Voice note 0:03')
        expect(lastSetText(app)).toBe('(Voice note, 0:03)')
        // Play it back, and stop it.
        yield* app.press('play-note')
        yield* app.wait(REQUEST)
        expect(app.byTestId('play-note').props['accessibilityLabel']).toBe('Stop playing the voice note')
        expect(device.audio.calls.some(call => String(call).includes('play'))).toBe(true)
        yield* app.press('play-note')
        yield* app.settle
        expect(app.byTestId('play-note').props['accessibilityLabel']).toBe('Play the voice note')
        // Send: the note goes with the message, to the server and onto the screen.
        yield* app.press('send')
        yield* until(app, () => replies(app).length === 1, REPLY, 'a reply')
        const question = ids(app).find(id => id.startsWith('message-local-')) as string
        expect(textIn(app.byTestId(question))).toBe('Voice note 0:03(Voice note, 0:03)')
        expect(app.has('voice-note')).toBe(false)
        yield* until(app, () => !app.has('stop'), REPLY * 2, 'the reply to end')
        yield* app.wait(REQUEST * 3)
        const saved = [...started.disk.entries.entries()].find(([key]) => key.startsWith('conversation-'))?.[1] ?? ''
        expect(JSON.parse(saved).messages[0].attachments).toEqual([
          // The note's place on the phone is kept too, so its row can play it back.
          { name: 'Voice note 0:03', mediaType: 'audio/mp4', sizeBytes: expect.any(Number), uri: expect.stringContaining('recording-') },
        ])
        expect(server.log().some(name => name.startsWith('SendMessage'))).toBe(true)
      }),
    ))

  it('the phone reads the note’s words from its file, and they take the place of the line in the field', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* newChat()
        yield* app.press('record')
        yield* app.wait(REQUEST)
        device.audio.advance(2000)
        yield* app.press('finish-recording')
        yield* app.wait(REQUEST)
        expect(lastSetText(app)).toBe('(Voice note, 0:02)')
        // Speech recognition was started on the recording's file, not on the microphone.
        const source = device.speech.starts[0]?.['audioSource'] as { uri?: string } | undefined
        expect(source?.uri).toMatch(/\.m4a$|^file:|recording/)
        // The microphone button does not say it is listening: nothing is being heard from the room.
        expect(app.has('send')).toBe(true)
        device.speech.hear('Buy bread and milk')
        yield* app.settle
        expect(lastSetText(app)).toBe('Buy bread and milk')
        device.speech.end()
        yield* app.settle
        expect(device.speech.listenerCount()).toBe(0)
        expect(app.text('voice-note')).toBe('Voice note 0:02')
      }),
    ))

  it('can be thrown away while recording, and removed afterwards', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* newChat()
        device.speech.setPermission('denied')
        yield* app.press('record')
        yield* app.wait(REQUEST)
        yield* app.press('cancel-recording')
        yield* app.wait(REQUEST)
        expect(app.has('recording')).toBe(false)
        expect(app.has('voice-note')).toBe(false)
        expect(app.has('record')).toBe(true)
        yield* app.press('record')
        yield* app.wait(REQUEST)
        device.audio.advance(1000)
        yield* app.press('finish-recording')
        yield* app.wait(REQUEST)
        expect(app.has('voice-note')).toBe(true)
        yield* app.press('remove-note')
        yield* app.settle
        expect(app.has('voice-note')).toBe(false)
        // Its line leaves the field with it.
        expect(lastSetText(app)).toBe('')
        expect(app.has('record')).toBe(true)
      }),
    ))

  it('a refused microphone shows a short notice and records nothing', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device } = started
        device.audio.state.permission = { status: 'denied', granted: false, canAskAgain: false } as never
        yield* app.press('record')
        yield* app.wait(REQUEST)
        expect(app.has('recording')).toBe(false)
        expect(notice(started)).toBe('Microphone access is off. Turn it on in the Settings app.')
      }),
    ))
})

describe('sending', () => {
  it('Send is felt as a light tap, Stop as a firmer one, and the first words of the reply as a tick', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* newChat({ timing: { firstTokenMs: 40, tokensPerSecond: 150, jitter: 0, pauseChance: 0, pauseMs: 0, toolMs: 20, latencyMs: 10 } })
        yield* send(app, 'How do I start running?')
        expect(device.haptics.calls).toEqual(['impact:light'])
        yield* until(app, () => replies(app).length === 1 && textIn(app.byTestId(replies(app)[0] as string)).length > 20, REPLY, 'the first words')
        expect(device.haptics.calls).toEqual(['impact:light', 'selection'])
        yield* app.press('stop')
        yield* until(app, () => !app.has('stop'), REPLY, 'the reply to stop')
        expect(device.haptics.calls).toEqual(['impact:light', 'selection', 'impact:medium'])
      }),
    ))

  it('a message the server refuses comes off the screen and goes back into the field, with the reason', () =>
    run(
      Effect.gen(function* () {
        const started = yield* newChat()
        const { app, device, server } = started
        server.setChaos({ refuseSend: true })
        yield* send(app, 'Will this go?')
        // On screen at once, and the field is empty.
        expect(ids(app).filter(id => id.startsWith('message-'))).toHaveLength(1)
        expect(lastSetText(app)).toBe('')
        yield* app.wait(REQUEST * 3)
        expect(ids(app).filter(id => id.startsWith('message-'))).toEqual([])
        expect(notice(started)).toMatch(/^Not sent\. /)
        expect(lastSetText(app)).toBe('Will this go?')
        expect(app.has('send')).toBe(true)
        expect(device.haptics.calls).toEqual(['impact:light', 'notification:error'])
        // Once the server takes messages again, the same text goes with one press.
        server.setChaos({ refuseSend: false })
        yield* app.press('send')
        yield* until(app, () => replies(app).length === 1, REPLY, 'a reply')
        expect(ids(app).filter(id => id.startsWith('message-')).map(id => app.text(id))).toEqual(['Will this go?'])
        expect(app.has('chat-notice')).toBe(false)
      }),
    ))

  it('a refused message does not write over what was typed since', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* newChat()
        server.setTiming({ firstTokenMs: 40, tokensPerSecond: 1500, jitter: 0, pauseChance: 0, pauseMs: 0, toolMs: 20, latencyMs: 120 })
        server.setChaos({ refuseSend: true })
        yield* send(app, 'First')
        yield* app.typeText('draft', 'Second thought')
        yield* app.wait(REQUEST * 4)
        expect(ids(app).filter(id => id.startsWith('message-'))).toEqual([])
        expect(lastSetText(app)).toBe('Second thought')
      }),
    ))

  it('offline: a line says so and nothing can be sent. Back online, it can', () =>
    run(
      Effect.gen(function* () {
        const { app, device, server } = yield* newChat()
        device.network.set('offline')
        yield* app.settle
        expect(app.text('offline')).toBe('You are offline. Sending is off until you are back.')
        expect(app.byTestId('draft').props['placeholder']).toBe('Offline')
        yield* app.typeText('draft', 'Hello')
        expect(app.byTestId('send').props['accessibilityState']).toEqual({ disabled: true })
        yield* app.press('send')
        yield* app.wait(REQUEST)
        expect(server.log().some(name => name.startsWith('SendMessage'))).toBe(false)
        // A question from the list is not sent either.
        device.network.set('online')
        yield* app.settle
        expect(app.has('offline')).toBe(false)
        yield* app.press('send')
        yield* app.wait(REQUEST)
        expect(server.log().some(name => name.startsWith('SendMessage'))).toBe(true)
      }),
    ))
})

describe('the composer sits on glass', () => {
  it('is the phone’s Liquid Glass where the phone has it, with no colour of its own', () =>
    run(
      Effect.gen(function* () {
        NativeViews.configureGlass({ available: true })
        NativeViews.registerGlass()
        const { app } = yield* newChat()
        const pill = app.byTestId('composer')
        expect(pill.viewName).toContain('GlassView')
        expect(pill.props['glassEffectStyle']).toBe('regular')
        expect(pill.props['backgroundColor']).toBeUndefined()
        expect(pill.props['borderRadius']).toBe(26)
        // The field and the buttons are inside it.
        const inside = NativeTest.flatten([pill]).map(node => node.props['testID'])
        expect(inside).toEqual(expect.arrayContaining(['draft', 'mic', 'record']))
      }),
    ))

  it('is a pale plain pill with a hairline where the phone has none', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* newChat()
        const pill = app.byTestId('composer')
        expect(pill.viewName).toBe('View')
        expect(pill.props['backgroundColor']).toBe('rgba(242,242,243,0.92)')
        expect(pill.props['borderWidth']).toBe(0.5)
      }),
    ))
})

describe('the settings sheet over a chat', () => {
  it('opens from the list while no chat is open, and the composer is not drawn', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* pressBarButton(app, 'bar-chats', 'settings')
        expect(app.has('sheet-settings')).toBe(true)
        expect(app.has('composer')).toBe(false)
      }),
    ))
})
