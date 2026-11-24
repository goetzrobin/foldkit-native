import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { Keyboard } from '../src/device/index.js'
import { DOCK_CONTENT_ID } from '../src/keyboard/dock.js'
import { configureMotion, stopMotion } from '../src/motion/clock.js'
import { registerNavigation } from '../src/index.js'
import {
  type BackSource,
  moveSheet,
  presentAgain,
  sheet,
  sheetAt,
  sheetKey,
  sheetMovedByPhone,
} from '../src/navigation.js'
import { MAPS_DETENTS, makeDemo } from './demos/sheets.js'
import type { FakeFabricNode } from '@ng-native/testing/fake'
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

/** A Back button a test presses by hand. */
const makeBackButton = () => {
  const listeners: Array<() => boolean> = []
  const source: BackSource = {
    subscribe: listener => {
      listeners.push(listener)
      return () => {
        listeners.splice(listeners.indexOf(listener), 1)
      }
    },
  }
  return {
    source,
    press: (): boolean => listeners.some(listener => listener()),
    listenerCount: (): number => listeners.length,
  }
}

type Started = {
  phone: Phone
  keyboard: ReturnType<typeof Keyboard.makeTest>
  back: ReturnType<typeof makeBackButton>
  exits: { count: number }
  stop: () => Promise<void>
}

let app: Started | undefined

const start = async (platform: 'ios' | 'android' = 'ios'): Promise<Started> => {
  registerNavigation()
  const phone = startPhone(platform)
  const keyboard = Keyboard.makeTest()
  const back = makeBackButton()
  const exits = { count: 0 }
  const handle = Runtime.embed(
    makeDemo(
      phone.surface.container,
      {
        device: { platform, osVersion: platform === 'ios' ? 27 : 16 },
        exit: () => {
          exits.count += 1
        },
        backSource: back.source,
      },
      keyboard.layer,
    ),
  )
  await settle()
  app = {
    phone,
    keyboard,
    back,
    exits,
    stop: async () => {
      handle.dispose()
      await settle()
      phone.surface.dispose()
    },
  }
  return app
}

afterEach(async () => {
  await app?.stop()
  app = undefined
})

const childIds = (phone: Phone, id: string): string[] =>
  byTestId(phone.fabric, id).children.map(child => String(child.props['testID']))

const words = (phone: Phone, id: string): string => textOf(byTestId(phone.fabric, id))

const propsOf = (phone: Phone, id: string) => byTestId(phone.fabric, id).props

/** The phone reporting a sheet at rest, or on its way, at one of its heights. */
const rest = async (phone: Phone, id: string, index: number, isStable = true): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, id), 'topSheetDetentChanged', { index, isStable })
  await settle()
}

const dismiss = async (phone: Phone, id: string): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, id), 'topDismissed', { dismissCount: 1 })
  await settle()
}

const type = async (phone: Phone, id: string, value: string): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, id), 'topChange', { text: value, eventCount: 1 })
  await settle()
}

const valueOf = (attributes: ReadonlyArray<unknown>, key: string): unknown =>
  (attributes as ReadonlyArray<{ key?: string; value?: unknown }>).find(each => each.key === key)
    ?.value

