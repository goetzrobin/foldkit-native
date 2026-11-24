/**
 * Links as Foldkit Commands: open a URL, ask whether one can be opened.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/linking.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { Linking } from '../../host/device/linking.js'

export * from '../../host/device/linking.js'

export const Message = defineMessageUnion({
  SucceededOpenUrl: { url: Schema.String },
  FailedOpenUrl: { url: Schema.String, reason: Schema.String },
  SucceededCanOpenUrl: { url: Schema.String, canOpen: Schema.Boolean },
  FailedCanOpenUrl: { url: Schema.String, reason: Schema.String },
})
export type Message = typeof Message.Type

/** Leaves the app for whichever app handles `url`. */
export const OpenUrl = Command.define('Linking.OpenUrl', {
  args: { url: Schema.String },
  messages: [Message.SucceededOpenUrl, Message.FailedOpenUrl],
  execute: ({ url }) =>
    Linking.use(linking => linking.open(url)).pipe(
      Effect.as(Message.SucceededOpenUrl({ url })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedOpenUrl({ url, reason: error.reason })),
      ),
    ),
})

/** Asks whether some app on the phone handles `url`, without opening it. */
export const CanOpenUrl = Command.define('Linking.CanOpenUrl', {
  args: { url: Schema.String },
  messages: [Message.SucceededCanOpenUrl, Message.FailedCanOpenUrl],
  execute: ({ url }) =>
    Linking.use(linking => linking.canOpen(url)).pipe(
      Effect.map(canOpen => Message.SucceededCanOpenUrl({ url, canOpen })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedCanOpenUrl({ url, reason: error.reason })),
      ),
    ),
})
