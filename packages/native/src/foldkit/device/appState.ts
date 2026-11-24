/**
 * App state as a Foldkit Subscription: active, background or inactive.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/appState.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Stream } from 'effect'
import { Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { streamOf } from '../../host/device/common.js'
import { AppState, AppStatus } from '../../host/device/appState.js'

export * from '../../host/device/appState.js'

export const Message = defineMessageUnion({
  ChangedAppState: { status: AppStatus },
})
export type Message = typeof Message.Type

/** The status when the Subscription starts, then each change. */
export const changes: Stream.Stream<Message, never, AppState> = Stream.unwrap(
  AppState.useSync(appState =>
    Stream.map(streamOf('app state', appState.statuses), status =>
      Message.ChangedAppState({ status }),
    ),
  ),
)

export const changesEntry = <AppMessage>(toMessage: (message: Message) => AppMessage) =>
  Subscription.persistentEntry(Stream.map(changes, toMessage))
