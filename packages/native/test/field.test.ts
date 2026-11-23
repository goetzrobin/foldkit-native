import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeField } from './field.js'
import { type Phone, byTestId, press, settle, startPhone, textOf } from './support/phone.js'

/** The user typing: the phone reports the field's new text and a count. */
const type = async (phone: Phone, text: string, eventCount: number): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'field'), 'topChange', { text, eventCount })
  await settle()
}

const textCommands = (phone: Phone) =>
  phone.fabric.commands.filter(command => command.name === 'setTextAndSelection')

describe('a Foldkit text field on the simulated phone', () => {
  let phone: Phone
  let handle: { dispose: () => void }

  beforeEach(async () => {
    phone = startPhone()
    handle = Runtime.embed(makeField(phone.surface.container))
    await settle()
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('draws a native text field with its placeholder', () => {
    const field = byTestId(phone.fabric, 'field')
    expect(field.viewName).toBe('TextInput')
    expect(field.props['placeholder']).toBe('Type here')
    expect(field.props['text']).toBe('')
  })

  it('puts typed text in the Model', async () => {
    await type(phone, 'h', 1)
    await type(phone, 'hi', 2)
    expect(textOf(byTestId(phone.fabric, 'echo'))).toBe('hi')
  })

  it('sends nothing back while the Model agrees with what was typed', async () => {
    await type(phone, 'h', 1)
    await type(phone, 'hi', 2)
    expect(textCommands(phone)).toEqual([])
  })

  it('sends the Model text back, with the latest count, when the program refuses a character', async () => {
    await type(phone, 'a', 1)
    await type(phone, 'a1', 2)
    expect(textOf(byTestId(phone.fabric, 'echo'))).toBe('a')
    expect(textCommands(phone).map(command => command.args)).toEqual([[2, 'a', -1, -1]])
  })

  it('clears the field from the program after the user has typed', async () => {
    await type(phone, 'hello', 5)
    await press(phone.fabric, 'clear')
    expect(textOf(byTestId(phone.fabric, 'echo'))).toBe('')
    expect(textCommands(phone).map(command => command.args)).toEqual([[5, '', -1, -1]])
  })

  it('keeps typing after a clear', async () => {
    await type(phone, 'hello', 5)
    await press(phone.fabric, 'clear')
    await type(phone, 'x', 6)
    expect(textOf(byTestId(phone.fabric, 'echo'))).toBe('x')
    expect(textCommands(phone)).toHaveLength(1)
  })
})
