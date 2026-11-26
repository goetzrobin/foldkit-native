/**
 * Swipe rows: `NativeViews.swipeRow` on its own, and on Effect Chat's list
 * of chats, on the simulated phone.
 *
 * The native view moves the row and decides what opens and closes. None of
 * that runs here. A test plays the native view's part by sending the three
 * events it sends (`topActionTriggered`, `topSwipeOpened`, `topSwipeClosed`)
 * and reads the props the phone was given. So these tests cover the
 * JavaScript half: what the native view is told, and what the program does
 * with what it hears.
 */
import { Command, UiSchema } from '@effect/ui'
import { Effect, Layer, Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetMarkdownSetup } from '../../native/src/host/markdown/detect.js'
import * as Data from '../chat/data.js'
import { SWIPE_GROUP } from '../chat/parts/conversationList.js'
import { Native, NativeViews } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { REQUEST, type TestApp, hold, listed, nodes, seeded, start } from './chatSupport.js'
import { run } from './support.js'

const SWIPE_VIEW = 'ViewManagerAdapter_FoldkitSwipe_SwipeRowView'

let closed: Array<string> = []

/** A build that has the native swipe row. `closeAll` is what its module offers JavaScript. */
const useNativeSwipe = (): void => {
  closed = []
  NativeViews.configureSwipe({
    expo: {
      modules: {
        FoldkitSwipe: {
          closeAll: (group: string) => {
            closed.push(group)
            return Promise.resolve()
          },
        },
      },
      getViewConfig: () => ({}),
    },
  })
}

beforeEach(() => {
  NativeViews.configureMarkdown({ native: true })
})
afterEach(() => {
  NativeViews.resetSwipe()
  resetMarkdownSetup()
})

const Message = UiSchema.TaggedEnum({
  Chose: { row: Schema.String, key: Schema.String, isFullSwipe: Schema.Boolean },
  Opened: { row: Schema.String, side: Schema.String },
  Closed: { row: Schema.String },
  PressedCloseAll: {},
  PressedCloseFirst: {},
  Answered: { closed: Schema.Number },
})

const First = Native.ref('first')

const Inbox = Native.component({
  name: 'Inbox',
  model: Schema.Struct({ heard: Schema.Array(Schema.String), answer: Schema.String }),
  message: Message,
}).make({
  init: () => ({ heard: [], answer: '' }),
  update: {
    Chose: ($, { row, key, isFullSwipe }) =>
      $.evolve({ heard: [...$.model.heard, `${row} ${key}${isFullSwipe ? ' by a full swipe' : ''}`] }),
    Opened: ($, { row, side }) => $.evolve({ heard: [...$.model.heard, `${row} opened ${side}`] }),
    Closed: ($, { row }) => $.evolve({ heard: [...$.model.heard, `${row} closed`] }),
    PressedCloseAll: $ =>
      $.run(NativeViews.closeSwipeRows('inbox').pipe(Command.map(answer => Message.Answered({ closed: answer.closed })))),
    PressedCloseFirst: $ =>
      $.run(NativeViews.closeSwipeRow(First).pipe(Command.map(answer => Message.Answered({ closed: answer.closed })))),
    Answered: ($, { closed: count }) => $.evolve({ answer: `closed ${count}` }),
  },
  view: (h, model) =>
    h.view.children(
      h.text.testId('heard').children(model.heard.join(', ')),
      h.text.testId('answer').children(model.answer),
      h.text.testId('status').children(NativeViews.swipeStatus()),
      h.pressable.testId('close-all').on('press', Message.PressedCloseAll()).children(h.text('close all')),
      h.pressable.testId('close-first').on('press', Message.PressedCloseFirst()).children(h.text('close first')),
      ['a', 'b'].map(row => {
        const made = NativeViews.swipeRow(h, {
          testId: `row-${row}`,
          leading: [{ key: 'read', label: 'Read' }],
          trailing: [
            { key: 'delete', label: 'Delete', symbol: 'trash', isDestructive: true },
            { key: 'flag', label: 'Flag', color: '#f59e0b' },
          ],
          group: 'inbox',
          cornerRadius: 12,
          style: { marginHorizontal: 8 },
          onAction: ({ key, isFullSwipe }) => Message.Chose({ row, key, isFullSwipe }),
          onOpened: side => Message.Opened({ row, side }),
          onClosed: () => Message.Closed({ row }),
        }).key(row)
        return (row === 'a' ? made.ref(First) : made).children(
          h.view.testId(`content-${row}`).style({ backgroundColor: '#FFFFFF' }).children(h.text(`Mail ${row}`)),
        )
      }),
    ),
})

