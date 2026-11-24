/**
 * The transport: how the client's requests reach the server and the answers
 * come back.
 *
 * In a real app this is the network: HTTP or a WebSocket. Here the server
 * runs inside the app, so the transport is a pretend cable between two ends
 * of the same program. It is still a real cable in one way that matters:
 * every request and every answer is written out as text, one line of JSON
 * per message (NDJSON, as a real server streams it), and read back on the
 * other side. A value that does not survive being written as JSON breaks
 * here, in the demo and the tests, and not first on a real server.
 *
 * The client uses Effect's own RPC client and the server Effect's own RPC
 * server. Only the cable between them is ours.
 *
 * REPLACING IT WITH A REAL NETWORK. Swap `layerInProcess(server)` for
 * a Layer that builds the same `AiChatRpcClient` over Effect's HTTP or
 * socket protocol, and delete the server from the app:
 *
 *   Layer.effect(AiChatRpcClient, RpcClient.make(AiChatRpcs)).pipe(
 *     Layer.provide(RpcClient.layerProtocolHttp({ url: 'https://api.example.com/rpc' })),
 *     Layer.provide(RpcSerialization.layerNdjson),
 *     Layer.provide(FetchHttpClient.layer),
 *   )
 *
 * Nothing else changes: the client, the atoms and the screens only know
 * `AiChatRpcClient`. Three things need work on the phone. React Native's
 * `fetch` does not stream a response body, so a streamed reply over HTTP
 * would arrive all at once at the end; use a WebSocket
 * (`RpcClient.layerProtocolSocket`) or a fetch that streams, such as
 * react-native-nitro-fetch in a prebuilt app. The server side becomes
 * `RpcServer.layerHttp` (or the WebSocket form) on a real server with the
 * same `AiChatRpcs` and real handlers. And the "drop the connection" chaos
 * switch has nothing to cut: a real network does that by itself.
 */
import { Context, Effect, Layer, Queue } from 'effect'
import * as RpcClient from 'effect/rpc/RpcClient'
import { RpcClientDefect, RpcClientError } from 'effect/rpc/RpcClientError'
import type { FromClientEncoded, FromServerEncoded } from 'effect/rpc/RpcMessage'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import type * as RpcGroup from 'effect/rpc/RpcGroup'

import type { AiServer } from './server.js'
import { AiChatRpcs } from './wire.js'

/** The RPC client, one method per request in `wire.ts`. */
export type AiChatRpcClientService = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof AiChatRpcs>,
  RpcClientError
>

/** What the client side of the app asks for. A real network would provide the same. */
export class AiChatRpcClient extends Context.Service<AiChatRpcClient, AiChatRpcClientService>()(
  'foldkit-native/AiChatRpcClient',
) {}

export type LinkStats = Readonly<{
  /** Lines of JSON from the client to the server. */
  linesUp: number
  /** Lines of JSON from the server to the client. */
  linesDown: number
  bytesUp: number
  bytesDown: number
  /** Times the connection was cut. */
  drops: number
}>

export type InProcessLink = Readonly<{
  clientProtocol: Layer.Layer<RpcClient.Protocol>
  serverProtocol: Layer.Layer<RpcServer.Protocol>
  /**
   * Cuts the connection, as a dead network would. Every request in flight
   * fails on the client with an `RpcClientError`, and the server is told the
   * client went away. The next request opens a new connection.
   */
  drop: Effect.Effect<void>
  stats: () => LinkStats
  /** The last lines that crossed, newest last, with their direction. */
  recentLines: () => ReadonlyArray<Readonly<{ direction: 'up' | 'down'; line: string }>>
}>

const RECENT_LINES_KEPT = 200

