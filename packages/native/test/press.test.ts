import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makePress } from './press.js'
import { type Phone, byTestId, settle, startPhone, textOf } from './support/phone.js'

/** One moment of a touch on the button, at a place on the screen. */
const touchAt = (phone: Phone, phase: 'Start' | 'Move' | 'End' | 'Cancel', x: number, y: number) => {
  const button = byTestId(phone.fabric, 'button')
  const point = { identifier: 0, target: button.reactTag, pageX: x, pageY: y, locationX: x, locationY: y, timestamp: Date.now() }
  const isDown = phase === 'Start' || phase === 'Move'
  phone.fabric.emit(button, `topTouch${phase}`, { ...point, touches: isDown ? [point] : [], changedTouches: [point] })
}

const presses = (phone: Phone): string => textOf(byTestId(phone.fabric, 'presses'))
/** The phone clears a prop by setting it to null. Both mean "not set". */
const opacity = (phone: Phone): unknown =>
  byTestId(phone.fabric, 'button').props['opacity'] ?? undefined

describe('a press on the simulated phone', () => {
  let phone: Phone
  let handle: { dispose: () => void }

  beforeEach(async () => {
    phone = startPhone()
    handle = Runtime.embed(makePress(phone.surface.container))
    await settle()
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('counts a touch that starts and ends on the button', async () => {
    touchAt(phone, 'Start', 50, 50)
    touchAt(phone, 'End', 50, 50)
    await settle()
    expect(presses(phone)).toBe('1')
  })

  it('still counts when the finger drifts a little', async () => {
    touchAt(phone, 'Start', 50, 50)
    touchAt(phone, 'Move', 54, 53)
    touchAt(phone, 'End', 54, 53)
    await settle()
    expect(presses(phone)).toBe('1')
  })

  it('calls the press off when the finger drifts away', async () => {
    touchAt(phone, 'Start', 50, 50)
    touchAt(phone, 'Move', 50, 90)
    touchAt(phone, 'End', 50, 90)
    await settle()
    expect(presses(phone)).toBe('0')
  })

  it('calls the press off when the phone cancels the touch', async () => {
    touchAt(phone, 'Start', 50, 50)
    touchAt(phone, 'Cancel', 50, 50)
    await settle()
    expect(presses(phone)).toBe('0')
  })

  it('shows the pressed style while the finger is down, and removes it after', async () => {
    expect(opacity(phone)).toBeUndefined()
    touchAt(phone, 'Start', 50, 50)
    expect(opacity(phone)).toBe(0.6)
    expect(byTestId(phone.fabric, 'button').props['backgroundColor']).toBeDefined()
    touchAt(phone, 'End', 50, 50)
    await settle()
    expect(opacity(phone)).toBeUndefined()
  })

  it('removes the pressed style when the finger drifts away', async () => {
    touchAt(phone, 'Start', 50, 50)
    touchAt(phone, 'Move', 50, 90)
    expect(opacity(phone)).toBeUndefined()
  })

  it('does not send pressedStyle to the phone as a prop', () => {
    expect(byTestId(phone.fabric, 'button').props['pressedStyle']).toBeUndefined()
  })
})
