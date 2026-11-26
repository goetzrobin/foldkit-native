// What test/devtools.test.ts uses from Node, declared by hand for the same
// reason as in globals.d.ts: with Node's own types on, names a phone does
// not have would compile everywhere in this package.
declare module 'node:net' {
  export interface AddressInfo {
    readonly port: number
  }
  export interface Socket {
    write(data: string): boolean
    destroy(): void
    on(event: 'connect' | 'close', listener: () => void): this
    on(event: 'data', listener: (chunk: { toString(encoding: string): string }) => void): this
    on(event: 'error', listener: (error: unknown) => void): this
  }
  export interface Server {
    once(event: 'error', listener: (error: unknown) => void): this
    listen(port: number, host: string, listening: () => void): this
    address(): AddressInfo | string | null
    close(closed?: () => void): this
  }
  export function createServer(): Server
  export function connect(port: number, host: string): Socket
  const net: { createServer: typeof createServer; connect: typeof connect }
  export default net
}
