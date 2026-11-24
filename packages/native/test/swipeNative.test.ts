/**
 * The native swipe row on the simulated phone.
 *
 * With the native view in the build: the right native view exists, with the
 * props the Swift and Kotlin code read, and what the native view reports
 * becomes Foldkit Messages. Without it (Expo Go): a plain view in the same
 * place, with the same children. Then the demo, in both kinds of build.
 *
 * The simulated phone cannot swipe. These tests check what the phone was
 * asked to draw, and what happens when the native view sends its events.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import type { FakeFabric, FakeFabricNode } from '@ng-native/testing/fake'
import { Effect, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type NativeSurface,
  Phone as PhoneFeatures,
  onPress,
  prop,
  registerNavigation,
  style,
  text,
  view as box,
} from '../src/index.js'
import {
  type NativeSwipeSettings,
  type SwipeExpoGlobal,
  closeNativeSwipes,
  closeNativeSwipesNow,
  configureNativeSwipe,
  isNativeSwipeAvailable,
  nativeSwipeOptions,
  nativeSwipeRow,
  nativeSwipeStatus,
  nativeSwipeUnavailableReason,
  nativeSwipeViewName,
  registerNativeSwipe,
  resetNativeSwipeDetection,
  resetNativeSwipeName,
  swipeAction,
} from '../src/swipeNative/index.js'
import { makeDemos } from './demos/index.js'
import { INBOX_GROUP, makeDemo } from './demos/swipeNative.js'
import { allText, byTestId, flatten, hasTestId, press, settle, startPhone, textOf } from './support/phone.js'

const ROW_VIEW = 'ViewManagerAdapter_FoldkitSwipe_SwipeRowView'
const NEEDS_PREBUILT = 'needs the prebuilt app, see docs/NATIVE_VIEWS.md'

/** Expo's global object as a build with the native module has it. */
const expoWith = (
  changes: Partial<SwipeExpoGlobal> & { module?: object | null } = {},
): SwipeExpoGlobal => {
  const { module, ...rest } = changes
  return {
    modules: module === null ? {} : { FoldkitSwipe: { closeAll: () => undefined, ...module } },
    getViewConfig: () => ({ validAttributes: {}, directEventTypes: {} }),
    ...rest,
  }
}

const reset = (): void => {
  resetNativeSwipeDetection()
  resetNativeSwipeName()
}

/** A phone whose build has the native view, or one whose build does not. */
const prepare = (expo: SwipeExpoGlobal | null, platform: 'ios' | 'android' = 'ios') => {
  reset()
  const phone = startPhone(platform)
  registerNavigation()
  configureNativeSwipe({ expo })
  registerNativeSwipe()
  return phone
}

const named = (fabric: FakeFabric, viewName: string): Array<FakeFabricNode> =>
  flatten(fabric.committed).filter(node => node.viewName === viewName)

afterEach(() => {
  reset()
  delete (globalThis as { expo?: unknown }).expo
  registerPlatformComponents('ios')
})

