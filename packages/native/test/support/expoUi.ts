/** Helpers for the menus and controls tests: a phone with or without Expo UI. */
import type { FakeFabric, FakeFabricNode } from '@ng-native/testing/fake'

import {
  type ExpoGlobal,
  configureExpoUi,
  registerExpoUi,
  resetExpoUi,
} from '../../src/controls/index.js'
import { registerNavigation } from '../../src/index.js'
import { configureSheets } from '../../src/menus/index.js'
import { type Phone, byTestId, flatten, settle, startPhone } from './phone.js'

/** The start of every Expo UI view's native name. */
export const UI = 'ViewManagerAdapter_ExpoUI_'

/** Expo's global object as a build with Expo UI has it. `missing` views are not in it. */
export const expoWith = (
  missing: ReadonlyArray<string> = [],
  identifier?: string,
): ExpoGlobal => ({
  ...(identifier === undefined ? {} : { __expo_app_identifier__: identifier }),
  modules: { ExpoUI: {} },
  getViewConfig: (_module, view) => (missing.includes(String(view)) ? null : { validAttributes: {} }),
})

export type Natives = Readonly<Record<string, unknown>>

/**
 * A phone whose build has Expo UI (`expo`), or not (`null`), and whichever
 * of React Native's own native modules are named in `natives`.
 */
export const prepare = (
  platform: 'ios' | 'android',
  expo: ExpoGlobal | null,
  natives: Natives = {},
): Phone => {
  resetExpoUi()
  const phone = startPhone(platform)
  registerNavigation()
  configureExpoUi({ expo })
  configureSheets({ nativeModule: name => natives[name] })
  registerExpoUi()
  return phone
}

/** The views with this native name inside the view with this testID. */
export const inside = (fabric: FakeFabric, id: string, viewName: string): Array<FakeFabricNode> =>
  flatten([byTestId(fabric, id)]).filter(node => node.viewName === viewName)

export const one = (fabric: FakeFabric, id: string, viewName: string): FakeFabricNode => {
  const found = inside(fabric, id, viewName)
  if (found.length !== 1) throw new Error(`Expected one ${viewName} in ${id}, found ${found.length}`)
  return found[0]!
}

/** A native event from a view, as the phone sends it. */
export const send = async (
  fabric: FakeFabric,
  node: FakeFabricNode,
  event: string,
  payload: object = {},
): Promise<void> => {
  fabric.emit(node, event, payload)
  await settle()
}

const touch = (node: FakeFabricNode, phase: 'start' | 'end') => {
  const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: Date.now() }
  return { ...point, touches: phase === 'start' ? [point] : [], changedTouches: [point] }
}

/** A finger resting on a view for a while, then lifting. */
export const hold = async (fabric: FakeFabric, id: string, milliseconds: number): Promise<void> => {
  fabric.emit(byTestId(fabric, id), 'topTouchStart', touch(byTestId(fabric, id), 'start'))
  await new Promise(resolve => setTimeout(resolve, milliseconds))
  fabric.emit(byTestId(fabric, id), 'topTouchEnd', touch(byTestId(fabric, id), 'end'))
  await settle()
}
