/**
 * The phone features demo on the simulated phone, with every service faked.
 * Each test presses what a person would press, then checks two things: the
 * program asked the service for the right thing, and the answer reached the
 * screen.
 */
import { Effect, Option, Schema } from 'effect'
import { Runtime } from 'foldkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as Device from '../src/device/index.js'
import { registerNavigation } from '../src/index.js'
import { makeDemo } from './demos/device.js'
import {
  type Phone,
  byTestId,
  press,
  settle,
  startPhone,
  textOf,
} from './support/phone.js'

type Fakes = ReturnType<typeof Device.makeTest>

const REMEMBERED_KEY = 'foldkit.demo.remembered'

const shown = (phone: Phone, id: string): string => textOf(byTestId(phone.fabric, id))

const type = async (phone: Phone, id: string, text: string): Promise<void> => {
  phone.fabric.emit(byTestId(phone.fabric, id), 'topChange', { text, eventCount: text.length })
  await settle()
}

describe('the phone features demo on the simulated phone', () => {
  let phone: Phone
  let device: Fakes
  let handle: { dispose: () => void }
  let exit: ReturnType<typeof vi.fn<() => void>>

  const start = async (fakes: Fakes): Promise<void> => {
    device = fakes
    handle = Runtime.embed(
      makeDemo(phone.surface.container, { device: { platform: 'ios', osVersion: 26 }, exit }, device.layer),
    )
    await settle()
  }

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone()
    exit = vi.fn<() => void>()
    await start(Device.makeTest({ blurFocused: () => phone.surface.engine.blurFocused() }))
  })

  afterEach(async () => {
    handle.dispose()
    await settle()
    phone.surface.dispose()
  })

  describe('haptics', () => {
    it('plays each kind and says so on screen', async () => {
      for (const id of ['light', 'medium', 'heavy', 'selection', 'success', 'warning', 'error']) {
        await press(phone.fabric, `haptic-${id}`)
      }
      expect(device.haptics.calls).toEqual([
        'impact:light',
        'impact:medium',
        'impact:heavy',
        'selection',
        'notification:success',
        'notification:warning',
        'notification:error',
      ])
      expect(shown(phone, 'haptic-result')).toBe('Played notification:error')
    })

    it('shows a failure and carries on', async () => {
      device.haptics.failNext('no Taptic Engine')
      await press(phone.fabric, 'haptic-light')
      expect(shown(phone, 'haptic-result')).toBe('Could not play impact:light: no Taptic Engine')
      await press(phone.fabric, 'haptic-light')
      expect(shown(phone, 'haptic-result')).toBe('Played impact:light')
    })
  })

  describe('clipboard', () => {
    it('copies what is in the field', async () => {
      await type(phone, 'draft', 'Buy milk')
      await press(phone.fabric, 'copy')
      expect(device.clipboard.calls).toEqual(['copy:Buy milk'])
      expect(device.clipboard.contents()).toBe('Buy milk')
      expect(shown(phone, 'clipboard-result')).toBe('Copied "Buy milk"')
    })

    it('pastes the clipboard into the field', async () => {
      await type(phone, 'draft', 'old')
      device.clipboard.setContents('from another app')
      await press(phone.fabric, 'paste')
      expect(device.clipboard.calls).toEqual(['read'])
      expect(shown(phone, 'clipboard-result')).toBe('Pasted "from another app"')
      // The phone owns the field's text, so the new text is sent as a command.
      expect(
        phone.fabric.commands.filter(c => c.name === 'setTextAndSelection').map(c => c.args[1]),
      ).toEqual(['from another app'])
    })

    it('shows a failed paste', async () => {
      device.clipboard.failNext('paste was not allowed')
      await press(phone.fabric, 'paste')
      expect(shown(phone, 'clipboard-result')).toBe('Could not paste: paste was not allowed')
    })
  })

  describe('storage', () => {
    it('looks for saved text at startup and finds none', () => {
      expect(device.storage.calls).toEqual([`get:${REMEMBERED_KEY}`])
      expect(shown(phone, 'storage-result')).toBe('Nothing saved yet')
    })

    it('saves the field as it is typed', async () => {
      await type(phone, 'remembered', 'door code 4471')
      expect(device.storage.items.get(REMEMBERED_KEY)).toBe('"door code 4471"')
      expect(shown(phone, 'storage-result')).toBe('Saved')
    })

    it('brings the text back when the app is closed and opened again', async () => {
      await type(phone, 'remembered', 'door code 4471')
      const kept = device.storage

      handle.dispose()
      await settle()
      phone.surface.dispose()
      phone = startPhone()
      await start(Device.makeTest({ storage: kept }))

      expect(byTestId(phone.fabric, 'remembered').props['text']).toBe('door code 4471')
      expect(shown(phone, 'storage-result')).toBe('Restored from last time')
    })

    it('forgets', async () => {
      await type(phone, 'remembered', 'door code 4471')
      await press(phone.fabric, 'forget')
      expect(device.storage.items.has(REMEMBERED_KEY)).toBe(false)
      expect(shown(phone, 'storage-result')).toBe('Forgotten')
    })

    it('shows a failed save and keeps running', async () => {
      device.storage.failNext('the keychain is locked')
      await type(phone, 'remembered', 'secret')
      expect(shown(phone, 'storage-result')).toBe('Could not save: the keychain is locked')
      expect(device.storage.items.has(REMEMBERED_KEY)).toBe(false)
      await type(phone, 'remembered', 'secret!')
      expect(shown(phone, 'storage-result')).toBe('Saved')
    })

    it('shows a failed restore at startup', async () => {
      handle.dispose()
      await settle()
      phone.surface.dispose()
      phone = startPhone()
      const fakes = Device.makeTest()
      fakes.storage.failNext('the keychain is locked')
      await start(fakes)
      expect(shown(phone, 'storage-result')).toBe('Could not restore: the keychain is locked')
    })

    it('starts empty when what was saved no longer fits', async () => {
      handle.dispose()
      await settle()
      phone.surface.dispose()
      phone = startPhone()
      await start(Device.makeTest({ stored: { [REMEMBERED_KEY]: '{"not":"a string"}' } }))
      expect(shown(phone, 'storage-result')).toBe('Nothing saved yet')
      expect(byTestId(phone.fabric, 'remembered').props['text']).toBe('')
    })
  })

  describe('share and links', () => {
    it('opens the share sheet with a message and a link', async () => {
      await press(phone.fabric, 'share')
      expect(device.share.calls).toEqual([
        { message: 'Sent from a Foldkit program', url: 'https://foldkit.dev' },
      ])
      expect(shown(phone, 'share-result')).toBe('Shared')
    })

    it('tells a closed sheet from a share', async () => {
      device.share.answerWith('dismissed')
      await press(phone.fabric, 'share')
      expect(shown(phone, 'share-result')).toBe('Sheet closed without sharing')
    })

    it('opens a link', async () => {
      await press(phone.fabric, 'open-url')
      expect(device.linking.opened).toEqual(['https://foldkit.dev'])
      expect(shown(phone, 'link-result')).toBe('Opened https://foldkit.dev')
    })

    it('asks whether a link can be opened', async () => {
      await press(phone.fabric, 'can-open-url')
      expect(device.linking.asked).toEqual(['https://foldkit.dev'])
      expect(shown(phone, 'link-result')).toBe('Yes, an app opens https://foldkit.dev')
    })

    it('shows a link that no app opens as a failure, and keeps running', async () => {
      await press(phone.fabric, 'open-bad-url')
      expect(shown(phone, 'link-result')).toBe(
        'Could not open foldkit-nobody://nowhere: No app on this phone opens foldkit-nobody://nowhere',
      )
      await press(phone.fabric, 'open-url')
      expect(shown(phone, 'link-result')).toBe('Opened https://foldkit.dev')
    })
  })

  describe('alert', () => {
    it('shows three buttons and reports the one pressed', async () => {
      device.alert.answerWith('delete')
      await press(phone.fabric, 'show-alert')
      expect(device.alert.shown).toHaveLength(1)
      expect(device.alert.shown[0]?.title).toBe('Delete this note?')
      expect(device.alert.shown[0]?.buttons.map(button => button.id)).toEqual([
        'cancel',
        'later',
        'delete',
      ])
      expect(shown(phone, 'alert-result')).toBe('You pressed "delete"')
    })

    it('reports an alert closed without a button', async () => {
      device.alert.answerWith(null)
      await press(phone.fabric, 'show-alert')
      expect(shown(phone, 'alert-result')).toBe('Closed without a button')
    })
  })

  describe('keyboard', () => {
    it('follows the keyboard up and down', async () => {
      expect(shown(phone, 'live-keyboard')).toBe('hidden')
      device.keyboard.show(336)
      await settle()
      expect(shown(phone, 'live-keyboard')).toBe('shown, 336 points tall')
      device.keyboard.hide()
      await settle()
      expect(shown(phone, 'live-keyboard')).toBe('hidden')
    })

    it('puts the keyboard away and blurs the focused field', async () => {
      const draft = byTestId(phone.fabric, 'draft')
      phone.fabric.emit(draft, 'topFocus', { target: draft.reactTag })
      device.keyboard.show(336)
      await settle()
      await press(phone.fabric, 'dismiss-keyboard')
      expect(device.keyboard.dismissCount()).toBe(1)
      expect(phone.fabric.commands.filter(c => c.name === 'blur')).toHaveLength(1)
      expect(shown(phone, 'live-keyboard')).toBe('hidden')
    })
  })

  describe('live lines', () => {
    it('shows what the phone reports at startup', () => {
      expect(shown(phone, 'live-app-state')).toBe('active')
      expect(shown(phone, 'live-scheme')).toBe('light')
      expect(shown(phone, 'live-network')).toBe('online (wifi)')
      expect(shown(phone, 'live-window')).toBe('393 × 852, portrait')
    })

    it('follows the app leaving and coming back', async () => {
      device.appState.set('inactive')
      device.appState.set('background')
      await settle()
      expect(shown(phone, 'live-app-state')).toBe('background')
      device.appState.set('active')
      await settle()
      expect(shown(phone, 'live-app-history')).toBe('active → inactive → background → active')
    })

    it('follows dark mode, and recolors the page', async () => {
      const paper = () => byTestId(phone.fabric, 'scroll').props['backgroundColor']
      const light = paper()
      device.colorScheme.set('dark')
      await settle()
      expect(shown(phone, 'live-scheme')).toBe('dark')
      expect(paper()).not.toEqual(light)
    })

    it('follows the network', async () => {
      device.network.set('offline')
      await settle()
      expect(shown(phone, 'live-network')).toBe('offline (none)')
      device.network.set('online', 'cellular')
      await settle()
      expect(shown(phone, 'live-network')).toBe('online (cellular)')
    })

    it('follows the phone turning', async () => {
      device.window.resize(852, 393)
      await settle()
      expect(shown(phone, 'live-window')).toBe('852 × 393, landscape')
    })

    it('stops listening when the program stops', async () => {
      expect(device.keyboard.listenerCount()).toBe(1)
      expect(device.appState.listenerCount()).toBe(1)
      expect(device.colorScheme.listenerCount()).toBe(1)
      expect(device.network.listenerCount()).toBe(1)
      expect(device.window.listenerCount()).toBe(1)
      handle.dispose()
      await settle()
      expect(device.keyboard.listenerCount()).toBe(0)
      expect(device.appState.listenerCount()).toBe(0)
      expect(device.colorScheme.listenerCount()).toBe(0)
      expect(device.network.listenerCount()).toBe(0)
      expect(device.window.listenerCount()).toBe(0)
    })
  })

  it('leaves through the Exit button', async () => {
    await press(phone.fabric, 'exit')
    expect(exit).toHaveBeenCalledTimes(1)
  })
})