describe('finding the native swipe view', () => {
  it('is there when the module and its view are in the build', () => {
    prepare(expoWith())
    expect(isNativeSwipeAvailable()).toBe(true)
    expect(nativeSwipeUnavailableReason()).toBe('')
    expect(nativeSwipeStatus()).toBe('Native view: present')
  })

  it('reads the real global when it is told nothing else', () => {
    reset()
    startPhone().surface.dispose()
    ;(globalThis as { expo?: unknown }).expo = expoWith()
    registerNativeSwipe()
    expect(isNativeSwipeAvailable()).toBe(true)
  })

  it('is not there until the app has called registerNativeSwipe', () => {
    reset()
    startPhone().surface.dispose()
    configureNativeSwipe({ expo: expoWith() })
    expect(isNativeSwipeAvailable()).toBe(false)
    expect(nativeSwipeUnavailableReason()).toBe('the app did not call registerNativeSwipe()')
  })

  it.each([
    ['there is no Expo', null, NEEDS_PREBUILT],
    ['the module is missing, as in Expo Go', expoWith({ module: null }), NEEDS_PREBUILT],
    [
      'the view is missing',
      expoWith({ getViewConfig: () => null }),
      'the native view SwipeRowView is missing from this build',
    ],
  ])('is not there when %s, and says why', (_name, expo, reason) => {
    prepare(expo)
    expect(isNativeSwipeAvailable()).toBe(false)
    expect(nativeSwipeUnavailableReason()).toBe(reason)
    expect(nativeSwipeStatus()).toBe(`Native view: not present: ${reason}`)
  })

  it('never throws when looking goes wrong', () => {
    prepare(
      expoWith({
        getViewConfig: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(isNativeSwipeAvailable()).toBe(false)
    expect(nativeSwipeUnavailableReason()).toBe('looking for the native view failed (boom)')

    const hostile = {} as SwipeExpoGlobal
    Object.defineProperty(hostile, 'modules', {
      get: () => {
        throw new Error('no modules')
      },
    })
    prepare(hostile)
    expect(isNativeSwipeAvailable()).toBe(false)
    expect(() => closeNativeSwipesNow('any')).not.toThrow()
  })

  it('can be switched off, and on, by the app', () => {
    prepare(expoWith())
    configureNativeSwipe({ available: false })
    expect(isNativeSwipeAvailable()).toBe(false)
    expect(nativeSwipeUnavailableReason()).toBe('switched off by the app')
    prepare(null)
    configureNativeSwipe({ available: true })
    expect(isNativeSwipeAvailable()).toBe(true)
  })

  it("names the view as Expo does, with Expo Go's project name where there is one", () => {
    prepare(expoWith())
    expect(nativeSwipeViewName()).toBe(ROW_VIEW)
    prepare(expoWith({ __expo_app_identifier__: 'abc123' }))
    expect(nativeSwipeViewName()).toBe(`${ROW_VIEW}_abc123`)
  })
})

// A small program with one swipe row and switches.

const Model = Schema.Struct({
  log: Schema.Array(Schema.String),
  isFlagged: Schema.Boolean,
  mode: Schema.Literals(['tiles', 'strip', 'info']),
  closeSignal: Schema.Number,
  isBare: Schema.Boolean,
  isFallbackForced: Schema.Boolean,
  presses: Schema.Number,
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  Opened: { side: Schema.String },
  Closed: {},
  TriggeredDelete: { viaFullSwipe: Schema.Boolean },
  TriggeredFlag: {},
  TriggeredOther: { key: Schema.String },
  PressedInside: {},
  /** One of `CHANGES`, by name. */
  PressedChange: { name: Schema.String },
})
type Message = typeof Message.Type

const CHANGES: Readonly<Record<string, (model: Model) => Partial<Model>>> = {
  strip: () => ({ mode: 'strip' }),
  close: model => ({ closeSignal: model.closeSignal + 1 }),
  bare: () => ({ isBare: true }),
  fallback: () => ({ isFallbackForced: true }),
}

const logged = (model: Model, line: string): Model =>
  modifyFields(model, { log: log => [...log, line] })

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    Opened: ({ side }) => ({ model: logged(model, `opened ${side}`) }),
    Closed: () => ({ model: logged(model, 'closed') }),
    TriggeredDelete: ({ viaFullSwipe }) => ({
      model: logged(model, `delete ${viaFullSwipe ? 'full' : 'press'}`),
    }),
    TriggeredFlag: () => ({
      model: { ...logged(model, 'flag'), isFlagged: !model.isFlagged },
    }),
    TriggeredOther: ({ key }) => ({ model: logged(model, `other ${key}`) }),
    PressedInside: () => ({ model: modifyFields(model, { presses: count => count + 1 }) }),
    PressedChange: ({ name }) => ({ model: { ...model, ...CHANGES[name]?.(model) } }),
  })

const settingsOf = (model: Model): NativeSwipeSettings<Message> =>
  model.isBare
    ? { isFallbackForced: model.isFallbackForced }
    : {
        trailing: [
          swipeAction({
            key: 'delete',
            label: 'Delete',
            symbol: 'trash',
            role: 'destructive',
            onTriggered: ({ viaFullSwipe }) => Message.TriggeredDelete({ viaFullSwipe }),
          }),
          // A Message as it is, with no function around it.
          swipeAction({
            key: 'flag',
            label: model.isFlagged ? 'Unflag' : 'Flag',
            tint: '#d97706',
            onTriggered: Message.TriggeredFlag(),
          }),
          // No Message of its own: the row's `onActionTriggered` gets it.
          swipeAction({ key: 'more', label: 'More', role: 'cancel' }),
        ],
        leading: [swipeAction({ key: 'read', label: 'Read', symbol: 'envelope.open' })],
        allowsFullSwipe: true,
        mode: model.mode,
        group: 'inbox',
        cornerRadius: 12,
        isEnabled: true,
        layoutDirection: 'rtl',
        closeSignal: model.closeSignal,
        isFallbackForced: model.isFallbackForced,
        fallbackStyle: { backgroundColor: '#eeeeee' },
        onOpened: side => Message.Opened({ side }),
        onClosed: () => Message.Closed(),
        onActionTriggered: ({ key }) => Message.TriggeredOther({ key }),
      }

const view = (model: Model, _h: HtmlBuilder<Message>): Html =>
  box(
    [],
    [
      ...Object.keys(CHANGES).map(name =>
        box([prop('testID', `change-${name}`), onPress(Message.PressedChange({ name }))], []),
      ),
      text([prop('testID', 'log')], [model.log.join(', ')]),
      nativeSwipeRow(
        [prop('testID', 'row'), nativeSwipeOptions(settingsOf(model)), style({ marginBottom: 4 })],
        [
          box(
            [prop('testID', 'inside'), onPress(Message.PressedInside())],
            [text([prop('testID', 'presses')], [`Pressed ${model.presses}`])],
          ),
        ],
      ),
    ],
  )

const FIRST: Model = {
  log: [],
  isFlagged: false,
  mode: 'tiles',
  closeSignal: 0,
  isBare: false,
  isFallbackForced: false,
  presses: 0,
}

describe('the swipe row', () => {
  let surface: NativeSurface | undefined
  let handle: { dispose: () => void } | undefined
  let fabricNow: FakeFabric

  const start = async (expo: SwipeExpoGlobal | null, platform: 'ios' | 'android' = 'ios') => {
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
  /** The native view reporting something, as the phone would. */
  const report = async (name: string, payload: object): Promise<void> => {
    fabricNow.emit(byTestId(fabricNow, 'row'), name, payload)
    await settle()
  }
  const log = (): string => textOf(byTestId(fabricNow, 'log'))

  afterEach(async () => {
    handle?.dispose()
    handle = undefined
    await settle()
    surface?.dispose()
    surface = undefined
  })

  describe('with the native view in the build', () => {
    it.each(['ios', 'android'] as const)(
      'draws the native view by the name Expo gives it, on %s',
      async platform => {
        const fabric = await start(expoWith(), platform)
        expect(byTestId(fabric, 'row').viewName).toBe(ROW_VIEW)
        expect(named(fabric, ROW_VIEW)).toHaveLength(1)
      },
    )

    it("adds Expo Go's project name to the view name", async () => {
      const fabric = await start(expoWith({ __expo_app_identifier__: 'proj_1' }))
      expect(byTestId(fabric, 'row').viewName).toBe(`${ROW_VIEW}_proj_1`)
    })

    it('sends the props the Swift and Kotlin code read', async () => {
      const fabric = await start(expoWith())
      const { props } = byTestId(fabric, 'row')
      expect(props['actionsTrailing']).toEqual([
        { key: 'delete', label: 'Delete', symbol: 'trash', role: 'destructive', tint: null },
        { key: 'flag', label: 'Flag', symbol: null, role: 'normal', tint: '#d97706' },
        { key: 'more', label: 'More', symbol: null, role: 'cancel', tint: null },
      ])
      expect(props['actionsLeading']).toEqual([
        { key: 'read', label: 'Read', symbol: 'envelope.open', role: 'normal', tint: null },
      ])
      expect(props).toMatchObject({
        allowsFullSwipe: true,
        mode: 'tiles',
        group: 'inbox',
        cornerRadius: 12,
        isEnabled: true,
        rowDirection: 'rtl',
        closeSignal: 0,
      })
    })

    it('sends no functions and none of its own settings across', async () => {
      const fabric = await start(expoWith())
      const { props } = byTestId(fabric, 'row')
      expect(props['nativeSwipeSettings']).toBeUndefined()
      expect(JSON.stringify(props['actionsTrailing'])).not.toContain('onTriggered')
    })

    it('sends every prop with its usual value when it is told nothing', async () => {
      const fabric = await start(expoWith())
      await change('bare')
      expect(byTestId(fabric, 'row').props).toMatchObject({
        actionsLeading: [],
        actionsTrailing: [],
        allowsFullSwipe: true,
        mode: 'tiles',
        group: '',
        cornerRadius: 0,
        isEnabled: true,
        rowDirection: 'auto',
        closeSignal: 0,
      })
    })

    it('keeps the children inside the native view, and its styles on it', async () => {
      const fabric = await start(expoWith())
      const row = byTestId(fabric, 'row')
      expect(flatten(row.children).some(node => node.props['testID'] === 'inside')).toBe(true)
      expect(row.props).toMatchObject({ marginBottom: 4, overflow: 'hidden' })
    })

    it('turns "opened" and "closed" into Messages', async () => {
      await start(expoWith())
      await report('topSwipeOpened', { side: 'trailing' })
      await report('topSwipeClosed', {})
      await report('topSwipeOpened', { side: 'leading' })
      expect(log()).toBe('opened trailing, closed, opened leading')
    })

    it("turns a triggered action into that action's Message", async () => {
      await start(expoWith())
      await report('topActionTriggered', { key: 'delete', viaFullSwipe: true })
      await report('topActionTriggered', { key: 'delete', viaFullSwipe: false })
      await report('topActionTriggered', { key: 'flag', viaFullSwipe: false })
      expect(log()).toBe('delete full, delete press, flag')
    })

    it("gives an action with no Message of its own to the row's handler", async () => {
      await start(expoWith())
      await report('topActionTriggered', { key: 'more', viaFullSwipe: false })
      await report('topActionTriggered', { key: 'read', viaFullSwipe: true })
      expect(log()).toBe('other more, other read')
    })

    it('ignores an event it cannot read', async () => {
      await start(expoWith())
      await report('topActionTriggered', {})
      await report('topActionTriggered', { key: 7 })
      expect(log()).toBe('')
    })

    it('sends changed props after a Message, and a new close signal', async () => {
      const fabric = await start(expoWith())
      await report('topActionTriggered', { key: 'flag', viaFullSwipe: false })
      const trailing = byTestId(fabric, 'row').props['actionsTrailing'] as Array<{ label: string }>
      expect(trailing[1]?.label).toBe('Unflag')
      await change('strip')
      await change('close')
      expect(byTestId(fabric, 'row').props).toMatchObject({ mode: 'strip', closeSignal: 1 })
    })

    it('still lets a button inside the row be pressed', async () => {
      const fabric = await start(expoWith())
      await press(fabric, 'inside')
      expect(textOf(byTestId(fabric, 'presses'))).toBe('Pressed 1')
    })

    it('draws the plain fallback when it is forced to', async () => {
      const fabric = await start(expoWith())
      await change('fallback')
      expect(named(fabric, ROW_VIEW)).toHaveLength(0)
      expect(byTestId(fabric, 'row').props).toMatchObject({ backgroundColor: '#eeeeee' })
    })

    it('stops listening when the program is disposed', async () => {
      const fabric = await start(expoWith())
      const row = byTestId(fabric, 'row')
      handle?.dispose()
      handle = undefined
      await settle()
      expect(() => fabric.emit(row, 'topSwipeOpened', { side: 'trailing' })).not.toThrow()
      surface?.dispose()
      surface = undefined
      expect(() => fabric.emit(row, 'topActionTriggered', { key: 'delete' })).not.toThrow()
    })
  })

  describe('without the native view, as in Expo Go', () => {
    it.each(['ios', 'android'] as const)('draws a plain view with the same children, on %s', async platform => {
      const fabric = await start(expoWith({ module: null }), platform)
      const row = byTestId(fabric, 'row')
      expect(named(fabric, ROW_VIEW)).toHaveLength(0)
      expect(row.viewName).not.toContain('ViewManagerAdapter')
      expect(flatten(row.children).some(node => node.props['testID'] === 'inside')).toBe(true)
      expect(row.props).toMatchObject({ marginBottom: 4, backgroundColor: '#eeeeee' })
    })

    it('sends none of the native props to the plain view', async () => {
      const fabric = await start(null)
      const { props } = byTestId(fabric, 'row')
      for (const key of ['actionsTrailing', 'actionsLeading', 'mode', 'group', 'closeSignal', 'nativeSwipeSettings']) {
        expect(props[key]).toBeUndefined()
      }
    })

    it('still lets a button inside the row be pressed', async () => {
      const fabric = await start(null)
      await press(fabric, 'inside')
      expect(textOf(byTestId(fabric, 'presses'))).toBe('Pressed 1')
    })
  })
})

describe('closing rows from JavaScript', () => {
  it('calls the native function with the group', () => {
    const calls: Array<string> = []
    prepare(expoWith({ module: { closeAll: (group: string) => void calls.push(group) } }))
    closeNativeSwipesNow('inbox')
    Effect.runSync(closeNativeSwipes('archive'))
    expect(calls).toEqual(['inbox', 'archive'])
  })

  it('does nothing until the Effect is run', () => {
    const calls: Array<string> = []
    prepare(expoWith({ module: { closeAll: (group: string) => void calls.push(group) } }))
    const effect = closeNativeSwipes('inbox')
    expect(calls).toEqual([])
    Effect.runSync(effect)
    expect(calls).toEqual(['inbox'])
  })

  it('does nothing, quietly, where there is no native module', () => {
    prepare(null)
    expect(() => closeNativeSwipesNow('inbox')).not.toThrow()
    expect(() => Effect.runSync(closeNativeSwipes('inbox'))).not.toThrow()
  })

  it('survives a native function that throws or rejects', async () => {
    prepare(
      expoWith({
        module: {
          closeAll: () => {
            throw new Error('native said no')
          },
        },
      }),
    )
    expect(() => closeNativeSwipesNow('inbox')).not.toThrow()
    prepare(expoWith({ module: { closeAll: () => Promise.reject(new Error('later no')) } }))
    expect(() => closeNativeSwipesNow('inbox')).not.toThrow()
    await settle()
  })
})

describe('the native swipe demo', () => {
  let surface: NativeSurface | undefined
  let handle: { dispose: () => void } | undefined
  let exits = 0

  const start = async (expo: SwipeExpoGlobal | null) => {
    const phone = prepare(expo)
    surface = phone.surface
    exits = 0
    handle = Runtime.embed(
      makeDemo(phone.surface.container, {
        device: { platform: 'ios', osVersion: 27 },
        exit: () => {
          exits += 1
        },
      }),
    )
    await settle()
    return phone.fabric
  }

  afterEach(async () => {
    handle?.dispose()
    handle = undefined
    await settle()
    surface?.dispose()
    surface = undefined
  })

  it('is on the showcase menu', () => {
    const demos = makeDemos({ device: PhoneFeatures.makeTest().layer })
    expect(demos.map(demo => demo.title)).toContain('Swipe actions (native view)')
  })

  describe('in Expo Go, without the native view', () => {
    it('says so on the status line and shows every row', async () => {
      const fabric = await start(expoWith({ module: null }))
      expect(textOf(byTestId(fabric, 'swipe-status'))).toBe(
        'Native view: not present: needs the prebuilt app, see docs/NATIVE_VIEWS.md',
      )
      expect(textOf(byTestId(fabric, 'swipe-hint'))).toContain('do not swipe in this build')
      expect(named(fabric, ROW_VIEW)).toHaveLength(0)
      expect(allText(fabric)).toContain('Ada')
      expect(allText(fabric)).toContain('Radia')
    })

    it('still counts presses on the button inside a row, and switches without a crash', async () => {
      const fabric = await start(null)
      await press(fabric, 'press-mail-1')
      expect(textOf(byTestId(fabric, 'presses-mail-1'))).toBe('Press me: 1')
      await press(fabric, 'mode-strip')
      await press(fabric, 'mode-info')
      await press(fabric, 'toggle-direction')
      await press(fabric, 'close-all')
      expect(textOf(byTestId(fabric, 'swipe-last-event'))).toBe(
        'Last event: Asked every open row to close',
      )
      expect(allText(fabric)).not.toContain('This screen crashed')
    })
  })

  describe('in a build with the native view', () => {
    it('says so, and draws one native row for each mail', async () => {
      const fabric = await start(expoWith())
      expect(textOf(byTestId(fabric, 'swipe-status'))).toBe('Native view: present')
      expect(named(fabric, ROW_VIEW)).toHaveLength(10)
      expect(byTestId(fabric, 'row-mail-1').props).toMatchObject({
        group: INBOX_GROUP,
        mode: 'tiles',
        allowsFullSwipe: true,
        rowDirection: 'ltr',
      })
    })

    it('puts Delete first on the trailing side, so a full swipe deletes', async () => {
      const fabric = await start(expoWith())
      const trailing = byTestId(fabric, 'row-mail-1').props['actionsTrailing'] as Array<{
        key: string
        role: string
      }>
      expect(trailing.map(action => action.key)).toEqual(['delete', 'flag'])
      expect(trailing[0]?.role).toBe('destructive')
    })

    it('deletes a mail on a full swipe and says what happened', async () => {
      const fabric = await start(expoWith())
      fabric.emit(byTestId(fabric, 'row-mail-2'), 'topActionTriggered', {
        key: 'delete',
        viaFullSwipe: true,
      })
      await settle()
      expect(hasTestId(fabric, 'row-mail-2')).toBe(false)
      expect(named(fabric, ROW_VIEW)).toHaveLength(9)
      expect(textOf(byTestId(fabric, 'swipe-last-event'))).toBe(
        'Last event: Delete on mail-2, by a full swipe',
      )
    })

    it('flags and reads a mail, and the tiles change their words', async () => {
      const fabric = await start(expoWith())
      const row = () => byTestId(fabric, 'row-mail-3')
      fabric.emit(row(), 'topActionTriggered', { key: 'flag', viaFullSwipe: false })
      await settle()
      expect(textOf(byTestId(fabric, 'from-mail-3'))).toBe('Linus (flagged)')
      expect((row().props['actionsTrailing'] as Array<{ label: string }>)[1]?.label).toBe('Unflag')
      fabric.emit(row(), 'topActionTriggered', { key: 'read', viaFullSwipe: false })
      await settle()
      expect((row().props['actionsLeading'] as Array<{ label: string }>)[0]?.label).toBe('Unread')
      expect(textOf(byTestId(fabric, 'swipe-last-event'))).toBe('Last event: Read on mail-3, by a press')
    })

    it('shows opened and closed on the last event line', async () => {
      const fabric = await start(expoWith())
      fabric.emit(byTestId(fabric, 'row-mail-1'), 'topSwipeOpened', { side: 'trailing' })
      await settle()
      expect(textOf(byTestId(fabric, 'swipe-last-event'))).toBe(
        'Last event: mail-1 opened on the trailing side',
      )
      fabric.emit(byTestId(fabric, 'row-mail-1'), 'topSwipeClosed', {})
      await settle()
      expect(textOf(byTestId(fabric, 'swipe-last-event'))).toBe('Last event: mail-1 closed')
    })

    it('switches look and direction, and info mode offers nothing to trigger on the leading side', async () => {
      const fabric = await start(expoWith())
      await press(fabric, 'mode-strip')
      await press(fabric, 'toggle-direction')
      expect(byTestId(fabric, 'row-mail-1').props).toMatchObject({
        mode: 'strip',
        rowDirection: 'rtl',
        cornerRadius: 0,
      })
      await press(fabric, 'mode-info')
      const { props } = byTestId(fabric, 'row-mail-1')
      expect(props['mode']).toBe('info')
      expect(props['actionsLeading']).toEqual([])
      expect((props['actionsTrailing'] as Array<{ label: string }>).map(each => each.label)).toEqual([
        'Not read yet',
        'Not flagged',
      ])
    })

    it('asks the native side to close the open rows of its group', async () => {
      const calls: Array<string> = []
      const fabric = await start(
        expoWith({ module: { closeAll: (group: string) => void calls.push(group) } }),
      )
      await press(fabric, 'close-all')
      expect(calls).toEqual([INBOX_GROUP])
    })

    it('resets the list, and leaves through Exit', async () => {
      const fabric = await start(expoWith())
      fabric.emit(byTestId(fabric, 'row-mail-1'), 'topActionTriggered', { key: 'delete', viaFullSwipe: false })
      await settle()
      expect(named(fabric, ROW_VIEW)).toHaveLength(9)
      await press(fabric, 'reset')
      expect(named(fabric, ROW_VIEW)).toHaveLength(10)
      await press(fabric, 'exit')
      expect(exits).toBe(1)
    })
  })
})