describe('sheet options', () => {
  it('sends what it always sent when given the old options', () => {
    const attributes = sheet({ detents: [0.5, 1], hasGrabber: true })
    expect(attributes).toHaveLength(7)
    expect(valueOf(attributes, 'stackPresentation')).toBe('formSheet')
    expect(valueOf(attributes, 'sheetAllowedDetents')).toEqual([0.5, 1])
    expect(valueOf(attributes, 'sheetInitialDetent')).toBe(0)
    expect(valueOf(attributes, 'sheetLargestUndimmedDetent')).toBe(-1)
    expect(valueOf(attributes, 'sheetGrabberVisible')).toBe(true)
    expect(valueOf(attributes, 'sheetCornerRadius')).toBe(-1)
    expect(valueOf(attributes, 'sheetExpandsWhenScrolledToEdge')).toBe(true)
  })

  it('opens at full height with no options, as before', () => {
    expect(valueOf(sheet(), 'sheetAllowedDetents')).toEqual([1])
  })

  it('turns the undimmed height into an index', () => {
    const detents = [0.25, 0.5, 1]
    const undimmed = (undimmedUpTo: number | 'all' | 'none') =>
      valueOf(sheet({ detents, undimmedUpTo }), 'sheetLargestUndimmedDetent')
    expect(undimmed('none')).toBe(-1)
    expect(undimmed('all')).toBe(2)
    expect(undimmed(1)).toBe(1)
    // Past the last height is the last height.
    expect(undimmed(7)).toBe(2)
  })

  it('asks for a sheet as tall as its content', () => {
    const attributes = sheet({ detents: 'fit', undimmedUpTo: 'all' })
    expect(valueOf(attributes, 'sheetAllowedDetents')).toEqual([-1])
    expect(valueOf(attributes, 'sheetLargestUndimmedDetent')).toBe(0)
  })

  it('cuts a long list of heights to three on Android only', () => {
    const detents = [0.2, 0.4, 0.6, 1]
    const allowed = (platform: string) =>
      valueOf(sheet({ detents, device: { platform } }), 'sheetAllowedDetents')
    expect(allowed('android')).toEqual([0.2, 0.4, 0.6])
    expect(allowed('ios')).toEqual(detents)
    expect(
      valueOf(
        sheet({ detents, device: { platform: 'android' }, undimmedUpTo: 'all', initialDetent: 3 }),
        'sheetLargestUndimmedDetent',
      ),
    ).toBe(2)
  })

  it('sends the look and the closing rule only when asked', () => {
    const attributes = sheet({
      isDismissable: false,
      background: 'clear',
      elevation: 8,
      cornerRadius: 12,
      expandsWhenScrolledToEdge: false,
    })
    expect(valueOf(attributes, 'gestureEnabled')).toBe(false)
    expect(valueOf(attributes, 'style')).toEqual({ backgroundColor: 'transparent' })
    expect(valueOf(attributes, 'sheetElevation')).toBe(8)
    expect(valueOf(attributes, 'sheetCornerRadius')).toBe(12)
    expect(valueOf(attributes, 'sheetExpandsWhenScrolledToEdge')).toBe(false)
    expect(valueOf(sheet({ background: '#fff' }), 'style')).toEqual({ backgroundColor: '#fff' })
  })
})

describe('a sheet place in the Model', () => {
  it('follows the phone without presenting again', () => {
    const place = sheetMovedByPhone(sheetAt(0), 2)
    expect(place).toEqual({ detent: 2, openedAt: 0, presentation: 0 })
    expect(sheetKey('maps', place)).toBe(sheetKey('maps', sheetAt(0)))
  })

  it('presents again when the Model moves it', () => {
    const place = moveSheet(sheetMovedByPhone(sheetAt(0), 2), 1)
    expect(place).toEqual({ detent: 1, openedAt: 1, presentation: 1 })
    expect(sheetKey('maps', place)).not.toBe(sheetKey('maps', sheetAt(0)))
  })

  it('leaves a sheet alone that is already there', () => {
    const place = sheetMovedByPhone(sheetAt(0), 2)
    expect(moveSheet(place, 2)).toBe(place)
  })

  it('presents again where it was', () => {
    expect(presentAgain(sheetMovedByPhone(sheetAt(0), 1))).toEqual({
      detent: 1,
      openedAt: 1,
      presentation: 1,
    })
  })
})

