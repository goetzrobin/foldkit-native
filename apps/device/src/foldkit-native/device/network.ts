/**
 * Whether the phone is online.
 *
 *   // app entry
 *   import * as ExpoNetwork from 'expo-network'
 *   const resources = Network.live(ExpoNetwork)
 *
 *   // subscriptions
 *   network: Network.changesEntry(message => Message.GotNetworkMessage({ message })),
 *
 * `online` means the phone has a connection and has not found the internet
 * unreachable. It is the phone's best guess: a Wi-Fi network that needs a
 * sign-in page can read as online. Treat a failed request as the real
 * answer.
 */
import { Context, Layer, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import {
  type NativeSubscription,
  type Source,
  makeTestSource,
  streamOf,
} from './common'

export const NetworkStatus = Schema.Literals(['online', 'offline'])
export type NetworkStatus = typeof NetworkStatus.Type

export type NetworkState = Readonly<{
  status: NetworkStatus
  /** `wifi`, `cellular`, `none`, `unknown` and so on, in lower case. */
  connection: string
}>

export type NetworkService = Readonly<{ states: Source<NetworkState> }>

export class Network extends Context.Service<Network, NetworkService>()(
  'foldkit-native/Network',
) {}

type NativeNetworkState = Readonly<{
  type?: string | undefined
  isConnected?: boolean | undefined
  isInternetReachable?: boolean | undefined
}>

/** The part of `expo-network` used here. */
export interface NetworkModule {
  getNetworkStateAsync(): Promise<NativeNetworkState>
  addNetworkStateListener(listener: (state: any) => void): NativeSubscription
}

const read = (state: NativeNetworkState): NetworkState => ({
  // "Reachable" is undefined until the phone has found out, which is not a no.
  status:
    state.isConnected === true && state.isInternetReachable !== false ? 'online' : 'offline',
  connection: (state.type ?? 'unknown').toLowerCase(),
})

export const live = (module: NetworkModule): Layer.Layer<Network> =>
  Layer.succeed(Network, {
    states: {
      subscribe: listener => {
        let isListening = true
        let hasChanged = false
        const subscription = module.addNetworkStateListener((state: NativeNetworkState) => {
          hasChanged = true
          listener(read(state))
        })
        // The state now. Dropped if a change arrived first: that is newer.
        module.getNetworkStateAsync().then(
          state => {
            if (isListening && !hasChanged) listener(read(state))
          },
          () => {},
        )
        return () => {
          isListening = false
          subscription.remove()
        }
      },
    },
  })

/** A fake. `set('offline')` is the phone losing its connection. */
export const makeTest = (initial: NetworkStatus = 'online') => {
  const toState = (status: NetworkStatus, connection?: string): NetworkState => ({
    status,
    connection: connection ?? (status === 'online' ? 'wifi' : 'none'),
  })
  const states = makeTestSource<NetworkState>(toState(initial))
  return {
    layer: Layer.succeed(Network, { states: states.source }),
    set: (status: NetworkStatus, connection?: string) => states.emit(toState(status, connection)),
    listenerCount: states.listenerCount,
  }
}

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
