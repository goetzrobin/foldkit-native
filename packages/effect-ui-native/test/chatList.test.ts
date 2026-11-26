/**
 * Effect Chat, step 3: the list of chats, delete, rename, the sheets and
 * the settings, end to end on the simulated phone.
 */
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import { SETTINGS_KEY } from '../chat/app.js'
import * as Data from '../chat/data.js'
import { dayGroupOf, listItems } from '../chat/list.js'
import { NativeViews } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import {
  NOW,
  REPLY,
  REQUEST,
  type TestApp,
  chooseBarMenu,
  hold,
  ids,
  listed,
  nodes,
  onEveryCommit,
  pressBarButton,
  seeded,
  send,
  start,
  textIn,
  until,
} from './chatSupport.js'
import { run } from './support.js'

beforeEach(() => {
  NativeViews.configureMarkdown({ native: true })
})
afterEach(() => {
  resetMarkdownSetup()
})

const DAY = 24 * 60 * 60 * 1000
const groups = (app: TestApp): Array<string> => ids(app).filter(id => id.startsWith('chat-group-')).map(id => id.slice(11))
const screens = (app: TestApp) => nodes(app).filter(node => node.viewName === 'RNSScreen' || node.viewName === 'RNSModalScreen')

describe('the day groups', () => {
  it('puts each chat under Today, Yesterday, the last 7 and 30 days, then its month', () => {
    expect(dayGroupOf(NOW - 1000, NOW)).toBe('Today')
    expect(dayGroupOf(NOW - DAY, NOW)).toBe('Yesterday')
    expect(dayGroupOf(NOW - 5 * DAY, NOW)).toBe('Previous 7 days')
    expect(dayGroupOf(NOW - 20 * DAY, NOW)).toBe('Previous 30 days')
    expect(dayGroupOf(NOW - 40 * DAY, NOW)).toBe('October')
    expect(dayGroupOf(NOW - 400 * DAY, NOW)).toBe('October 2025')
  })

  it('a search shows only the matches, newest first, with no headings', () => {
    const summary = (id: string, title: string, preview: string, updatedAt: number) => ({ id, title, preview, updatedAt, createdAt: updatedAt, messageCount: 1 })
    const all = [summary('a', 'Bread', 'flour and water', NOW - 5 * DAY), summary('b', 'Running', 'start slow', NOW), summary('c', 'Water', 'drink more', NOW - DAY)]
    expect(listItems(all as never, NOW, '').map(item => item.key)).toEqual(['header-Today', 'b', 'header-Yesterday', 'c', 'header-Previous 7 days', 'a'])
    expect(listItems(all as never, NOW, ' WATER ').map(item => item.key)).toEqual(['c', 'a'])
  })
})

describe('the list of chats', () => {
  it('shows each chat under the heading for its day, by the clock it is given', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        expect(groups(app)).toEqual(['Today', 'Yesterday', 'October'])
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
        // Each heading comes before its chat.
        const order = ids(app).filter(id => id.startsWith('chat-group-') || id.startsWith('chat-row-'))
        expect(order).toEqual(['chat-group-Today', 'chat-row-c4', 'chat-group-Yesterday', 'chat-row-c1', 'chat-group-October', 'chat-row-c7'])
      }),
    ))

  it('search on an iPhone is the phone’s own field under the title, and keeps the chats that match', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        const search = app.fabric.find('RNSSearchBar')
        expect(search?.props['placeholder']).toBe('Search')
        // It sits in the bar's search slot.
        const slot = nodes(app).find(node => node.children.includes(search as never))
        expect(slot?.props['type']).toBe('searchBar')
        yield* app.emit('search', 'topChangeText', { text: 'river' })
        expect(listed(app)).toEqual(['c1'])
        expect(groups(app)).toEqual([])
        yield* app.emit('search', 'topChangeText', { text: 'zebra' })
        expect(listed(app)).toEqual([])
        expect(app.text('no-matches')).toBe('No chats match "zebra".')
        yield* app.emit('search', 'topChangeText', { text: '' })
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
      }),
    ))

  it('search on Android is a field at the top of the list', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded(), platform: 'android' })
        expect(app.fabric.find('RNSSearchBar')).toBeUndefined()
        yield* app.typeText('search', 'bread')
        expect(listed(app)).toEqual(['c4'])
      }),
    ))
})