describe('NativeViews.swipeRow, in a build with the native view', () => {
  it('is the native view, told its actions, its group and what a full swipe does, with the content inside it', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const app = yield* NativeTest.mount(Inbox, {})
        expect(app.text('status')).toBe('native swipe row')
        const row = app.byTestId('row-a')
        expect(row.viewName).toBe(SWIPE_VIEW)
        expect(row.props).toMatchObject({
          actionsLeading: [{ key: 'read', label: 'Read', role: 'normal' }],
          // Delete is first: at the screen's edge, and the one a full swipe triggers.
          actionsTrailing: [
            { key: 'delete', label: 'Delete', role: 'destructive', symbol: 'trash' },
            { key: 'flag', label: 'Flag', role: 'normal', tint: '#f59e0b' },
          ],
          allowsFullSwipe: true,
          group: 'inbox',
          mode: 'tiles',
          cornerRadius: 12,
          isEnabled: true,
          // The native code is this view, and its content is cut off at its edge.
          collapsable: false,
          overflow: 'hidden',
          marginHorizontal: 8,
        })
        // An action with no symbol or colour sends neither, not a null.
        expect(Object.keys((row.props['actionsLeading'] as Array<object>)[0] as object).sort()).toEqual(['key', 'label', 'role'])
        expect(NativeTest.flatten([row]).some(node => node.props['testID'] === 'content-a')).toBe(true)
        expect(app.byTestId('row-b').props['group']).toBe('inbox')
      }),
    ))

  it('hands on what the native view says as Messages: a tile, a full swipe, opened, closed', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const app = yield* NativeTest.mount(Inbox, {})
        yield* app.emit('row-a', 'topSwipeOpened', { side: 'trailing' })
        yield* app.emit('row-a', 'topActionTriggered', { key: 'flag', viaFullSwipe: false })
        yield* app.emit('row-a', 'topSwipeClosed', {})
        yield* app.emit('row-b', 'topSwipeOpened', { side: 'leading' })
        yield* app.emit('row-b', 'topActionTriggered', { key: 'delete', viaFullSwipe: true })
        expect(app.text('heard')).toBe(
          'a opened trailing, a flag, a closed, b opened leading, b delete by a full swipe',
        )
      }),
    ))

  it('closes a group through the native module, and one row by a number only that row is given', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const app = yield* NativeTest.mount(Inbox, {})
        yield* app.press('close-all')
        expect(closed).toEqual(['inbox'])
        expect(app.text('answer')).toBe('closed 1')
        expect(app.byTestId('row-a').props['closeSignal']).toBe(undefined)
        yield* app.press('close-first')
        expect(app.byTestId('row-a').props['closeSignal']).toBe(1)
        expect(app.byTestId('row-b').props['closeSignal']).toBe(undefined)
        // The native row closes when the number changes, so a second close changes it again.
        yield* app.press('close-first')
        expect(app.byTestId('row-a').props['closeSignal']).toBe(2)
        // A draw of the rows does not take the number back.
        yield* app.emit('row-b', 'topSwipeOpened', { side: 'trailing' })
        expect(app.byTestId('row-a').props['closeSignal']).toBe(2)
        expect(closed).toEqual(['inbox'])
      }),
    ))
})

