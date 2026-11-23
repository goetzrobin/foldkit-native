import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type NativeSurface, createNativeSurface } from '../src/index.js'
import { makeList } from './list.js'

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const flatten = (nodes: readonly FakeFabricNode[]): FakeFabricNode[] =>
  nodes.flatMap(node => [node, ...flatten(node.children)])

const byTestId = (fabric: FakeFabric, id: string): FakeFabricNode => {
  const found = flatten(fabric.committed).find(node => node.props['testID'] === id)
  if (found === undefined) throw new Error(`No view with testID ${id}`)
  return found
}

const touch = (node: FakeFabricNode, phase: 'start' | 'end') => {
  const point = { identifier: 0, target: node.reactTag, pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: Date.now() }
  return { ...point, touches: phase === 'start' ? [point] : [], changedTouches: [point] }
}

const press = async (fabric: FakeFabric, id: string): Promise<void> => {
  fabric.emit(byTestId(fabric, id), 'topTouchStart', touch(byTestId(fabric, id), 'start'))
  fabric.emit(byTestId(fabric, id), 'topTouchEnd', touch(byTestId(fabric, id), 'end'))
  await settle()
}

const rowsShown = (fabric: FakeFabric): string[] =>
  byTestId(fabric, 'rows').children.map(row =>
    flatten([row])
      .map(node => node.props['text'])
      .filter(value => typeof value === 'string')
      .join(''),
  )

const allText = (fabric: FakeFabric): string[] =>
  flatten(fabric.committed)
    .map(node => node.props['text'])
    .filter((value): value is string => typeof value === 'string')

describe('a Foldkit list on the simulated phone', () => {
  let fabric: FakeFabric
  let surface: NativeSurface
  let handle: { dispose: () => void }

  beforeEach(async () => {
    // No animation-frame clock is provided: drawing must not depend on one.
    registerPlatformComponents('ios')
    fabric = createFakeFabric()
    surface = createNativeSurface(fabric, 1, { dev: false })
    handle = Runtime.embed(makeList(surface.container))
    await settle()
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    surface.dispose()
  })

  it('draws the starting rows', () => {
    expect(rowsShown(fabric)).toEqual(['row 1', 'row 2', 'row 3'])
  })

  it('adds a row at the end', async () => {
    await press(fabric, 'add')
    expect(rowsShown(fabric)).toEqual(['row 1', 'row 2', 'row 3', 'row 4'])
  })

  it('removes a row from the front', async () => {
    await press(fabric, 'remove')
    expect(rowsShown(fabric)).toEqual(['row 2', 'row 3'])
  })

  it('reorders rows without creating new views', async () => {
    const before = fabric.calls.createNode
    await press(fabric, 'reverse')
    expect(rowsShown(fabric)).toEqual(['row 3', 'row 2', 'row 1'])
    expect(fabric.calls.createNode - before).toBe(0)
  })

  it('changes a style when the Model crosses a threshold, and back', async () => {
    expect(byTestId(fabric, 'rows').props['backgroundColor']).toBeDefined()
    const white = byTestId(fabric, 'rows').props['backgroundColor']
    await press(fabric, 'add')
    const red = byTestId(fabric, 'rows').props['backgroundColor']
    expect(red).not.toEqual(white)
    await press(fabric, 'remove')
    expect(byTestId(fabric, 'rows').props['backgroundColor']).toEqual(white)
  })

  it('shows and hides a conditional element', async () => {
    expect(allText(fabric)).not.toContain('empty')
    await press(fabric, 'remove')
    await press(fabric, 'remove')
    await press(fabric, 'remove')
    expect(rowsShown(fabric)).toEqual([])
    expect(allText(fabric)).toContain('empty')
    await press(fabric, 'add')
    expect(allText(fabric)).not.toContain('empty')
    expect(rowsShown(fabric)).toEqual(['row 4'])
  })
})
