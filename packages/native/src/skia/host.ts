/**
 * Finding Skia on the phone, without React.
 *
 * `@shopify/react-native-skia` has two halves. The JavaScript half is React
 * components, which this project cannot use. The native half is what draws,
 * and it can be reached with no React at all:
 *
 * 1. A native module called `RNSkiaModule` has one method, `install()`.
 *    Calling it puts two objects on the JavaScript global:
 *    `SkiaApi` (make a recorder, a paint, a color, a font) and
 *    `SkiaViewApi` (hand something to a Skia view on screen).
 * 2. A native view called `SkiaPictureView` shows a "picture": a recorded
 *    list of drawing calls. The view is given a number in its `nativeID`
 *    prop. `SkiaViewApi.setJsiProperty(thatNumber, 'picture', picture)`
 *    hands it a picture, and `SkiaViewApi.requestRedraw(thatNumber)` asks it
 *    to draw.
 *
 * That is exactly what the package's own `SkiaPictureView` React component
 * does inside (see `src/views/SkiaPictureView.tsx` in the package, 2.14.0).
 * Nothing from the package is imported here, so none of its React code runs.
 *
 * Nothing in this file throws when Skia is missing. The answer is then
 * "not available", with a reason a person can read on the phone.
 */

/** A recorded drawing. Made by `SkiaApi.PictureRecorder()`. */
export type SkPicture = Readonly<{ dispose?: () => void }>

export type SkPaint = Readonly<{
  setColor: (color: unknown) => void
  /** 0 fills a shape, 1 draws its outline. */
  setStyle: (style: number) => void
  setStrokeWidth: (width: number) => void
  setAntiAlias: (on: boolean) => void
}>

export type SkRect = Readonly<{ x: number; y: number; width: number; height: number }>

export type SkCanvas = Readonly<{
  drawCircle: (cx: number, cy: number, radius: number, paint: SkPaint) => void
  drawRect: (rect: SkRect, paint: SkPaint) => void
  drawLine: (x1: number, y1: number, x2: number, y2: number, paint: SkPaint) => void
  drawText: (text: string, x: number, y: number, paint: SkPaint, font: unknown) => void
}>

export type SkPictureRecorder = Readonly<{
  beginRecording: (bounds?: SkRect) => SkCanvas
  finishRecordingAsPicture: () => SkPicture
  dispose?: () => void
}>

/** The part of the global `SkiaApi` object this project uses. */
export type SkiaApi = Readonly<{
  PictureRecorder: () => SkPictureRecorder
  Paint: () => SkPaint
  /** A color from CSS text such as `#ff0000`. */
  Color: (value: string) => unknown
  Font: (typeface?: unknown, size?: number) => unknown
  FontMgr?: Readonly<{
    System: () => Readonly<{ matchFamilyStyle: (name: string, style: object) => unknown }>
  }>
}>

/** The part of the global `SkiaViewApi` object this project uses. */
export type SkiaViewApi = Readonly<{
  setJsiProperty: (nativeId: number, name: string, value: unknown) => void
  requestRedraw: (nativeId: number) => void
}>

export type SkiaHost = Readonly<{ api: SkiaApi; views: SkiaViewApi }>

type NativeSkiaModule = { install?: () => unknown }

export type SkiaOptions = Readonly<{
  /**
   * How to ask React Native for a native module by name. In an app:
   *
   *   import { TurboModuleRegistry } from 'react-native'
   *   configureSkia({ nativeModule: name => TurboModuleRegistry.get(name) })
   *
   * Without it the module is looked for on the global, where React Native
   * also keeps it.
   */
  nativeModule?: (name: string) => unknown
  /**
   * Skia itself, without looking. `null` says it is not there, which is how
   * to force the plain views. Tests pass a stand-in. `'detect'` (the default)
   * looks for it.
   */
  host?: SkiaHost | null | 'detect'
  /** The time now, in milliseconds. Tests pass their own clock. */
  now?: () => number
}>

const MODULE_NAME = 'RNSkiaModule'

type Global = {
  SkiaApi?: SkiaApi
  SkiaViewApi?: SkiaViewApi
  __turboModuleProxy?: (name: string) => unknown
  nativeModuleProxy?: Record<string, unknown>
  performance?: { now?: () => number }
}

let nativeModule: ((name: string) => unknown) | undefined
let given: SkiaHost | null | 'detect' = 'detect'
let found: { host: SkiaHost | null; reason: string } | undefined
let clock: (() => number) | undefined

/** Optional. Call at startup, before the first draw. */
export const configureSkia = (options: SkiaOptions): void => {
  if (options.nativeModule !== undefined) nativeModule = options.nativeModule
  if (options.host !== undefined) {
    given = options.host
    found = undefined
  }
  if (options.now !== undefined) clock = options.now
}

/** Back to looking for Skia and to the phone's clock. For tests. */
export const resetSkia = (): void => {
  nativeModule = undefined
  given = 'detect'
  found = undefined
  clock = undefined
}

/** The time now in milliseconds, from a clock that never goes backwards where there is one. */
export const nowMs = (): number => {
  if (clock !== undefined) return clock()
  const performance = (globalThis as Global).performance
  return typeof performance?.now === 'function' ? performance.now() : Date.now()
}

const findModule = (): NativeSkiaModule | undefined => {
  const host = globalThis as Global
  const module =
    nativeModule?.(MODULE_NAME) ??
    host.__turboModuleProxy?.(MODULE_NAME) ??
    host.nativeModuleProxy?.[MODULE_NAME]
  return module === undefined || module === null ? undefined : (module as NativeSkiaModule)
}

const fromGlobal = (): SkiaHost | undefined => {
  const host = globalThis as Global
  const api = host.SkiaApi
  const views = host.SkiaViewApi
  if (api === undefined || api === null || views === undefined || views === null) return undefined
  if (typeof api.PictureRecorder !== 'function' || typeof api.Paint !== 'function') return undefined
  if (typeof views.setJsiProperty !== 'function') return undefined
  return { api, views }
}

const detect = (): { host: SkiaHost | null; reason: string } => {
  try {
    // Something else in the app may have installed it already.
    const ready = fromGlobal()
    if (ready !== undefined) return { host: ready, reason: '' }
    const module = findModule()
    if (module === undefined || typeof module.install !== 'function') {
      return { host: null, reason: "Skia's native code is not in this build" }
    }
    if (module.install() !== true) {
      return { host: null, reason: 'Skia was found but did not start' }
    }
    const installed = fromGlobal()
    return installed === undefined
      ? { host: null, reason: 'Skia started but its drawing objects are missing' }
      : { host: installed, reason: '' }
  } catch (error) {
    return {
      host: null,
      reason: `Skia failed to start (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

const resolved = (): { host: SkiaHost | null; reason: string } => {
  if (given !== 'detect') {
    return { host: given, reason: given === null ? 'Skia was switched off by the app' : '' }
  }
  // Asked once: a build does not gain or lose native code while it runs.
  if (found === undefined) found = detect()
  return found
}

/** Skia, or null when this build does not have it. Never throws. */
export const skiaHost = (): SkiaHost | null => resolved().host

export const isSkiaAvailable = (): boolean => resolved().host !== null

/** Why Skia is not available, in plain words. Empty when it is. */
export const skiaUnavailableReason = (): string => resolved().reason
