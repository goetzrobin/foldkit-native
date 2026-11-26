/**
 * A stand-in for the phone's UI thread, for tests.
 *
 * On a phone, `react-native-worklets` runs worklets on a second JavaScript
 * engine, Reanimated's native code lets them change views, and
 * gesture-handler's native code sends them a finger's movement. Here there
 * is one engine and no native code, so this file plays all three and records
 * what was asked of them:
 *
 * - A scheduled worklet waits in a queue until the test calls `flushUi()`.
 * - `frame()` moves the UI thread's clock on and runs what asked for a frame.
 * - While a worklet runs, the global holds what the UI engine's global holds
 *   on a phone (`requestAnimationFrame`, `_updateProps`, `_measure`). They
 *   are taken away again afterwards, so code that reaches for them on the
 *   JavaScript thread fails, as the rest of the tests expect.
 * - A shared value read with `.value` outside a worklet throws: on a phone
 *   it is simply not there.
 * - What a worklet sends back waits until `flushUi()` or `frame()` is done,
 *   as it would for the JavaScript thread on a phone.
 *
 * See `src/worklets/host.ts` for the real things.
 */
import type { WorkletsOptions, WorkletsPackage } from '../../src/host/worklets/index.js'

export type FakeWorkletsOptions = Readonly<{
  /** Whether the build has Reanimated's native code. Default true. */
  reanimated?: boolean
  /** Whether the build has gesture-handler's native code. Default true. */
  gestures?: boolean
}>

type ViewHandle = { reactTag?: number }
type EventHandler = Readonly<{ id: number; name: string; tag: number; run: (ms: number, event: unknown) => void }>

const UI_GLOBALS = [
  '__RUNTIME_KIND',
  '__workletsModuleProxy',
  '__serializer',
  'requestAnimationFrame',
  '_updateProps',
  '_measure',
  '_maybeFlushUIUpdatesQueue',
] as const

const JS_GLOBALS = ['__workletsModuleProxy', '__reanimatedModuleProxy', '_RNGH_MODULE_ID'] as const

