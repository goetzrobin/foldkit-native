// The few globals the phone's JavaScript engine (Hermes) and Node both have.
// Declared by hand so that no browser type can slip into this package: with
// the DOM library on, `document` would compile and then fail on the phone.
declare function setTimeout(run: () => void, ms?: number): number
declare function clearTimeout(timer: number | undefined): void
declare function setInterval(run: () => void, ms?: number): number
declare function clearInterval(timer: number | undefined): void
declare function queueMicrotask(run: () => void): void
declare const performance: { now(): number }
declare const console: {
  log(...values: ReadonlyArray<unknown>): void
  warn(...values: ReadonlyArray<unknown>): void
  error(...values: ReadonlyArray<unknown>): void
}
// Tests read two environment variables.
declare const process: { env: Record<string, string | undefined> }
declare module 'node:fs' {
  export function appendFileSync(path: string, text: string): void
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string, options: { recursive: true }): Array<string>
}
// The pretend chat server's cable (host/aiChat/transport.ts) names it for a
// case NDJSON never takes: a message encoded as bytes.
declare class TextDecoder {
  decode(bytes: unknown): string
}
