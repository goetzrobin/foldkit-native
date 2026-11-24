/**
 * Clipboard as Foldkit Commands: copy text, read text.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/clipboard.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { Clipboard } from '../../host/device/clipboard.js'

export * from '../../host/device/clipboard.js'

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