export const makeWorklets = (options: FakeWorkletsOptions = {}) => {
  const host = globalThis as unknown as Record<string, unknown>
  const holder = { runtime: 'ui' }
  const scheduler = { scheduler: 'ui' }

  let isOnUi = false
  let nowMs = 0
  let isReanimatedStarted = false
  let nextEventId = 1
  const jobs: Array<() => void> = []
  let frames: Array<(ms: number) => void> = []
  const toJavaScript: Array<() => void> = []
  const eventHandlers: Array<EventHandler> = []

  /** Every style a worklet put on a view, oldest first. */
  const updates: Array<Readonly<{ tag: number; style: Record<string, unknown> }>> = []
  /** The style each view has now from the UI thread, by the view's number. */
  const styles = new Map<number, Record<string, unknown>>()
  let flushes = 0
  /** What gesture-handler's module was asked to do, oldest first. */
  const gestureCalls: Array<ReadonlyArray<unknown>> = []
  const removable: Array<unknown> = []
  let reanimatedStarts = 0

  const uiGlobal = (): Record<string, unknown> => ({
    __RUNTIME_KIND: 2,
    __workletsModuleProxy: {
      scheduleOnRN: (run: (...args: Array<unknown>) => void, args: Array<unknown> | undefined) => {
        toJavaScript.push(() => run(...(args ?? [])))
      },
    },
    __serializer: (value: unknown) => value,
    requestAnimationFrame: (run: (ms: number) => void) => frames.push(run),
    ...(isReanimatedStarted
      ? {
          _updateProps: (operations: ReadonlyArray<{ shadowNodeWrapper: ViewHandle; updates: object }>) => {
            for (const { shadowNodeWrapper, updates: style } of operations) {
              const tag = shadowNodeWrapper.reactTag ?? -1
              updates.push({ tag, style: { ...style } })
              styles.set(tag, { ...styles.get(tag), ...style })
            }
          },
          _maybeFlushUIUpdatesQueue: () => {
            flushes += 1
          },
          _measure: (node: ViewHandle) => {
            const style = styles.get(node.reactTag ?? -1) ?? {}
            const size = (name: string): number =>
              typeof style[name] === 'number' ? (style[name] as number) : 0
            return { x: 0, y: 0, width: size('width'), height: size('height'), pageX: 0, pageY: 0 }
          },
        }
      : {}),
  })

  /** Runs `run` with the UI engine's global in place. */
  const asUi = <Result>(run: () => Result): Result => {
    if (isOnUi) return run()
    const before = UI_GLOBALS.map(name => [name, name in host, host[name]] as const)
    const ui = uiGlobal()
    for (const name of UI_GLOBALS) {
      if (name in ui) host[name] = ui[name]
      else delete host[name]
    }
    isOnUi = true
    try {
      return run()
    } finally {
      isOnUi = false
      for (const [name, had, value] of before) {
        if (had) host[name] = value
        else delete host[name]
      }
    }
  }

  const deliver = (): void => {
    for (const job of toJavaScript.splice(0)) job()
  }

  const pkg: WorkletsPackage = {
    scheduleOnUI: (worklet, ...args) => {
      jobs.push(() => worklet(...args))
    },
    runOnUISync: (worklet, ...args) => asUi(() => worklet(...args)),
    createShareable: (_hostRuntimeId, initial, config) => {
      const box = { value: initial } as Record<string | symbol, unknown>
      asUi(() => config?.hostDecorator?.(box))
      const guard = (name: string | symbol): void => {
        if (!isOnUi) {
          throw new Error(
            `A shared value's ${String(name)} was used on the JavaScript thread. Use readShared or writeShared there.`,
          )
        }
      }
      return new Proxy(box, {
        get: (target, name) => {
          if (name === 'getSync') return () => asUi(() => target['value'])
          if (name === 'setAsync') {
            return (value: unknown) => {
              jobs.push(() => {
                target['value'] = value
              })
            }
          }
          guard(name)
          return target[name]
        },
        set: (target, name, value) => {
          guard(name)
          target[name] = value
          return true
        },
      }) as never
    },
    createSerializable: value => value,
    getUIRuntimeHolder: () => holder,
    getUISchedulerHolder: () => scheduler,
    UIRuntimeId: 2,
  }

  const proxy = {
    registerEventHandler: (handler: unknown, name: string, tag: number): number => {
      const id = nextEventId++
      eventHandlers.push({ id, name, tag, run: handler as EventHandler['run'] })
      return id
    },
    unregisterEventHandler: (id: number): void => {
      const at = eventHandlers.findIndex(handler => handler.id === id)
      if (at >= 0) eventHandlers.splice(at, 1)
    },
    markNodeAsRemovable: (node: unknown): void => {
      removable.push(node)
    },
  }

  const modules: Record<string, unknown> = {
    ...(options.reanimated === false
      ? {}
      : {
          ReanimatedModule: {
            installTurboModule: (): boolean => {
              // Reanimated's native code reads the UI engine from these two.
              if (host['__UI_WORKLET_RUNTIME_HOLDER'] !== holder) return false
              if (host['__UI_SCHEDULER_HOLDER'] !== scheduler) return false
              reanimatedStarts += 1
              isReanimatedStarted = true
              host['__reanimatedModuleProxy'] = proxy
              return true
            },
          },
        }),
    ...(options.gestures === false
      ? {}
      : {
          RNGestureHandlerModule: {
            createGestureHandler: (...args: Array<unknown>) => gestureCalls.push(['create', ...args]),
            attachGestureHandler: (...args: Array<unknown>) => gestureCalls.push(['attach', ...args]),
            dropGestureHandler: (...args: Array<unknown>) => gestureCalls.push(['drop', ...args]),
            configureRelations: (...args: Array<unknown>) => gestureCalls.push(['relations', ...args]),
            flushOperations: () => gestureCalls.push(['flush']),
          },
        }),
  }

  /** What an app passes to `configureWorklets`. */
  const config: WorkletsOptions = {
    load: () => {
      // Loading the real package starts its native half, which leaves this.
      host['__workletsModuleProxy'] = { native: true }
      if (options.gestures !== false) host['_RNGH_MODULE_ID'] = 0
      return pkg
    },
    nativeModule: name => modules[name],
  }

  return {
    config,
    pkg,
    updates,
    styles,
    gestureCalls,
    removable,
    eventHandlers,
    flushes: () => flushes,
    reanimatedStarts: () => reanimatedStarts,
    /** How many worklets are waiting for the UI thread. */
    waiting: () => jobs.length,
    /** How many callbacks are waiting for the next frame. */
    framesAsked: () => frames.length,
    /** Lets the UI thread run everything scheduled, then hands back what it sent. */
    flushUi: (): void => {
      while (jobs.length > 0) {
        const job = jobs.shift()!
        asUi(job)
      }
      deliver()
    },
    /** One frame on the UI thread, `ms` later. The JavaScript thread hears nothing until `deliver`. */
    frame: (ms = 16, options: Readonly<{ deliver?: boolean }> = {}): void => {
      nowMs += ms
      const due = frames
      frames = []
      asUi(() => {
        for (const run of due) run(nowMs)
      })
      if (options.deliver !== false) deliver()
    },
    /** Hands the JavaScript thread what worklets sent while it was busy. */
    deliver,
    /** A native event for a view, delivered on the UI thread as Reanimated does. */
    emit: (tag: number, name: string, event: object): void => {
      const heard = eventHandlers.filter(handler => handler.tag === tag && handler.name === name)
      asUi(() => {
        for (const handler of heard) handler.run(nowMs, { ...event, eventName: name })
      })
      deliver()
    },
    /** Takes away what `load` and Reanimated left on the global. Call after each test. */
    uninstall: (): void => {
      for (const name of JS_GLOBALS) delete host[name]
    },
  }
}

export type FakeWorklets = ReturnType<typeof makeWorklets>
