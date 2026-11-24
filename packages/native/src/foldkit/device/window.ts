/**
 * Window size as a Foldkit Subscription.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/window.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { streamOf } from '../../host/device/common.js'
import { Window, orientationOf, Orientation } from '../../host/device/window.js'

export * from '../../host/device/window.js'

export const Message = defineMessageUnion({
  ChangedWindowSize: {
    width: Schema.Number,
    height: Schema.Number,
    orientation: Orientation,
  },
})
export type Message = typeof Message.Type

/** The size when the Subscription starts, then each change. */
export const changes: Stream.Stream<Message, never, Window> = Stream.unwrap(
  Window.useSync(window =>
    Stream.map(streamOf('window', window.sizes), size =>
      Message.ChangedWindowSize({ ...size, orientation: orientationOf(size) }),
    ),
  ),
)

export const changesEntry = <AppMessage>(toMessage: (message: Message) => AppMessage) =>
  Subscription.persistentEntry(Stream.map(changes, toMessage))
