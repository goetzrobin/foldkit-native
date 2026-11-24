/**
 * Alert as a Foldkit Command: the button the user presses comes back as a Message.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/alert.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError } from '../../host/device/common.js'
import { Alert, MAX_BUTTONS, AlertButton } from '../../host/device/alert.js'

export * from '../../host/device/alert.js'

export const Message = defineMessageUnion({
  PressedAlertButton: { id: Schema.String },
  /** Closed without a button. Android only. */
  DismissedAlert: {},
  FailedShowAlert: { reason: Schema.String },
})
export type Message = typeof Message.Type

/** Shows an alert. Its result Message arrives when the user answers. */
export const Show = Command.define('Alert.Show', {
  args: {
    title: Schema.String,
    message: Schema.optional(Schema.String),
    buttons: Schema.Array(AlertButton),
  },
  messages: [Message.PressedAlertButton, Message.DismissedAlert, Message.FailedShowAlert],
  execute: request =>
    (request.buttons.length > MAX_BUTTONS
      ? Effect.fail(
          new DeviceError({
            capability: 'alert',
            reason: `An alert holds at most ${MAX_BUTTONS} buttons, and this one has ${request.buttons.length}`,
          }),
        )
      : Alert.use(alert => alert.show(request))
    ).pipe(
      Effect.map(answer =>
        answer._tag === 'Pressed'
          ? Message.PressedAlertButton({ id: answer.id })
          : Message.DismissedAlert(),
      ),
      Effect.catch(error => Effect.succeed(Message.FailedShowAlert({ reason: error.reason }))),
    ),
})
