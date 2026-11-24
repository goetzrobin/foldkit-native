/**
 * Menus on the simulated phone, on each of the four ways they are drawn:
 * SwiftUI, Compose, React Native's sheet, and the plain in-app list. Then
 * the title bar's menu and the action sheet Command.
 *
 * The simulated phone cannot open a menu. These tests check what the phone
 * was asked to draw, and that what the phone would report becomes the right
 * Message.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import {
  expoUiKind,
  expoUiUnavailableReason,
  expoViewName,
  configureExpoUi,
  resetExpoUi,
} from '../src/controls/index.js'
import {
  ActionSheet,
  HOLD_MS,
  type MenuItem,
  barMenuData,
  configureSheets,
  flatten,
  menuRoute,
  menusStatus,
  presentSheet,
  sheetRoute,
} from '../src/menus/index.js'
import { makeDemo } from './demos/menus.js'
import { UI, type Natives, expoWith, hold, inside, one, prepare, send } from './support/expoUi.js'
import { type Phone, byTestId, flatten as allNodes, hasTestId, press, settle, textOf } from './support/phone.js'

let running: { dispose: () => void } | undefined
let phone: Phone | undefined

/** The demo on a phone of this kind. */
const start = async (
  platform: 'ios' | 'android',
  hasExpoUi: boolean,
  natives: Natives = {},
  sheet = ActionSheet.makeTest(),
) => {
  phone = prepare(platform, hasExpoUi ? expoWith() : null, natives)
  running = Runtime.embed(
    makeDemo(phone.surface.container, { device: { platform, osVersion: 27 }, exit: () => {} }, sheet.layer),
  )
  await settle()
  return { fabric: phone.fabric, sheet }
}

const lastEvent = (fabric: Phone['fabric']): string => textOf(byTestId(fabric, 'last-event'))

afterEach(async () => {
  running?.dispose()
  running = undefined
  await settle()
  phone?.surface.dispose()
  phone = undefined
  resetExpoUi()
  configureSheets({ nativeModule: 'global' })
  registerPlatformComponents('ios')
})

describe('finding Expo UI', () => {
  it('is SwiftUI on iOS and Compose on Android when the module and its host view exist', () => {
    prepare('ios', expoWith())
    expect(expoUiKind()).toBe('swiftui')
    expect(expoUiUnavailableReason()).toBe('')
    expect(menuRoute()).toBe('swiftui')
    prepare('android', expoWith())
    expect(expoUiKind()).toBe('compose')
    expect(menuRoute()).toBe('compose')
  })

  it.each([
    ['there is no Expo', null, "Expo's native modules are not in this build"],
    ['the module is missing', { modules: {} }, "@expo/ui's native code is not in this build"],
    ['the host view is missing', expoWith(['HostView']), 'the native view HostView is missing from this build'],
  ])('is not there when %s, and says why', (_name, expo, reason) => {
    prepare('ios', expo)
    expect(expoUiKind()).toBe('none')
    expect(expoUiUnavailableReason()).toBe(reason)
  })

  it('is not there until the app has called registerExpoUi, and can be switched off', () => {
    resetExpoUi()
    configureExpoUi({ expo: expoWith() })
    expect(expoUiKind()).toBe('none')
    expect(expoUiUnavailableReason()).toBe('the app did not call registerExpoUi()')
    prepare('ios', expoWith())
    configureExpoUi({ available: false })
    expect(expoUiKind()).toBe('none')
    expect(expoUiUnavailableReason()).toBe('switched off by the app')
  })

  it('never throws, whatever Expo hands back', () => {
    const hostile = {}
    Object.defineProperty(hostile, 'modules', {
      get: () => {
        throw new Error('boom')
      },
    })
    prepare('ios', hostile)
    expect(expoUiKind()).toBe('none')
    expect(expoUiUnavailableReason()).toBe('looking for Expo UI failed (boom)')
    expect(() => menusStatus()).not.toThrow()
  })

  it("names a view as Expo does, with Expo Go's project name where there is one", async () => {
    phone = prepare('ios', expoWith([], 'abc123'))
    expect(expoViewName('ExpoUI', 'HostView')).toBe(`${UI}HostView_abc123`)
    running = Runtime.embed(
      makeDemo(
        phone.surface.container,
        { device: { platform: 'ios', osVersion: 27 }, exit: () => {} },
        ActionSheet.makeTest().layer,
      ),
    )
    await settle()
    expect(byTestId(phone.fabric, 'switch').viewName).toBe(`${UI}HostView_abc123`)
    expect(byTestId(phone.fabric, 'switch').children[0]!.viewName).toBe(`${UI}ToggleView_abc123`)
  })

  it('names the views again when Expo Go only tells the project name later', async () => {
    const expo: { __expo_app_identifier__?: string } & ReturnType<typeof expoWith> = { ...expoWith() }
    phone = prepare('ios', expo)
    // After registerExpoUi, before the first draw.
    expo.__expo_app_identifier__ = 'late'
    running = Runtime.embed(
      makeDemo(
        phone.surface.container,
        { device: { platform: 'ios', osVersion: 27 }, exit: () => {} },
        ActionSheet.makeTest().layer,
      ),
    )
    await settle()
    expect(byTestId(phone.fabric, 'switch').viewName).toBe(`${UI}HostView_late`)
  })

  it('falls back when the build lacks the views a menu needs', () => {
    prepare('ios', expoWith(['ContextMenu']), { ActionSheetManager: { showActionSheetWithOptions: () => {} } })
    expect(expoUiKind()).toBe('swiftui')
    expect(menuRoute()).toBe('sheet')
    prepare('ios', expoWith(['ContextMenu']))
    expect(menuRoute()).toBe('in-app')
  })
})