/**
 * The `live` Layers over stand-ins for the real modules. These check the
 * facts about each module that the Layers rely on: which function is
 * called, with what, and how its answer is read.
 */
describe('the live Layers over stand-in native modules', () => {
  const listeners = () => {
    const byEvent = new Map<string, Set<(payload: unknown) => void>>()
    return {
      add: (event: string, listener: (payload: unknown) => void) => {
        const set = byEvent.get(event) ?? new Set()
        byEvent.set(event, set)
        set.add(listener)
        return { remove: () => void set.delete(listener) }
      },
      emit: (event: string, payload?: unknown) => {
        for (const listener of [...(byEvent.get(event) ?? [])]) listener(payload)
      },
      count: () => [...byEvent.values()].reduce((sum, set) => sum + set.size, 0),
    }
  }

  const collect = <A>(source: Device.Source<A>) => {
    const values: Array<A> = []
    const stop = source.subscribe(value => values.push(value))
    return { values, stop }
  }

  const serviceOf = <I, S>(tag: { use: any }, layer: any): Promise<S> =>
    Effect.runPromise(Effect.provide(tag.use((service: S) => Effect.succeed(service)), layer) as never)

  it('haptics passes the style words through and turns a rejection into a failure', async () => {
    const calls: Array<string> = []
    const layer = Device.Haptics.live({
      impactAsync: async style => void calls.push(`impact:${style}`),
      selectionAsync: async () => void calls.push('selection'),
      notificationAsync: async () => {
        throw new Error('not linked')
      },
    })
    const run = (command: { effect: Effect.Effect<unknown, never, Device.Haptics.Haptics> }) =>
      Effect.runPromise(Effect.provide(command.effect, layer))
    expect(await run(Device.Haptics.Impact({ style: 'heavy' }))).toMatchObject({
      _tag: 'CompletedPlayHaptic',
    })
    await run(Device.Haptics.Select())
    expect(calls).toEqual(['impact:heavy', 'selection'])
    expect(await run(Device.Haptics.Notify({ type: 'error' }))).toMatchObject({
      _tag: 'FailedPlayHaptic',
      reason: 'not linked',
    })
  })

  it('storage reads a missing key as none, on both kinds of store', async () => {
    const secure = new Map<string, string>()
    const secureLayer = Device.Storage.liveSecureStore({
      getItemAsync: async key => secure.get(key) ?? null,
      setItemAsync: async (key, value) => void secure.set(key, value),
      deleteItemAsync: async key => void secure.delete(key),
    })
    const plain = new Map<string, string>()
    const plainLayer = Device.Storage.liveAsyncStorage({
      getItem: async key => plain.get(key) ?? null,
      setItem: async (key, value) => void plain.set(key, value),
      removeItem: async key => void plain.delete(key),
    })
    for (const layer of [secureLayer, plainLayer]) {
      const Slice = Device.Storage.persisted({
        key: 'slice',
        schema: Schema.Struct({ count: Schema.Number }),
      })
      const run = <A>(effect: Effect.Effect<A, never, Device.Storage.Storage>) =>
        Effect.runPromise(Effect.provide(effect, layer))
      expect(await run(Slice.restore)).toEqual(Option.none())
      expect(await run(Slice.Save({ value: { count: 3 } }).effect)).toMatchObject({
        _tag: 'SucceededSave',
      })
      expect(await run(Slice.restore)).toEqual(Option.some({ count: 3 }))
      expect(await run(Slice.Restore().effect)).toMatchObject({
        _tag: 'SucceededRestore',
        maybeValue: Option.some({ count: 3 }),
      })
      expect(await run(Device.Storage.RemoveItem({ key: 'slice' }).effect)).toMatchObject({
        _tag: 'SucceededRemoveItem',
      })
      expect(await run(Slice.restore)).toEqual(Option.none())
    }
    expect(secure.size + plain.size).toBe(0)
  })

  it('share folds the link into the message on Android only', async () => {
    const sent: Array<unknown> = []
    const module = {
      share: async (content: unknown) => {
        sent.push(content)
        return { action: 'dismissedAction' }
      },
    }
    const open = (platform: string, args: Parameters<typeof Device.Share.Open>[0]) =>
      Effect.runPromise(
        Effect.provide(Device.Share.Open(args).effect, Device.Share.live(module, platform)),
      )
    expect(await open('ios', { message: 'Hi', url: 'https://a.b' })).toMatchObject({
      _tag: 'SucceededShare',
      outcome: 'dismissed',
    })
    await open('android', { message: 'Hi', url: 'https://a.b', title: 'T' })
    expect(sent).toEqual([
      { message: 'Hi', url: 'https://a.b' },
      { title: 'T', message: 'Hi\nhttps://a.b' },
    ])
    expect(await open('ios', {})).toMatchObject({ _tag: 'FailedShare' })
    expect(sent).toHaveLength(2)
  })

  it('linking reports a rejected open as a failure', async () => {
    const layer = Device.Linking.live({
      openURL: async url => {
        if (!url.startsWith('https:')) throw new Error(`Unable to open URL: ${url}`)
      },
      canOpenURL: async url => url.startsWith('https:'),
    })
    const run = <A>(effect: Effect.Effect<A, never, Device.Linking.Linking>) =>
      Effect.runPromise(Effect.provide(effect, layer))
    expect(await run(Device.Linking.OpenUrl({ url: 'https://a.b' }).effect)).toMatchObject({
      _tag: 'SucceededOpenUrl',
    })
    expect(await run(Device.Linking.OpenUrl({ url: 'nope://x' }).effect)).toMatchObject({
      _tag: 'FailedOpenUrl',
      reason: 'Unable to open URL: nope://x',
    })
    expect(await run(Device.Linking.CanOpenUrl({ url: 'nope://x' }).effect)).toMatchObject({
      _tag: 'SucceededCanOpenUrl',
      canOpen: false,
    })
  })

  it('alert hands the pressed button back, and refuses more than three', async () => {
    type NativeButton = { text: string; style?: string; onPress: () => void }
    const alerts: Array<{ title: string; buttons: Array<NativeButton> }> = []
    const layer = Device.Alert.live({
      alert: (title, _message, buttons: Array<NativeButton>) => {
        alerts.push({ title, buttons })
        // The user presses the last button a moment later.
        setTimeout(() => buttons.at(-1)?.onPress(), 5)
      },
    })
    const show = (buttons: ReadonlyArray<Device.Alert.AlertButton>) =>
      Effect.runPromise(
        Effect.provide(Device.Alert.Show({ title: 'Sure?', buttons }).effect, layer),
      )
    expect(
      await show([
        { id: 'no', label: 'No', style: 'cancel' },
        { id: 'yes', label: 'Yes' },
      ]),
    ).toMatchObject({ _tag: 'PressedAlertButton', id: 'yes' })
    expect(alerts[0]?.buttons.map(button => [button.text, button.style])).toEqual([
      ['No', 'cancel'],
      ['Yes', undefined],
    ])
    expect(await show([])).toMatchObject({ _tag: 'PressedAlertButton', id: 'ok' })
    const four = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id }))
    expect(await show(four)).toMatchObject({ _tag: 'FailedShowAlert' })
    expect(alerts).toHaveLength(2)
  })

  it('keyboard hears "will" events on iOS and "did" events on Android', async () => {
    for (const [platform, showEvent, hideEvent] of [
      ['ios', 'keyboardWillShow', 'keyboardWillHide'],
      ['android', 'keyboardDidShow', 'keyboardDidHide'],
    ] as const) {
      const native = listeners()
      const order: Array<string> = []
      const layer = Device.Keyboard.live(
        { addListener: native.add, dismiss: () => void order.push('dismiss') },
        { platform, blurFocused: () => void order.push('blur') },
      )
      const keyboard = await serviceOf<unknown, Device.Keyboard.KeyboardService>(
        Device.Keyboard.Keyboard,
        layer,
      )
      const heard = collect(keyboard.heights)
      native.emit(showEvent, { endCoordinates: { height: 300 } })
      native.emit(hideEvent, {})
      // iOS sends a frame change beside a hide. It is not a show.
      native.emit('keyboardWillChangeFrame', { endCoordinates: { height: 300 } })
      expect(heard.values).toEqual([0, 300, 0])
      heard.stop()
      expect(native.count()).toBe(0)
      await Effect.runPromise(keyboard.dismiss)
      expect(order).toEqual(['blur', 'dismiss'])
    }
  })

  it('app state, color scheme and window report now and then each change', async () => {
    const native = listeners()
    let scheme: string | null = null
    const appState = await serviceOf<unknown, Device.AppState.AppStateService>(
      Device.AppState.AppState,
      Device.AppState.live({ currentState: 'unknown', addEventListener: native.add }),
    )
    const colorScheme = await serviceOf<unknown, Device.ColorScheme.ColorSchemeService>(
      Device.ColorScheme.ColorScheme,
      Device.ColorScheme.live({
        getColorScheme: () => scheme,
        addChangeListener: listener => native.add('appearance', listener),
      }),
    )
    const window = await serviceOf<unknown, Device.Window.WindowService>(
      Device.Window.Window,
      Device.Window.live({
        get: () => ({ width: 393, height: 852 }),
        addEventListener: (_event, listener) => native.add('dimensions', listener),
      }),
    )
    const statuses = collect(appState.statuses)
    const schemes = collect(colorScheme.schemes)
    const sizes = collect(window.sizes)

    native.emit('change', 'background')
    expect(statuses.values).toEqual(['active', 'background'])
    statuses.stop()

    native.emit('appearance') // nothing changed: not passed on
    scheme = 'dark'
    native.emit('appearance')
    native.emit('appearance')
    expect(schemes.values).toEqual(['light', 'dark'])
    schemes.stop()

    native.emit('dimensions', { window: { width: 852, height: 393 }, screen: {} })
    expect(sizes.values).toEqual([
      { width: 393, height: 852 },
      { width: 852, height: 393 },
    ])
    sizes.stop()
    expect(native.count()).toBe(0)
  })

  it('network reads "not known yet" as online, and a change beats a slow first read', async () => {
    const native = listeners()
    let answer: (state: object) => void = () => {}
    const layer = Device.Network.live({
      getNetworkStateAsync: () => new Promise(resolve => (answer = resolve)),
      addNetworkStateListener: listener => native.add('network', listener),
    })
    const network = await serviceOf<unknown, Device.Network.NetworkService>(
      Device.Network.Network,
      layer,
    )
    const first = collect(network.states)
    answer({ type: 'WIFI', isConnected: true })
    await settle()
    native.emit('network', { type: 'NONE', isConnected: false, isInternetReachable: false })
    expect(first.values).toEqual([
      { status: 'online', connection: 'wifi' },
      { status: 'offline', connection: 'none' },
    ])
    first.stop()

    const second = collect(network.states)
    native.emit('network', { type: 'CELLULAR', isConnected: true, isInternetReachable: true })
    answer({ type: 'NONE', isConnected: false })
    await settle()
    expect(second.values).toEqual([{ status: 'online', connection: 'cellular' }])
    second.stop()
    expect(native.count()).toBe(0)
  })
})