describe('NativeViews.swipeRow, in a build without the native view', () => {
  it('draws the content in a plain view, says why nothing swipes, and its Commands close nothing', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Inbox, {})
        expect(app.text('status')).toBe('no swipe (needs the prebuilt app, see docs/NATIVE_VIEWS.md)')
        const row = app.byTestId('row-a')
        expect(row.viewName).not.toBe(SWIPE_VIEW)
        expect(row.props['actionsTrailing']).toBe(undefined)
        expect(row.props['marginHorizontal']).toBe(8)
        expect(app.allText()).toContain('Mail a')
        expect(app.allText()).toContain('Mail b')
        yield* app.press('close-all')
        expect(app.text('answer')).toBe('closed 0')
        yield* app.press('close-first')
        expect(app.text('answer')).toBe('closed 0')
        expect(app.byTestId('row-a').props['closeSignal']).toBe(undefined)
      }),
    ))

  it('a module with no view in the build is also a plain row', () =>
    run(
      Effect.gen(function* () {
        NativeViews.configureSwipe({ expo: { modules: { FoldkitSwipe: {} }, getViewConfig: () => null } })
        const app = yield* NativeTest.mount(Inbox, {})
        expect(app.text('status')).toBe('no swipe (the native view SwipeRowView is missing from this build)')
        expect(app.byTestId('row-a').viewName).not.toBe(SWIPE_VIEW)
      }),
    ))
})

const screens = (app: TestApp) => nodes(app).filter(node => node.viewName === 'RNSScreen' || node.viewName === 'RNSModalScreen')
const swipe = (app: TestApp, id: string, key: string, viaFullSwipe: boolean) =>
  app.emit(`chat-swipe-${id}`, 'topActionTriggered', { key, viaFullSwipe })

