/**
 * Running code on the UI thread, and values both threads can use.
 *
 *   runOnUi(worklet, ...args)       starts a worklet on the UI thread
 *   runOnUiSync(worklet, ...args)   the same, and waits for its answer
 *   const x = shared(0)             a value kept on the UI thread
 *   readShared(x), writeShared(x, 5)   from the JavaScript thread
 *   x.value                         inside a worklet
 *
 * None of these throws. Where the UI thread cannot be reached they answer
 * "no" with the reason, and a shared value is an ordinary box, so a program
 * written for worklets still runs, only on one thread.
 */
import { type Check, type Shareable, workletsPackage, uiRuntimeCheck } from './host.js'
import { type SharedHost, decorateShared } from './ui.js'

declare const sharedBrand: unique symbol

/**
 * A value kept on the UI thread. In a worklet use `.value`. On the
 * JavaScript thread use `readShared` and `writeShared`: `.value` is not
 * there.
 */
export type Shared<T> = SharedHost<T> & { readonly [sharedBrand]: T }

type Marked = { __workletHash?: unknown }

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]!.trim()

/**
 * Whether the app's build rewrote this function as a worklet. It did not if
 * the Babel plugin is off, or the function lacks its `'worklet'` line.
 */
export const isCompiledWorklet = (worklet: unknown): boolean =>
  typeof worklet === 'function' && (worklet as Marked).__workletHash !== undefined

let needsCompiled = true

/**
 * Tests run worklets as the ordinary functions they are, against a stand-in
 * for the UI thread, so they turn this check off.
 */
export const requireCompiledWorklets = (isRequired: boolean): void => {
  needsCompiled = isRequired
}

const NOT_COMPILED = "the app's build did not turn this function into a worklet (is the Babel plugin on?)"

/** Whether `worklet` can be sent to the UI thread in this build, and why not. */
export const workletCheck = (worklet: unknown): Check => ready(worklet)

const ready = (worklet: unknown): Check => {
  const runtime = uiRuntimeCheck()
  if (!runtime.ok) return runtime
  if (needsCompiled && !isCompiledWorklet(worklet)) return { ok: false, reason: NOT_COMPILED }
  return runtime
}

/** Starts `worklet` on the UI thread a moment from now. Answers whether it could. */
export const runOnUi = <Args extends Array<any>>(
  worklet: (...args: Args) => unknown,
  ...args: Args
): Check => {
  const check = ready(worklet)
  if (!check.ok) return check
  try {
    workletsPackage()!.scheduleOnUI(worklet, ...args)
    return check
  } catch (error) {
    return { ok: false, reason: `the UI thread refused it (${messageOf(error)})` }
  }
}

export type UiResult<Result> =
  | Readonly<{ ok: true; value: Result }>
  | Readonly<{ ok: false; reason: string }>

/**
 * Runs `worklet` on the UI thread and waits for what it returns. The
 * JavaScript thread stands still meanwhile, so keep it for small questions.
 */
export const runOnUiSync = <Args extends Array<any>, Result>(
  worklet: (...args: Args) => Result,
  ...args: Args
): UiResult<Result> => {
  const check = ready(worklet)
  if (!check.ok) return { ok: false, reason: check.reason }
  try {
    return { ok: true, value: workletsPackage()!.runOnUISync(worklet, ...args) }
  } catch (error) {
    return { ok: false, reason: `the UI thread refused it (${messageOf(error)})` }
  }
}

/** A stand-in for where there is no UI thread: one box, one thread. */
const localShared = <T>(initial: T): Shareable<T> => {
  const box = decorateShared({ value: initial } as SharedHost<T>) as SharedHost<T> & Shareable<T>
  box.getSync = () => box.value
  box.setAsync = value => {
    box.value = value
  }
  return box
}

/**
 * Makes a value that lives on the UI thread. Make it once, outside the view
 * and outside the Model: it is a live thing, not data.
 */
export const shared = <T>(initial: T): Shared<T> => {
  const pkg = ready(decorateShared).ok ? workletsPackage() : null
  if (pkg !== null) {
    try {
      return pkg.createShareable(pkg.UIRuntimeId, initial, {
        hostDecorator: decorateShared,
      }) as unknown as Shared<T>
    } catch {
      // Falls through to the stand-in.
    }
  }
  return localShared(initial) as unknown as Shared<T>
}

/** The value now, read from the JavaScript thread. It waits for the UI thread. */
export const readShared = <T>(value: Shared<T>): T => {
  const guest = value as unknown as Shareable<T>
  return typeof guest.getSync === 'function' ? guest.getSync() : guest.value
}

/** Sets the value from the JavaScript thread. It arrives a moment later. */
export const writeShared = <T>(value: Shared<T>, next: T): void => {
  const guest = value as unknown as Shareable<T>
  if (typeof guest.setAsync === 'function') guest.setAsync(next)
  else guest.value = next
}
