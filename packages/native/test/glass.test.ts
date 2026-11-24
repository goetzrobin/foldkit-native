/**
 * Liquid Glass on the simulated phone.
 *
 * With the native code in the build: the right native views exist, with the
 * props Expo's native view reads. Without it: plain views in the same
 * places. Then the demo, pressed through from the first screen to the tabs
 * screen and out.
 *
 * The simulated phone cannot show glass. These tests check what the phone
 * was asked to draw.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import type { FakeFabric, FakeFabricNode } from '@ng-native/testing/fake'
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type ExpoGlobal,
  FALLBACK_LOOK,
  type GlassSettings,
  configureGlass,
  expoViewName,
  glass,
  glassContainer,
  glassContainerOptions,
  glassOptions,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  liquidGlassStatus,
  liquidGlassUnavailableReason,
  registerGlass,
  resetGlass,
} from '../src/glass/index.js'
import {
  type NativeSurface,
  onPress,
  prop,
  registerNavigation,
  style,
  text,
  view as box,
} from '../src/index.js'
import { makeDemo } from './demos/glass.js'
import { makeDemos } from './demos/index.js'
import { Phone as PhoneFeatures } from '../src/index.js'
import { byTestId, flatten, hasTestId, press, settle, startPhone, textOf } from './support/phone.js'

const GLASS_VIEW = 'ViewManagerAdapter_ExpoGlassEffect_GlassView'
const CONTAINER_VIEW = 'ViewManagerAdapter_ExpoGlassEffect_GlassContainer'

/** Expo's global object as a phone with Liquid Glass has it. */
const expoWith = (changes: Partial<ExpoGlobal> & { module?: object | null } = {}): ExpoGlobal => {
  const { module, ...rest } = changes
  return {
    modules:
      module === null
        ? {}
        : {
            ExpoGlassEffect: {
              isLiquidGlassAvailable: true,
              isGlassEffectAPIAvailable: true,
              ...module,
            },
          },
    getViewConfig: () => ({ validAttributes: {}, directEventTypes: {} }),
    ...rest,
  }
}

/** A phone whose build has Liquid Glass, or one whose build does not. */
const prepare = (expo: ExpoGlobal | null, platform: 'ios' | 'android' = 'ios') => {
  resetGlass()
  const phone = startPhone(platform)
  registerNavigation()
  configureGlass({ expo })
  registerGlass()
  return phone
}

const named = (fabric: FakeFabric, viewName: string): Array<FakeFabricNode> =>
  flatten(fabric.committed).filter(node => node.viewName === viewName)

afterEach(() => {
  resetGlass()
  delete (globalThis as { expo?: unknown }).expo
  registerPlatformComponents('ios')
})

