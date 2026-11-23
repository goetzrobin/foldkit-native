/**
 * Where a program's Model waits while its code is being replaced.
 *
 * It lives on `globalThis` and not in this file's own variables. Metro's hot
 * update runs changed files again in the same JavaScript runtime, so a global
 * is still there afterwards. A full reload restarts the runtime and clears
 * it, which is what a full reload should do.
 *
 * Each program is known by its container's `id`. Every start of a program is
 * a numbered "run". A Model kept during one run can be claimed only by the
 * very next run, so a program that is started by hand a second time (the
 * tests do this) never picks up an old Model by accident.
 */

type Kept = {
  /** Gives the Model as plain data, encoded by the program's Model schema. */
  read: () => unknown
  /** The run that kept it. */
  run: number
}

type Store = {
  kept: Map<string, Kept>
  runs: Map<string, number>
  /** Work that writes out a Model still waiting in a timer. */
  flushes: Set<() => void>
  /** The running hot programs, by name. Owned by `hotReload.ts`. */
  sessions: Map<string, unknown>
}

const STORE_KEY = '__foldkitNativeDevLoop'

export const store = (): Store => {
  const host = globalThis as { [STORE_KEY]?: Store }
  host[STORE_KEY] ??= {
    kept: new Map(),
    runs: new Map(),
    flushes: new Set(),
    sessions: new Map(),
  }
  return host[STORE_KEY]
}

const currentRun = (id: string): number => store().runs.get(id) ?? 0

/** Keeps the latest Model of the program `id`. `read` is called only if the
 *  next run asks for it, so encoding costs nothing while the program runs. */
export const remember = (id: string, read: () => unknown): void => {
  store().kept.set(id, { read, run: currentRun(id) })
}

/** Registers work to do just before a program is replaced. Returns a
 *  function that removes it. */
export const onBeforeSwap = (flush: () => void): (() => void) => {
  store().flushes.add(flush)
  return () => {
    store().flushes.delete(flush)
  }
}

export const flushBeforeSwap = (): void => {
  for (const flush of [...store().flushes]) flush()
}

/** The old program has stopped: what it kept now belongs to the next run. */
export const beginNextRun = (id: string): void => {
  store().runs.set(id, currentRun(id) + 1)
}

/**
 * The Model the previous run kept, or `undefined` to start fresh. Claiming
 * moves it to the current run: if the new program never changes its Model,
 * the save after this one still finds it.
 */
export const claim = (id: string): unknown => {
  const kept = store().kept.get(id)
  if (kept === undefined || kept.run !== currentRun(id) - 1) return undefined
  kept.run = currentRun(id)
  try {
    return kept.read()
  } catch {
    // The old schema could not encode its own Model. Nothing to hand over.
    return undefined
  }
}

export const forget = (id: string): void => {
  store().kept.delete(id)
  store().runs.delete(id)
}