describe('menu data', () => {
  const items: ReadonlyArray<MenuItem> = [
    { key: 'a', title: 'A', isChecked: true },
    { title: 'More', submenu: [{ key: 'b', title: 'B', isDisabled: true }] },
    { title: 'Danger', section: [{ key: 'c', title: 'C', isDestructive: true, symbol: 'trash' }] },
  ]

  it('flattens sections and submenus into one list', () => {
    expect(flatten(items)).toEqual([
      { key: 'a', title: 'A', isDestructive: false, isDisabled: false, isChecked: true, startsSection: false },
      { key: 'b', title: 'More: B', isDestructive: false, isDisabled: true, isChecked: false, startsSection: false },
      { key: 'c', title: 'C', isDestructive: true, isDisabled: false, isChecked: false, startsSection: true },
    ])
  })

  it("writes a title bar menu as react-native-screens' native code reads it", () => {
    expect(barMenuData({ title: 'T', items })).toEqual({
      title: 'T',
      items: [
        { type: 'action', menuId: 'a', title: 'A', state: 'on' },
        { type: 'submenu', title: 'More', items: [{ type: 'action', menuId: 'b', title: 'B', disabled: true }] },
        {
          type: 'submenu',
          title: 'Danger',
          displayInline: true,
          items: [{ type: 'action', menuId: 'c', title: 'C', destructive: true, sfSymbolName: 'trash' }],
        },
      ],
    })
  })
})

