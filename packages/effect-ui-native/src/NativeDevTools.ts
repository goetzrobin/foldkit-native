/**
 * Effect UI's dev tools for an app on a phone. Development builds only.
 *
 *   // the app's entry file
 *   if (__DEV__) {
 *     const NativeDevTools = require('./native/effect-ui-native/src/NativeDevTools')
 *     const server = NativeDevTools.serverFromBundle(scriptURL)
 *     if (server !== undefined) devTools = NativeDevTools.layer({ server })
 *   }
 *
 * Effect UI keeps a log of everything a running app does: every Message,
 * what it changed, every Command and how it ended. The dev tools server on
 * the developer's Mac (`npm run devtools` in the app's folder) shows that
 * log on a page in a browser, and offers it to coding agents over MCP.
 *
 * This Layer sends the app's log to that server over a WebSocket, as Effect
 * UI's own `MessageLog.socket` does it. A phone has no web page, so it uses
 * the same route as a terminal app (`DevToolsHeadless` in
 * `@effect/ui-devtools`), with React Native's global `WebSocket`.
 *
 * It opens a second WebSocket too, which the server's page of a web app
 * would open: the control line. Over it the server can ask for the JSON
 * Schema of a component's Messages and send Messages into the running app
 * (the `get_message_schema` and `dispatch` tools). Showing the app as it was
 * at an earlier entry is not possible: Effect UI does that by painting a
 * copy of a web page, and it has no such call for another host.
 *
 * If the server is not running, the app runs as it always does. Each line
 * tries again after 0.2, 0.4, 0.8 seconds and so on, and then every ten
 * seconds. Nothing is shown on screen.
 *
 * This file is not in the package's index. An app loads it by its path,
 * inside `if (__DEV__)`, so a release build leaves it out.
 */
import * as MessageLog from '@effect/ui/MessageLog'
import type * as Renderer from '@effect/ui/Renderer'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'

import { Roots } from './internal/roots.js'

/** The port `npm run devtools` takes the phone's two lines on. The page and MCP are on 4774. */
export const PHONE_PORT = 4775

/** A WebSocket class, as a browser and React Native have it. */
export type WebSocketClass = new (url: string, protocols?: string | Array<string>) => Socket.WebSocketLike

export type Options = Readonly<{
  /** Where the dev tools server takes a phone's lines, such as `http://192.168.1.20:4775`. */
  server: string
  /** The WebSocket to use. The global one if left out. */
  WebSocket?: WebSocketClass
  /** How many entries are kept to send again when the server connects late. 1,000 if left out. */
  size?: number
  /** `false` leaves out the control line: the server can read the app and not send to it. */
  control?: boolean
}>

/**
 * The dev tools address for the Mac this app loaded its code from.
 *
 * A development build loads its JavaScript from Metro on the Mac, and React
 * Native keeps the address it used (`SourceCode.scriptURL`). The dev tools
 * server runs on the same Mac, so its address is that host with the dev
 * tools port. A release build loads its code from a file, and this answers
 * `undefined`.
 */
export const serverFromBundle = (scriptUrl: string | null | undefined, port: number = PHONE_PORT): string | undefined => {
  const match = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/.exec(scriptUrl ?? '')
  return match === null ? undefined : `http://${match[1]}:${port}`
}

/** `http://host:4775` and `/log` as `ws://host:4775/log`. */
export const socketUrl = (server: string, path: string): string =>
  server.replace(/^http/, 'ws').replace(/\/+$/, '') + path

// THE CONTROL LINE
//
// The shapes below are `@effect/ui-devtools`' own (`src/internal/control.ts`
// at c73e7ce). That file is not exported, so they are written out here.

type Request =
  | { readonly _tag: 'Show'; readonly session: string; readonly seq: number }
  | { readonly _tag: 'Resume' }
  | { readonly _tag: 'MessageSchema'; readonly session: string; readonly instance: number; readonly tag?: string }
  | {
      readonly _tag: 'Dispatch'
      readonly session: string
      readonly instance: number
      readonly messages: ReadonlyArray<unknown>
      readonly within: number
    }

type Outcome =
  | { readonly _tag: 'Updated'; readonly seq: number }
  | { readonly _tag: 'Failed'; readonly seq: number }
  | { readonly _tag: 'Ignored'; readonly reason: string }
  | { readonly _tag: 'Unknown' }

