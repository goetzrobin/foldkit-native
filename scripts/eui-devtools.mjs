#!/usr/bin/env node
// Starts Effect UI's dev tools server for an Effect UI app in this repo.
// Run it from the app's folder: `npm run devtools`.
//
// It starts two things on this Mac:
//
// 1. The dev tools server, from the vendored `@effect/ui-devtools` package,
//    on port 4774. It serves the page you open in a browser and the MCP
//    endpoint for coding agents. It listens on this Mac only (127.0.0.1) and
//    has no option to listen anywhere else.
//
// 2. A small relay on port 4775, which a phone on the same Wi-Fi can reach.
//    It passes on two kinds of connection and nothing else: an app's log
//    (`/log`) and an app's control line (`/control`). It does not pass on
//    the page or MCP, so nobody on the network can read what the tools hold.
//    The server refuses connections that name another machine as their
//    origin, and a phone's WebSocket always names one, so the relay takes
//    that line out.
//
// Options, after `--`:
//   --dispatch       lets a coding agent send Messages into the running app
//   --local          the relay listens on this Mac only: simulators can connect, phones cannot
//   --port <n>       the page's port (4774)
//   --phone-port <n> the relay's port (4775)
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PAGE_PORT = 4774
export const PHONE_PORT = 4775

/** The two paths an app connects to. Everything else stays on this Mac. */
const RELAYED = new Set(['/log', '/control'])
const MAX_HEAD = 16 * 1024

const refuse = (socket, status) => {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/**
 * Takes WebSocket connections for `/log` and `/control` on every network
 * address of this Mac and passes them to the dev tools server on 127.0.0.1.
 */
export const startRelay = ({ port = PHONE_PORT, to = PAGE_PORT, host = '0.0.0.0' } = {}) =>
  new Promise((resolve, reject) => {
    const open = new Set()
    const server = net.createServer(client => {
      open.add(client)
      client.on('close', () => open.delete(client))
      client.on('error', () => client.destroy())
      let head = Buffer.alloc(0)
      // A connection that never sends a request is closed.
      client.setTimeout(10_000, () => client.destroy())
      const onData = chunk => {
        head = Buffer.concat([head, chunk])
        const end = head.indexOf('\r\n\r\n')
        if (end < 0) {
          if (head.length > MAX_HEAD) refuse(client, '431 Request Header Fields Too Large')
          return
        }
        client.off('data', onData)
        client.setTimeout(0)
        const lines = head.subarray(0, end).toString('latin1').split('\r\n')
        const rest = head.subarray(end + 4)
        const [method, target] = (lines[0] ?? '').split(' ')
        const requestPath = (target ?? '').split('?')[0]
        const headers = lines.slice(1)
        const isUpgrade = headers.some(line => /^upgrade:\s*websocket\s*$/i.test(line))
        if (method !== 'GET' || !RELAYED.has(requestPath) || !isUpgrade) return refuse(client, '404 Not Found')
        // The server takes a connection with no origin as a local program.
        const passed = headers.filter(line => !/^(origin|host):/i.test(line))
        const upstream = net.connect(to, '127.0.0.1')
        open.add(upstream)
        upstream.on('close', () => {
          open.delete(upstream)
          client.destroy()
        })
        upstream.on('error', () => {
          // The dev tools server is not there: the app tries again later.
          if (!client.destroyed) refuse(client, '502 Bad Gateway')
          upstream.destroy()
        })
        client.on('close', () => upstream.destroy())
        upstream.on('connect', () => {
          upstream.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1:${to}\r\n${passed.join('\r\n')}\r\n\r\n`)
          if (rest.length > 0) upstream.write(rest)
          client.pipe(upstream)
          upstream.pipe(client)
        })
      }
      client.on('data', onData)
    })
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve({
        port: server.address().port,
        close: () =>
          new Promise(done => {
            for (const socket of open) socket.destroy()
            server.close(() => done())
          }),
      })
    })
  })

/** This Mac's addresses on its networks, such as 192.168.1.20. */
export const lanAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter(each => each !== undefined && each.family === 'IPv4' && !each.internal)
    .map(each => each.address)

/**
 * Starts the server and, unless `phone` is false, the relay. `from` is the
 * folder whose `node_modules` holds `@effect/ui-devtools`: the app's folder.
 */
export const start = async ({
  from = process.cwd(),
  port = PAGE_PORT,
  phonePort = PHONE_PORT,
  phone = true,
  dispatch = false,
  size,
  keep,
} = {}) => {
  const require = createRequire(path.join(from, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  let DevToolsServer
  try {
    ;({ DevToolsServer } = await load('@effect/ui-devtools/node'))
  } catch (error) {
    throw new Error(
      `Could not load the dev tools from ${from}. Run "npm install" in that folder first.\n(${error?.message ?? error})`,
    )
  }
  const [Effect, Exit, Layer, Scope] = await Promise.all(
    ['effect/Effect', 'effect/Exit', 'effect/Layer', 'effect/Scope'].map(load),
  )
  const scope = Effect.runSync(Scope.make())
  const stopServer = () => Effect.runPromise(Scope.close(scope, Exit.void))
  try {
    await Effect.runPromise(Layer.buildWithScope(DevToolsServer.layer({ port, dispatch, size, keep }), scope))
  } catch (error) {
    await stopServer()
    throw new Error(
      `Could not start the dev tools on port ${port}. Is another copy already running? Close it, or pass --port.\n(${error?.message ?? error})`,
    )
  }
  let relay
  {
    try {
      // Without phones, the relay is still there for simulators, on this Mac only.
      relay = await startRelay({ port: phonePort, to: port, host: phone ? '0.0.0.0' : '127.0.0.1' })
    } catch (error) {
      await stopServer()
      throw new Error(
        `Could not open port ${phonePort} for phones. Is another copy already running? Close it, or pass --phone-port.\n(${error?.message ?? error})`,
      )
    }
  }
  const url = DevToolsServer.url({ port })
  return {
    url,
    mcp: `${url}/mcp`,
    phonePort: relay.port,
    stop: async () => {
      await relay.close()
      await stopServer()
    },
  }
}

const main = async () => {
  const { values } = parseArgs({
    options: {
      dispatch: { type: 'boolean' },
      local: { type: 'boolean' },
      port: { type: 'string' },
      'phone-port': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help === true) {
    console.log('npm run devtools -- [--dispatch] [--local] [--port <n>] [--phone-port <n>]')
    return
  }
  const number = (value, fallback) => (value === undefined ? fallback : Number(value))
  const running = await start({
    dispatch: values.dispatch === true,
    phone: values.local !== true,
    port: number(values.port, PAGE_PORT),
    phonePort: number(values['phone-port'], PHONE_PORT),
  })
  const addresses = lanAddresses()
  console.log(
    [
      '',
      'Effect UI dev tools are running.',
      '',
      `  Open this page in a browser on this Mac:  ${running.url}`,
      `  For a coding agent (MCP):                 ${running.mcp}`,
      values.local === true
        ? `  Simulators on this Mac send to port ${running.phonePort}. Phones cannot connect (--local).`
        : `  Apps send to port ${running.phonePort} of this Mac` +
          (addresses.length === 0 ? '. This Mac is on no network, so only simulators can.' : ` (${addresses.join(', ')}).`),
      `  A coding agent ${values.dispatch === true ? 'can' : 'cannot'} send Messages into the app` +
        (values.dispatch === true ? '.' : ' (add -- --dispatch to allow it).'),
      '',
      'Now start the app, or reload it. Leave this window open. Press Control-C to stop.',
      '',
    ].join('\n'),
  )
  const stop = () => {
    running.stop().finally(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
