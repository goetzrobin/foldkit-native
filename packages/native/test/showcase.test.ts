/**
 * Every demo in the showcase, opened from the menu on one simulated phone,
 * one after another. Each demo has its own tests. This one checks that they
 * live together: that opening one does not break the next.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Phone, registerNavigation } from '../src/index.js'
import { makeDemos } from './demos/index.js'
import { startShowcase } from './demos/shell.js'
import { type Phone as TestPhone, allText, hasTestId, press, settle, startPhone } from './support/phone.js'

const demos = makeDemos({ device: Phone.makeTest().layer })

describe('the whole showcase on the simulated phone', () => {
  let phone: TestPhone
  let showcase: { dispose: () => void }

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone()
    showcase = startShowcase(phone.surface.container, { platform: 'ios', osVersion: 27 }, demos)
    await settle()
  })

  afterEach(async () => {
    showcase.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('lists every demo on the menu', () => {
    for (const demo of demos) {
      expect(allText(phone.fabric)).toContain(demo.title)
    }
  })

  for (const demo of demos) {
    it(`opens "${demo.title}" without a crash`, async () => {
      await press(phone.fabric, `open-${demo.id}`)
      await settle()
      expect(hasTestId(phone.fabric, 'screen-menu')).toBe(false)
      expect(allText(phone.fabric).length).toBeGreaterThan(0)
      expect(allText(phone.fabric)).not.toContain('This screen crashed')
    })
  }
})
