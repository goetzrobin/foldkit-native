/**
 * Effect UI's dev tools with an app on the simulated phone, end to end.
 *
 * Each test starts the real dev tools server (the vendored
 * `@effect/ui-devtools`, through `scripts/eui-devtools.mjs`, as
 * `npm run devtools` does) on ports of its own, mounts an app with
 * `NativeDevTools.layer`, and stops the server before it ends. The app
 * sends its log over a real WebSocket: Node's global one, which has the
 * shape of React Native's.
 *
 * What the server holds is read the way a coding agent reads it: through
 * its MCP endpoint, over HTTP.
 */
import net from 'node:net'

import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { start as startDevTools, startRelay } from '../../../scripts/eui-devtools.mjs'
import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../playground/app.js'
import { playgroundCrash, playgroundServices } from '../playground/start.js'
import * as NativeDevTools from '../src/NativeDevTools.js'
import { Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { provideForTest, run } from './support.js'

vi.setConfig({ testTimeout: 30000 })

/** This package's folder: where the tests run, and where `@effect/ui-devtools` is installed. */
const PACKAGE = (process as unknown as { cwd: () => string }).cwd()

// Node has both, as a phone does. This package's types name neither on purpose (see types/globals.d.ts).
type Answer = { readonly status: number; readonly headers: { get(name: string): string | null }; text(): Promise<string> }
type Line = {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  close(): void
}
const { fetch, WebSocket } = globalThis as unknown as {
  fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Answer>
  WebSocket: new (url: string, protocols?: string | Array<string>) => Line
}

/** A port nothing listens on right now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })

type Running = Awaited<ReturnType<typeof startDevTools>>
let stops: Array<() => Promise<void>> = []

const startServer = async (options: { port?: number; phonePort?: number; dispatch?: boolean } = {}): Promise<Running> => {
  const running = await startDevTools({
    from: PACKAGE,
    port: options.port ?? (await freePort()),
    phonePort: options.phonePort ?? (await freePort()),
    dispatch: options.dispatch ?? false,
    // This Mac only: a test opens no port to the network.
    phone: false,
  })
  stops.push(running.stop)
  return running
}

/** An MCP client, as small as it can be: one session, tools called by name. */
const connectAgent = async (mcp: string) => {
  let id = 0
  let session: string | undefined
  const post = async (body: object): Promise<any> => {
    const response = await fetch(mcp, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session === undefined ? {} : { 'mcp-session-id': session }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...body }),
    })
    session ??= response.headers.get('mcp-session-id') ?? undefined
    const text = await response.text()
    return text === '' ? undefined : JSON.parse(text)
  }
  await post({
    id: ++id,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'devtools.test', version: '0' } },
  })
  await post({ method: 'notifications/initialized' })
  return {
    /** The tool's answer, or the error text it gave. */
    call: async (name: string, args: object = {}): Promise<{ ok: boolean; value: any; text: string }> => {
      const reply = await post({ id: ++id, method: 'tools/call', params: { name, arguments: args } })
      const text: string = reply?.result?.content?.[0]?.text ?? JSON.stringify(reply)
      const isError = reply?.result?.isError !== false
      return { ok: !isError, value: isError ? undefined : reply.result.structuredContent?.result, text }
    },
  }
}

const turn = (ms: number) => Effect.promise(() => new Promise<void>(resolve => setTimeout(() => resolve(), ms)))

/** Waits until `ready` answers something, or fails with what was being waited for. */
const eventually = <A>(what: string, ready: () => Promise<A | undefined>, ms = 5000) =>
  Effect.promise(async () => {
    const deadline = Date.now() + ms
    for (;;) {
      const value = await ready()
      if (value !== undefined) return value
      if (Date.now() > deadline) throw new Error(`Waited ${ms} ms for ${what}`)
      await new Promise<void>(resolve => setTimeout(() => resolve(), 25))
    }
  })

type Options = Readonly<{ server: string; WebSocket?: NativeDevTools.WebSocketClass; crash?: boolean }>