for (const platform of ['ios', 'android'] as const) {
  describe(`the sheets demo on ${platform}`, () => {
    it('opens on the main screen with nothing presented', async () => {
      const { phone } = await start(platform)
      expect(childIds(phone, 'sheets')).toEqual(['home'])
      expect(words(phone, 'maps-status')).toBe('Maps-style sheet: closed.')
      expect(words(phone, 'last-event')).toBe('Last event: Nothing yet.')
    })

    it('presents the Maps-style sheet with three heights and a bright screen behind', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      expect(childIds(phone, 'sheets')).toEqual(['home', 'maps'])
      const maps = byTestId(phone.fabric, 'maps')
      expect(maps.viewName).toBe(platform === 'ios' ? 'RNSModalScreen' : 'RNSScreen')
      expect(maps.props['stackPresentation']).toBe('formSheet')
      expect(maps.props['sheetAllowedDetents']).toEqual([...MAPS_DETENTS])
      expect(maps.props['sheetInitialDetent']).toBe(0)
      expect(maps.props['sheetLargestUndimmedDetent']).toBe(1)
      expect(maps.props['sheetGrabberVisible']).toBe(true)
      expect(maps.props['sheetCornerRadius']).toBe(20)
      expect(maps.props['backgroundColor']).toBe('#ffffff')
      expect(maps.props['activityState']).toBe(2)
      expect(byTestId(phone.fabric, 'maps-content').viewName).toBe('RNSScreenContentWrapper')
      expect(byTestId(phone.fabric, 'maps-content').props['collapsable']).toBe(false)
    })

    it('keeps the screen behind usable while the sheet is open', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      await press(phone.fabric, 'count')
      await press(phone.fabric, 'count')
      expect(words(phone, 'counter')).toBe('Counter: 2')
      expect(childIds(phone, 'sheets')).toEqual(['home', 'maps'])
    })

    it('turns a drag to another height into a Message', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      const before = byTestId(phone.fabric, 'maps').reactTag
      await rest(phone, 'maps', 2)
      expect(words(phone, 'maps-status')).toBe(
        'Maps-style sheet: resting at full (height 3 of 3).',
      )
      expect(words(phone, 'maps-detent')).toBe('The Model says: resting at full.')
      expect(words(phone, 'last-event')).toBe('Last event: The phone moved the sheet to full.')
      // The same sheet: a drag never presents it again, and the height it
      // opened at is not sent again either.
      expect(byTestId(phone.fabric, 'maps').reactTag).toBe(before)
      expect(propsOf(phone, 'maps')['sheetInitialDetent']).toBe(0)
    })

    it('ignores a report from a sheet that is still moving', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      await rest(phone, 'maps', 2, false)
      expect(words(phone, 'maps-status')).toBe(
        'Maps-style sheet: resting at small (height 1 of 3).',
      )
    })

    it('moves the sheet from the Model by presenting it again at the new height', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      const before = byTestId(phone.fabric, 'maps').reactTag
      await press(phone.fabric, 'move-half')
      expect(childIds(phone, 'sheets')).toEqual(['home', 'maps'])
      const after = byTestId(phone.fabric, 'maps')
      expect(after.reactTag).not.toBe(before)
      expect(after.props['sheetInitialDetent']).toBe(1)
      expect(words(phone, 'maps-status')).toBe(
        'Maps-style sheet: resting at half (height 2 of 3).',
      )
      // Asking for the height it is at changes nothing.
      await press(phone.fabric, 'move-half')
      expect(byTestId(phone.fabric, 'maps').reactTag).toBe(after.reactTag)
    })

    it('moves it from the Model after the phone moved it', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      await rest(phone, 'maps', 2)
      await press(phone.fabric, 'move-small')
      expect(propsOf(phone, 'maps')['sheetInitialDetent']).toBe(0)
      expect(words(phone, 'maps-status')).toBe(
        'Maps-style sheet: resting at small (height 1 of 3).',
      )
      await rest(phone, 'maps', 1)
      expect(words(phone, 'maps-status')).toBe(
        'Maps-style sheet: resting at half (height 2 of 3).',
      )
    })

    it('has nothing to move while the sheet is closed', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'move-full')
      expect(words(phone, 'maps-status')).toBe('Maps-style sheet: closed.')
      await press(phone.fabric, 'open-maps')
      expect(propsOf(phone, 'maps')['sheetInitialDetent']).toBe(0)
    })

    it('closes from the Model and from the phone', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-maps')
      await rest(phone, 'maps', 1)
      await press(phone.fabric, 'maps-close')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
      expect(words(phone, 'maps-status')).toBe('Maps-style sheet: closed.')
      // Opened again, it starts at the first height.
      await press(phone.fabric, 'open-maps')
      expect(propsOf(phone, 'maps')['sheetInitialDetent']).toBe(0)
      await dismiss(phone, 'maps')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
      expect(words(phone, 'last-event')).toContain('The phone closed the sheet')
    })

    it('fits a sheet to its content', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-fit')
      expect(propsOf(phone, 'fit')['sheetAllowedDetents']).toEqual([-1])
      const content = byTestId(phone.fabric, 'fit-content')
      expect(content.viewName).toBe('RNSScreenContentWrapper')
      // Pinned to the top with no bottom edge, so its height is its content's.
      expect(content.props['position']).toBe('absolute')
      expect(content.props['top']).toBe(0)
      expect(content.props['bottom']).toBeUndefined()
      expect(content.props['flex']).toBeUndefined()
      expect(hasTestId(phone.fabric, 'fit-line-3')).toBe(false)
      await press(phone.fabric, 'fit-add')
      expect(hasTestId(phone.fabric, 'fit-line-3')).toBe(true)
    })

    it('puts a 500-row list in a sheet as a title row and a scroll view', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-list')
      const content = byTestId(phone.fabric, 'list-content')
      // iOS sizes the scroll view only when it is the second of two children.
      expect(content.children).toHaveLength(2)
      expect(content.children[0]?.props['collapsable']).toBe(false)
      const scroll = content.children[1]
      expect(scroll?.props['testID']).toBe('sheet-rows')
      expect(scroll?.viewName).toBe('ScrollView')
      // Android hands the drag to the sheet only from a nested-scrolling view.
      expect(scroll?.props['nestedScrollEnabled']).toBe(true)
      // iOS: the sheet's own setting hands the drag over.
      expect(propsOf(phone, 'long-list')['sheetExpandsWhenScrolledToEdge']).toBe(true)
      expect(textOf(content)).toContain('Row 1')
      expect(textOf(content)).not.toContain('Row 400')
    })

    it('opens a sheet over a sheet and closes them one at a time', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-lower')
      await press(phone.fabric, 'open-upper')
      expect(childIds(phone, 'sheets')).toEqual(['home', 'lower', 'upper'])
      expect(propsOf(phone, 'upper')['sheetAllowedDetents']).toEqual([0.4])
      await dismiss(phone, 'upper')
      expect(childIds(phone, 'sheets')).toEqual(['home', 'lower'])
      await press(phone.fabric, 'lower-close')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
    })

    it('holds a stack of screens with a title bar inside a sheet', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-screens')
      const sheetScreen = byTestId(phone.fabric, 'screens')
      expect(sheetScreen.children).toHaveLength(1)
      const inner = sheetScreen.children[0]
      expect(inner?.viewName).toBe('RNSScreenStack')
      expect(childIds(phone, 'inner')).toEqual(['inner-1'])
      const first = byTestId(phone.fabric, 'inner-1')
      expect(first.viewName).toBe('RNSScreen')
      expect(first.children.some(child => child.viewName === 'RNSScreenStackHeaderConfig')).toBe(
        true,
      )
      await press(phone.fabric, 'inner-push')
      expect(childIds(phone, 'inner')).toEqual(['inner-1', 'inner-2'])
      expect(words(phone, 'inner-depth')).toBe('Screen 2 of 2 inside the sheet.')
      // A swipe-back inside the sheet pops the inner stack, not the sheet.
      phone.fabric.emit(byTestId(phone.fabric, 'inner-2'), 'topDismissed', { dismissCount: 1 })
      await settle()
      expect(childIds(phone, 'inner')).toEqual(['inner-1'])
      expect(childIds(phone, 'sheets')).toEqual(['home', 'screens'])
      await press(phone.fabric, 'screens-close')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
    })

    it('keeps the buttons of the footer working', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-footer')
      await press(phone.fabric, 'footer-save')
      expect(words(phone, 'saves')).toBe('Saved 1 times')
      await press(phone.fabric, 'footer-cancel')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
    })

    it('sends a line from the sheet with a text field', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-composer')
      await type(phone, 'draft', 'Hello')
      await press(phone.fabric, 'send')
      expect(words(phone, 'line-2')).toBe('Hello')
      expect(words(phone, 'last-event')).toBe('Last event: Sent: Hello')
    })

    it('asks before the Close button throws text away', async () => {
      const { phone } = await start(platform)
      await press(phone.fabric, 'open-ask')
      expect(propsOf(phone, 'ask-first')['preventNativeDismiss']).toBe(false)
      await type(phone, 'note', 'Draft')
      expect(propsOf(phone, 'ask-first')['preventNativeDismiss']).toBe(true)
      expect(propsOf(phone, 'ask-first')['nativeBackButtonDismissalEnabled']).toBe(false)
      await press(phone.fabric, 'ask-close')
      expect(childIds(phone, 'sheets')).toEqual(['home', 'ask-first'])
      expect(words(phone, 'ask-question')).toBe('Throw away what you typed?')
      await press(phone.fabric, 'keep')
      expect(hasTestId(phone.fabric, 'ask-question')).toBe(false)
      await press(phone.fabric, 'ask-close')
      await press(phone.fabric, 'discard')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
      // Opened again, it is empty and closes at once.
      await press(phone.fabric, 'open-ask')
      expect(propsOf(phone, 'ask-first')['preventNativeDismiss']).toBe(false)
      await press(phone.fabric, 'ask-close')
      expect(childIds(phone, 'sheets')).toEqual(['home'])
    })

    it('leaves and stops listening', async () => {
      const started = await start(platform)
      await press(started.phone.fabric, 'open-maps')
      expect(started.keyboard.listenerCount()).toBeGreaterThan(0)
      expect(started.back.listenerCount()).toBe(1)
      await press(started.phone.fabric, 'exit')
      expect(started.exits.count).toBe(1)
      await started.stop()
      app = undefined
      expect(started.keyboard.listenerCount()).toBe(0)
      expect(started.back.listenerCount()).toBe(0)
      expect(hasTestId(started.phone.fabric, 'home')).toBe(false)
    })
  })
}

