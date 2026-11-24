/**
 * The share sheet as a Foldkit Command.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/share.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { Share, ShareOutcome } from '../../host/device/share.js'

export * from '../../host/device/share.js'

export const Message = defineMessageUnion({
  SucceededShare: { outcome: ShareOutcome },
  FailedShare: { reason: Schema.String },
})
export type Message = typeof Message.Type

/** Opens the share sheet. Give a `message`, a `url`, or both. */
export const Open = Command.define('Share.Open', {
  args: {
    message: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    title: Schema.optional(Schema.String),
  },
  messages: [Message.SucceededShare, Message.FailedShare],
  execute: request =>
    Share.use(share => share.share(request)).pipe(
      Effect.map(outcome => Message.SucceededShare({ outcome })),
      Effect.catch(error => Effect.succeed(Message.FailedShare({ reason: error.reason }))),
    ),
})