/** The playground on the simulated phone, sending its log to `server`. */
const startApp = (options: Options) =>
  Effect.gen(function* () {
    registerNavigation()
    const device = Phone.Device.makeTest()
    const layer = Layer.mergeAll(
      Layer.provideMerge(playgroundServices(device.layer, { serverDelayMs: 20 }), device.layer),
      NativeDevTools.layer({
        server: options.server,
        ...(options.WebSocket === undefined ? {} : { WebSocket: options.WebSocket }),
      }),
    )
    const app = yield* NativeTest.mount(
      App,
      { platform: 'ios', hasReadout: false },
      options.crash === true ? { crash: playgroundCrash } : {},
    ).pipe(provideForTest(layer as Layer.Layer<any>))
    return { app, device }
  })

/** The newest connected session, once the server has it. */
const sessionOf = (agent: Awaited<ReturnType<typeof connectAgent>>) =>
  eventually('a connected session', async () => {
    const sessions = (await agent.call('list_sessions')).value as Array<any>
    return sessions.find(each => each.connected === true && each.controllable === true)
  })

const instanceOf = async (agent: Awaited<ReturnType<typeof connectAgent>>, component: string) => {
  const instances = (await agent.call('list_instances')).value as Array<any>
  return instances.find(each => String(each.path).includes(component) && each.unmounted === undefined)
}

beforeEach(() => {
  stops = []
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const stop of stops.reverse()) await stop()
})

describe('the address', () => {
  it('is the host the app loaded its code from, with the dev tools port', () => {
    const from = NativeDevTools.serverFromBundle
    expect(from('http://192.168.1.20:8081/index.bundle?platform=ios&dev=true&minify=false')).toBe('http://192.168.1.20:4775')
    expect(from('http://localhost:8081/index.bundle?platform=ios')).toBe('http://localhost:4775')
    expect(from('http://10.0.2.2:8081/index.bundle?platform=android')).toBe('http://10.0.2.2:4775')
    expect(from('http://[fe80::1]:8081/index.bundle')).toBe('http://[fe80::1]:4775')
    expect(from('https://my-mac.local:8081/index.bundle')).toBe('http://my-mac.local:4775')
    expect(from('http://192.168.1.20:8081/index.bundle', 5000)).toBe('http://192.168.1.20:5000')
    // A release build loads its code from a file in the app: no dev tools.
    expect(from('file:///var/containers/Bundle/Application/1/EffectChat.app/main.jsbundle')).toBeUndefined()
    expect(from(undefined)).toBeUndefined()
    expect(from(null)).toBeUndefined()
    expect(NativeDevTools.socketUrl('http://192.168.1.20:4775', '/log')).toBe('ws://192.168.1.20:4775/log')
    expect(NativeDevTools.socketUrl('https://host:4775/', '/control')).toBe('wss://host:4775/control')
  })
})