describe('what differs between the phones', () => {
  it('iOS: refuses a swipe-down while there is text, and asks', async () => {
    const { phone } = await start('ios')
    await press(phone.fabric, 'open-ask')
    await type(phone, 'note', 'Draft')
    const before = byTestId(phone.fabric, 'ask-first').reactTag
    phone.fabric.emit(byTestId(phone.fabric, 'ask-first'), 'topNativeDismissCancelled', {
      dismissCount: 1,
    })
    await settle()
    expect(childIds(phone, 'sheets')).toEqual(['home', 'ask-first'])
    expect(byTestId(phone.fabric, 'ask-first').reactTag).toBe(before)
    expect(words(phone, 'ask-question')).toBe('Throw away what you typed?')
  })

  it('Android: shows a sheet again that the phone hid with text in it', async () => {
    const { phone } = await start('android')
    await press(phone.fabric, 'open-ask')
    await type(phone, 'note', 'Draft')
    const before = byTestId(phone.fabric, 'ask-first').reactTag
    await dismiss(phone, 'ask-first')
    expect(childIds(phone, 'sheets')).toEqual(['home', 'ask-first'])
    // A new native sheet, with what was typed still in it.
    expect(byTestId(phone.fabric, 'ask-first').reactTag).not.toBe(before)
    expect(propsOf(phone, 'note')['value'] ?? propsOf(phone, 'note')['text']).toBe('Draft')
    expect(words(phone, 'ask-question')).toBe('Throw away what you typed?')
  })

  it('Android: Back asks first, goes back inside a sheet, then closes it', async () => {
    const { phone, back } = await start('android')
    expect(back.press()).toBe(false)
    await press(phone.fabric, 'open-ask')
    await type(phone, 'note', 'Draft')
    expect(back.press()).toBe(true)
    await settle()
    expect(childIds(phone, 'sheets')).toEqual(['home', 'ask-first'])
    expect(words(phone, 'ask-question')).toBe('Throw away what you typed?')
    await press(phone.fabric, 'discard')

    await press(phone.fabric, 'open-screens')
    await press(phone.fabric, 'inner-push')
    back.press()
    await settle()
    expect(childIds(phone, 'inner')).toEqual(['inner-1'])
    back.press()
    await settle()
    expect(childIds(phone, 'sheets')).toEqual(['home'])
  })

  it('iOS: the footer is a plain view under the content, clear of the home indicator', async () => {
    const { phone } = await start('ios')
    await press(phone.fabric, 'open-footer')
    const children = byTestId(phone.fabric, 'footer').children
    expect(children.map(child => child.viewName)).toEqual(['RNSScreenContentWrapper', 'View'])
    const bar = byTestId(phone.fabric, 'footer-bar')
    expect(bar.children[0]?.viewName).toBe('RNSSafeAreaView')
    expect(bar.children[0]?.props['edges']).toEqual({
      top: false,
      right: false,
      bottom: true,
      left: false,
    })
  })

  it("Android: the footer is react-native-screens' own, a direct child of the sheet", async () => {
    const { phone } = await start('android')
    await press(phone.fabric, 'open-footer')
    const children = byTestId(phone.fabric, 'footer').children
    expect(children.map(child => child.viewName)).toEqual([
      'RNSScreenContentWrapper',
      'RNSScreenFooter',
    ])
    expect(byTestId(phone.fabric, 'footer-bar').props['collapsable']).toBe(false)
  })

  it('a sheet that lays out its own list keeps iOS from resizing it', async () => {
    const { phone } = await start('ios')
    await press(phone.fabric, 'open-footer')
    const content = byTestId(phone.fabric, 'footer-content')
    // One real view, whose first child is an empty real view.
    expect(content.children).toHaveLength(1)
    const inner = content.children[0]
    expect(inner?.props['collapsable']).toBe(false)
    expect(inner?.children[0]?.props['collapsable']).toBe(false)
    expect(inner?.children[0]?.children).toHaveLength(0)
    expect(inner?.children[0]?.viewName).toBe('View')
  })

  it('iOS: the text field rides on a keyboard dock inside the sheet', async () => {
    const { phone, keyboard } = await start('ios')
    // Frames are run by hand, as the phone would run them.
    const frames: Array<() => void> = []
    configureMotion(phone.surface, { requestFrame: run => frames.push(run) })
    await press(phone.fabric, 'open-composer')
    const inSheet = (): FakeFabricNode[] => flatten([byTestId(phone.fabric, 'composer')])
    expect(byTestId(phone.fabric, 'composer').children.map(child => child.viewName)).toEqual([
      'RNSScreenContentWrapper',
    ])
    const content = inSheet().find(node => node.props['nativeID'] === DOCK_CONTENT_ID)
    expect(content).toBeDefined()
    expect(flatten(content === undefined ? [] : [content]).some(node => node.props['testID'] === 'draft')).toBe(true)
    const raised = (): number =>
      Math.max(0, ...inSheet().map(node => Number(node.props['paddingBottom'] ?? 0)))
    expect(raised()).toBeLessThan(300)
    keyboard.show(300)
    await settle()
    // The dock eases the bar up over a quarter of a second.
    await new Promise(resolve => setTimeout(resolve, 600))
    for (let count = 0; count < 100 && frames.length > 0; count++) frames.shift()?.()
    expect(raised()).toBe(300)
    stopMotion(phone.surface)
  })

  it("Android: the text field is in the sheet's footer and nothing is padded", async () => {
    const { phone, keyboard } = await start('android')
    await press(phone.fabric, 'open-composer')
    const children = byTestId(phone.fabric, 'composer').children
    expect(children.map(child => child.viewName)).toEqual([
      'RNSScreenContentWrapper',
      'RNSScreenFooter',
    ])
    const footer = children[1]
    expect(flatten(footer === undefined ? [] : [footer]).some(node => node.props['testID'] === 'draft')).toBe(true)
    expect(
      flatten([byTestId(phone.fabric, 'composer')]).some(
        node => node.props['nativeID'] === DOCK_CONTENT_ID,
      ),
    ).toBe(false)
    keyboard.show(300)
    await settle()
    expect(
      flatten([byTestId(phone.fabric, 'composer')]).some(node => Number(node.props['paddingBottom'] ?? 0) >= 300),
    ).toBe(false)
  })

  it('Android: draws a handle, which iOS draws itself', async () => {
    const pill = (phone: Phone): boolean =>
      flatten([byTestId(phone.fabric, 'maps-content')]).some(
        node => node.props['width'] === 36 && node.props['height'] === 5,
      )
    const android = await start('android')
    await press(android.phone.fabric, 'open-maps')
    expect(pill(android.phone)).toBe(true)
    await android.stop()
    const ios = await start('ios')
    await press(ios.phone.fabric, 'open-maps')
    expect(pill(ios.phone)).toBe(false)
  })
})