describe('menus drawn by SwiftUI (iOS with Expo UI)', () => {
  it('draws the context menu as SwiftUI views: host, menu, and a slot each for trigger and items', async () => {
    const { fabric } = await start('ios', true)
    const host = byTestId(fabric, 'card-menu')
    expect(host.viewName).toBe(`${UI}HostView`)
    expect(host.props).toMatchObject({
      matchContentsVertical: true,
      matchContentsHorizontal: false,
      layoutDirection: 'leftToRight',
    })
    const menu = host.children[0]!
    expect(menu.viewName).toBe(`${UI}ContextMenu`)
    expect(menu.children.map(child => [child.viewName, child.props['name']])).toEqual([
      [`${UI}SlotView`, 'trigger'],
      [`${UI}SlotView`, 'items'],
    ])
    // The card itself is the app's own view, inside the trigger.
    const hosted = one(fabric, 'card-menu', `${UI}RNHostView`)
    expect(hosted.props).toMatchObject({
      matchContentsVertical: true,
      matchContentsHorizontal: false,
      expoInternalSizeFromChildren: true,
    })
    expect(hosted.children[0]!.props['collapsable']).toBe(false)
    expect(allNodes([hosted]).some(node => node.props['testID'] === 'card')).toBe(true)
  })

  it('writes each kind of entry as the SwiftUI view that draws it', async () => {
    const { fabric } = await start('ios', true)
    const items = byTestId(fabric, 'card-menu').children[0]!.children[1]!
    const shape = (node: FakeFabricNode) => [node.viewName.replace(UI, ''), node.props['label'] ?? node.props['title']]
    expect(items.children.map(shape)).toEqual([
      ['Button', 'Copy'],
      ['ToggleView', 'Pinned'],
      ['Button', 'Print (off)'],
      ['MenuView', 'Move to'],
      ['SectionView', undefined],
    ])
    const [copy, pinned, print, move, section] = items.children as [
      FakeFabricNode,
      FakeFabricNode,
      FakeFabricNode,
      FakeFabricNode,
      FakeFabricNode,
    ]
    expect(copy.props).toMatchObject({ systemImage: 'doc.on.doc', role: 'default', modifiers: [] })
    expect(pinned.props).toMatchObject({ isOn: false, systemImage: 'pin' })
    expect(print.props['modifiers']).toEqual([{ $type: 'disabled', disabled: true }])
    expect(move.children.map(child => child.props['label'])).toEqual(['Inbox', 'Archive'])
    const content = section.children[0]!
    expect(content.props['name']).toBe('content')
    expect(content.children[0]!.props).toMatchObject({ label: 'Delete', role: 'destructive' })
  })

  it('turns a chosen entry into the Message, and shows a check mark from the Model', async () => {
    const { fabric } = await start('ios', true)
    const entry = (label: string) =>
      allNodes([byTestId(fabric, 'card-menu')]).find(node => node.props['label'] === label)!
    await send(fabric, entry('Copy'), 'topButtonPress')
    expect(lastEvent(fabric)).toBe('Card menu: copy')
    await send(fabric, entry('Archive'), 'topButtonPress')
    expect(lastEvent(fabric)).toBe('Card menu: move-archive')
    await send(fabric, entry('Pinned'), 'topIsOnChange', { isOn: true })
    expect(lastEvent(fabric)).toBe('Card menu: pin')
    expect(entry('Pinned').props['isOn']).toBe(true)
    expect(textOf(byTestId(fabric, 'card-pinned'))).toBe('Pinned')
  })

  it('draws the pull-down menu as a SwiftUI Menu with a label and a symbol', async () => {
    const { fabric } = await start('ios', true)
    const host = byTestId(fabric, 'sort-menu')
    expect(host.props).toMatchObject({ matchContentsVertical: true, matchContentsHorizontal: true })
    const menu = host.children[0]!
    expect(menu.viewName).toBe(`${UI}MenuView`)
    expect(menu.props).toMatchObject({ label: 'Sort', systemImage: 'arrow.up.arrow.down' })
    expect(menu.children[0]!.props['title']).toBe('Sort by')
    const name = allNodes([menu]).find(node => node.props['label'] === 'Name')!
    expect(name.props['isOn']).toBe(false)
    await send(fabric, name, 'topIsOnChange', { isOn: true })
    expect(textOf(byTestId(fabric, 'sort-value'))).toBe('Sorted by name')
    expect(allNodes([byTestId(fabric, 'sort-menu')]).find(node => node.props['label'] === 'Name')!.props['isOn']).toBe(true)
  })

  it('says so in the status block', async () => {
    const { fabric } = await start('ios', true)
    expect(textOf(byTestId(fabric, 'status-context-menu'))).toBe('context menu: Expo UI (SwiftUI), with a preview')
    expect(textOf(byTestId(fabric, 'status-pull-down-menu'))).toBe('pull-down menu: Expo UI (SwiftUI)')
    expect(textOf(byTestId(fabric, 'status-title-bar-menu'))).toBe(
      "title bar menu: react-native-screens' bar button menu",
    )
  })
})