describe('deleting a chat', () => {
  it('from its menu in the list: the row goes at once, never comes back, and the server has deleted it', () =>
    run(
      Effect.gen(function* () {
        const { app, device, menus, server } = yield* start({ disk: seeded() })
        yield* hold(app, 'chat-row-c1')
        expect(menus.open()?.title).toBe('Weekend plans')
        expect(menus.titles()).toEqual(['Rename', 'Delete'])
        expect(menus.open()?.options[1]?.isDestructive).toBe(true)
        expect(device.haptics.calls).toContain('impact:medium')
        // The hold did not open the chat.
        expect(screens(app)).toHaveLength(1)
        const frames: Array<string> = []
        onEveryCommit(app, () => frames.push(listed(app).join(',')))
        menus.choose('delete')
        yield* app.settle
        expect(listed(app)).toEqual(['c4', 'c7'])
        yield* app.wait(REQUEST * 4)
        expect(server.log()).toContain('DeleteConversation c1')
        expect(listed(app)).toEqual(['c4', 'c7'])
        // Not in any frame the phone was sent, while the list loaded again.
        expect(frames.length).toBeGreaterThan(0)
        expect(frames.filter(frame => frame.includes('c1'))).toEqual([])
        expect(device.haptics.calls).toContain('notification:warning')
      }),
    ))

  it('that the server refuses: the row is back, and the list says why', () =>
    run(
      Effect.gen(function* () {
        // A delete that takes a moment and then fails.
        const refusing = Data.DeleteConversation.toLayer(() =>
          Effect.andThen(Effect.sleep('60 millis'), Effect.fail(new Data.ChatError({ kind: 'refused', reason: 'The server said no.' }))),
        )
        const { app, device, menus } = yield* start({ disk: seeded(), override: refusing as Layer.Layer<any> })
        yield* hold(app, 'chat-row-c1')
        menus.choose('delete')
        yield* app.settle
        expect(listed(app)).toEqual(['c4', 'c7'])
        yield* app.wait(REQUEST * 3)
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
        expect(app.text('list-notice')).toBe('Could not delete the chat. The server said no.')
        expect(device.haptics.calls).toContain('notification:error')
        // The line goes away by itself.
        yield* app.wait(2400)
        expect(app.has('list-notice')).toBe(false)
      }),
    ))

  it('from the chat’s own menu: the chat closes, and its row is gone from the list', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        // The iPhone's bar button carries the menu, with Delete set apart and red.
        const items = app.byTestId('bar-chat').props['headerRightBarButtonItems'] as Array<{ menu?: { items: Array<Record<string, unknown>> } }>
        const menu = items[0]?.menu?.items ?? []
        expect(menu.map(item => item['title'] === '' ? (item['items'] as Array<{ title: string }>).map(each => each.title) : item['title'])).toEqual(['Rename', 'Settings', ['Delete']])
        expect(screens(app)).toHaveLength(2)
        yield* chooseBarMenu(app, 'bar-chat', 'delete')
        expect(screens(app)).toHaveLength(1)
        expect(listed(app)).toEqual(['c1', 'c7'])
        yield* app.wait(REQUEST * 4)
        expect(server.log()).toContain('DeleteConversation c4')
        expect(listed(app)).toEqual(['c1', 'c7'])
      }),
    ))

  it('on Android the chat’s menu is a list of choices', () =>
    run(
      Effect.gen(function* () {
        const { app, menus } = yield* start({ disk: seeded(), platform: 'android' })
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        yield* app.press('bar-chat-menu')
        expect(menus.titles()).toEqual(['Rename', 'Settings', 'Delete'])
        menus.choose('delete')
        yield* app.settle
        expect(listed(app)).toEqual(['c1', 'c7'])
      }),
    ))
})

describe('renaming a chat', () => {
  it('opens a sheet with the title, and Save shows the new title at once and never the old one again', () =>
    run(
      Effect.gen(function* () {
        const { app, menus, server, device } = yield* start({ disk: seeded() })
        yield* hold(app, 'chat-row-c1')
        menus.choose('rename')
        yield* app.settle
        const sheet = app.byTestId('sheet-rename')
        expect(sheet.viewName).toBe('RNSModalScreen')
        expect(sheet.props['stackPresentation']).toBe('formSheet')
        // As tall as its content.
        expect(sheet.props['sheetAllowedDetents']).toEqual([-1])
        expect(app.byTestId('rename-field').props['text'] ?? app.byTestId('rename-field').props['value']).toBe('Weekend plans')
        // An empty title cannot be saved.
        yield* app.typeText('rename-field', '   ')
        yield* app.press('rename-save')
        expect(app.has('sheet-rename')).toBe(true)
        yield* app.typeText('rename-field', ' Saturday ')
        const frames: Array<string> = []
        onEveryCommit(app, () => frames.push(app.has('chat-title-c1') ? app.text('chat-title-c1') : ''))
        yield* app.press('rename-save')
        expect(app.has('sheet-rename')).toBe(false)
        expect(app.text('chat-title-c1')).toBe('Saturday')
        yield* app.wait(REQUEST * 4)
        expect(server.log()).toContain('RenameConversation c1')
        expect(app.text('chat-title-c1')).toBe('Saturday')
        // Once the new title is on screen, the old one is in no frame the phone is sent.
        expect(frames).toContain('Saturday')
        expect(frames.slice(frames.indexOf('Saturday')).filter(frame => frame === 'Weekend plans')).toEqual([])
        expect(device.keyboard.dismissCount()).toBeGreaterThan(0)
      }),
    ))

  it('Cancel closes the sheet and changes nothing', () =>
    run(
      Effect.gen(function* () {
        const { app, menus, server } = yield* start({ disk: seeded() })
        yield* hold(app, 'chat-row-c1')
        menus.choose('rename')
        yield* app.settle
        yield* app.typeText('rename-field', 'Other')
        yield* app.press('rename-cancel')
        expect(app.has('sheet-rename')).toBe(false)
        yield* app.wait(REQUEST * 2)
        expect(app.text('chat-title-c1')).toBe('Weekend plans')
        expect(server.log().some(name => name.startsWith('RenameConversation'))).toBe(false)
      }),
    ))
})

