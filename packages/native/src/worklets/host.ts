/**
 * Finding the three native pieces that let code run on the phone's UI
 * thread, without React.
 *
 * A phone app has two threads that matter here. JavaScript (Foldkit, the
 * Model, the view) runs on one. The screen is drawn and fingers are read on
 * the other, the UI thread. A "worklet" is a small function that is copied
 * to a second JavaScript engine living on the UI thread, so it keeps running
 * while the first one is busy.
 *
 * 1. `react-native-worklets` makes that second engine. Its JavaScript half
 *    imports no React: only `TurboModuleRegistry` from `react-native`. The
 *    app hands it over with `configureWorklets({ load })`, because this
 *    package has no dependencies of its own. Loading it calls the native
 *    module `WorkletsModule.installTurboModule()`, which puts
 *    `__workletsModuleProxy` on the JavaScript global. It throws when the
 *    native half is missing, so it is loaded inside a try.
 *
 * 2. `react-native-reanimated` has the only native code that lets a worklet
 *    change a view. Its JavaScript half is React components and hooks, and
 *    none of it is imported here. Its native module is started the way its
 *    own `NativeReanimated.ts` does it (4.7.1): put the UI engine on two
 *    globals, call `ReanimatedModule.installTurboModule()`, remove the
 *    globals. After that the UI engine has `_updateProps`, `_measure` and
 *    `_maybeFlushUIUpdatesQueue`, and JavaScript has
 *    `__reanimatedModuleProxy`.
 *
 * 3. `react-native-gesture-handler` reads fingers on the UI thread. Its
 *    native module `RNGestureHandlerModule` can make a gesture and attach
 *    it to a view by the view's number, and it sends the gesture's events
 *    to Reanimated's native code, which calls a worklet.
 *
 * Nothing in this file throws. A missing piece is "not available", with a
 * reason a person can read on the phone.
 */

/** A value kept on the UI thread. See `shared` in `run.ts`. */
export type Shareable<T> = {
  /** On the UI thread only. */
  value: T
  /** On the JavaScript thread: asks the UI thread and waits for the answer. */
  getSync?: () => T
  /** On the JavaScript thread: sets the value a moment later. */
  setAsync?: (value: T) => void
}

/** The part of `react-native-worklets` (0.13) this project uses. */
export type WorkletsPackage = Readonly<{
  scheduleOnUI: (worklet: (...args: Array<any>) => unknown, ...args: Array<any>) => void
  runOnUISync: <Result>(worklet: (...args: Array<any>) => Result, ...args: Array<any>) => Result
  createShareable: <T>(
    hostRuntimeId: number,
    initial: T,
    config?: Readonly<{ hostDecorator?: (host: any) => any }>,
  ) => Shareable<T>
  /** Packs a value, or a worklet, so native code can carry it to the UI thread. */
  createSerializable: (value: unknown) => unknown
  getUIRuntimeHolder: () => object
  getUISchedulerHolder: () => object
  UIRuntimeId: number
}>

/** `__reanimatedModuleProxy`: the part of it this project uses. */
export type ReanimatedProxy = Readonly<{
  registerEventHandler: (handler: unknown, eventName: string, viewTag: number) => number
  unregisterEventHandler: (id: number) => void
  markNodeAsRemovable?: (shadowNode: unknown) => void
}>

/** `RNGestureHandlerModule`: the part of it this project uses. */
export type GestureModule = Readonly<{
  createGestureHandler: (name: string, handlerTag: number, config: object) => void
  attachGestureHandler: (handlerTag: number, viewTag: number, actionType: number) => void
  dropGestureHandler: (handlerTag: number) => void
  flushOperations: () => void
  /** Says which other gestures this one waits for, blocks, or runs beside. */
  configureRelations?: (handlerTag: number, relations: object) => void
}>