describe('finding Liquid Glass', () => {
  it('is there when the module says so and both native views exist', () => {
    prepare(expoWith())
    expect(isLiquidGlassAvailable()).toBe(true)
    expect(isGlassEffectAPIAvailable()).toBe(true)
    expect(liquidGlassUnavailableReason()).toBe('')
    expect(liquidGlassStatus()).toBe('Liquid Glass: available')
  })

  it('reads the real global when it is told nothing else', () => {
    resetGlass()
    startPhone().surface.dispose()
    ;(globalThis as { expo?: unknown }).expo = expoWith()
    registerGlass()
    expect(isLiquidGlassAvailable()).toBe(true)
  })

  it('is not there until the app has called registerGlass', () => {
    resetGlass()
    startPhone().surface.dispose()
    configureGlass({ expo: expoWith() })
    expect(isLiquidGlassAvailable()).toBe(false)
    expect(liquidGlassUnavailableReason()).toBe('the app did not call registerGlass()')
  })

  it.each([
    ['there is no Expo', null, "Expo's native modules are not in this build"],
    [
      'the module is missing',
      expoWith({ module: null }),
      "expo-glass-effect's native code is not in this build",
    ],
    [
      'the phone cannot draw glass',
      expoWith({ module: { isGlassEffectAPIAvailable: false } }),
      'this version of iOS cannot draw Liquid Glass (it needs iOS 26 or later)',
    ],
    [
      'the module says Liquid Glass is off',
      expoWith({ module: { isLiquidGlassAvailable: false } }),
      'Liquid Glass is off for this app, or iOS is older than 26',
    ],
    [
      'a native view is missing',
      expoWith({ getViewConfig: (_module, view) => (view === 'GlassContainer' ? null : {}) }),
      'the native view GlassContainer is missing from this build',
    ],
  ])('is not there when %s, and says why', (_name, expo, reason) => {
    prepare(expo)
    expect(isLiquidGlassAvailable()).toBe(false)
    expect(liquidGlassUnavailableReason()).toBe(reason)
    expect(liquidGlassStatus()).toBe(`Liquid Glass: not available (${reason})`)
  })

  it('is not there on Android, where the package has no native code', () => {
    prepare(expoWith({ module: null }), 'android')
    expect(isLiquidGlassAvailable()).toBe(false)
    expect(liquidGlassUnavailableReason()).toBe('Android has no Liquid Glass')
  })

  it('never throws when looking goes wrong', () => {
    prepare(
      expoWith({
        getViewConfig: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(isLiquidGlassAvailable()).toBe(false)
    expect(liquidGlassUnavailableReason()).toBe('looking for Liquid Glass failed (boom)')

    const hostile = {} as ExpoGlobal
    Object.defineProperty(hostile, 'modules', {
      get: () => {
        throw new Error('no modules')
      },
    })
    prepare(hostile)
    expect(isLiquidGlassAvailable()).toBe(false)
    expect(isGlassEffectAPIAvailable()).toBe(false)
  })

  it('can be switched off, and on, by the app', () => {
    prepare(expoWith())
    configureGlass({ available: false })
    expect(isLiquidGlassAvailable()).toBe(false)
    expect(liquidGlassUnavailableReason()).toBe('switched off by the app')
    prepare(null)
    configureGlass({ available: true })
    expect(isLiquidGlassAvailable()).toBe(true)
  })

  it("names a view as Expo does, with Expo Go's project name where there is one", () => {
    prepare(expoWith())
    expect(expoViewName('ExpoGlassEffect', 'GlassView')).toBe(GLASS_VIEW)
    prepare(expoWith({ __expo_app_identifier__: 'abc123' }))
    expect(expoViewName('ExpoGlassEffect', 'GlassView')).toBe(`${GLASS_VIEW}_abc123`)
  })
})

// A small program with one glass view, one container, and switches.

const Model = Schema.Struct({
  glassStyle: Schema.Literals(['regular', 'clear', 'none']),
  isTinted: Schema.Boolean,
  isInteractive: Schema.Boolean,
  isAnimated: Schema.Boolean,
  isFallbackForced: Schema.Boolean,
  spacing: Schema.Number,
  presses: Schema.Number,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedGlass: {},
  /** One of `CHANGES`, by name. */
  PressedChange: { name: Schema.String },
})
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedGlass: () => ({ model: modifyFields(model, { presses: count => count + 1 }) }),
    PressedChange: ({ name }) => ({ model: { ...model, ...CHANGES[name] } }),
  })

/** What the test's switches do to the Model. Each is a button on screen. */
const CHANGES: Readonly<Record<string, Partial<Model>>> = {
  clearTintedTouch: { glassStyle: 'clear', isTinted: true, isInteractive: true, spacing: 30 },
  nonePlain: { glassStyle: 'none', isTinted: false, isInteractive: false },
  clearAnimated: { glassStyle: 'clear', isAnimated: true },
  fallback: { isFallbackForced: true },
  glass: { isFallbackForced: false },
}

const FALLBACK = { backgroundColor: '#ffeeaa', borderWidth: 0 } as const

const view = (model: Model, _h: HtmlBuilder<Message>): Html => {
  const settings: GlassSettings = {
    glassStyle: model.glassStyle,
    isInteractive: model.isInteractive,
    isFallbackForced: model.isFallbackForced,
    ...(model.isTinted ? { tintColor: '#ff000033' } : {}),
    ...(model.isAnimated ? { isStyleAnimated: true, styleAnimationSeconds: 0.5 } : {}),
  }
  const switches = Object.keys(CHANGES).map(name =>
    box([prop('testID', `change-${name}`), onPress(Message.PressedChange({ name }))], []),
  )
  return box([], [...switches, panes(model, settings)])
}

const panes = (model: Model, settings: GlassSettings): Html =>
  glassContainer(
    [
      prop('testID', 'container'),
      glassContainerOptions({ spacing: model.spacing, isFallbackForced: model.isFallbackForced }),
      style({ flexDirection: 'row', gap: 8 }),
    ],
    [
      glass(
        [
          prop('testID', 'pane'),
          glassOptions(settings),
          style({ width: 80, height: 40, borderRadius: 20 }),
          onPress(Message.PressedGlass()),
        ],
        [text([prop('testID', 'presses')], [`Pressed ${model.presses}`])],
      ),
      glass(
        [
          prop('testID', 'custom'),
          glassOptions({ fallbackStyle: FALLBACK, isFallbackForced: model.isFallbackForced }),
          style({ width: 40 }),
          style({ height: 40 }),
        ],
        [],
      ),
    ],
  )

const FIRST: Model = {
  glassStyle: 'regular',
  isTinted: false,
  isInteractive: false,
  isAnimated: false,
  isFallbackForced: false,
  spacing: 12,
  presses: 0,
}

describe('glass views', () => {
  let surface: NativeSurface | undefined
  let handle: { dispose: () => void } | undefined
  let fabricNow: FakeFabric

  const start = async (expo: ExpoGlobal | null, platform: 'ios' | 'android' = 'ios') => {
    const phone = prepare(expo, platform)
    surface = phone.surface
    const program = Runtime.makeElement({
      Model,
      init: () => ({ model: FIRST }),
      update,
      view,
      container: phone.surface.container,
    })
    handle = Runtime.embed(program)
    fabricNow = phone.fabric
    await settle()
    return phone.fabric
  }
  const change = (name: keyof typeof CHANGES): Promise<void> => press(fabricNow, `change-${name}`)

  afterEach(async () => {
    handle?.dispose()
    handle = undefined
    await settle()
    surface?.dispose()
    surface = undefined
  })

  describe('with Liquid Glass in the build', () => {
    it("draws Expo's two native views, by the names Expo gives them", async () => {
      const fabric = await start(expoWith())
      expect(byTestId(fabric, 'container').viewName).toBe(CONTAINER_VIEW)
      expect(byTestId(fabric, 'pane').viewName).toBe(GLASS_VIEW)
      expect(byTestId(fabric, 'container').children.map(child => child.viewName)).toEqual([
        GLASS_VIEW,
        GLASS_VIEW,
      ])
    })

    it("adds Expo Go's project name to the view names", async () => {
      const fabric = await start(expoWith({ __expo_app_identifier__: 'proj_1' }))
      expect(byTestId(fabric, 'container').viewName).toBe(`${CONTAINER_VIEW}_proj_1`)
      expect(byTestId(fabric, 'pane').viewName).toBe(`${GLASS_VIEW}_proj_1`)
    })

    it('sends the props the native view reads, each with its usual value', async () => {
      const fabric = await start(expoWith())
      const pane = byTestId(fabric, 'pane').props
      expect(pane['glassEffectStyle']).toBe('regular')
      expect(pane['isInteractive']).toBe(false)
      expect(pane['colorScheme']).toBe('auto')
      expect(pane['tintColor'] ?? null).toBeNull()
      // The corners and the size, which the native view reads as its own.
      expect(pane['borderRadius']).toBe(20)
      expect(pane['width']).toBe(80)
      expect(byTestId(fabric, 'container').props['spacing']).toBe(12)
      expect(byTestId(fabric, 'container').props['flexDirection']).toBe('row')
      // Nothing of the fallback, and nothing of this project's own.
      expect(pane['backgroundColor']).toBeUndefined()
      expect(pane['glassSettings']).toBeUndefined()
      expect(byTestId(fabric, 'custom').props['backgroundColor']).toBeUndefined()
      expect(byTestId(fabric, 'custom').props['width']).toBe(40)
      expect(byTestId(fabric, 'custom').props['height']).toBe(40)
    })

    it('changes the props on the same views when the options change', async () => {
      const fabric = await start(expoWith())
      const tag = byTestId(fabric, 'pane').reactTag
      await change('clearTintedTouch')
      const pane = byTestId(fabric, 'pane')
      expect(pane.reactTag).toBe(tag)
      expect(pane.props['glassEffectStyle']).toBe('clear')
      expect(pane.props['tintColor']).toBe('#ff000033')
      expect(pane.props['isInteractive']).toBe(true)
      expect(byTestId(fabric, 'container').props['spacing']).toBe(30)

      await change('nonePlain')
      expect(byTestId(fabric, 'pane').props['glassEffectStyle']).toBe('none')
      expect(byTestId(fabric, 'pane').props['tintColor'] ?? null).toBeNull()
      expect(byTestId(fabric, 'pane').props['isInteractive']).toBe(false)
    })

    it('asks for a faded change of style when told to', async () => {
      const fabric = await start(expoWith())
      await change('clearAnimated')
      expect(byTestId(fabric, 'pane').props['glassEffectStyle']).toEqual({
        style: 'clear',
        animate: true,
        animationDuration: 0.5,
      })
    })

    it('hears a press on the glass', async () => {
      const fabric = await start(expoWith())
      await press(fabric, 'pane')
      expect(textOf(byTestId(fabric, 'presses'))).toBe('Pressed 1')
    })

    it('draws the fallback when a view is told to, and glass again after', async () => {
      const fabric = await start(expoWith())
      await change('fallback')
      expect(named(fabric, GLASS_VIEW)).toHaveLength(0)
      expect(named(fabric, CONTAINER_VIEW)).toHaveLength(0)
      expect(byTestId(fabric, 'pane').props['backgroundColor']).toBe(
        FALLBACK_LOOK.backgroundColor,
      )
      await change('glass')
      expect(byTestId(fabric, 'pane').viewName).toBe(GLASS_VIEW)
    })
  })

  describe.each([
    ['on an iPhone without the native code', expoWith({ module: null }), 'ios'],
    ['on an iPhone before iOS 26', expoWith({ module: { isLiquidGlassAvailable: false } }), 'ios'],
    ['on Android', null, 'android'],
  ] as const)('%s', (_name, expo, platform) => {
    it('draws plain views in the same places, with a pale background', async () => {
      const fabric = await start(expo, platform)
      const all = flatten(fabric.committed)
      expect(all.filter(node => node.viewName.includes('ExpoGlassEffect'))).toHaveLength(0)
      const container = byTestId(fabric, 'container')
      const pane = byTestId(fabric, 'pane')
      expect(container.viewName).toBe('View')
      expect(pane.viewName).toBe('View')
      // The same layout as the glass would have.
      expect(container.props['flexDirection']).toBe('row')
      expect(container.props['gap']).toBe(8)
      expect(container.children).toHaveLength(2)
      expect(pane.props['width']).toBe(80)
      expect(pane.props['height']).toBe(40)
      expect(pane.props['borderRadius']).toBe(20)
      expect(pane.props['backgroundColor']).toBe(FALLBACK_LOOK.backgroundColor)
      expect(pane.props['borderWidth']).toBe(1)
      // None of the glass's own props reach a plain view.
      for (const key of ['glassEffectStyle', 'tintColor', 'isInteractive', 'colorScheme']) {
        expect(pane.props[key]).toBeUndefined()
      }
      expect(container.props['spacing']).toBeUndefined()
      expect(container.props['backgroundColor']).toBeUndefined()
    })

    it("uses the caller's fallback style over the pale background", async () => {
      const fabric = await start(expo, platform)
      const custom = byTestId(fabric, 'custom')
      expect(custom.props['backgroundColor']).toBe(FALLBACK.backgroundColor)
      expect(custom.props['borderWidth']).toBe(0)
      expect(custom.props['width']).toBe(40)
      expect(custom.props['height']).toBe(40)
    })

    it('gives the style "none" no background, as the glass would have none', async () => {
      const fabric = await start(expo, platform)
      await change('nonePlain')
      // Taken away again: the phone is told the view has none.
      expect(byTestId(fabric, 'pane').props['backgroundColor'] ?? null).toBeNull()
      expect(byTestId(fabric, 'pane').props['width']).toBe(80)
    })

    it('still hears a press', async () => {
      const fabric = await start(expo, platform)
      await press(fabric, 'pane')
      expect(textOf(byTestId(fabric, 'presses'))).toBe('Pressed 1')
    })
  })

  it('draws the fallback, and does not throw, before registerGlass was called', async () => {
    resetGlass()
    const phone = startPhone()
    surface = phone.surface
    configureGlass({ expo: expoWith() })
    handle = Runtime.embed(
      Runtime.makeElement({
        Model,
        init: () => ({ model: FIRST }),
        update,
        view,
        container: phone.surface.container,
      }),
    )
    await settle()
    expect(byTestId(phone.fabric, 'pane').viewName).toBe('View')
  })
})

describe('the Glass demo', () => {
  let fabric: FakeFabric
  let surface: NativeSurface | undefined
  let handle: { dispose: () => void } | undefined
  let exits = 0

  const start = async (
    expo: ExpoGlobal | null,
    device: { platform: 'ios' | 'android'; osVersion: number } = { platform: 'ios', osVersion: 27 },
  ): Promise<void> => {
    const phone = prepare(expo, device.platform)
    fabric = phone.fabric
    surface = phone.surface
    exits = 0
    handle = Runtime.embed(
      makeDemo(phone.surface.container, {
        device,
        exit: () => {
          exits += 1
        },
      }),
    )
    await settle()
  }
  const status = (): string => textOf(byTestId(fabric, 'glass-status'))
  const glassViews = (): Array<FakeFabricNode> =>
    flatten(fabric.committed).filter(node => node.viewName.startsWith(GLASS_VIEW))

  afterEach(async () => {
    handle?.dispose()
    handle = undefined
    await settle()
    surface?.dispose()
    surface = undefined
  })

  it('is in the menu as Glass', () => {
    const entry = makeDemos({ device: PhoneFeatures.makeTest().layer }).find(
      demo => demo.id === 'glass',
    )
    expect(entry?.title).toBe('Glass')
  })

  describe('with Liquid Glass', () => {
    it('says so, and draws the card, the two shapes, the round button and the pill in glass', async () => {
      await start(expoWith())
      expect(status()).toBe('Liquid Glass: available')
      expect(textOf(byTestId(fabric, 'glass-drawn'))).toContain('Drawing real glass')
      for (const id of ['glass-card', 'shape-a', 'shape-b', 'glass-round', 'glass-pill']) {
        expect(byTestId(fabric, id).viewName).toBe(GLASS_VIEW)
      }
      expect(glassViews()).toHaveLength(5)
      const pair = byTestId(fabric, 'glass-pair')
      expect(pair.viewName).toBe(CONTAINER_VIEW)
      expect(pair.children.map(child => child.props['testID'])).toEqual(['shape-a', 'shape-b'])
      // The glass floats over the scrolling colours, after them in the same box.
      const stage = flatten(fabric.committed).find(node =>
        node.children.includes(byTestId(fabric, 'glass-card')),
      )
      expect(stage?.children[0]?.props['testID']).toBe('glass-background')
      expect(byTestId(fabric, 'glass-round').props['isInteractive']).toBe(true)
      expect(byTestId(fabric, 'glass-card').props['isInteractive']).toBe(false)
    })

    it('counts presses on the round button and on the two halves of the pill', async () => {
      await start(expoWith())
      await press(fabric, 'glass-round')
      await press(fabric, 'pill-more')
      await press(fabric, 'pill-more')
      await press(fabric, 'pill-less')
      expect(textOf(byTestId(fabric, 'counts'))).toBe('Pill count: 1. Round button pressed: 1.')
    })

    it('switches every glass between regular and clear', async () => {
      await start(expoWith())
      await press(fabric, 'style-clear')
      expect(glassViews().map(node => node.props['glassEffectStyle'])).toEqual(
        Array.from({ length: 5 }, () => 'clear'),
      )
      await press(fabric, 'style-regular')
      expect(byTestId(fabric, 'glass-card').props['glassEffectStyle']).toBe('regular')
    })

    it('tints every glass, and takes the tint away again', async () => {
      await start(expoWith())
      await press(fabric, 'toggle-tint')
      expect(textOf(byTestId(fabric, 'toggle-tint'))).toBe('Tint: ON')
      expect(glassViews().every(node => typeof node.props['tintColor'] === 'string')).toBe(true)
      await press(fabric, 'toggle-tint')
      expect(glassViews().every(node => (node.props['tintColor'] ?? null) === null)).toBe(true)
    })

    it('switches the reaction to touch off on the button and the pill, as new views', async () => {
      await start(expoWith())
      const before = byTestId(fabric, 'glass-round').reactTag
      await press(fabric, 'toggle-interactive')
      expect(textOf(byTestId(fabric, 'toggle-interactive'))).toBe('Reacts to touch: OFF')
      expect(byTestId(fabric, 'glass-round').props['isInteractive']).toBe(false)
      expect(byTestId(fabric, 'glass-pill').props['isInteractive']).toBe(false)
      expect(byTestId(fabric, 'glass-round').reactTag).not.toBe(before)
      // Still pressable.
      await press(fabric, 'glass-round')
      expect(textOf(byTestId(fabric, 'counts'))).toContain('Round button pressed: 1')
    })

    it('moves the two shapes apart and together', async () => {
      await start(expoWith())
      expect(byTestId(fabric, 'glass-pair').props['gap']).toBe(6)
      await press(fabric, 'toggle-close')
      expect(textOf(byTestId(fabric, 'toggle-close'))).toBe('Shapes: apart')
      expect(byTestId(fabric, 'glass-pair').props['gap']).toBe(56)
      expect(byTestId(fabric, 'glass-pair').props['spacing']).toBe(28)
    })

    it('can show the fallback for comparison, and the glass again', async () => {
      await start(expoWith())
      await press(fabric, 'toggle-fallback')
      expect(glassViews()).toHaveLength(0)
      expect(byTestId(fabric, 'glass-pill').viewName).toBe('View')
      expect(textOf(byTestId(fabric, 'glass-drawn'))).toContain('Drawing the fallback')
      // The status line is about the build, which has not changed.
      expect(status()).toBe('Liquid Glass: available')
      await press(fabric, 'toggle-fallback')
      expect(glassViews()).toHaveLength(5)
    })
  })

  describe('without Liquid Glass', () => {
    it('says why on an iPhone, and draws plain views that still work', async () => {
      await start(expoWith({ module: null }))
      expect(status()).toBe(
        "Liquid Glass: not available (expo-glass-effect's native code is not in this build)",
      )
      expect(flatten(fabric.committed).some(node => node.viewName.includes('ExpoGlass'))).toBe(
        false,
      )
      expect(byTestId(fabric, 'glass-card').viewName).toBe('View')
      expect(byTestId(fabric, 'glass-card').props['backgroundColor']).toBe(
        FALLBACK_LOOK.backgroundColor,
      )
      // Nothing to compare with, so no switch.
      expect(hasTestId(fabric, 'toggle-fallback')).toBe(false)
      await press(fabric, 'glass-round')
      await press(fabric, 'pill-less')
      expect(textOf(byTestId(fabric, 'counts'))).toBe('Pill count: -1. Round button pressed: 1.')
    })

    it('says Android has none, and tints the fallback when asked', async () => {
      await start(null, { platform: 'android', osVersion: 36 })
      expect(status()).toBe('Liquid Glass: not available (Android has no Liquid Glass)')
      await press(fabric, 'toggle-tint')
      expect(byTestId(fabric, 'glass-card').props['backgroundColor']).not.toBe(
        FALLBACK_LOOK.backgroundColor,
      )
      expect(byTestId(fabric, 'glass-card').props['tintColor']).toBeUndefined()
    })
  })

  describe('the tabs screen', () => {
    const openTabs = async (): Promise<void> => {
      await press(fabric, 'open-tabs')
    }
    const viewNames = (): Array<string> => flatten(fabric.committed).map(node => node.viewName)

    it('opens with a tab bar that shrinks on scroll and a search tab', async () => {
      await start(expoWith())
      await openTabs()
      expect(hasTestId(fabric, 'screen-glass')).toBe(false)
      const bar = byTestId(fabric, 'glass-tabs')
      expect(bar.viewName).toBe('RNSTabsHostIOS')
      expect(bar.props['tabBarMinimizeBehavior']).toBe('onScrollDown')
      expect(bar.children.map(child => child.viewName)).toEqual([
        'RNSTabsScreenIOS',
        'RNSTabsScreenIOS',
        'RNSTabsScreenIOS',
      ])
      expect(byTestId(fabric, 'tab-search').props['tabRole']).toBe('search')
      expect(byTestId(fabric, 'tab-list').props['tabRole']).toBeUndefined()
    })

    it('stops the bar shrinking when switched off', async () => {
      await start(expoWith())
      await openTabs()
      await press(fabric, 'toggle-shrink')
      expect(byTestId(fabric, 'glass-tabs').props['tabBarMinimizeBehavior']).toBe('never')
    })

    it('puts a strip above the bar on iOS 26 and later, and takes it away', async () => {
      await start(expoWith())
      await openTabs()
      expect(viewNames()).not.toContain('RNSTabsBottomAccessory')
      await press(fabric, 'toggle-strip')
      const bar = byTestId(fabric, 'glass-tabs')
      const strip = bar.children.at(-1) as FakeFabricNode
      expect(bar.children).toHaveLength(4)
      expect(strip.viewName).toBe('RNSTabsBottomAccessory')
      expect(strip.children.map(child => child.viewName)).toEqual([
        'RNSTabsBottomAccessoryContent',
        'RNSTabsBottomAccessoryContent',
      ])
      expect(strip.children.map(child => child.props['environment'])).toEqual([
        'regular',
        'inline',
      ])
      expect(textOf(strip.children[0] as FakeFabricNode)).toBe('Strip above the bar')
      await press(fabric, 'toggle-strip')
      expect(viewNames()).not.toContain('RNSTabsBottomAccessory')
      expect(byTestId(fabric, 'glass-tabs').children).toHaveLength(3)
    })

    it.each([
      ['an iPhone before iOS 26', { platform: 'ios', osVersion: 18 }],
      ['Android', { platform: 'android', osVersion: 36 }],
    ] as const)('draws no strip on %s, whose tab bar would refuse it', async (_name, device) => {
      await start(null, device)
      await openTabs()
      await press(fabric, 'toggle-strip')
      expect(viewNames()).not.toContain('RNSTabsBottomAccessory')
      expect(byTestId(fabric, 'glass-tabs').children).toHaveLength(3)
    })

    it('gives the title bar two buttons on glass of their own, and counts their presses', async () => {
      await start(expoWith())
      await openTabs()
      const bar = byTestId(fabric, 'tabs-header')
      expect(bar.props['headerRightBarButtonItems']).toEqual([
        { buttonId: 'share', index: 0, sfSymbolName: 'square.and.arrow.up', sharesBackground: false },
        { buttonId: 'done', index: 1, title: 'Done', variant: 'prominent', sharesBackground: false },
      ])
      fabric.emit(bar, 'topPressHeaderBarButtonItem', { buttonId: 'done' })
      await settle()
      expect(textOf(byTestId(fabric, 'bar-presses'))).toBe('Title bar buttons pressed: 1')
    })

    it('switches how the list meets the bars', async () => {
      await start(expoWith())
      await openTabs()
      const listScreen = (): FakeFabricNode => byTestId(fabric, 'screen-tabs-list')
      expect(listScreen().props['topScrollEdgeEffect']).toBe('soft')
      expect(listScreen().props['bottomScrollEdgeEffect']).toBe('soft')
      expect(listScreen().props['leftScrollEdgeEffect']).toBe('automatic')
      await press(fabric, 'toggle-edge')
      expect(listScreen().props['topScrollEdgeEffect']).toBe('hard')
    })

    it('follows the phone to another tab, and goes back to the glass screen', async () => {
      await start(expoWith())
      await openTabs()
      fabric.emit(byTestId(fabric, 'glass-tabs'), 'topTabSelected', {
        selectedScreenKey: 'saved',
        provenance: 1,
        isRepeated: false,
        actionOrigin: 'user',
      })
      await settle()
      await press(fabric, 'close-tabs-saved')
      expect(hasTestId(fabric, 'glass-tabs')).toBe(false)
      expect(byTestId(fabric, 'glass-card').viewName).toBe(GLASS_VIEW)
      // The switches kept their places.
      expect(textOf(byTestId(fabric, 'toggle-tint'))).toBe('Tint: OFF')
    })
  })

  it('leaves through Exit, once', async () => {
    await start(expoWith())
    await press(fabric, 'exit')
    expect(exits).toBe(1)
  })

  it('takes every view away when it is stopped', async () => {
    await start(expoWith())
    await press(fabric, 'open-tabs')
    handle?.dispose()
    handle = undefined
    await settle()
    expect(flatten(fabric.committed).some(node => node.viewName.includes('ExpoGlass'))).toBe(false)
    expect(flatten(fabric.committed).some(node => node.viewName.startsWith('RNSTabs'))).toBe(false)
  })
})
