/**
 * The clipboard: copy text, and read what is there.
 *
 *   // app entry
 *   import * as ExpoClipboard from 'expo-clipboard'
 *   const resources = Clipboard.live(ExpoClipboard)
 *
 *   // update
 *   PressedCopy: () => ({
 *     model,
 *     commands: [
 *       Command.mapMessage(Clipboard.CopyText({ text: model.draft }), message =>
 *         Message.GotClipboardMessage({ message })),
 *     ],
 *   })
 *
 * On iOS 16 and later, reading shows the system's "Allow Paste" question
 * unless the text was copied by this app. Read when the user asks to paste,
 * never on a timer.
 */
import { Context, Effect, Layer, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { type DeviceError, attempt, makeFailure } from './common'

export type ClipboardService = Readonly<{
  copy: (text: string) => Effect.Effect<void, DeviceError>
  read: Effect.Effect<string, DeviceError>
}>

export class Clipboard extends Context.Service<Clipboard, ClipboardService>()(
  'foldkit-native/Clipboard',
) {}

/** The part of `expo-clipboard` used here. */
export interface ClipboardModule {
  getStringAsync(): Promise<string>
  setStringAsync(text: string): Promise<boolean>
}

export const live = (module: ClipboardModule): Layer.Layer<Clipboard> =>
  Layer.succeed(Clipboard, {
    copy: text => Effect.asVoid(attempt('clipboard', () => module.setStringAsync(text))),
    read: attempt('clipboard', () => module.getStringAsync()),
  })

/** A fake clipboard. `calls` lists `copy:<text>` and `read`; `contents()` is what it holds. */
export const makeTest = (initial = '') => {
  const calls: Array<string> = []
  let text = initial
  const { failNext, guard } = makeFailure('clipboard')
  const layer = Layer.succeed(Clipboard, {
    copy: copied =>
      guard(() => {
        calls.push(`copy:${copied}`)
        text = copied
      }),
    read: guard(() => {
      calls.push('read')
      return text
    }),
  })
  return {
    layer,
    calls,
    failNext,
    contents: () => text,
    /** As if another app had copied something. */
    setContents: (value: string) => {
      text = value
    },
  }
}

export const Message = defineMessageUnion({
  SucceededCopyText: { text: Schema.String },
  FailedCopyText: { reason: Schema.String },
  SucceededReadText: { text: Schema.String },
  FailedReadText: { reason: Schema.String },
})
export type Message = typeof Message.Type

/** Puts text on the clipboard. */
export const CopyText = Command.define('Clipboard.CopyText', {
  args: { text: Schema.String },
  messages: [Message.SucceededCopyText, Message.FailedCopyText],
  execute: ({ text }) =>
    Clipboard.use(clipboard => clipboard.copy(text)).pipe(
      Effect.as(Message.SucceededCopyText({ text })),
      Effect.catch(error => Effect.succeed(Message.FailedCopyText({ reason: error.reason }))),
    ),
})

/** Reads the clipboard's text. Empty when it holds none. */
export const ReadText = Command.define('Clipboard.ReadText', {
  messages: [Message.SucceededReadText, Message.FailedReadText],
  execute: Clipboard.use(clipboard => clipboard.read).pipe(
    Effect.map(text => Message.SucceededReadText({ text })),
    Effect.catch(error => Effect.succeed(Message.FailedReadText({ reason: error.reason }))),
  ),
})
