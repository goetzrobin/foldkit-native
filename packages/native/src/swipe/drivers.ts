/**
 * The drivers: the pieces of code that can draw and move a swipe row.
 *
 * Two ship in this folder and register themselves here:
 *
 *   'ui-thread'    the finger is read and the row is moved on the phone's
 *                  UI thread, by worklets. Needs the worklets pieces.
 *   'javascript'   the same row moved from JavaScript. Always there.
 *
 * Another folder can add its own through the same door, without editing
 * this one, for example a row made of native views:
 *
 *   registerSwipeDriver('native', {
 *     label: 'Native',
 *     check: () => ({ ok: false, reason: 'needs the prebuilt app' }),
 *     row: (h, spec, children) => ...,
 *   })
 *
 * A row asks for a driver by name, or for `'auto'`: the first name in the
 * order that can run in this build.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { SwipeCheck, SwipeDriverName, SwipeRowSpec } from './types.js'

export type SwipeDriver = Readonly<{
  /** A short name for a person: "UI thread". */
  label: string
  /** Whether this driver can run in this build, and why not. Must not throw. */
  check: () => SwipeCheck
  /**
   * Draws one row. The driver raises `swipeOpened`, `swipeClosed`,
   * `swipeTriggered` and `swipeArmed` on the view it returns (see
   * `types.ts`), puts `swipeEventAttributes(spec)` on that view so they
   * become Messages, and joins the row's group with `joinSwipeGroup`.
   */
  row: <Message>(
    h: HtmlBuilder<Message>,
    spec: SwipeRowSpec<Message>,
    children: ReadonlyArray<Html>,
  ) => Html
}>

export type SwipeDriverStatus = Readonly<{
  name: SwipeDriverName
  label: string
  ok: boolean
  /** Why it cannot run. Empty when it can. */
  reason: string
}>

const drivers = new Map<string, SwipeDriver>()
let order: ReadonlyArray<SwipeDriverName> = ['ui-thread', 'javascript']

/** Adds a driver, or replaces the one with this name. */
export const registerSwipeDriver = (name: SwipeDriverName, driver: SwipeDriver): void => {
  drivers.set(name, driver)
}

/** Which drivers `'auto'` tries, first to last. Default `['ui-thread', 'javascript']`. */
export const setSwipeDriverOrder = (names: ReadonlyArray<SwipeDriverName>): void => {
  order = [...names]
}

export const swipeDriverOrder = (): ReadonlyArray<SwipeDriverName> => order

const checkOf = (driver: SwipeDriver): SwipeCheck => {
  try {
    return driver.check()
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Every registered driver, and whether it can run here. For a settings screen. */
export const swipeDrivers = (): ReadonlyArray<SwipeDriverStatus> =>
  [...drivers.entries()].map(([name, driver]) => {
    const check = checkOf(driver)
    return { name, label: driver.label, ok: check.ok, reason: check.ok ? '' : check.reason }
  })

export type ResolvedSwipeDriver = Readonly<{
  name: SwipeDriverName
  driver: SwipeDriver
  /** Why this one, in words for a person. */
  why: string
}>

/**
 * The driver a row gets. A named driver that cannot run falls back to the
 * automatic choice, and `why` says so.
 */
export const resolveSwipeDriver = (wanted: SwipeDriverName | 'auto' = 'auto'): ResolvedSwipeDriver => {
  let why = ''
  if (wanted !== 'auto') {
    const driver = drivers.get(wanted)
    if (driver === undefined) why = `no driver is named ${wanted}`
    else {
      const check = checkOf(driver)
      if (check.ok) return { name: wanted, driver, why: 'asked for' }
      why = `${driver.label} cannot run: ${check.reason}`
    }
  }
  for (const name of order) {
    const driver = drivers.get(name)
    if (driver === undefined) continue
    const check = checkOf(driver)
    if (check.ok) return { name, driver, why: why === '' ? 'first that can run' : why }
    if (why === '') why = `${driver.label} cannot run: ${check.reason}`
  }
  const last = drivers.get('javascript')
  if (last === undefined) throw new Error('No swipe driver is registered')
  return { name: 'javascript', driver: last, why }
}
