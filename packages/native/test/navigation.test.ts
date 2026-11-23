import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerNavigation } from '../src/index.js'
import {
  type BackSource,
  canPop,
  pop,
  popByPhone,
  popTo,
  popToRoot,
  push,
  replace,
} from '../src/navigation.js'
import { makeDemo } from './demos/navigation.js'
import {
  type Phone,
  byTestId,
  hasTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

/** A Back button a test presses by hand. It answers as Android would hear it. */
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
    /** True when the program took the press, false when Android would leave the app. */
    press: (): boolean => listeners.some(listener => listener()),
    listenerCount: (): number => listeners.length,
  }
}

type Started = {
  phone: Phone
  back: ReturnType<typeof makeBackButton>
  exits: { count: number }
  stop: () => Promise<void>
}

const start = async (platform: 'ios' | 'android' = 'ios'): Promise<Started> => {
  registerNavigation()
  const phone = startPhone(platform)
  const back = makeBackButton()
  const exits = { count: 0 }
  const handle = Runtime.embed(
    makeDemo(phone.surface.container, {
      device: { platform, osVersion: platform === 'ios' ? 26 : 16 },
      exit: () => {
        exits.count += 1
      },
      backSource: back.source,
    }),
  )
  await settle()
  return {
    phone,
    back,
    exits,
    stop: async () => {
      handle.dispose()
      await settle()
      phone.surface.dispose()
    },
  }
}

const childIds = (phone: Phone, id: string): string[] =>
  byTestId(phone.fabric, id).children.map(child => String(child.props['testID']))

const words = (phone: Phone, id: string): string => textOf(byTestId(phone.fabric, id))

const requestedTab = (phone: Phone): unknown =>
  (byTestId(phone.fabric, 'tabs').props['navStateRequest'] as { selectedScreenKey?: string })
    ?.selectedScreenKey

/** The phone reporting a tab change, as a tap on the bar does. */
const tapTab = async (
  phone: Phone,
  key: string,
  provenance: number,
  isRepeated = false,
): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, 'tabs'), 'topTabSelected', {
    selectedScreenKey: key,
    provenance,
    isRepeated,
    hasTriggeredSpecialEffect: false,
    actionOrigin: 'user',
  })
  await settle()
}

const dismiss = async (phone: Phone, id: string, dismissCount: number): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, id), 'topDismissed', { dismissCount })
  await settle()
}

