/**
 * Network status as a Foldkit Subscription: online or offline.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/network.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { streamOf } from '../../host/device/common.js'
import { Network, NetworkStatus } from '../../host/device/network.js'

export * from '../../host/device/network.js'

export const Message = defineMessageUnion({
  ChangedNetworkStatus: { status: NetworkStatus, connection: Schema.String },
})
export type Message = typeof Message.Type

/** The status when the Subscription starts, then each change. */
export const changes: Stream.Stream<Message, never, Network> = Stream.unwrap(
  Network.useSync(network =>
    Stream.map(streamOf('network', network.states), state =>
      Message.ChangedNetworkStatus(state),
    ),
  ),
)

export const changesEntry = <AppMessage>(toMessage: (message: Message) => AppMessage) =>
  Subscription.persistentEntry(Stream.map(changes, toMessage))