export type WorkletsOptions = Readonly<{
  /**
   * How to get `react-native-worklets`. In an app:
   *
   *   configureWorklets({ load: () => require('react-native-worklets') })
   *
   * It is called once, the first time something asks for the UI thread, and
   * inside a try: the package throws when its native half is missing.
   * `null` says worklets are switched off.
   */
  load?: (() => unknown) | null
  /**
   * How to ask React Native for a native module by name. In an app:
   *
   *   configureWorklets({ nativeModule: name => TurboModuleRegistry.get(name) })
   */
  nativeModule?: (name: string) => unknown
}>

/** One answer: yes, or no with the reason. */
export type Check = Readonly<{ ok: boolean; reason: string }>

const yes: Check = { ok: true, reason: '' }
const no = (reason: string): Check => ({ ok: false, reason })

type Global = {
  __workletsModuleProxy?: unknown
  __reanimatedModuleProxy?: ReanimatedProxy
  __UI_WORKLET_RUNTIME_HOLDER?: object
  __UI_SCHEDULER_HOLDER?: object
  __turboModuleProxy?: (name: string) => unknown
  nativeModuleProxy?: Record<string, unknown>
}

const REANIMATED_MODULE = 'ReanimatedModule'
const GESTURE_MODULE = 'RNGestureHandlerModule'

let load: (() => unknown) | null | undefined
let nativeModule: ((name: string) => unknown) | undefined
let runtime: { pkg: WorkletsPackage | null; check: Check } | undefined
let views: Check | undefined
let gestures: { module: GestureModule | null; check: Check } | undefined

/** Optional. Call at startup. Without it every answer is "not available". */
export const configureWorklets = (options: WorkletsOptions): void => {
  if (options.load !== undefined) load = options.load
  if (options.nativeModule !== undefined) nativeModule = options.nativeModule
  runtime = undefined
  views = undefined
  gestures = undefined
}

/** Back to the state before `configureWorklets`. For tests. */
export const resetWorklets = (): void => {
  load = undefined
  nativeModule = undefined
  runtime = undefined
  views = undefined
  gestures = undefined
}

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0]!.trim()

const findModule = (name: string): unknown => {
  const host = globalThis as Global
  const module =
    nativeModule?.(name) ?? host.__turboModuleProxy?.(name) ?? host.nativeModuleProxy?.[name]
  return module === undefined || module === null ? undefined : module
}

const NEEDED = [
  'scheduleOnUI',
  'runOnUISync',
  'createShareable',
  'createSerializable',
  'getUIRuntimeHolder',
  'getUISchedulerHolder',
] as const

const detectRuntime = (): { pkg: WorkletsPackage | null; check: Check } => {
  const none = (reason: string) => ({ pkg: null, check: no(reason) })
  if (load === undefined) return none('the app did not call configureWorklets()')
  if (load === null) return none('switched off by the app')
  let loaded: unknown
  try {
    loaded = load()
  } catch (error) {
    return none(`react-native-worklets did not start (${messageOf(error)})`)
  }
  if (typeof loaded !== 'object' || loaded === null) {
    return none('react-native-worklets is not in this app')
  }
  const pkg = loaded as Record<string, unknown>
  const missing = NEEDED.find(name => typeof pkg[name] !== 'function')
  if (missing !== undefined) {
    return none(`this version of react-native-worklets has no ${missing}`)
  }
  if (typeof pkg['UIRuntimeId'] !== 'number') {
    return none('this version of react-native-worklets has no UIRuntimeId')
  }
  if ((globalThis as Global).__workletsModuleProxy === undefined) {
    return none("the worklets package loaded but its native code is not in this build")
  }
  return { pkg: loaded as WorkletsPackage, check: yes }
}

const resolvedRuntime = (): { pkg: WorkletsPackage | null; check: Check } => {
  // Asked once: a build does not gain or lose native code while it runs.
  if (runtime === undefined) {
    try {
      runtime = detectRuntime()
    } catch (error) {
      runtime = { pkg: null, check: no(`looking for worklets failed (${messageOf(error)})`) }
    }
  }
  return runtime
}

/** `react-native-worklets`, or null when it cannot be used. Never throws. */
export const workletsPackage = (): WorkletsPackage | null => resolvedRuntime().pkg

