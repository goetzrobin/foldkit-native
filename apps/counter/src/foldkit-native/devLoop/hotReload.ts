/**
 * Runs a Foldkit program so that saving a file swaps in the new code and
 * redraws with the same Model.
 *
 * In the app's entry file, at the top level:
 *
 *   const program = hotProgram({
 *     module,
 *     make: container => makeDemo(container, env),
 *   })
 *   AppRegistry.registerRunnable('main', ({ rootTag }) => {
 *     program.run(createNativeSurface(getFabricUIManager(), Number(rootTag)))
 *   })
 *
 * How it works with Metro. When a file is saved, Metro runs that file again,
 * then each file that imports it, upwards, until it reaches a file that
 * called `module.hot.accept()`. If none did, it reloads the whole app.
 * `hotProgram` calls `accept` on the entry file's `module`, so the walk stops
 * there. The entry file has then just run again, so `hotProgram` is called a
 * second time, now with a `make` that builds the new code. It finds the
 * program still running from the first call, stops it, and starts the new
 * one in the same place on screen.
 *
 * That is why `hotProgram` must be called at the top level and not inside
 * the `registerRunnable` callback: the phone calls that callback once, so
 * code inside it never sees the new `make`.
 *
 * The Model crosses over through `store.ts`, filled by Foldkit itself when
 * it has the preservation transport, or by `keepModel` when it does not.
 *
 * In a release build `module.hot` is undefined. Then this only starts the
 * program, as `Runtime.embed` does.
 */
import { Runtime } from 'foldkit'

import { connectFoldkitTransport } from './foldkitTransport'
import { beginNextRun, flushBeforeSwap, forget, store } from './store'

/** The part of Metro's `module` this needs. */
export type HotModule = Readonly<{
  hot?: Readonly<{ accept: (callback?: () => void) => void }>
}>

/** What `Runtime.makeElement` returns, for a program that takes no Flags. */
type Program<Resources> = Runtime.MakeRuntimeReturn<any, void, Resources, any>

/** Builds the program for a container. Called again after every hot update. */
export type ProgramFactory<Resources = never> = (container: HTMLElement) => Program<Resources>

export type HotProgramOptions<Resources = never> = Readonly<{
  /** The entry file's own `module`. Leave it out to run without Metro. */
  module?: HotModule
  make: ProgramFactory<Resources>
  /** Names the program. Only needed when one app runs two hot programs. */
  name?: string
}>

export type HotProgram<Resources = never> = Readonly<{
  /** Starts the program on a surface from `createNativeSurface`. */
  run: (surface: Readonly<{ container: HTMLElement }>) => void
  /**
   * Replaces the running program with one from `make`, keeping the Model.
   * Metro's hot update ends up here. Resolves when the new program has been
   * started.
   */
  swap: (make: ProgramFactory<Resources>) => Promise<void>
  /** Stops the program and forgets its Model. */
  dispose: () => Promise<void>
}>

type Session = {
  // Every factory fits here: the session only calls it and embeds the result.
  make: ProgramFactory<any>
  container: HTMLElement | undefined
  handle: Readonly<{ disposeAsync: () => Promise<void> }> | undefined
  /** Swaps wait for each other here. It never rejects. */
  queue: Promise<void>
  isSwapping: boolean
}

const start = (session: Session): void => {
  if (session.container === undefined) return
  session.handle = Runtime.embed(session.make(session.container))
}

/** Stops the running program, then starts `session.make` again, on
 *  `nextContainer` when the phone gave a new surface. */
const restart = (session: Session, nextContainer?: HTMLElement): Promise<void> => {
  session.queue = session.queue.then(async () => {
    session.isSwapping = true
    try {
      const { handle, container } = session
      if (handle !== undefined) {
        // A Model changed in the last moment may still sit in a timer.
        flushBeforeSwap()
        session.handle = undefined
        // Foldkit asks that the old program has fully stopped before another
        // is started in the same container.
        await handle.disposeAsync()
        if (container !== undefined) beginNextRun(container.id)
      }
      if (nextContainer !== undefined) session.container = nextContainer
      start(session)
    } catch (error) {
      // The new code is broken. Leave the screen empty and say why: the next
      // save tries again.
      console.error('[foldkit-native] Hot reload could not start the program:', error)
    } finally {
      session.isSwapping = false
    }
  })
  return session.queue
}

export const hotProgram = <Resources = never>(
  options: HotProgramOptions<Resources>,
): HotProgram<Resources> => {
  const { make, name = 'app' } = options
  const hot = options.module?.hot
  const sessions = store().sessions as Map<string, Session>

  const running = hot === undefined ? undefined : sessions.get(name)
  const session: Session = running ?? {
    make,
    container: undefined,
    handle: undefined,
    queue: Promise.resolve(),
    isSwapping: false,
  }

  if (hot !== undefined) {
    hot.accept()
    connectFoldkitTransport()
    sessions.set(name, session)
  }

  const swap = (next: ProgramFactory<Resources>): Promise<void> => {
    session.make = next
    return session.container === undefined ? session.queue : restart(session)
  }

  // This file ran again after a hot update: the program from the earlier run
  // is still on screen.
  if (running !== undefined) void swap(make)

  return {
    run: surface => {
      // After a `dispose` the program may be run again.
      if (hot !== undefined) sessions.set(name, session)
      const isFirst = session.handle === undefined && !session.isSwapping
      if (isFirst) {
        // Started in the same turn the phone asked for it, as the first draw
        // needs, and so a broken program fails loudly at startup.
        forget(surface.container.id)
        session.container = surface.container
        start(session)
        return
      }
      // The phone handed over a new surface while a program was running.
      void restart(session, surface.container)
    },
    swap,
    dispose: () => {
      session.queue = session.queue.then(async () => {
        const { handle, container } = session
        session.handle = undefined
        session.container = undefined
        if (sessions.get(name) === session) sessions.delete(name)
        if (handle !== undefined) await handle.disposeAsync().catch(() => {})
        if (container !== undefined) forget(container.id)
      })
      return session.queue
    },
  }
}
