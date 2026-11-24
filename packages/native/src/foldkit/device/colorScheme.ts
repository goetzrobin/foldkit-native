/**
 * Color scheme as a Foldkit Subscription: light or dark.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/colorScheme.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Stream } from 'effect'
import { Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { streamOf } from '../../host/device/common.js'
import { ColorScheme, Scheme } from '../../host/device/colorScheme.js'

export * from '../../host/device/colorScheme.js'

export const Message = defineMessageUnion({
  ChangedColorScheme: { scheme: Scheme },
})
export type Message = typeof Message.Type

/** The scheme when the Subscription starts, then each change. */
export const changes: Stream.Stream<Message, never, ColorScheme> = Stream.unwrap(
  ColorScheme.useSync(colorScheme =>
    Stream.map(streamOf('color scheme', colorScheme.schemes), scheme =>
      Message.ChangedColorScheme({ scheme }),
    ),
  ),
)

export const changesEntry = <AppMessage>(toMessage: (message: Message) => AppMessage) =>
  Subscription.persistentEntry(Stream.map(changes, toMessage))
