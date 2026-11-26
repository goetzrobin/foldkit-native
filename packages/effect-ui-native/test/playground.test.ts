/**
 * The playground app end to end on the simulated phone: the menu, the screen
 * stack, notes with a text field, and the phone's services.
 */
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { App } from '../playground/app.js'
import { MAX_DRAFT } from '../playground/notes.js'
import { Phone } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const start = () =>
  Effect.gen(function* () {
    registerNavigation()
    const device = Phone.Device.makeTest()
    const layer = Layer.provideMerge(Phone.layer, device.layer)
    const app = yield* NativeTest.mount(App, { platform: 'ios', hasReadout: false }).pipe(Effect.provide(layer))
    return { app, device }
  })

const screens = (app: { fabric: { committed: ReadonlyArray<any> } }) =>
  NativeTest.flatten(app.fabric.committed).filter(node => node.viewName === 'RNSScreen')

describe('playground app', () => {
  it('shows the menu in a native stack with a title bar', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        expect(app.fabric.find('RNSScreenStack')).toBeDefined()
        expect(screens(app)).toHaveLength(1)
        const header = app.fabric.find('RNSScreenStackHeaderConfig')
        expect(header?.props['title']).toBe('Effect UI Native')
        expect(app.allText()).toContain('Long list')
      }),
    ))

  it('pushes a demo, and a swipe back the phone reports pops it from the Model', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('menu-Counter')
        expect(screens(app)).toHaveLength(2)
        expect(app.root.model()?.screens.map(screen => screen._tag)).toEqual(['Menu', 'Demo'])
        yield* app.press('counter-plus')
        yield* app.press('counter-plus')
        expect(app.text('counter-count')).toBe('2')
        // The phone pops the screen by itself, then says so.
        const top = screens(app)[1]
        yield* Effect.sync(() => app.fabric.emit(top, 'topDismissed', { dismissCount: 1 }))
        yield* app.settle
        expect(app.root.model()?.screens.map(screen => screen._tag)).toEqual(['Menu'])
        expect(screens(app)).toHaveLength(1)
        expect(app.has('counter-count')).toBe(false)
      }),
    ))

  it('notes: typing, adding, deleting, and opening a note on its own screen', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('menu-Notes')
        yield* app.typeText('notes-field', 'Buy milk')
        expect(app.text('notes-count')).toContain('Draft: 8 letters')
        yield* app.press('notes-add')
        expect(app.allText()).toContain('Buy milk')
        expect(app.text('notes-count')).toContain('2 notes')
        // Return on the keyboard adds as well.
        yield* app.typeText('notes-field', 'Call Sam')
        yield* app.emit('notes-field', 'topSubmitEditing', { text: 'Call Sam' })
        expect(app.text('notes-count')).toContain('3 notes')
        yield* app.press('note-delete-n0')
        expect(app.allText()).not.toContain('Press me to open')
        // Opening tells the app, which pushes the screen.
        yield* app.press('note-n1')
        expect(screens(app)).toHaveLength(3)
        expect(app.text('note-detail-text')).toBe('Buy milk')
        const headers = NativeTest.flatten(app.fabric.committed).filter(
          node => node.viewName === 'RNSScreenStackHeaderConfig',
        )
        expect(headers.map(header => header.props['title'])).toEqual(['Effect UI Native', 'Notes', 'Note'])
        yield* Effect.sync(() => app.fabric.emit(screens(app)[2], 'topDismissed', { dismissCount: 1 }))
        yield* app.settle
        expect(screens(app)).toHaveLength(2)
        // The notes kept their state under the detail screen.
        expect(app.text('notes-count')).toContain('2 notes')
      }),
    ))

  it('the text field echo: text the Model changes or refuses is sent back with the latest count', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('menu-Notes')
        yield* app.typeText('notes-field', 'Hello')
        const sent = () => app.commands().filter(command => command.name === 'setTextAndSelection')
        // The Model took what was typed: nothing is sent back.
        expect(sent()).toHaveLength(0)
        // Add clears the draft: the Model changed the text, so it is sent with the count.
        yield* app.press('notes-add')
        expect(sent()).toHaveLength(1)
        expect(sent()[0]?.args).toEqual([1, '', -1, -1])
        // Too long: the Model refuses and stays as it was. The field is put back.
        yield* app.typeText('notes-field', 'ok')
        const long = 'x'.repeat(MAX_DRAFT + 1)
        yield* app.typeText('notes-field', long)
        expect(app.root.model()).toBeDefined()
        expect(app.text('notes-count')).toContain('Draft: 2 letters')
        expect(sent()).toHaveLength(2)
        expect(sent()[1]?.args).toEqual([3, 'ok', -1, -1])
      }),
    ))

  it('long list: the stream does not move the list while a finger rests on a row, and follows again after', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('menu-LongList')
        const scrolls = () => app.commands().filter(command => command.name === 'scrollToEnd').length
        yield* app.press('list-stream')
        yield* app.wait(150)
        const following = scrolls()
        expect(following).toBeGreaterThan(0)

        // A finger comes down on a row and stays: the row grows, the list stays put.
        yield* app.touchStart('row-0')
        const atTouch = scrolls()
        const lengthAtTouch = app.text('streamed-text').length
        yield* app.wait(200)
        expect(app.text('streamed-text').length).toBeGreaterThan(lengthAtTouch)
        expect(scrolls()).toBe(atTouch)

        // The finger lifts: the list follows the end again.
        yield* app.touchEnd('row-0')
        yield* app.wait(150)
        expect(scrolls()).toBeGreaterThan(atTouch)

        // A drag away from the end stops it until the reader is back at the end.
        yield* app.emit('long-list', 'topScrollBeginDrag', {
          contentOffset: { x: 0, y: 5000 },
          contentSize: { width: 390, height: 90000 },
          layoutMeasurement: { width: 390, height: 600 },
        })
        const atDrag = scrolls()
        yield* app.emit('long-list', 'topMomentumScrollEnd', {
          contentOffset: { x: 0, y: 3000 },
          contentSize: { width: 390, height: 90000 },
          layoutMeasurement: { width: 390, height: 600 },
        })
        yield* app.wait(150)
        expect(scrolls()).toBe(atDrag)
        yield* app.press('list-to-end')
        yield* app.wait(150)
        expect(scrolls()).toBeGreaterThan(atDrag + 1)
        yield* app.press('list-stream')
      }),
    ))

  it('phone: haptics, clipboard, keyboard, colour scheme and app state', () =>
    run(
      Effect.gen(function* () {
        const { app, device } = yield* start()
        yield* app.press('menu-Phone')
        yield* app.press('phone-light')
        yield* app.press('phone-success')
        expect(device.haptics.calls).toEqual(['impact:light', 'notification:success'])
        expect(app.text('phone-taps')).toBe('Taps asked for: 2. Last answer: the phone took it')
        // A phone that refuses says why on the screen.
        yield* Effect.sync(() => device.haptics.failNext('no haptics module'))
        yield* app.press('phone-heavy')
        expect(app.text('phone-taps')).toBe('Taps asked for: 3. Last answer: failed: no haptics module')
        yield* app.press('phone-copy')
        expect(device.clipboard.contents()).toBe('Copied from the playground, 1')
        yield* app.press('phone-paste')
        expect(app.text('phone-clipboard')).toContain('Read back: Copied from the playground, 1')
        yield* Effect.sync(() => device.keyboard.show(336))
        yield* app.settle
        expect(app.text('phone-keyboard')).toBe('Keyboard height: 336 points')
        yield* app.press('phone-dismiss')
        expect(device.keyboard.dismissCount()).toBe(1)
        expect(app.text('phone-keyboard')).toBe('Keyboard height: 0 points')
        yield* Effect.sync(() => device.colorScheme.set('dark'))
        yield* app.settle
        expect(app.text('phone-scheme')).toBe('Colour scheme: dark')
        yield* Effect.sync(() => device.appState.set('background'))
        yield* app.settle
        expect(app.text('phone-appstate')).toContain('background')
        // Leaving the screen stops the Subscriptions.
        const top = screens(app)[1]
        yield* Effect.sync(() => app.fabric.emit(top, 'topDismissed', { dismissCount: 1 }))
        yield* app.settle
        expect(device.keyboard.listenerCount()).toBe(0)
        expect(device.colorScheme.listenerCount()).toBe(0)
        expect(device.appState.listenerCount()).toBe(0)
      }),
    ))
})