export const makeInProcessLink = (
  options: Readonly<{ serialization?: RpcSerialization.RpcSerialization['Service'] }> = {},
): InProcessLink => {
  const serialization = options.serialization ?? RpcSerialization.ndjson
  // Each side reads with its own parser, as two ends of a cable would.
  const readOnServer = serialization.makeUnsafe()
  const readOnClient = serialization.makeUnsafe()
  const writer = serialization.makeUnsafe()

  let writeRequest: ((connection: number, message: FromClientEncoded) => Effect.Effect<void>) | undefined
  let writeResponse: ((clientId: number, message: FromServerEncoded) => Effect.Effect<void>) | undefined
  let disconnects: Queue.Queue<number> | undefined

  // A connection number for each client. Cutting the cable gives the client
  // a new number, so the server never mixes the old connection with the new.
  const connectionOf = new Map<number, number>()
  const clientOf = new Map<number, number>()
  let nextConnection = 1

  const stats = { linesUp: 0, linesDown: 0, bytesUp: 0, bytesDown: 0, drops: 0 }
  const recent: Array<{ direction: 'up' | 'down'; line: string }> = []

  const remember = (direction: 'up' | 'down', line: string) => {
    recent.push({ direction, line })
    if (recent.length > RECENT_LINES_KEPT) recent.splice(0, recent.length - RECENT_LINES_KEPT)
  }

  /** Writes a message as text. Returns nothing for an empty batch. */
  const asText = (message: unknown): string | undefined => {
    const encoded = writer.encode(message)
    if (encoded === undefined) return undefined
    return typeof encoded === 'string' ? encoded : new TextDecoder().decode(encoded)
  }

  const connectionFor = (clientId: number): number => {
    const known = connectionOf.get(clientId)
    if (known !== undefined) return known
    const connection = nextConnection++
    connectionOf.set(clientId, connection)
    clientOf.set(connection, clientId)
    return connection
  }

  const up = (clientId: number, message: FromClientEncoded): Effect.Effect<void, RpcClientError> =>
    Effect.suspend(() => {
      const line = asText(message)
      if (line === undefined) return Effect.void
      if (writeRequest === undefined) {
        return Effect.fail(
          new RpcClientError({
            reason: new RpcClientDefect({ message: 'The in-app server is not running', cause: null }),
          }),
        )
      }
      stats.linesUp += 1
      stats.bytesUp += line.length
      remember('up', line)
      const deliver = writeRequest
      const connection = connectionFor(clientId)
      const messages = readOnServer.decode(line) as ReadonlyArray<FromClientEncoded>
      return Effect.forEach(messages, each => deliver(connection, each), { discard: true })
    })

  const down = (connection: number, message: FromServerEncoded): Effect.Effect<void> =>
    Effect.suspend(() => {
      const clientId = clientOf.get(connection)
      // An answer on a cut connection is lost, as on a real network.
      if (clientId === undefined || writeResponse === undefined) return Effect.void
      const line = asText(message)
      if (line === undefined) return Effect.void
      stats.linesDown += 1
      stats.bytesDown += line.length
      remember('down', line)
      const deliver = writeResponse
      const messages = readOnClient.decode(line) as ReadonlyArray<FromServerEncoded>
      return Effect.forEach(messages, each => deliver(clientId, each), { discard: true })
    })

  const drop: Effect.Effect<void> = Effect.suspend(() => {
    const cut = [...connectionOf.entries()]
    connectionOf.clear()
    clientOf.clear()
    stats.drops += 1
    const deliver = writeResponse
    return Effect.forEach(
      cut,
      ([clientId, connection]) =>
        Effect.gen(function* () {
          if (disconnects !== undefined) yield* Queue.offer(disconnects, connection)
          if (deliver !== undefined) {
            yield* deliver(clientId, {
              _tag: 'ClientProtocolError',
              error: new RpcClientError({
                reason: new RpcClientDefect({ message: 'The connection was lost', cause: null }),
              }),
            })
          }
        }),
      { discard: true },
    )
  })

  const serverProtocol = Layer.effect(
    RpcServer.Protocol,
    RpcServer.Protocol.make(write =>
      Effect.gen(function* () {
        writeRequest = write
        const queue = yield* Queue.unbounded<number>()
        disconnects = queue
        return {
          disconnects: queue,
          send: (connection, response) => down(connection, response),
          end: () => Effect.void,
          clientIds: Effect.sync(() => new Set(clientOf.keys())),
          initialMessage: Effect.succeedNone,
          // Like a socket: the client says when it has taken each piece of a
          // stream, so a slow reader slows the writer down.
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: false,
          supportsNotifications: false,
          codecFor: serialization.codecFor,
        }
      }),
    ),
  )

  const clientProtocol = Layer.effect(
    RpcClient.Protocol,
    RpcClient.Protocol.make(write =>
      Effect.sync(() => {
        writeResponse = write
        return {
          send: (clientId, request) => up(clientId, request),
          supportsAck: true,
          supportsTransferables: false,
          codecFor: serialization.codecFor,
        }
      }),
    ),
  )

  return {
    clientProtocol,
    serverProtocol,
    drop,
    stats: () => ({ ...stats }),
    recentLines: () => recent,
  }
}

/**
 * The client, connected to `server` by an in-process cable. This is the one
 * line to change for a real network: see the top of this file.
 */
export const layerInProcess = (
  server: AiServer,
  link: InProcessLink = makeInProcessLink(),
): Layer.Layer<AiChatRpcClient> => {
  server.attachConnection(link.drop)
  const serverLayer = RpcServer.layer(AiChatRpcs).pipe(
    Layer.provide(server.handlers),
    Layer.provide(link.serverProtocol),
  )
  const clientLayer = Layer.effect(AiChatRpcClient, RpcClient.make(AiChatRpcs)).pipe(
    Layer.provide(link.clientProtocol),
  )
  return Layer.merge(clientLayer, serverLayer)
}