/** The parts of an open sheet, in the order the phone has them. */
const sheetParts = (app: TestApp, id: string) => {
  const sheet = app.byTestId(id)
  const content = sheet.children.find(child => child.viewName === 'RNSScreenContentWrapper')
  return { sheet, content, footer: sheet.children.find(child => child.viewName === 'RNSScreenFooter') }
}

describe('the settings sheet', () => {
  it('is the phone’s own sheet, with its content filling it and the footer last, at the bottom', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* pressBarButton(app, 'bar-chats', 'settings')
        const { sheet, content } = sheetParts(app, 'sheet-settings')
        expect(sheet.viewName).toBe('RNSModalScreen')
        expect(sheet.props['stackPresentation']).toBe('formSheet')
        expect(sheet.props['sheetAllowedDetents']).toEqual([1])
        expect(sheet.props['sheetGrabberVisible']).toBe(true)
        // It is a screen of the app's stack, on top.
        expect(app.fabric.find('RNSScreenStack')?.children.at(-1)).toBe(sheet)
        // The content view fills the sheet, and says so itself. With no height of its own, a footer under it was drawn at the top.
        expect(sheet.children).toEqual([content])
        expect(content?.props['flex']).toBe(1)
        expect(content?.props['position']).toBeUndefined()
        expect(content?.props['collapsable']).toBe(false)
        // Inside it: the scrolling body, which takes all the room there is, then the footer.
        const [body, footer] = content?.children ?? []
        expect(content?.children).toHaveLength(2)
        expect(body?.viewName).toBe('ScrollView')
        expect(body?.props['flex']).toBe(1)
        expect(NativeTest.flatten([footer as never]).some(node => node.props['testID'] === 'settings-done')).toBe(true)
        // The footer keeps clear of the home indicator, and of nothing else.
        const safe = NativeTest.flatten([footer as never]).find(node => node.viewName === 'RNSSafeAreaView')
        expect(safe?.props['edges']).toEqual({ top: false, right: false, bottom: true, left: false })
        yield* app.press('settings-done')
        expect(app.has('sheet-settings')).toBe(false)
      }),
    ))

  it('on Android the footer is the sheet’s own footer view, after the content, and the sheet has a handle', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded(), platform: 'android' })
        yield* app.press('bar-settings')
        const { sheet, content, footer } = sheetParts(app, 'sheet-settings')
        expect(sheet.children.map(child => child.viewName)).toEqual(['RNSScreenContentWrapper', 'RNSScreenFooter'])
        expect(content?.props['flex']).toBe(1)
        expect(NativeTest.flatten([footer as never]).some(node => node.props['testID'] === 'settings-done')).toBe(true)
        // Android's sheet has no "drag me" bar of its own, so one is drawn first.
        expect(content?.children[0]?.children[0]?.props['width']).toBe(36)
      }),
    ))

  it('a swipe down closes it', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* pressBarButton(app, 'bar-chats', 'settings')
        yield* app.emit('sheet-settings', 'topDismissed', { dismissCount: 1 })
        expect(app.has('sheet-settings')).toBe(false)
        // And it opens again afterwards.
        yield* pressBarButton(app, 'bar-chats', 'settings')
        expect(app.has('sheet-settings')).toBe(true)
      }),
    ))

  it('Dark tells the phone, redraws in dark, and is remembered for the next launch', () =>
    run(
      Effect.gen(function* () {
        const first = yield* start({ disk: seeded() })
        const { app, device } = first
        expect(app.byTestId('screen-chats').props['backgroundColor']).toBe('#FFFFFF')
        yield* pressBarButton(app, 'bar-chats', 'settings')
        expect(app.byTestId('theme-system').props['accessibilityState']).toEqual({ selected: true })
        yield* app.press('theme-dark')
        yield* app.wait(REQUEST)
        expect(device.appearance.calls).toEqual(['dark'])
        expect(app.byTestId('screen-chats').props['backgroundColor']).toBe('#0B0B0C')
        expect(app.byTestId('sheet-settings').props['backgroundColor']).toBe('#0B0B0C')
        expect(app.byTestId('theme-dark').props['accessibilityState']).toEqual({ selected: true })
        expect(device.haptics.calls).toContain('selection')
        const saved = device.storage.calls.filter(call => call.startsWith(`set:${SETTINGS_KEY}=`)).at(-1) ?? ''
        expect(JSON.parse(saved.slice(saved.indexOf('=') + 1))).toEqual({ theme: 'dark', speed: 'normal' })
        // The next launch reads it back and tells the phone before anything is pressed.
        const again = yield* start({ disk: seeded(), stored: { [SETTINGS_KEY]: JSON.stringify({ theme: 'dark', speed: 'fast' }) } })
        yield* again.app.wait(REQUEST)
        expect(again.device.appearance.calls).toEqual(['dark'])
        expect(again.app.byTestId('screen-chats').props['backgroundColor']).toBe('#0B0B0C')
      }),
    ))

  it('Reply speed and the failure switches set the pretend server', () =>
    run(
      Effect.gen(function* () {
        const { app, server } = yield* start({ disk: seeded() })
        yield* pressBarButton(app, 'bar-chats', 'settings')
        expect(server.chaos().refuseSend).toBe(false)
        yield* app.press('chaos-refuseSend')
        yield* app.wait(REQUEST)
        expect(server.chaos().refuseSend).toBe(true)
        expect(app.byTestId('chaos-refuseSend').props['accessibilityState']).toEqual({ selected: true })
        yield* app.press('chaos-refuseSend')
        yield* app.wait(REQUEST)
        expect(server.chaos().refuseSend).toBe(false)
        yield* app.press('speed-slow')
        expect(app.byTestId('speed-slow').props['accessibilityState']).toEqual({ selected: true })
      }),
    ))

  it('Show numbers turns the strip on for the next chat', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* pressBarButton(app, 'bar-chats', 'settings')
        yield* app.press('numbers-switch')
        yield* app.press('settings-done')
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        expect(app.has('numbers')).toBe(true)
        expect(app.text('numbers-hold-route')).toContain('hold: ')
      }),
    ))

  it('opens from the chat’s own menu too', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start({ disk: seeded() })
        yield* app.press('chat-row-c4')
        yield* app.wait(REQUEST)
        yield* chooseBarMenu(app, 'bar-chat', 'settings')
        expect(app.has('sheet-settings')).toBe(true)
        expect(app.fabric.find('RNSScreenStack')?.children.map(child => child.viewName)).toEqual(['RNSScreen', 'RNSScreen', 'RNSModalScreen'])
      }),
    ))
})

