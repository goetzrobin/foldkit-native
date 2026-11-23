import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerNavigation } from '../src/index.js'
import { makeNotes } from './notes.js'
import {
  type Phone,
  allText,
  byTestId,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

const type = async (phone: Phone, text: string, eventCount: number): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'draft'), 'topChange', { text, eventCount })
  await settle()
}

const screens = (phone: Phone): string[] =>
  byTestId(phone.fabric, 'stack').children.map(child => String(child.props['testID']))

describe('the notes program on the simulated phone', () => {
  let phone: Phone
  let handle: { dispose: () => void }

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone()
    handle = Runtime.embed(
      makeNotes(phone.surface.container, { platform: 'ios', osVersion: 26 }),
    )
    await settle()
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('draws one native screen in a native stack', () => {
    expect(byTestId(phone.fabric, 'stack').viewName).toBe('RNSScreenStack')
    expect(byTestId(phone.fabric, 'screen-home').viewName).toBe('RNSScreen')
    expect(screens(phone)).toEqual(['screen-home'])
    console.log(phone.fabric.render({ props: true }).split('\n').slice(0, 14).join('\n'))
  })

  it('gives each screen what a native stack needs', () => {
    const home = byTestId(phone.fabric, 'screen-home')
    expect(home.props['activityState']).toBe(2)
    expect(home.props['gestureResponseDistance']).toEqual({ start: -1, end: -1, top: -1, bottom: -1 })
    expect(home.props['position']).toBe('absolute')
    const bar = home.children.find(child => child.viewName === 'RNSScreenStackHeaderConfig')
    expect(bar?.props['title']).toBe('Notes')
  })

  it('insets the content below the title bar on iOS', () => {
    const home = byTestId(phone.fabric, 'screen-home')
    const safe = home.children.find(child => child.viewName === 'RNSSafeAreaView')
    expect(safe?.props['edges']).toEqual({ top: true, right: true, bottom: true, left: true })
  })

  it('puts a scroll view\'s rows inside one content view', () => {
    const list = byTestId(phone.fabric, 'list')
    expect(list.viewName).toBe('ScrollView')
    expect(list.props['alwaysBounceVertical']).toBe(true)
    expect(list.children).toHaveLength(1)
    expect(list.children[0]?.props['collapsable']).toBe(false)
    expect(list.children[0]?.children).toHaveLength(24)
  })

  it('adds a typed note and clears the field', async () => {
    await type(phone, 'Buy milk', 8)
    await press(phone.fabric, 'add')
    expect(allText(phone.fabric)).toContain('Buy milk')
    expect(phone.fabric.commands.filter(c => c.name === 'setTextAndSelection').map(c => c.args)).toEqual([
      [8, '', -1, -1],
    ])
  })

  it('pushes a second screen when a note is pressed', async () => {
    await press(phone.fabric, 'note-1')
    expect(screens(phone)).toEqual(['screen-home', 'screen-note-1'])
    expect(textOf(byTestId(phone.fabric, 'note-text'))).toBe('Swipe from the left edge to go back')
  })

  it('keeps the first screen mounted under the second', async () => {
    await type(phone, 'half typed', 10)
    await press(phone.fabric, 'note-1')
    expect(byTestId(phone.fabric, 'draft').props['text']).toBe('half typed')
  })

  it('pops when the Model says so', async () => {
    await press(phone.fabric, 'note-1')
    await press(phone.fabric, 'back')
    expect(screens(phone)).toEqual(['screen-home'])
  })

  it('catches the Model up when the phone pops by itself (swipe-back)', async () => {
    await press(phone.fabric, 'note-1')
    phone.fabric.emit(byTestId(phone.fabric, 'screen-note-1'), 'topDismissed', { dismissCount: 1 })
    await settle()
    expect(screens(phone)).toEqual(['screen-home'])
    // The Model agrees: pressing the same note opens exactly one screen again.
    await press(phone.fabric, 'note-1')
    expect(screens(phone)).toEqual(['screen-home', 'screen-note-1'])
  })

  it('deletes a note from its own screen and goes back', async () => {
    await press(phone.fabric, 'note-2')
    await press(phone.fabric, 'delete')
    expect(screens(phone)).toEqual(['screen-home'])
    expect(hasTestId(phone.fabric, 'note-2')).toBe(false)
    expect(hasTestId(phone.fabric, 'note-1')).toBe(true)
  })
})
