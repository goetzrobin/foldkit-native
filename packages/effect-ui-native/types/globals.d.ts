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