describe('the reasoning sheet', () => {
  it('"Thought for" under a reply opens what the model thought, in a sheet with two heights and its footer last', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('start-chat')
        yield* app.wait(REQUEST)
        yield* send(app, 'Should I take the train or drive to the coast? Think it through.')
        yield* until(app, () => ids(app).some(id => id.startsWith('reply-reasoning-')) && !app.has('stop'), REPLY * 4, 'a reply that thought first')
        const button = ids(app).find(id => id.startsWith('reply-reasoning-')) as string
        expect(textIn(app.byTestId(button))).toMatch(/^Thought for \d+ s›$/)
        yield* app.press(button)
        const { sheet, content } = sheetParts(app, 'sheet-reasoning')
        expect(sheet.props['sheetAllowedDetents']).toEqual([0.5, 1])
        expect(content?.props['flex']).toBe(1)
        expect(content?.children).toHaveLength(2)
        expect(content?.children[0]?.viewName).toBe('ScrollView')
        expect(NativeTest.flatten([content?.children[1] as never]).some(node => node.props['testID'] === 'reasoning-done')).toBe(true)
        expect(app.text('reasoning-text').length).toBeGreaterThan(20)
        expect(textIn(sheet)).toMatch(/Thought for \d+ s/)
        yield* app.press('reasoning-done')
        expect(app.has('sheet-reasoning')).toBe(false)
        // The chat is still under it.
        expect(app.has('screen-chat')).toBe(true)
      }),
    ))
})