/**
 * What a mounted tree can do besides what `Renderer.Root` says. Effect UI's
 * web host uses the same two functions for its dev tools. They are there on
 * every root, and not in the public type.
 */
type ControlledRoot = Renderer.Root<unknown, unknown> & {
  readonly find?: (instance: number) => ControlledInstance | undefined
  readonly dispatch?: (instance: ControlledInstance, message: unknown) => Effect.Effect<Outcome>
}
type ControlledInstance = { readonly component: { readonly definition: { readonly message: Schema.Top } } }

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

const NO_TIME_TRAVEL =
  'A phone app cannot be shown at an earlier entry. Time travel paints a copy of a web page, and a phone has none. Read the entry with get_state and diff_state.'

/** The `_tag` a member of a Message's JSON Schema stands for. */
const tagOf = (schema: unknown, definitions: Json): unknown => {
  const resolved =
    isObject(schema) && typeof schema['$ref'] === 'string'
      ? definitions[schema['$ref'].slice(schema['$ref'].lastIndexOf('/') + 1)]
      : schema
  const tag = isObject(resolved) && isObject(resolved['properties']) ? resolved['properties']['_tag'] : undefined
  if (!isObject(tag)) return undefined
  const options = tag['enum']
  return tag['const'] ?? (Array.isArray(options) && options.length === 1 ? options[0] : undefined)
}

const messageSchema = (schema: Schema.Top, tag: string | undefined): Effect.Effect<unknown, string> =>
  Effect.suspend(() => {
    const document = Schema.toJsonSchemaDocument(Schema.toCodecJson(schema)) as unknown as {
      readonly schema: unknown
      readonly definitions: Json
    }
    if (tag === undefined) return Effect.succeed({ schema: document.schema, definitions: document.definitions })
    const root = document.schema
    const members = isObject(root) && Array.isArray(root['anyOf']) ? (root['anyOf'] as ReadonlyArray<unknown>) : [root]
    const member = members.find(each => tagOf(each, document.definitions) === tag)
    if (member !== undefined) return Effect.succeed({ schema: member, definitions: document.definitions })
    const tags = members.map(each => tagOf(each, document.definitions)).filter(each => typeof each === 'string')
    return Effect.fail(`No message _tag ${tag}. The tags are ${tags.join(', ')}.`)
  })

/** Answers one request of the server, for the trees mounted now. */
export const makeHandler =
  (roots: ReadonlyMap<string, ControlledRoot>) =>
  (request: Request): Effect.Effect<unknown, string> => {
    const target = (session: string, instance: number) =>
      Effect.suspend(() => {
        const root = roots.get(session)
        if (root === undefined || root.find === undefined || root.dispatch === undefined) {
          return Effect.fail(`Session ${session} is not on screen in this app.`)
        }
        const found = root.find(instance)
        return found === undefined
          ? Effect.fail(`Instance ${instance} is not mounted in session ${session}.`)
          : Effect.succeed({ found, dispatch: root.dispatch })
      })
    switch (request._tag) {
      case 'Show':
        return Effect.fail(NO_TIME_TRAVEL)
      case 'Resume':
        // Nothing is ever paused here, so the live app is what is on screen.
        return Effect.succeed(null)
      case 'MessageSchema':
        return Effect.flatMap(target(request.session, request.instance), ({ found }) =>
          messageSchema(found.component.definition.message, request.tag),
        )
      case 'Dispatch':
        return Effect.gen(function* () {
          const { found, dispatch } = yield* target(request.session, request.instance)
          const decode = Schema.decodeUnknownEffect(
            Schema.toCodecJson(found.component.definition.message as Schema.Codec<unknown>),
          )
          // Every message is checked before the first one is sent.
          const messages = yield* Effect.forEach(request.messages, (message, index) =>
            Effect.mapError(decode(message), error => `Message ${index} does not decode: ${error.message}`),
          )
          const deadline = Date.now() + request.within
          const outcomes: Array<Outcome> = []
          for (const message of messages) {
            const left = deadline - Date.now()
            if (left <= 0) break
            const outcome = yield* dispatch(found, message).pipe(
              Effect.timeoutOrElse({ duration: left, orElse: () => Effect.succeed<Outcome>({ _tag: 'Unknown' }) }),
            )
            outcomes.push(outcome)
            if (outcome._tag !== 'Updated') break
          }
          return { outcomes, paused: null }
        })
    }
  }

