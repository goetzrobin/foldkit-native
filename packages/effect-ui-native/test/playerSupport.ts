/**
 * Shared by the tests of the audio player on the simulated phone: steps a
 * person takes, as Effects.
 */
import { Effect } from 'effect'

import { REPLY, REQUEST, type Started, type TestApp, ids, replies, until } from './chatSupport.js'

/** The person's messages on screen, oldest first, by row id. */
export const questions = (app: TestApp): Array<string> =>
  ids(app)
    .filter(id => /^message-local-/.test(id))
    .map(id => id.slice('message-'.length))

/** Records a voice note of `seconds`, sends it, and waits for the reply to end. Answers with the new message's row id. */
export const sendVoiceNote = ({ app, device }: Started, seconds: number) =>
  Effect.gen(function* () {
    const before = questions(app).length
    const repliesBefore = replies(app).length
    yield* app.press('record')
    yield* app.wait(REQUEST)
    device.audio.advance(seconds * 1000)
    yield* app.settle
    yield* app.press('finish-recording')
    yield* app.wait(REQUEST)
    yield* app.press('send')
    yield* until(app, () => questions(app).length === before + 1, REPLY, 'the voice note to be on screen')
    yield* until(app, () => replies(app).length === repliesBefore + 1 && !app.has('stop'), REPLY * 2, 'the reply to end')
    yield* app.wait(REQUEST * 2)
    return questions(app)[before] as string
  })

/** The phone's own swipe back from a chat to the list. */
export const goBack = (app: TestApp) =>
  Effect.gen(function* () {
    yield* app.emit('screen-chat', 'topDismissed', { dismissCount: 1 })
    yield* app.wait(REQUEST)
  })

/** The id of the chat made by "New chat" in an empty app. */
export const FIRST_CHAT = 'c1'