describe('Effect Chat: swiping a chat in the list', () => {
  it('offers Delete at the edge and Rename beside it, on every chat, all in one group', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app } = yield* start({ disk: seeded() })
        const rows = listed(app).map(id => app.byTestId(`chat-swipe-${id}`))
        expect(rows).toHaveLength(3)
        for (const row of rows) {
          expect(row.viewName).toBe(SWIPE_VIEW)
          expect((row.props['actionsTrailing'] as Array<{ key: string; role: string }>).map(action => `${action.key} ${action.role}`)).toEqual([
            'delete destructive',
            'rename normal',
          ])
          expect(row.props['actionsLeading']).toEqual([])
          expect(row.props['allowsFullSwipe']).toBe(true)
          // The native view closes the other rows of a group when one is dragged.
          expect(row.props['group']).toBe(SWIPE_GROUP)
        }
      }),
    ))

  it('Rename opens the rename sheet with the chat’s title', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app } = yield* start({ disk: seeded() })
        yield* app.emit('chat-swipe-c1', 'topSwipeOpened', { side: 'trailing' })
        yield* swipe(app, 'c1', 'rename', false)
        expect(app.byTestId('rename-field').props['text']).toBe('Weekend plans')
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
      }),
    ))

  it('a full swipe deletes: the row goes at once, the phone taps once, and the server is asked once even if the phone says it twice', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app, device, server } = yield* start({ disk: seeded() })
        // The native view's word arrives twice in one go, before anything is drawn.
        const row = app.byTestId('chat-swipe-c1')
        app.fabric.emit(row, 'topActionTriggered', { key: 'delete', viaFullSwipe: true })
        app.fabric.emit(row, 'topActionTriggered', { key: 'delete', viaFullSwipe: true })
        yield* app.settle
        expect(listed(app)).toEqual(['c4', 'c7'])
        yield* app.wait(REQUEST * 4)
        expect(server.log().filter(line => line === 'DeleteConversation c1')).toHaveLength(1)
        expect(device.haptics.calls.filter(call => call === 'notification:warning')).toHaveLength(1)
        expect(listed(app)).toEqual(['c4', 'c7'])
        expect(app.has('list-notice')).toBe(false)
      }),
    ))

  it('a delete the server refuses puts the row back and says why, and the chat can be deleted again', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        let attempts = 0
        const refusing = Data.DeleteConversation.toLayer(() =>
          Effect.andThen(
            Effect.sync(() => void attempts++),
            Effect.andThen(Effect.sleep('60 millis'), Effect.fail(new Data.ChatError({ kind: 'refused', reason: 'The server said no.' }))),
          ),
        )
        const { app, device } = yield* start({ disk: seeded(), override: refusing as Layer.Layer<any> })
        yield* swipe(app, 'c1', 'delete', true)
        expect(listed(app)).toEqual(['c4', 'c7'])
        yield* app.wait(REQUEST * 3)
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
        expect(app.text('list-notice')).toBe('Could not delete the chat. The server said no.')
        expect(device.haptics.calls).toContain('notification:error')
        // The row that came back is a swipe row again, and its delete is not held back as a repeat.
        expect(app.byTestId('chat-swipe-c1').viewName).toBe(SWIPE_VIEW)
        yield* swipe(app, 'c1', 'delete', false)
        expect(listed(app)).toEqual(['c4', 'c7'])
        yield* app.wait(REQUEST * 3)
        expect(attempts).toBe(2)
      }),
    ))

  it('with a chat swiped open, a tap on another chat closes it and opens nothing', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app } = yield* start({ disk: seeded() })
        yield* app.emit('chat-swipe-c1', 'topSwipeOpened', { side: 'trailing' })
        yield* app.press('chat-row-c4')
        expect(closed).toEqual([SWIPE_GROUP])
        expect(screens(app)).toHaveLength(1)
        // The native view says the row has closed. Now a tap opens the chat.
        yield* app.emit('chat-swipe-c1', 'topSwipeClosed', {})
        yield* app.press('chat-row-c4')
        expect(screens(app)).toHaveLength(2)
        expect(closed).toEqual([SWIPE_GROUP])
      }),
    ))

  it('opening a second chat leaves that one as the open row: the first one’s "closed" does not forget it', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app } = yield* start({ disk: seeded() })
        yield* app.emit('chat-swipe-c1', 'topSwipeOpened', { side: 'trailing' })
        // The native view closes the first row as the second is dragged, then the second comes to rest open.
        yield* app.emit('chat-swipe-c1', 'topSwipeClosed', {})
        yield* app.emit('chat-swipe-c4', 'topSwipeOpened', { side: 'trailing' })
        // In the other order too: the second is open before the first has said it closed.
        yield* app.emit('chat-swipe-c7', 'topSwipeOpened', { side: 'trailing' })
        yield* app.emit('chat-swipe-c4', 'topSwipeClosed', {})
        // A row is still open, so a tap closes and opens nothing.
        yield* app.press('chat-row-c1')
        expect(screens(app)).toHaveLength(1)
        expect(closed).toEqual([SWIPE_GROUP])
      }),
    ))

  it('scrolling the list closes the open chat, and a scroll with none open asks for nothing', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app } = yield* start({ disk: seeded() })
        yield* app.emit('chat-list', 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } })
        expect(closed).toEqual([])
        yield* app.emit('chat-swipe-c4', 'topSwipeOpened', { side: 'trailing' })
        yield* app.emit('chat-list', 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } })
        expect(closed).toEqual([SWIPE_GROUP])
      }),
    ))

  it('holding a chat still opens its menu, and Delete from there still deletes', () =>
    run(
      Effect.gen(function* () {
        useNativeSwipe()
        const { app, menus, server } = yield* start({ disk: seeded() })
        yield* hold(app, 'chat-row-c7')
        expect(menus.titles()).toEqual(['Rename', 'Delete'])
        menus.choose('delete')
        yield* app.settle
        expect(listed(app)).toEqual(['c4', 'c1'])
        yield* app.wait(REQUEST * 4)
        expect(server.log()).toContain('DeleteConversation c7')
      }),
    ))

  it('in a build without the native view the chats are plain rows that open and can be held', () =>
    run(
      Effect.gen(function* () {
        const { app, menus } = yield* start({ disk: seeded() })
        expect(app.byTestId('chat-swipe-c1').viewName).not.toBe(SWIPE_VIEW)
        expect(listed(app)).toEqual(['c4', 'c1', 'c7'])
        yield* hold(app, 'chat-row-c1')
        expect(menus.titles()).toEqual(['Rename', 'Delete'])
        menus.choose('rename')
        yield* app.settle
        expect(app.byTestId('rename-field').props['text']).toBe('Weekend plans')
      }),
    ))
})