describe('the dev tools server and an app on the simulated phone', () => {
  it('holds the session, the instances, the entries and an instance state', () =>
    run(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => startServer())
        const agent = yield* Effect.promise(() => connectAgent(server.mcp))
        const { app } = yield* startApp({ server: `http://127.0.0.1:${server.phonePort}` })
        yield* app.press('menu-Counter')
        yield* app.press('counter-plus')
        yield* app.press('counter-plus')
        yield* app.press('counter-minus')
        yield* app.press('counter-plus')
        expect(app.text('counter-count')).toBe('2')

        const session = yield* sessionOf(agent)
        expect(session.app).toBe('App')
        expect(session.host).toBe('terminal')
        expect(session.session).toBe(app.root.session)

        // The instances: the app, and the counter on its screen.
        const counter = yield* eventually('the counter', () => instanceOf(agent, 'Counter'))
        const instances = (yield* Effect.promise(() => agent.call('list_instances'))).value as Array<any>
        expect(instances.map(each => each.path)[0]).toBe('/App')
        expect(counter.path).toMatch(/^\/App\/Counter\[/)

        // The entries: one per Message, in order.
        const rows = yield* eventually('four counter entries', async () => {
          const listed = (await agent.call('list_entries', { instance: counter.instance, filter: 'messages' })).value
          const updates = (listed.rows as Array<any>).filter(row => row.tag === 'Update')
          return updates.length >= 4 ? updates : undefined
        })
        expect(rows.map((row: any) => row.label)).toEqual([
          'PressedIncrement',
          'PressedIncrement',
          'PressedDecrement',
          'PressedIncrement',
        ])
        const counts = (yield* Effect.promise(() => agent.call('count_entries', { instance: counter.instance }))).value
        expect(JSON.stringify(counts)).toContain('PressedIncrement')

        // The state now, and at the second press.
        const now = (yield* Effect.promise(() => agent.call('get_state', { instance: counter.instance }))).value
        expect(now.model).toEqual({ count: 2 })
        const then = (yield* Effect.promise(() => agent.call('get_state', { instance: counter.instance, at: rows[1].seq })))
          .value
        expect(then.model).toEqual({ count: 2 })
        const first = (yield* Effect.promise(() => agent.call('get_state', { instance: counter.instance, at: rows[0].seq })))
          .value
        expect(first.model).toEqual({ count: 1 })
        // What the third press changed.
        const diff = (yield* Effect.promise(() => agent.call('diff_state', { seq: rows[2].seq }))).value
        expect(JSON.stringify(diff.changes)).toContain('count')
        // One entry in full, and what caused it.
        const entry = (yield* Effect.promise(() => agent.call('get_entry', { seq: rows[0].seq }))).value
        expect(JSON.stringify(entry)).toContain('PressedIncrement')
        const chain = yield* Effect.promise(() => agent.call('get_chain', { seq: rows[0].seq }))
        expect(chain.ok).toBe(true)
      }),
    ))

  it('serves the page for a browser, and the page gets the app log', () =>
    run(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => startServer())
        const { app } = yield* startApp({ server: `http://127.0.0.1:${server.phonePort}` })
        yield* app.press('menu-Counter')
        yield* app.press('counter-plus')

        const page = yield* Effect.promise(() => fetch(server.url))
        expect(page.status).toBe(200)
        expect(yield* Effect.promise(() => page.text())).toContain('<title>Effect UI DevTools</title>')

        // The page reads the log from `/watch`. Read it as the page does.
        const frames: Array<any> = []
        const socket = new WebSocket(server.url.replace('http', 'ws') + '/watch')
        socket.addEventListener('message', event => frames.push(JSON.parse(String(event.data))))
        yield* eventually('the press on the page', async () =>
          frames.some(frame => frame._tag === 'Update' && JSON.stringify(frame).includes('PressedIncrement')) ? true : undefined,
        )
        socket.close()
        expect(frames.some(frame => frame._tag === 'SessionStarted' && frame.app === 'App')).toBe(true)
        expect(frames.some(frame => frame._tag === 'Mounted' && String(frame.path).startsWith('/App/Counter'))).toBe(true)
      }),
    ))

  it('dispatch sends Messages into the running app, and a wrong Message changes nothing', () =>
    run(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => startServer({ dispatch: true }))
        const agent = yield* Effect.promise(() => connectAgent(server.mcp))
        const { app } = yield* startApp({ server: `http://127.0.0.1:${server.phonePort}` })
        yield* app.press('menu-Counter')
        yield* app.press('counter-plus')
        yield* sessionOf(agent)
        const counter = yield* eventually('the counter', () => instanceOf(agent, 'Counter'))

        // What the counter can be told.
        const schema = yield* Effect.promise(() => agent.call('get_message_schema', { instance: counter.instance }))
        expect(schema.ok).toBe(true)
        expect(schema.text).toContain('PressedIncrement')
        expect(schema.text).toContain('PressedReset')
        const one = yield* Effect.promise(() =>
          agent.call('get_message_schema', { instance: counter.instance, tag: 'PressedReset' }),
        )
        expect(one.text).toContain('PressedReset')
        expect(one.text).not.toContain('PressedIncrement')

        const sent = yield* Effect.promise(() =>
          agent.call('dispatch', {
            instance: counter.instance,
            messages: [{ _tag: 'PressedIncrement' }, { _tag: 'PressedIncrement' }],
          }),
        )
        expect(sent.ok).toBe(true)
        expect(sent.value.applied).toBe(2)
        yield* app.settle
        // The phone's screen shows it: the Messages ran in the app itself.
        expect(app.text('counter-count')).toBe('3')

        const wrong = yield* Effect.promise(() =>
          agent.call('dispatch', { instance: counter.instance, messages: [{ _tag: 'PressedIncrement' }, { _tag: 'Nonsense' }] }),
        )
        expect(wrong.ok).toBe(false)
        expect(wrong.text).toContain('Message 1 does not decode')
        yield* app.settle
        expect(app.text('counter-count')).toBe('3')
      }),
    ))

  it('dispatch is refused unless the server was started with it', () =>
    run(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => startServer())
        const agent = yield* Effect.promise(() => connectAgent(server.mcp))
        const { app } = yield* startApp({ server: `http://127.0.0.1:${server.phonePort}` })
        yield* app.press('menu-Counter')
        yield* sessionOf(agent)
        const counter = yield* eventually('the counter', () => instanceOf(agent, 'Counter'))
        const sent = yield* Effect.promise(() =>
          agent.call('dispatch', { instance: counter.instance, messages: [{ _tag: 'PressedIncrement' }] }),
        )
        expect(sent.ok).toBe(false)
        expect(sent.text).toContain('Dispatch is off')
        yield* app.settle
        expect(app.text('counter-count')).toBe('0')
      }),
    ))

  it('time travel says plainly that a phone app cannot be shown at an earlier entry', () =>
    run(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => startServer())
        const agent = yield* Effect.promise(() => connectAgent(server.mcp))
        const { app } = yield* startApp({ server: `http://127.0.0.1:${server.phonePort}` })
        yield* app.press('menu-Counter')
        yield* app.press('counter-plus')
        const session = yield* sessionOf(agent)
        const shown = yield* Effect.promise(() => agent.call('show_entry', { seq: session.last ?? session.first }))
        expect(shown.ok).toBe(false)
        expect(shown.text).toContain('A phone app cannot be shown at an earlier entry')
        // Nothing is paused, and the app is as it was.
        expect((yield* Effect.promise(() => agent.call('resume'))).ok).toBe(true)
        expect(app.text('counter-count')).toBe('1')
        yield* app.press('counter-plus')
        expect(app.text('counter-count')).toBe('2')
      }),
    ))

  it('a crash is in the log, and the app that starts again is a new session', () =>
    run(
      Effect.gen(function* () {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const server = yield* Effect.promise(() => startServer())
        const agent = yield* Effect.promise(() => connectAgent(server.mcp))
        const { app } = yield* startApp({ server: `http://127.0.0.1:${server.phonePort}`, crash: true })
        const first = yield* sessionOf(agent)
        yield* app.press('menu-Phone')
        yield* app.press('crash-update')
        yield* turn(50)
        expect(app.has('crash-screen')).toBe(true)

        const failed = yield* eventually('the failure', async () => {
          const counted = await agent.call('count_entries', { session: first.session })
          return JSON.stringify(counted.value).includes('Failed') ? counted.value : undefined
        })
        expect(JSON.stringify(failed)).toContain('Failed')

        yield* app.press('crash-restart')
        yield* turn(50)
        expect(app.has('menu')).toBe(true)
        const second = yield* eventually('the new session', async () => {
          const sessions = (await agent.call('list_sessions')).value as Array<any>
          return sessions.find(each => each.session === app.root.session && each.controllable === true)
        })
        expect(second.session).not.toBe(first.session)
        // The crash screen is not in anybody's log.
        const all = (yield* Effect.promise(() => agent.call('list_sessions'))).value as Array<any>
        expect(all).toHaveLength(2)
      }),
    ))
})

