/** Helpers shared by the tests: a simulated phone and a finger. */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'

import { type NativeSurface, createNativeSurface } from '../../src/index.js'

export type Phone = Readonly<{ fabric: FakeFabric; surface: NativeSurface }>

export const startPhone = (platform: 'ios' | 'android' = 'ios'): Phone => {
  registerPlatformComponents(platform)
  const fabric = createFakeFabric()
  return { fabric, surface: createNativeSurface(fabric, 1, { dev: false }) }
}

/** Let Foldkit's runtime process what is queued and draw. */
export const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

export const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap(node => [node, ...flatten(node.children)])

export const byTestId = (fabric: FakeFabric, id: string): FakeFabricNode => {
  const found = flatten(fabric.committed).find(node => node.props['testID'] === id)
  if (found === undefined) throw new Error(`No view with testID ${id}`)
  return found
}

export const hasTestId = (fabric: FakeFabric, id: string): boolean =>
  flatten(fabric.committed).some(node => node.props['testID'] === id)

const touch = (node: FakeFabricNode, phase: 'start' | 'end') => {
  const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: Date.now() }
  return { ...point, touches: phase === 'start' ? [point] : [], changedTouches: [point] }
}

/** A finger going down and up on a view, as the phone reports it. */
export const press = async (fabric: FakeFabric, id: string): Promise<void> => {
  fabric.emit(byTestId(fabric, id), 'topTouchStart', touch(byTestId(fabric, id), 'start'))
  fabric.emit(byTestId(fabric, id), 'topTouchEnd', touch(byTestId(fabric, id), 'end'))
  await settle()
}

/** The words drawn inside a view. */
export const textOf = (node: FakeFabricNode): string =>
  flatten([node])
    .filter(each => each.viewName === 'RawText')
    .map(each => each.props['text'])
    .filter(value => typeof value === 'string')
    .join('')

export const allText = (fabric: FakeFabric): string[] =>
  flatten(fabric.committed)
    .filter(node => node.viewName === 'RawText')
    .map(node => node.props['text'])
    .filter((value): value is string => typeof value === 'string')