const parseRequest = (text: string): { readonly id: number; readonly request: Request } | undefined => {
  try {
    const value: unknown = JSON.parse(text)
    if (!isObject(value) || typeof value['id'] !== 'number' || !isObject(value['request'])) return undefined
    const tag = value['request']['_tag']
    return tag === 'Show' || tag === 'Resume' || tag === 'MessageSchema' || tag === 'Dispatch'
      ? { id: value['id'], request: value['request'] as Request }
      : undefined
  } catch {
    return undefined
  }
}

/** The control line: says which trees are mounted, and answers the server's requests. */
const control = (url: string): Effect.Effect<Roots, never, Socket.WebSocketConstructor | import('effect/Scope').Scope> =>
  Effect.gen(function* () {
    const mounted = new Map<string, ControlledRoot>()
    const changes = yield* Queue.sliding<void>(1)
    const handle = makeHandler(mounted)

    const connection = Effect.gen(function* () {
      const socket = yield* Socket.makeWebSocket(url)
      const writer = yield* socket.writer
      // Text frames arrive as strings. `Socket.readerString` is not used: it
      // needs `TextDecoder`, which the phone's JavaScript engine may not have.
      const reader = yield* socket.reader
      const send = (message: unknown) => writer.write(JSON.stringify(message))
      const state = Effect.suspend(() => send({ _tag: 'State', sessions: [...mounted.keys()], paused: null }))
      yield* state
      yield* Effect.forkScoped(Effect.ignore(Effect.forever(Effect.andThen(Queue.take(changes), state))))
      return yield* Effect.forever(
        Effect.flatMap(reader.pull, chunks =>
          Effect.forEach(
            chunks,
            chunk => {
              const asked = typeof chunk === 'string' ? parseRequest(chunk) : undefined
              if (asked === undefined) return Effect.void
              return handle(asked.request).pipe(
                Effect.matchEffect({
                  onSuccess: value => send({ _tag: 'Reply', id: asked.id, ok: true, value }),
                  onFailure: value => send({ _tag: 'Reply', id: asked.id, ok: false, value }),
                }),
                Effect.ignore,
                Effect.forkScoped,
              )
            },
            { discard: true },
          ),
        ),
      )
    }).pipe(Effect.scoped)

    yield* connection.pipe(
      Effect.retry(Schedule.min([Schedule.exponential('200 millis'), Schedule.spaced('10 seconds')])),
      Effect.forever,
      Effect.ignore,
      Effect.forkScoped,
    )

    return {
      register: root => {
        const session = root.session
        mounted.set(session, root as ControlledRoot)
        Queue.offerUnsafe(changes, undefined)
        return () => {
          if (mounted.get(session) === root) mounted.delete(session)
          Queue.offerUnsafe(changes, undefined)
        }
      },
    }
  })

/**
 * Sends the app's message log to the dev tools server, and takes the
 * server's requests. Provide it to the app's mount. Development only.
 */
export const layer = (options: Options): Layer.Layer<never> => {
  const WebSocketGlobal = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketClass }).WebSocket
  // A JavaScript engine with no WebSocket: the app runs with no dev tools.
  if (WebSocketGlobal === undefined) return Layer.empty
  const constructor = Layer.succeed(Socket.WebSocketConstructor)(
    (url, protocols) =>
      new WebSocketGlobal(url, typeof protocols === 'string' || Array.isArray(protocols) ? protocols : undefined),
  )
  const log = MessageLog.socket(socketUrl(options.server, '/log'), {
    // Effect UI has no name for a phone yet. "terminal" is its name for a host with no web page.
    host: 'terminal',
    buffer: options.size,
  })
  const lines =
    options.control === false
      ? log
      : Layer.merge(
          log,
          Layer.effectContext(
            Effect.map(control(socketUrl(options.server, '/control')), roots => Context.make(Roots, roots)),
          ) as Layer.Layer<never, never, Socket.WebSocketConstructor>,
        )
  return lines.pipe(Layer.provide(constructor))
}
