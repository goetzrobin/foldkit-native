/**
 * An action sheet: the phone's own list of choices, asked for from `update`
 * like an alert. The choice comes back as a Message.
 *
 *   // app entry: nothing to import, the native modules are found by name
 *   const resources = ActionSheet.live()
 *
 *   // update
 *   PressedShare: () => ({
 *     model,
 *     commands: [
 *       Command.mapMessage(
 *         ActionSheet.Show({
 *           title: 'Share this note',
 *           items: [
 *             { key: 'copy', title: 'Copy link' },
 *             { key: 'delete', title: 'Delete', isDestructive: true },
 *           ],
 *         }),
 *         message => Message.GotSheetMessage({ message }),
 *       ),
 *     ],
 *   })
 *   // later: SelectedActionSheetItem({ key: 'copy' }) or DismissedActionSheet()
 *
 * iOS shows its action sheet, with a Cancel button. Android has no action
 * sheet, so it shows a dialog with the same list: a press outside it closes
 * it. A disabled entry is greyed out on iOS and left out on Android. See
 * `sheet.ts` for how both are reached.
 */
import { Context, Effect, Layer, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError, makeFailure, reasonOf } from '../device/common.js'
import { type SheetAnswer, type SheetRequest, presentSheet } from './sheet.js'

export const ActionSheetItem = Schema.Struct({
  /** Comes back in `SelectedActionSheetItem`. */
  key: Schema.String,
  title: Schema.String,
  isDestructive: Schema.optional(Schema.Boolean),
  isDisabled: Schema.optional(Schema.Boolean),
})
export type ActionSheetItem = typeof ActionSheetItem.Type

export type ActionSheetRequest = Readonly<{
  title?: string | undefined
  message?: string | undefined
  items: ReadonlyArray<ActionSheetItem>
  cancelLabel?: string | undefined
}>

export type ActionSheetService = Readonly<{
  /** Shows the sheet and waits for the answer. */
  show: (request: ActionSheetRequest) => Effect.Effect<SheetAnswer, DeviceError>
}>

export class ActionSheet extends Context.Service<ActionSheet, ActionSheetService>()(
  'foldkit-native/ActionSheet',
) {}

const CAPABILITY = 'action sheet'

/** The real thing. `present` is replaced in tests of this file only. */
export const live = (
  present: (request: SheetRequest, done: (answer: SheetAnswer) => void) => void = presentSheet,
): Layer.Layer<ActionSheet> =>
  Layer.succeed(ActionSheet, {
    show: request =>
      Effect.callback<SheetAnswer, DeviceError>(resume => {
        try {
          present(
            {
              title: request.title,
              message: request.message,
              options: request.items,
              cancelLabel: request.cancelLabel,
            },
            answer => resume(Effect.succeed(answer)),
          )
        } catch (error) {
          resume(Effect.fail(new DeviceError({ capability: CAPABILITY, reason: reasonOf(error) })))
        }
      }),
  })

/**
 * A fake action sheet. `shown` holds each request. By default the first
 * entry is chosen at once. `answerWith` picks another key for the next
 * sheets, or `null` for closed without a choice.
 */
export const makeTest = () => {
  const shown: Array<ActionSheetRequest> = []
  let chosen: string | null | undefined
  const { failNext, guard } = makeFailure(CAPABILITY)
  const layer = Layer.succeed(ActionSheet, {
    show: request =>
      guard((): SheetAnswer => {
        shown.push(request)
        const key = chosen === undefined ? request.items[0]?.key : chosen
        return key === null || key === undefined ? { _tag: 'Dismissed' } : { _tag: 'Selected', key }
      }),
  })
  return {
    layer,
    shown,
    failNext,
    answerWith: (key: string | null) => {
      chosen = key
    },
  }
}

export const Message = defineMessageUnion({
  SelectedActionSheetItem: { key: Schema.String },
  /** Closed without a choice: Cancel on iOS, a press outside on Android. */
  DismissedActionSheet: {},
  FailedShowActionSheet: { reason: Schema.String },
})
export type Message = typeof Message.Type

/** Shows an action sheet. Its result Message arrives when the user answers. */
export const Show = Command.define('ActionSheet.Show', {
  args: {
    title: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
    items: Schema.Array(ActionSheetItem),
    cancelLabel: Schema.optional(Schema.String),
  },
  messages: [
    Message.SelectedActionSheetItem,
    Message.DismissedActionSheet,
    Message.FailedShowActionSheet,
  ],
  execute: request =>
    (request.items.length === 0
      ? Effect.fail(
          new DeviceError({ capability: CAPABILITY, reason: 'An action sheet needs at least one entry' }),
        )
      : ActionSheet.use(sheet => sheet.show(request))
    ).pipe(
      Effect.map(answer =>
        answer._tag === 'Selected'
          ? Message.SelectedActionSheetItem({ key: answer.key })
          : Message.DismissedActionSheet(),
      ),
      Effect.catch(error => Effect.succeed(Message.FailedShowActionSheet({ reason: error.reason }))),
    ),
})