describe('with no server running', () => {
  /** A WebSocket class that counts how often the app tries to connect. */
  const counting = () => {
    const tries: Array<string> = []
    class Counted extends WebSocket {
      constructor(url: string, protocols?: string | Array<string>) {
        tries.push(url)
        super(url, protocols)
      }
    }
    return { tries, Counted: Counted as unknown as NativeDevTools.WebSocketClass }
  }

  it('the app starts and works, says nothing as an error, and tries again only a few times', () =>
    run(
      Effect.gen(function* () {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
        const port = yield* Effect.promise(() => freePort())
        const { tries, Counted } = counting()
        const { app } = yield* startApp({ server: `http://127.0.0.1:${port}`, WebSocket: Counted })
        yield* app.press('menu-Counter')
        yield* app.press('counter-plus')
        expect(app.text('counter-count')).toBe('1')
        expect(app.has('crash-screen')).toBe(false)

        yield* turn(2500)
        yield* app.press('counter-plus')
        expect(app.text('counter-count')).toBe('2')
        // Two lines, each at 0, 0.2, 0.6 and 1.4 seconds, and next at 3.
        expect(tries.filter(url => url.endsWith('/log')).length).toBeGreaterThanOrEqual(1)
        expect(tries.filter(url => url.endsWith('/log')).length).toBeLessThanOrEqual(5)
        expect(tries.filter(url => url.endsWith('/control')).length).toBeLessThanOrEqual(5)
        expect(errors).not.toHaveBeenCalled()
        // One line in the console for the lost log, and none per try.
        const lines = logged.mock.calls.map(call => call.join(' ')).filter(line => line.includes('MessageLog'))
        expect(lines.length).toBeLessThanOrEqual(1)
      }),
    ))

  it('a server started later gets what the app did before', () =>
    run(
      Effect.gen(function* () {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const port = yield* Effect.promise(() => freePort())
        const phonePort = yield* Effect.promise(() => freePort())
        const { app } = yield* startApp({ server: `http://127.0.0.1:${phonePort}` })
        yield* app.press('menu-Counter')
        yield* app.press('counter-plus')
        yield* app.press('counter-plus')
        yield* turn(300)

        const server = yield* Effect.promise(() => startServer({ port, phonePort }))
        const agent = yield* Effect.promise(() => connectAgent(server.mcp))
        const session = yield* sessionOf(agent)
        expect(session.session).toBe(app.root.session)
        const counter = yield* eventually('the counter', () => instanceOf(agent, 'Counter'))
        const state = (yield* Effect.promise(() => agent.call('get_state', { instance: counter.instance }))).value
        expect(state.model).toEqual({ count: 2 })
      }),
    ))
})