describe('the route helpers', () => {
  const routes = ['a', 'b', 'c', 'd']

  it('push adds on top', () => {
    expect(push(routes, 'e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('pop takes from the top and never the first route', () => {
    expect(pop(routes)).toEqual(['a', 'b', 'c'])
    expect(pop(routes, 2)).toEqual(['a', 'b'])
    expect(pop(routes, 99)).toEqual(['a'])
    expect(pop(['a'])).toEqual(['a'])
  })

  it('popTo stops at the nearest match below the top', () => {
    expect(popTo(routes, route => route === 'b')).toEqual(['a', 'b'])
    expect(popTo(['a', 'b', 'a', 'b'], route => route === 'b')).toEqual(['a', 'b'])
    // No match: nothing happens.
    expect(popTo(routes, route => route === 'z')).toEqual(routes)
    // The top itself is not a place to pop to.
    expect(popTo(routes, route => route === 'd')).toEqual(routes)
  })

  it('popToRoot keeps the first route', () => {
    expect(popToRoot(routes)).toEqual(['a'])
  })

  it('replace swaps the top', () => {
    expect(replace(routes, 'z')).toEqual(['a', 'b', 'c', 'z'])
    expect(replace(['a'], 'z')).toEqual(['z'])
  })

  it('popByPhone drops what the phone closed', () => {
    expect(popByPhone(routes, 3)).toEqual(['a'])
    expect(popByPhone(routes, 0)).toEqual(routes)
  })

  it('canPop says whether there is a screen to go back from', () => {
    expect(canPop(['a'])).toBe(false)
    expect(canPop(routes)).toBe(true)
  })
})

describe('the navigation demo on the simulated phone (iOS)', () => {
  let app: Started

  beforeEach(async () => {
    app = await start('ios')
  })

  afterEach(async () => {
    await app.stop()
  })

  describe('tabs', () => {
    it('draws a native tab bar with three tabs, each holding a native stack', () => {
      const bar = byTestId(app.phone.fabric, 'tabs')
      expect(bar.viewName).toBe('RNSTabsHostIOS')
      expect(bar.children.map(child => child.viewName)).toEqual([
        'RNSTabsScreenIOS',
        'RNSTabsScreenIOS',
        'RNSTabsScreenIOS',
      ])
      expect(bar.children.map(child => child.props['screenKey'])).toEqual([
        'stack',
        'present',
        'bar',
      ])
      for (const child of bar.children) {
        expect(child.children.map(each => each.viewName)).toEqual(['RNSScreenStack'])
      }
    })

    it('gives each tab a title and an SF Symbol', () => {
      const first = byTestId(app.phone.fabric, 'tab-stack')
      expect(first.props['title']).toBe('Stack')
      expect(first.props['isTitleUndefined']).toBe(false)
      expect(first.props['iconType']).toBe('sfSymbol')
      expect(first.props['iconResourceName']).toBe('square.stack')
    })

    it('leaves popping a tab on a second tap to the Model', () => {
      expect(byTestId(app.phone.fabric, 'tab-stack').props['specialEffects']).toEqual({
        repeatedTabSelection: { popToRoot: false, scrollToTop: true },
      })
    })

    it('asks the phone for the first tab at the start', () => {
      expect(byTestId(app.phone.fabric, 'tabs').props['navStateRequest']).toEqual({
        selectedScreenKey: 'stack',
        baseProvenance: 0,
      })
    })

    it('follows a tab the phone selected (native to Model)', async () => {
      await tapTab(app.phone, 'bar', 1)
      // The Model agrees with the phone, so what it asks for is what is shown.
      expect(requestedTab(app.phone)).toBe('bar')
      // Back now acts on the new tab: it has one screen, so Android would leave.
      await press(app.phone.fabric, 'push')
      expect(app.back.press()).toBe(false)
    })

    it('tells the phone when the Model changes tab (Model to native)', async () => {
      await press(app.phone.fabric, 'go-to-bar')
      expect(byTestId(app.phone.fabric, 'tabs').props['navStateRequest']).toEqual({
        selectedScreenKey: 'bar',
        baseProvenance: 0,
      })
    })

    it('sends each request with the last change number the phone reported', async () => {
      await tapTab(app.phone, 'present', 7)
      await tapTab(app.phone, 'stack', 8)
      await press(app.phone.fabric, 'go-to-bar')
      expect(byTestId(app.phone.fabric, 'tabs').props['navStateRequest']).toEqual({
        selectedScreenKey: 'bar',
        baseProvenance: 8,
      })
    })

    it('does not treat the phone answering its own request as a tap', async () => {
      await press(app.phone.fabric, 'go-to-bar')
      // The answer names the tab asked for. A stale one names an older tab:
      // following it would undo the Model's choice.
      app.phone.fabric.emit(byTestId(app.phone.fabric, 'tabs'), 'topTabSelected', {
        selectedScreenKey: 'stack',
        provenance: 3,
        isRepeated: false,
        actionOrigin: 'programmatic-js',
      })
      await settle()
      expect(requestedTab(app.phone)).toBe('bar')
    })

    it('pops a tab to its first screen when its item is tapped again', async () => {
      await press(app.phone.fabric, 'push-three')
      expect(childIds(app.phone, 'levels')).toHaveLength(4)
      await tapTab(app.phone, 'stack', 1, true)
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
    })

    it('keeps a tab as it was left while another is in front', async () => {
      await press(app.phone.fabric, 'push-three')
      await tapTab(app.phone, 'present', 1)
      await tapTab(app.phone, 'stack', 2)
      expect(childIds(app.phone, 'levels')).toHaveLength(4)
      expect(words(app.phone, 'depth')).toBe('Depth 4')
    })
  })

  describe('the stack of routes', () => {
    it('starts with one screen and prints the Model', () => {
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
      expect(words(app.phone, 'depth')).toBe('Depth 1')
      expect(words(app.phone, 'routes')).toBe('Routes in the Model: #1')
    })

    it('pushes', async () => {
      await press(app.phone.fabric, 'push')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-2'])
      expect(byTestId(app.phone.fabric, 'level-2').viewName).toBe('RNSScreen')
      expect(words(app.phone, 'depth')).toBe('Depth 2')
    })

    it('pushes several levels at once', async () => {
      await press(app.phone.fabric, 'push-three')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-2', 'level-3', 'level-4'])
      expect(words(app.phone, 'routes')).toBe('Routes in the Model: #1 > #2 > #3 > #4')
    })

    it('pops when the Model says so', async () => {
      await press(app.phone.fabric, 'push-three')
      await press(app.phone.fabric, 'pop')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-2', 'level-3'])
    })

    it('does not pop the first screen', async () => {
      await press(app.phone.fabric, 'pop')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
    })

    it('pops to a screen further down', async () => {
      await press(app.phone.fabric, 'push-three')
      await press(app.phone.fabric, 'pop-to-second')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-2'])
      await press(app.phone.fabric, 'push-three')
      await press(app.phone.fabric, 'pop-to-root')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
    })

    it('replaces the top screen with a new one', async () => {
      await press(app.phone.fabric, 'push')
      const before = byTestId(app.phone.fabric, 'level-2').reactTag
      await press(app.phone.fabric, 'replace')
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-3'])
      expect(byTestId(app.phone.fabric, 'level-3').reactTag).not.toBe(before)
      expect(words(app.phone, 'depth')).toBe('Depth 2')
    })

    it('keeps the screens below the top as the same native views', async () => {
      await press(app.phone.fabric, 'push')
      const first = byTestId(app.phone.fabric, 'level-1').reactTag
      const second = byTestId(app.phone.fabric, 'level-2').reactTag
      await press(app.phone.fabric, 'push')
      await press(app.phone.fabric, 'pop')
      expect(byTestId(app.phone.fabric, 'level-1').reactTag).toBe(first)
      expect(byTestId(app.phone.fabric, 'level-2').reactTag).toBe(second)
    })

    it('catches the Model up when the phone pops one screen (swipe-back)', async () => {
      await press(app.phone.fabric, 'push-three')
      await dismiss(app.phone, 'level-4', 1)
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-2', 'level-3'])
      expect(words(app.phone, 'routes')).toBe('Routes in the Model: #1 > #2 > #3')
    })

    it('catches the Model up when the phone pops several screens at once', async () => {
      await press(app.phone.fabric, 'push-three')
      await dismiss(app.phone, 'level-4', 3)
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
      // The Model agrees: one push opens exactly one screen.
      await press(app.phone.fabric, 'push')
      expect(childIds(app.phone, 'levels')).toHaveLength(2)
      expect(words(app.phone, 'depth')).toBe('Depth 2')
    })
  })

  describe('modals and sheets', () => {
    beforeEach(async () => {
      await tapTab(app.phone, 'present', 1)
    })

    it('presents a modal in the view made for presented screens', async () => {
      await press(app.phone.fabric, 'open-modal')
      expect(childIds(app.phone, 'presented')).toEqual(['present-home', 'modal'])
      const modal = byTestId(app.phone.fabric, 'modal')
      expect(modal.viewName).toBe('RNSModalScreen')
      expect(modal.props['stackPresentation']).toBe('modal')
      // What every screen in a native stack needs.
      expect(modal.props['activityState']).toBe(2)
      expect(modal.props['gestureResponseDistance']).toEqual({
        start: -1,
        end: -1,
        top: -1,
        bottom: -1,
      })
      expect(modal.props['position']).toBe('absolute')
    })

    it('presents a sheet with its heights', async () => {
      await press(app.phone.fabric, 'open-sheet')
      const sheet = byTestId(app.phone.fabric, 'sheet')
      expect(sheet.props['stackPresentation']).toBe('formSheet')
      expect(sheet.props['sheetAllowedDetents']).toEqual([0.5, 1])
      expect(sheet.props['sheetGrabberVisible']).toBe(true)
    })

    it('can present through the plain screen view too', async () => {
      await press(app.phone.fabric, 'open-plain-modal')
      const modal = byTestId(app.phone.fabric, 'plain-modal')
      expect(modal.viewName).toBe('RNSScreen')
      expect(modal.props['stackPresentation']).toBe('modal')
    })

    it('closes by button (the Model)', async () => {
      await press(app.phone.fabric, 'open-modal')
      await press(app.phone.fabric, 'close')
      expect(childIds(app.phone, 'presented')).toEqual(['present-home'])
      expect(words(app.phone, 'closed-by-button')).toBe('Closed by the button: 1')
      expect(words(app.phone, 'closed-by-phone')).toBe('Closed by the phone: 0')
    })

    it('catches the Model up when a swipe-down closes it (the phone)', async () => {
      await press(app.phone.fabric, 'open-sheet')
      await dismiss(app.phone, 'sheet', 1)
      expect(childIds(app.phone, 'presented')).toEqual(['present-home'])
      expect(words(app.phone, 'closed-by-phone')).toBe('Closed by the phone: 1')
      // The Model agrees: opening again shows exactly one sheet.
      await press(app.phone.fabric, 'open-sheet')
      expect(childIds(app.phone, 'presented')).toEqual(['present-home', 'sheet'])
    })
  })

  describe('the navigation bar', () => {
    beforeEach(async () => {
      await tapTab(app.phone, 'bar', 1)
    })

    const barOf = (id: string) => {
      const found = byTestId(app.phone.fabric, id).children.find(
        child => child.viewName === 'RNSScreenStackHeaderConfig',
      )
      if (found === undefined) throw new Error(`No navigation bar on ${id}`)
      return found
    }

    it('describes the right button to iOS as data on the bar', () => {
      expect(barOf('bar-options').props['headerRightBarButtonItems']).toEqual([
        { buttonId: 'right', index: 0, title: 'Add', sfSymbolName: 'plus' },
      ])
      // No view of ours in the bar: iOS draws the button itself.
      expect(barOf('bar-options').children).toHaveLength(0)
    })

    it('turns a press on the bar button into a Message', async () => {
      app.phone.fabric.emit(barOf('bar-options'), 'topPressHeaderBarButtonItem', {
        buttonId: 'right',
      })
      await settle()
      expect(words(app.phone, 'bar-presses')).toBe('Bar button pressed: 1')
      // A press on a button that is not ours is not counted.
      app.phone.fabric.emit(barOf('bar-options'), 'topPressHeaderBarButtonItem', {
        buttonId: 'someone-else',
      })
      await settle()
      expect(words(app.phone, 'bar-presses')).toBe('Bar button pressed: 1')
    })

    it('shows the count as a badge on the tab', async () => {
      expect(byTestId(app.phone.fabric, 'tab-bar').props['badgeValue']).toBeUndefined()
      app.phone.fabric.emit(barOf('bar-options'), 'topPressHeaderBarButtonItem', {
        buttonId: 'right',
      })
      await settle()
      expect(byTestId(app.phone.fabric, 'tab-bar').props['badgeValue']).toBe('1')
    })

    it('turns the large title on and off', async () => {
      expect(barOf('bar-options').props['largeTitle']).toBe(false)
      await press(app.phone.fabric, 'toggle-large-title')
      expect(barOf('bar-options').props['largeTitle']).toBe(true)
      await press(app.phone.fabric, 'toggle-large-title')
      expect(barOf('bar-options').props['largeTitle']).toBe(false)
    })

    it('hides the bar and shows it again', async () => {
      expect(barOf('bar-options').props['hidden']).toBe(false)
      await press(app.phone.fabric, 'toggle-bar')
      expect(barOf('bar-options').props['hidden']).toBe(true)
      await press(app.phone.fabric, 'toggle-bar')
      expect(barOf('bar-options').props['hidden']).toBe(false)
    })

    it('names the back button', async () => {
      await press(app.phone.fabric, 'open-detail')
      expect(barOf('bar-detail').props['title']).toBe('Next screen')
      expect(barOf('bar-detail').props['backTitle']).toBe('Options')
    })

    it('lets the phone close a screen that does not block back', async () => {
      await press(app.phone.fabric, 'open-detail')
      const detail = byTestId(app.phone.fabric, 'bar-detail')
      expect(detail.props['preventNativeDismiss']).toBe(false)
      expect(detail.props['nativeBackButtonDismissalEnabled']).toBe(true)
    })

    it('refuses a native back while the Model blocks it, and counts the attempt', async () => {
      await press(app.phone.fabric, 'toggle-block')
      await press(app.phone.fabric, 'open-detail')
      const detail = byTestId(app.phone.fabric, 'bar-detail')
      expect(detail.props['preventNativeDismiss']).toBe(true)
      expect(detail.props['nativeBackButtonDismissalEnabled']).toBe(false)
      // iOS refuses the swipe itself and reports the attempt.
      app.phone.fabric.emit(detail, 'topNativeDismissCancelled', { dismissCount: 1 })
      await settle()
      expect(childIds(app.phone, 'bar')).toEqual(['bar-options', 'bar-detail'])
      expect(words(app.phone, 'refused')).toBe('Back refused: 1')
    })

    it('lets go when the Model stops blocking', async () => {
      await press(app.phone.fabric, 'toggle-block')
      await press(app.phone.fabric, 'open-detail')
      await press(app.phone.fabric, 'toggle-block-here')
      const detail = byTestId(app.phone.fabric, 'bar-detail')
      expect(detail.props['preventNativeDismiss']).toBe(false)
      expect(detail.props['nativeBackButtonDismissalEnabled']).toBe(true)
      await dismiss(app.phone, 'bar-detail', 1)
      expect(childIds(app.phone, 'bar')).toEqual(['bar-options'])
    })

    it('still pops a blocked screen when the Model says so', async () => {
      await press(app.phone.fabric, 'toggle-block')
      await press(app.phone.fabric, 'open-detail')
      await press(app.phone.fabric, 'leave-detail')
      expect(childIds(app.phone, 'bar')).toEqual(['bar-options'])
    })
  })

  describe('leaving', () => {
    it('calls exit from the first tab', async () => {
      expect(app.exits.count).toBe(0)
      await press(app.phone.fabric, 'exit')
      expect(app.exits.count).toBe(1)
    })

    it('stops listening for Back when the program stops', async () => {
      expect(app.back.listenerCount()).toBe(1)
      await app.stop()
      expect(app.back.listenerCount()).toBe(0)
      app = await start('ios')
    })
  })
})

describe('the navigation demo on the simulated phone (Android)', () => {
  let app: Started

  beforeEach(async () => {
    app = await start('android')
  })

  afterEach(async () => {
    await app.stop()
  })

  it('uses Android\'s tab views', () => {
    const bar = byTestId(app.phone.fabric, 'tabs')
    expect(bar.viewName).toBe('RNSTabsHostAndroid')
    expect(bar.children.map(child => child.viewName)).toEqual([
      'RNSTabsScreenAndroid',
      'RNSTabsScreenAndroid',
      'RNSTabsScreenAndroid',
    ])
  })

  it('uses the one screen view Android has for a modal', async () => {
    await tapTab(app.phone, 'present', 1)
    await press(app.phone.fabric, 'open-modal')
    expect(byTestId(app.phone.fabric, 'modal').viewName).toBe('RNSScreen')
  })

  it('has the bar make room for the status bar', () => {
    const bar = byTestId(app.phone.fabric, 'level-1').children.find(
      child => child.viewName === 'RNSScreenStackHeaderConfig',
    )
    expect(bar?.props['consumeTopInset']).toBe(true)
  })

  describe('the hardware Back button', () => {
    it('is declined on a first screen, so Android leaves the app', () => {
      expect(app.back.press()).toBe(false)
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
    })

    it('pops the top screen through the Model when deeper', async () => {
      await press(app.phone.fabric, 'push-three')
      expect(app.back.press()).toBe(true)
      await settle()
      expect(childIds(app.phone, 'levels')).toEqual(['level-1', 'level-2', 'level-3'])
      expect(words(app.phone, 'routes')).toBe('Routes in the Model: #1 > #2 > #3')
    })

    it('walks all the way down, then is declined', async () => {
      await press(app.phone.fabric, 'push')
      expect(app.back.press()).toBe(true)
      await settle()
      expect(childIds(app.phone, 'levels')).toEqual(['level-1'])
      expect(app.back.press()).toBe(false)
    })

    it('acts on the tab in front', async () => {
      await press(app.phone.fabric, 'push')
      await tapTab(app.phone, 'present', 1)
      // The first tab is two deep, but it is not the one showing.
      expect(app.back.press()).toBe(false)
      expect(childIds(app.phone, 'levels')).toHaveLength(2)
    })

    it('closes a modal', async () => {
      await tapTab(app.phone, 'present', 1)
      await press(app.phone.fabric, 'open-modal')
      expect(app.back.press()).toBe(true)
      await settle()
      expect(childIds(app.phone, 'presented')).toEqual(['present-home'])
    })

    it('is taken and refused on a screen that blocks back', async () => {
      await tapTab(app.phone, 'bar', 1)
      await press(app.phone.fabric, 'toggle-block')
      await press(app.phone.fabric, 'open-detail')
      expect(app.back.press()).toBe(true)
      await settle()
      expect(childIds(app.phone, 'bar')).toEqual(['bar-options', 'bar-detail'])
      expect(words(app.phone, 'refused')).toBe('Back refused: 1')
    })
  })

  describe('the navigation bar', () => {
    beforeEach(async () => {
      await tapTab(app.phone, 'bar', 1)
    })

    it('draws the right button as a view in the bar\'s right slot', () => {
      const bar = byTestId(app.phone.fabric, 'bar-options').children.find(
        child => child.viewName === 'RNSScreenStackHeaderConfig',
      )
      expect(bar?.props['headerRightBarButtonItems']).toBeUndefined()
      expect(bar?.children.map(child => child.viewName)).toEqual(['RNSScreenStackHeaderSubview'])
      expect(bar?.children[0]?.props['type']).toBe('right')
      expect(textOf(byTestId(app.phone.fabric, 'bar-button'))).toBe('Add')
    })

    it('turns a press on that view into a Message', async () => {
      await press(app.phone.fabric, 'bar-button')
      expect(words(app.phone, 'bar-presses')).toBe('Bar button pressed: 1')
    })

    it('hands the bar\'s back arrow to the Model while back is blocked', async () => {
      await press(app.phone.fabric, 'toggle-block')
      await press(app.phone.fabric, 'open-detail')
      app.phone.fabric.emit(byTestId(app.phone.fabric, 'bar-detail'), 'topHeaderBackButtonClicked', {})
      await settle()
      expect(hasTestId(app.phone.fabric, 'bar-detail')).toBe(true)
      expect(words(app.phone, 'refused')).toBe('Back refused: 1')
    })
  })
})
