/** The lists and motion demo starts and its buttons do what their labels say. */
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerNavigation } from '../src/index.js'
import { stopMotion } from '../src/motion/index.js'
import { makeDemo } from './demos/lists.js'
import {
  type Phone,
  byTestId,
  flatten,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

describe('the lists and motion demo', () => {
  let phone: Phone
  let handle: { dispose: () => void }
  let exits = 0

  beforeEach(async () => {
    exits = 0
    registerNavigation()
    phone = startPhone()
    handle = Runtime.embed(
      makeDemo(phone.surface.container, {
        device: { platform: 'ios', osVersion: 26 },
        exit: () => {
          exits += 1
        },
      }),
    )
    await settle()
  })

  afterEach(async () => {
    stopMotion(phone.surface)
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  const rowViews = (): number =>
    flatten([byTestId(phone.fabric, 'rows')]).filter(node =>
      String(node.props['testID'] ?? '').startsWith('row-'),
    ).length

  it('draws a few of its 5,000 rows and says how many', () => {
    expect(textOf(byTestId(phone.fabric, 'model-status'))).toContain('5000 rows in the Model')
    expect(rowViews()).toBeGreaterThan(5)
    expect(rowViews()).toBeLessThan(40)
    expect(textOf(byTestId(phone.fabric, 'row-count'))).toBe(
      `Row views that exist now: ${rowViews()} (rows 1 to ${rowViews()})`,
    )
  })

  it('jumps to row 2,500 and still has only a few row views', async () => {
    await press(phone.fabric, 'jump')
    expect(hasTestId(phone.fabric, 'row-2500')).toBe(true)
    expect(hasTestId(phone.fabric, 'row-0')).toBe(false)
    expect(rowViews()).toBeLessThan(40)
  })

  it('adds, removes and shuffles rows, and marks a pressed row', async () => {
    await press(phone.fabric, 'add-row')
    expect(hasTestId(phone.fabric, 'row-5000')).toBe(true)
    await press(phone.fabric, 'remove-row')
    expect(hasTestId(phone.fabric, 'row-5000')).toBe(false)
    await press(phone.fabric, 'row-1')
    expect(textOf(byTestId(phone.fabric, 'row-1'))).toContain('(pressed)')
    await press(phone.fabric, 'shuffle')
    expect(textOf(byTestId(phone.fabric, 'model-status'))).toContain('5000 rows')
    expect(rowViews()).toBeLessThan(40)
  })

  it('refreshes: a pull spins, then three rows arrive and the spinner stops', async () => {
    const control = flatten(phone.fabric.committed).find(
      node => node.viewName === 'PullToRefreshView',
    )
    if (control === undefined) throw new Error('No refresh control')
    phone.fabric.emit(control, 'topRefresh', {})
    await settle()
    expect(
      flatten(phone.fabric.committed).find(node => node.viewName === 'PullToRefreshView')?.props[
        'refreshing'
      ],
    ).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 1100))
    await settle()
    expect(textOf(byTestId(phone.fabric, 'model-status'))).toContain('5003 rows')
    expect(textOf(byTestId(phone.fabric, 'model-status'))).toContain('Refreshed 1 times')
    expect(hasTestId(phone.fabric, 'row-5002')).toBe(true)
  })

  it('opens the motion screen and comes back', async () => {
    await press(phone.fabric, 'open-motion')
    expect(hasTestId(phone.fabric, 'screen-motion')).toBe(true)
    expect(hasTestId(phone.fabric, 'card')).toBe(true)
    await press(phone.fabric, 'add-chip')
    expect(hasTestId(phone.fabric, 'chip-4')).toBe(true)
    await press(phone.fabric, 'close-motion')
    expect(hasTestId(phone.fabric, 'screen-motion')).toBe(false)
  })

  it('leaves through the Exit button', async () => {
    await press(phone.fabric, 'exit')
    expect(exits).toBe(1)
  })
})