describe('menus drawn by Compose (Android with Expo UI)', () => {
  const dropdown = (fabric: Phone['fabric'], id: string) => one(fabric, id, `${UI}DropdownMenuView`)

  it('keeps the card an ordinary view and hangs a closed Material menu from its corner', async () => {
    const { fabric } = await start('android', true)
    const anchor = byTestId(fabric, 'card-menu')
    expect(anchor.viewName).toBe('View')
    expect(anchor.children[0]!.props['testID']).toBe('card')
    const host = one(fabric, 'card-menu', `${UI}HostView`)
    expect(host.props).toMatchObject({ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1 })
    expect(dropdown(fabric, 'card-menu').props['expanded']).toBe(false)
    const slot = dropdown(fabric, 'card-menu').children[0]!
    expect(slot.props['slotName']).toBe('items')
    const texts = inside(fabric, 'card-menu', `${UI}TextView`).map(node => node.props['text'])
    expect(texts).toEqual(['Copy', 'Pinned', 'Print (off)', 'Move to: Inbox', 'Move to: Archive', 'Delete'])
    const entries = inside(fabric, 'card-menu', `${UI}DropdownMenuItemView`)
    expect(entries.map(entry => entry.props['enabled'])).toEqual([true, true, false, true, true, true])
    expect(entries[5]!.props['elementColors']).toEqual({ textColor: '#b3261e' })
    expect(inside(fabric, 'card-menu', `${UI}HorizontalDividerView`)).toHaveLength(1)
  })

  it('opens on a long press, not on a short one', async () => {
    const { fabric } = await start('android', true)
    await hold(fabric, 'card', 100)
    expect(dropdown(fabric, 'card-menu').props['expanded']).toBe(false)
    await hold(fabric, 'card', HOLD_MS + 80)
    expect(dropdown(fabric, 'card-menu').props['expanded']).toBe(true)
  })

  it('reports the chosen entry, shows the check mark, and closes', async () => {
    const { fabric } = await start('android', true)
    await hold(fabric, 'card', HOLD_MS + 80)
    const pinned = inside(fabric, 'card-menu', `${UI}DropdownMenuItemView`)[1]!
    await send(fabric, pinned, 'topItemPressed')
    expect(lastEvent(fabric)).toBe('Card menu: pin')
    expect(dropdown(fabric, 'card-menu').props['expanded']).toBe(false)
    expect(inside(fabric, 'card-menu', `${UI}TextView`)[1]!.props['text']).toBe('✓ Pinned')
  })

  it('closes when the phone asks: a press outside, or Back', async () => {
    const { fabric } = await start('android', true)
    await press(fabric, 'sort-menu')
    expect(dropdown(fabric, 'sort-menu').props['expanded']).toBe(true)
    await send(fabric, dropdown(fabric, 'sort-menu'), 'topDismissRequest')
    expect(dropdown(fabric, 'sort-menu').props['expanded']).toBe(false)
    expect(lastEvent(fabric)).toBe('Nothing yet')
  })

  it('opens the pull-down menu on a press', async () => {
    const { fabric } = await start('android', true)
    await press(fabric, 'sort-menu')
    expect(dropdown(fabric, 'sort-menu').props['expanded']).toBe(true)
    await send(fabric, inside(fabric, 'sort-menu', `${UI}DropdownMenuItemView`)[2]!, 'topItemPressed')
    expect(textOf(byTestId(fabric, 'sort-value'))).toBe('Sorted by size')
    expect(dropdown(fabric, 'sort-menu').props['expanded']).toBe(false)
  })

  it('puts a menu button in the title bar', async () => {
    const { fabric } = await start('android', true)
    const item = allNodes(fabric.committed).find(node => node.viewName === 'RNSScreenStackHeaderSubview')!
    expect(item.props['type']).toBe('right')
    expect(item.children[0]!.props['testID']).toBe('bar-menu')
    await press(fabric, 'bar-menu')
    expect(dropdown(fabric, 'bar-menu').props['expanded']).toBe(true)
    await send(fabric, inside(fabric, 'bar-menu', `${UI}DropdownMenuItemView`)[1]!, 'topItemPressed')
    expect(lastEvent(fabric)).toBe('Title bar menu: bar-rename')
  })

  it('says in the status block that Android has no preview', async () => {
    const { fabric } = await start('android', true)
    expect(textOf(byTestId(fabric, 'status-context-menu'))).toBe(
      'context menu: Expo UI (Jetpack Compose), opened by a long press, with no preview',
    )
  })
})

