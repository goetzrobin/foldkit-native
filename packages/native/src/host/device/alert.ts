/**
 * The phone's own alert box: a title, a line of text and up to three buttons.
 * The button the user presses comes back as a Message.
 *
 *   // app entry
 *   import { Alert as NativeAlert } from 'react-native'
 *   const resources = Alert.live(NativeAlert)
 *
 *   // update
 *   PressedDelete: () => ({
 *     model,
 *     commands: [
 *       Command.mapMessage(
 *         Alert.Show({
 *           title: 'Delete this note?',
 *           message: 'This cannot be undone.',
 *           buttons: [
 *             { id: 'cancel', label: 'Cancel', style: 'cancel' },
 *             { id: 'delete', label: 'Delete', style: 'destructive' },
 *           ],
 *         }),
 *         message => Message.GotAlertMessage({ message }),
 *       ),
 *     ],
 *   })
 *   // later: PressedAlertButton({ id: 'delete' })
 *
 * Android shows at most three buttons and drops the rest without saying so,
 * so `Show` fails with `FailedShowAlert` when given more. With no buttons the
 * phone adds one "OK", reported with the id `ok`.
 */
import { Context, Effect, Layer, Schema } from 'effect'

import { DeviceError, makeFailure, reasonOf } from './common.js'

export const AlertButton = Schema.Struct({
  /** Comes back in `PressedAlertButton`. */
  id: Schema.String,
  label: Schema.String,
  /** `cancel` sits where the phone puts Cancel. `destructive` is red on iOS. */
  style: Schema.optional(Schema.Literals(['default', 'cancel', 'destructive'])),
})
export type AlertButton = typeof AlertButton.Type

export type AlertRequest = Readonly<{
  title: string
  message?: string | undefined
  buttons: ReadonlyArray<AlertButton>
}>

/** How an alert ended: a button's id, or closed without one (Android). */
export type AlertAnswer =
  | Readonly<{ _tag: 'Pressed'; id: string }>
  | Readonly<{ _tag: 'Dismissed' }>

export type AlertService = Readonly<{
  /** Shows the alert and waits for the answer. */
  show: (request: AlertRequest) => Effect.Effect<AlertAnswer, DeviceError>
}>

export class Alert extends Context.Service<Alert, AlertService>()('foldkit-native/Alert') {}

/** The part of React Native's `Alert` used here. */
export interface AlertModule {
  alert(title: string, message?: string, buttons?: any, options?: any): void
}

export const MAX_BUTTONS = 3
const OK_ID = 'ok'

export const live = (module: AlertModule): Layer.Layer<Alert> =>
  Layer.succeed(Alert, {
    show: request =>
      Effect.callback<AlertAnswer, DeviceError>(resume => {
        const buttons =
          request.buttons.length === 0 ? [{ id: OK_ID, label: 'OK' }] : request.buttons
        try {
          module.alert(
            request.title,
            request.message,
            buttons.map(button => ({
              text: button.label,
              style: 'style' in button ? button.style : undefined,
              onPress: () => resume(Effect.succeed({ _tag: 'Pressed', id: button.id })),
            })),
            // Android only, and only if the app made the alert cancelable:
            // a press outside it. Reported so the Command always ends.
            { onDismiss: () => resume(Effect.succeed({ _tag: 'Dismissed' })) },
          )
        } catch (error) {
          resume(Effect.fail(new DeviceError({ capability: 'alert', reason: reasonOf(error) })))
        }
      }),
  })

/**
 * A fake alert. `shown` holds each request. By default the first button is
 * pressed at once. `answerWith` picks another button id for the next alerts,
 * or `null` for closed without a button.
 */
export const makeTest = () => {
  const shown: Array<AlertRequest> = []
  let chosen: string | null | undefined
  const { failNext, guard } = makeFailure('alert')
  const layer = Layer.succeed(Alert, {
    show: request =>
      guard((): AlertAnswer => {
        shown.push(request)
        if (chosen === null) return { _tag: 'Dismissed' }
        return { _tag: 'Pressed', id: chosen ?? request.buttons[0]?.id ?? OK_ID }
      }),
  })
  return {
    layer,
    shown,
    failNext,
    answerWith: (id: string | null) => {
      chosen = id
    },
  }
}