/** Whether there is a JavaScript engine on the UI thread. Never throws. */
export const uiRuntimeCheck = (): Check => resolvedRuntime().check

type ReanimatedModule = { installTurboModule?: () => unknown }

/**
 * Starts Reanimated's native code if it is there and not started yet. A "no"
 * that could turn into a "yes" later (no screen yet) is not remembered.
 */
const detectViews = (): { check: Check; isFinal: boolean } => {
  const { pkg, check } = resolvedRuntime()
  if (pkg === null) return { check, isFinal: true }
  const host = globalThis as Global
  if (host.__reanimatedModuleProxy !== undefined) return { check: yes, isFinal: true }
  const module = findModule(REANIMATED_MODULE) as ReanimatedModule | undefined
  if (module === undefined || typeof module.installTurboModule !== 'function') {
    return { check: no("Reanimated's native code is not in this build"), isFinal: true }
  }
  let isStarted: unknown
  host.__UI_WORKLET_RUNTIME_HOLDER = pkg.getUIRuntimeHolder()
  host.__UI_SCHEDULER_HOLDER = pkg.getUISchedulerHolder()
  try {
    isStarted = module.installTurboModule()
  } finally {
    delete host.__UI_WORKLET_RUNTIME_HOLDER
    delete host.__UI_SCHEDULER_HOLDER
  }
  if (isStarted !== true) {
    return {
      check: no('Reanimated could not start yet: the app has no screen to draw on'),
      isFinal: false,
    }
  }
  return host.__reanimatedModuleProxy === undefined
    ? { check: no('Reanimated started but left nothing to call'), isFinal: true }
    : { check: yes, isFinal: true }
}

/** Whether a worklet can change a view. Starts Reanimated's native code. Never throws. */
export const viewUpdatesCheck = (): Check => {
  if (views !== undefined) return views
  try {
    const found = detectViews()
    if (found.isFinal) views = found.check
    return found.check
  } catch (error) {
    return (views = no(`Reanimated failed to start (${messageOf(error)})`))
  }
}

/** Reanimated's native object on the JavaScript thread, once it has started. */
export const reanimatedProxy = (): ReanimatedProxy | null =>
  viewUpdatesCheck().ok ? ((globalThis as Global).__reanimatedModuleProxy ?? null) : null

const GESTURE_METHODS = [
  'createGestureHandler',
  'attachGestureHandler',
  'dropGestureHandler',
  'flushOperations',
] as const

const detectGestures = (): { module: GestureModule | null; check: Check } => {
  const none = (reason: string) => ({ module: null, check: no(reason) })
  const updates = viewUpdatesCheck()
  // The gesture's events reach a worklet through Reanimated's native code.
  if (!updates.ok) return none(updates.reason)
  const module = findModule(GESTURE_MODULE) as Record<string, unknown> | undefined
  if (module === undefined) return none("gesture-handler's native code is not in this build")
  const missing = GESTURE_METHODS.find(name => typeof module[name] !== 'function')
  if (missing !== undefined) return none(`this version of gesture-handler has no ${missing}`)
  return { module: module as unknown as GestureModule, check: yes }
}

const resolvedGestures = (): { module: GestureModule | null; check: Check } => {
  if (gestures !== undefined) return gestures
  try {
    const found = detectGestures()
    // Reanimated may still start later. Then this is asked again.
    if (found.check.ok || views !== undefined) gestures = found
    return found
  } catch (error) {
    return (gestures = {
      module: null,
      check: no(`looking for gesture-handler failed (${messageOf(error)})`),
    })
  }
}

/** Whether a gesture can be read on the UI thread. Never throws. */
export const gesturesCheck = (): Check => resolvedGestures().check

export const gestureModule = (): GestureModule | null => resolvedGestures().module

/** Whether code can run on the UI thread at all. Never throws. */
export const isWorkletsAvailable = (): boolean => uiRuntimeCheck().ok

/** Why not, in plain words. Empty when it can. */
export const workletsUnavailableReason = (): string => uiRuntimeCheck().reason