describe("menus through React Native's sheet (no Expo UI)", () => {
  it('asks iOS for an action sheet on a long press, and reports the choice', async () => {
    const calls: Array<{ options: Record<string, unknown>; done: (index: number) => void }> = []
    const { fabric } = await start('ios', false, {
      ActionSheetManager: {
        showActionSheetWithOptions: (options: Record<string, unknown>, done: (index: number) => void) =>
          calls.push({ options, done }),
      },
    })
    expect(menuRoute()).toBe('sheet')
    expect(byTestId(fabric, 'card-menu').viewName).toBe('View')
    await hold(fabric, 'card', HOLD_MS + 80)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.options).toEqual({
      title: 'Card',
      options: ['Copy', 'Pinned', 'Print (off)', 'Move to: Inbox', 'Move to: Archive', 'Delete', 'Cancel'],
      cancelButtonIndex: 6,
      destructiveButtonIndices: [5],
      disabledButtonIndices: [2],
    })
    calls[0]!.done(4)
    await settle()
    expect(lastEvent(fabric)).toBe('Card menu: move-archive')
    // Cancel reports nothing.
    await hold(fabric, 'card', HOLD_MS + 80)
    calls[1]!.done(6)
    await settle()
    expect(lastEvent(fabric)).toBe('Card menu: move-archive')
  })

  it('asks Android for a dialog with a list on a press, leaving disabled entries out', async () => {
    const calls: Array<{ config: Record<string, unknown>; done: (action: string, key?: number) => void }> = []
    const { fabric } = await start('android', false, {
      DialogManagerAndroid: {
        showAlert: (config: Record<string, unknown>, _onError: unknown, done: (action: string, key?: number) => void) =>
          calls.push({ config, done }),
      },
    })
    await hold(fabric, 'card', HOLD_MS + 80)
    expect(calls[0]!.config).toEqual({
      title: 'Card',
      items: ['Copy', 'Pinned', 'Move to: Inbox', 'Move to: Archive', 'Delete'],
      cancelable: true,
    })
    calls[0]!.done('buttonClicked', 4)
    await settle()
    expect(lastEvent(fabric)).toBe('Card menu: delete')
    await press(fabric, 'sort-menu')
    calls[1]!.done('dismissed')
    await settle()
    expect(lastEvent(fabric)).toBe('Card menu: delete')
    expect(textOf(byTestId(fabric, 'status-pull-down-menu'))).toBe(
      "pull-down menu: React Native's list dialog (DialogManagerAndroid) (no Expo UI: Expo's native modules are not in this build)",
    )
  })
})