describe('the relay a phone connects to', () => {
  /** Opens a WebSocket by hand, so the test can name an origin as a phone's WebSocket does. */
  const handshake = (port: number, requestPath: string, origin?: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1')
      let answer = ''
      socket.on('connect', () => {
        socket.write(
          [
            `GET ${requestPath} HTTP/1.1`,
            `Host: 192.168.1.20:${port}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version: 13',
            ...(origin === undefined ? [] : [`Origin: ${origin}`]),
            '',
            '',
          ].join('\r\n'),
        )
      })
      socket.on('data', chunk => {
        answer += chunk.toString('latin1')
        if (answer.includes('\r\n\r\n')) {
          socket.destroy()
          resolve(answer.split('\r\n')[0] ?? '')
        }
      })
      socket.on('error', reject)
      socket.on('close', () => resolve(answer.split('\r\n')[0] ?? ''))
    })

  it('passes on an app log and control line, with the origin a phone names, and nothing else', () =>
    run(
      Effect.gen(function* () {
        const server = yield* Effect.promise(() => startServer())
        const pagePort = Number(server.url.slice(server.url.lastIndexOf(':') + 1))
        const relayPort = server.phonePort
        const phoneOrigin = `http://192.168.1.20:${relayPort}`

        // The server itself refuses a connection that names another machine.
        expect(yield* Effect.promise(() => handshake(pagePort, '/log', phoneOrigin))).toContain('403')
        // Through the relay the same connection is taken.
        expect(yield* Effect.promise(() => handshake(relayPort, '/log', phoneOrigin))).toContain('101')
        expect(yield* Effect.promise(() => handshake(relayPort, '/control', phoneOrigin))).toContain('101')

        // The page, MCP and the page's own feed stay on this Mac.
        expect(yield* Effect.promise(() => handshake(relayPort, '/watch', phoneOrigin))).toContain('404')
        expect((yield* Effect.promise(() => fetch(`http://127.0.0.1:${relayPort}/`))).status).toBe(404)
        const mcp = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${relayPort}/mcp`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
        )
        expect(mcp.status).toBe(404)
        expect((yield* Effect.promise(() => fetch(`http://127.0.0.1:${relayPort}/log`))).status).toBe(404)
      }),
    ))

  it('answers 502 when the dev tools server behind it is gone', () =>
    run(
      Effect.gen(function* () {
        const nowhere = yield* Effect.promise(() => freePort())
        const relay = yield* Effect.promise(async () => startRelay({ port: await freePort(), to: nowhere, host: '127.0.0.1' }))
        stops.push(relay.close)
        expect(yield* Effect.promise(() => handshake(relay.port, '/log'))).toContain('502')
      }),
    ))
})
