/**
 * The keyboard as a Foldkit Command (dismiss) and Subscription (shown, hidden).
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/keyboard.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema, Stream } from 'effect'
import { Command, Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { streamOf } from '../../host/device/common.js'
import { Keyboard } from '../../host/device/keyboard.js'

export * from '../../host/device/keyboard.js'

export const Message = defineMessageUnion({
  CompletedDismissKeyboard: {},
  /**
   * The keyboard is up, or changed height while up. `covers` is how much of
   * the app's window it covers: raise a composer by that, not by `height`.
   */
  ShownKeyboard: { height: Schema.Number, covers: Schema.Number },
  HidKeyboard: {},
})
export type Message = typeof Message.Type

/** Puts the keyboard away, as a tap outside the field does in other apps. */
export const Dismiss = Command.define('Keyboard.Dismiss', {
  messages: [Message.CompletedDismissKeyboard],
  execute: Keyboard.use(keyboard => keyboard.dismiss).pipe(
    Effect.as(Message.CompletedDismissKeyboard()),
  ),
})

/**
 * `HidKeyboard` or `ShownKeyboard` for the keyboard as it is when the
 * Subscription starts, then one for each change.
 */
export const changes: Stream.Stream<
  typeof Message.ShownKeyboard.Type | typeof Message.HidKeyboard.Type,
  never,
  Keyboard
> = Stream.unwrap(
  Keyboard.useSync(keyboard =>
    Stream.map(streamOf('keyboard', keyboard.frames), ({ height, covers }) =>
      height > 0 ? Message.ShownKeyboard({ height, covers }) : Message.HidKeyboard(),
    ),
  ),
)

/** `changes` as a Subscription entry that runs for the life of the program. */
export const changesEntry = <AppMessage>(
  toMessage: (
    message: typeof Message.ShownKeyboard.Type | typeof Message.HidKeyboard.Type,
  ) => AppMessage,
) => Subscription.persistentEntry(Stream.map(changes, toMessage))