describe('menus as a plain in-app list (no Expo UI, no sheet)', () => {
  it('draws a hidden list under the card, opens it on a long press, and closes it on a choice', async () => {
    const { fabric } = await start('ios', false)
    expect(menuRoute()).toBe('in-app')
    // A hidden view is not sent to the phone at all.
    const isOpen = () => hasTestId(fabric, 'card-menu-list')
    expect(isOpen()).toBe(false)
    await hold(fabric, 'card', 100)
    expect(isOpen()).toBe(false)
    await hold(fabric, 'card', HOLD_MS + 80)
    expect(isOpen()).toBe(true)
    expect(byTestId(fabric, 'card-menu-list').viewName).toBe('View')
    expect(textOf(byTestId(fabric, 'card-menu-list'))).toBe(
      'CardCopyPinnedPrint (off)Move to: InboxMove to: ArchiveDeleteClose',
    )
    await press(fabric, 'card-menu-pin')
    expect(lastEvent(fabric)).toBe('Card menu: pin')
    expect(isOpen()).toBe(false)
    await hold(fabric, 'card', HOLD_MS + 80)
    expect(textOf(byTestId(fabric, 'card-menu-pin'))).toBe('\u2713 Pinned')
  })

  it('does not report a disabled entry', async () => {
    const { fabric } = await start('ios', false)
    await hold(fabric, 'card', HOLD_MS + 80)
    await press(fabric, 'card-menu-print')
    expect(lastEvent(fabric)).toBe('Nothing yet')
  })

  it('opens the pull-down list on a press, and closes it on a second press or a choice', async () => {
    const { fabric } = await start('android', false)
    const isOpen = () => hasTestId(fabric, 'sort-menu-list')
    await press(fabric, 'sort-menu')
    expect(isOpen()).toBe(true)
    await press(fabric, 'sort-menu')
    expect(isOpen()).toBe(false)
    await press(fabric, 'sort-menu')
    await press(fabric, 'sort-menu-name')
    expect(textOf(byTestId(fabric, 'sort-value'))).toBe('Sorted by name')
    expect(isOpen()).toBe(false)
    expect(textOf(byTestId(fabric, 'status-pull-down-menu'))).toBe(
      "pull-down menu: a plain in-app list (no Expo UI: Expo's native modules are not in this build)",
    )
    expect(textOf(byTestId(fabric, 'status-action-sheet'))).toBe(
      "action sheet: not available: React Native's sheet module is not in this build",
    )
  })

  it('forgets a long press that was under way when the screen went away', async () => {
    const { fabric } = await start('ios', false)
    const card = byTestId(fabric, 'card')
    fabric.emit(card, 'topTouchStart', {
      identifier: 0,
      target: card.reactTag,
      pageX: 0,
      pageY: 0,
      touches: [{ identifier: 0, target: card.reactTag, pageX: 0, pageY: 0 }],
      changedTouches: [{ identifier: 0, target: card.reactTag, pageX: 0, pageY: 0 }],
    })
    running?.dispose()
    running = undefined
    await new Promise(resolve => setTimeout(resolve, HOLD_MS + 80))
    expect(hasTestId(fabric, 'card-menu-list')).toBe(false)
  })
})

describe('the title bar menu on iOS', () => {
  it('describes the menu on the bar button, with no action of its own', async () => {
    const { fabric } = await start('ios', true)
    const bar = allNodes(fabric.committed).find(node => node.viewName === 'RNSScreenStackHeaderConfig')!
    expect(bar.props['headerRightBarButtonItems']).toEqual([
      {
        index: 0,
        title: 'More',
        sfSymbolName: 'ellipsis.circle',
        menu: {
          title: 'This screen',
          items: [
            { type: 'action', menuId: 'bar-share', title: 'Share', sfSymbolName: 'square.and.arrow.up' },
            { type: 'action', menuId: 'bar-rename', title: 'Rename', sfSymbolName: 'pencil' },
            {
              type: 'submenu',
              title: '',
              displayInline: true,
              items: [
                { type: 'action', menuId: 'bar-delete', title: 'Delete', sfSymbolName: 'trash', destructive: true },
              ],
            },
          ],
        },
      },
    ])
  })

  it('turns a chosen entry into the Message', async () => {
    const { fabric } = await start('ios', true)
    const bar = allNodes(fabric.committed).find(node => node.viewName === 'RNSScreenStackHeaderConfig')!
    await send(fabric, bar, 'topPressHeaderBarButtonMenuItem', { menuId: 'bar-delete' })
    expect(lastEvent(fabric)).toBe('Title bar menu: bar-delete')
  })
})

describe('the action sheet', () => {
  it('shows the sheet from update and reports the choice', async () => {
    const sheet = ActionSheet.makeTest()
    sheet.answerWith('library')
    const { fabric } = await start('ios', true, {}, sheet)
    await press(fabric, 'open-sheet')
    expect(sheet.shown).toHaveLength(1)
    expect(sheet.shown[0]).toMatchObject({ title: 'Profile photo' })
    expect(sheet.shown[0]!.items.map(item => item.key)).toEqual(['camera', 'library', 'files', 'remove'])
    expect(lastEvent(fabric)).toBe('Action sheet: library')
  })

  it('reports a sheet closed without a choice, and one that did not open', async () => {
    const sheet = ActionSheet.makeTest()
    sheet.answerWith(null)
    const { fabric } = await start('ios', true, {}, sheet)
    await press(fabric, 'open-sheet')
    expect(lastEvent(fabric)).toBe('Action sheet: closed without a choice')
    sheet.failNext('no window')
    await press(fabric, 'open-sheet')
    expect(lastEvent(fabric)).toBe('Action sheet did not open: no window')
  })

  it("reaches iOS's action sheet through React Native's native module", async () => {
    const calls: Array<{ options: Record<string, unknown>; done: (index: number) => void }> = []
    prepare('ios', null, {
      ActionSheetManager: {
        showActionSheetWithOptions: (options: Record<string, unknown>, done: (index: number) => void) =>
          calls.push({ options, done }),
      },
    })
    expect(sheetRoute()).toBe('ios-action-sheet')
    const answer = Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ActionSheet.ActionSheet
        return yield* service.show({
          title: 'T',
          message: 'M',
          cancelLabel: 'Not now',
          items: [
            { key: 'a', title: 'A' },
            { key: 'b', title: 'B', isDestructive: true },
          ],
        })
      }).pipe(Effect.provide(ActionSheet.live())),
    )
    await settle()
    expect(calls[0]!.options).toEqual({
      title: 'T',
      message: 'M',
      options: ['A', 'B', 'Not now'],
      cancelButtonIndex: 2,
      destructiveButtonIndices: [1],
      disabledButtonIndices: [],
    })
    calls[0]!.done(1)
    expect(await answer).toEqual({ _tag: 'Selected', key: 'b' })
  })

  it("reaches Android's list dialog, and reports a press outside as closed", () => {
    const calls: Array<{ config: Record<string, unknown>; done: (action: string, key?: number) => void }> = []
    prepare('android', null, {
      DialogManagerAndroid: {
        showAlert: (config: Record<string, unknown>, _onError: unknown, done: (action: string, key?: number) => void) =>
          calls.push({ config, done }),
      },
    })
    expect(sheetRoute()).toBe('android-dialog')
    const answers: Array<unknown> = []
    presentSheet({ message: 'Only a message', options: [{ key: 'a', title: 'A' }] }, answer => answers.push(answer))
    expect(calls[0]!.config).toEqual({ title: 'Only a message', items: ['A'], cancelable: true })
    calls[0]!.done('dismissed')
    // The phone may call twice. Only the first counts.
    calls[0]!.done('buttonClicked', 0)
    expect(answers).toEqual([{ _tag: 'Dismissed' }])
  })

  it('fails with a reason where the phone has no sheet, and for an empty list', async () => {
    prepare('ios', null)
    expect(sheetRoute()).toBe('none')
    const run = (items: ReadonlyArray<ActionSheet.ActionSheetItem>) =>
      Effect.runPromise(ActionSheet.Show({ items }).effect.pipe(Effect.provide(ActionSheet.live())) as never)
    expect(await run([{ key: 'a', title: 'A' }])).toMatchObject({
      _tag: 'FailedShowActionSheet',
      reason: "React Native's ActionSheetManager is not in this build",
    })
    expect(await run([])).toMatchObject({
      _tag: 'FailedShowActionSheet',
      reason: 'An action sheet needs at least one entry',
    })
  })
})
