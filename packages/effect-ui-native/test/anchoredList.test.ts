/**
 * What step 2 added to the package, each on its own with a small program:
 * `AnchoredList` (the host's list controller with Effect UI rows),
 * `KeyboardBar` (a bar the phone moves with the keyboard), a scroll view's
 * own tap, and `focus` on a field that has the caret already.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { Command, UiSchema } from '@effect/ui'
import { Effect, Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { AnchoredList, KeyboardBar, Native, NativeCommand } from '../src/index.js'
import { ChatPhone, NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const ROW = 50
const VIEWPORT = 600
const BAR = 60

const DemoMessage = UiSchema.TaggedEnum({
  PlannedWindow: { window: AnchoredList.Window },
  ChangedAtEnd: { isAtEnd: Schema.Boolean },
  ChangedFollowing: { isFollowing: Schema.Boolean },
  PressedGrow: {},
  PressedAdd: {},
  PressedToEnd: {},
  Touched: { isDown: Schema.Boolean },
  TappedList: {},
  PressedFocus: {},
  ChangedText: { text: Schema.String },
  ChangedKeyboard: { height: Schema.Number },
})

const DemoModel = Schema.Struct({
  window: AnchoredList.Window,
  windows: Schema.Number,
  count: Schema.Number,
  /** How many lines the last row has. */
  lines: Schema.Number,
  ends: Schema.Array(Schema.Boolean),
  follows: Schema.Array(Schema.Boolean),
  taps: Schema.Number,
  text: Schema.String,
  keyboard: Schema.Number,
})

const Field = Native.ref('field')

/** A list of fixed rows whose last row can grow, under a bar with a text field. */
const Demo = Native.component({
  name: 'Demo',
  props: Schema.Struct({ hasBar: Schema.Boolean }),
  model: DemoModel,
  message: DemoMessage,
}).make({
  init: () => ({ window: AnchoredList.init(), windows: 0, count: 60, lines: 1, ends: [], follows: [], taps: 0, text: '', keyboard: 0 }),
  update: {
    PlannedWindow: ($, { window }) => $.evolve({ window, windows: count => count + 1 }),
    ChangedAtEnd: ($, { isAtEnd }) => $.evolve({ ends: [...$.model.ends, isAtEnd] }),
    ChangedFollowing: ($, { isFollowing }) => $.evolve({ follows: [...$.model.follows, isFollowing] }),
    PressedGrow: $ => $.evolve({ lines: lines => lines + 1 }),
    PressedAdd: $ => $.evolve({ count: count => count + 1 }),
    PressedToEnd: $ => $.run(AnchoredList.scrollToEnd('demo', false).pipe(Command.asNoop)),
    Touched: ($, { isDown }) => $.run(AnchoredList.touch('demo', isDown).pipe(Command.asNoop)),
    TappedList: $ => $.evolve({ taps: taps => taps + 1 }),
    PressedFocus: $ => $.run(NativeCommand.focus(Field).pipe(Command.asNoop)),
    ChangedText: ($, { text }) => $.evolve({ text }),
    ChangedKeyboard: ($, { height }) => $.evolve({ keyboard: height }),
  },
  view: (h, model) => {
    const keys = Array.from({ length: model.count }, (_, index) => `r${index}`)
    const list = AnchoredList.view(h, {
      id: 'demo',
      window: model.window,
      keys,
      estimate: ROW,
      testId: 'list',
      inset: h.props.hasBar ? 'whenAtEnd' : undefined,
      onWindow: window => DemoMessage.PlannedWindow({ window }),
      onAtEnd: isAtEnd => DemoMessage.ChangedAtEnd({ isAtEnd }),
      onFollow: isFollowing => DemoMessage.ChangedFollowing({ isFollowing }),
      onTap: DemoMessage.TappedList(),
      row: (index, key) =>
        h.view
          .testId(`row-${key}`)
          .set({ collapsable: false })
          .on('pressIn', DemoMessage.Touched({ isDown: true }))
          .on('pressOut', DemoMessage.Touched({ isDown: false }))
          .children(h.text.children(index === model.count - 1 ? `last ${model.lines}` : `row ${index}`)),
    })
    const buttons = h.view.children(
      h.pressable.testId('grow').on('press', DemoMessage.PressedGrow()).children(h.text.children('Grow')),
      h.pressable.testId('add').on('press', DemoMessage.PressedAdd()).children(h.text.children('Add')),
      h.pressable.testId('to-end').on('press', DemoMessage.PressedToEnd()).children(h.text.children('End')),
      h.pressable.testId('focus').on('press', DemoMessage.PressedFocus()).children(h.text.children('Focus')),
      AnchoredList.numbersLabel(h, 'demo', { fontSize: 11 }, 'numbers'),
    )
    const field = h.textInput
      .testId('field')
      .ref(Field)
      .prop('nativeID', 'demo-field')
      .value(model.text)
      .on('changeText', ({ text }) => DemoMessage.ChangedText({ text }))
    return h.view.style({ flex: 1 }).children(
      buttons,
      h.props.hasBar
        ? KeyboardBar.view(h, { keyboardHeight: model.keyboard, listId: 'demo', fieldId: 'demo-field', above: list, bar: [field] })
        : h.view.style({ flex: 1 }).children(list, field),
    )
  },
})

/** A fixed row is 50 points. The last row is 50 for each of its lines. */
const rowHeight = (row: FakeFabricNode): number | undefined => {
  const text = NativeTest.textOf(row)
  if (text.startsWith('last ')) return ROW * Number(text.slice(5))
  return text.startsWith('row ') ? ROW : undefined
}

let stops: Array<() => void> = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  ChatPhone.reset()
})

const start = () =>
  Effect.gen(function* () {
    const app = yield* NativeTest.mount(Demo, { hasBar: false })
    const scroll = ChatPhone.startScrollPhone(app.fabric, { listId: 'list', viewport: VIEWPORT, rowHeight })
    stops.push(scroll.stop)
    yield* app.wait(60)
    return { app, scroll }
  })

const rowsDrawn = (app: { fabric: { committed: ReadonlyArray<FakeFabricNode> } }): Array<string> =>
  NativeTest.flatten(app.fabric.committed)
    .map(node => String(node.props['testID'] ?? ''))
    .filter(id => id.startsWith('row-'))

describe('AnchoredList', () => {
  it('opens at its end, draws only the rows near the screen, and tells the window as a Message', () =>
    run(
      Effect.gen(function* () {
        const { app, scroll } = yield* start()
        const model = app.root.model()
        // 60 rows of 50 points, a screen of 600: the end is at 2400.
        expect(scroll.phone.offset).toBe(60 * ROW - VIEWPORT)
        expect(rowsDrawn(app).at(-1)).toBe('row-r59')
        expect(rowsDrawn(app)).not.toContain('row-r0')
        expect(rowsDrawn(app).length).toBeLessThan(40)
        expect(model?.window.end).toBe(60)
        expect(model?.window.before).toBe((model?.window.first ?? 0) * ROW)
        // The canvas is as tall as every row together, and can be seen now.
        const canvas = app.byTestId('list').children.at(-1)?.children[0]
        expect(canvas?.props).toMatchObject({ height: 60 * ROW, opacity: 1 })
      }),
    ))

  it('scrolling sends no Message until other rows are needed, and a row height never sends one', () =>
    run(
      Effect.gen(function* () {
        const { app, scroll } = yield* start()
        const dispatched = app.stats.dispatched
        const windows = app.root.model()?.windows ?? 0
        // A small drag: the rows drawn still cover the screen.
        scroll.drag(scroll.phone.offset - 100)
        yield* app.wait(150)
        expect(app.root.model()?.windows).toBe(windows)
        // Only the two Messages that say the end was left and following stopped.
        expect(app.stats.dispatched - dispatched).toBe(2)
        expect(app.root.model()?.ends.at(-1)).toBe(false)
        expect(app.root.model()?.follows.at(-1)).toBe(false)
        // A long one: the window moves, as one Message.
        scroll.drag(0)
        yield* app.wait(150)
        expect(app.root.model()?.windows).toBeGreaterThan(windows)
        expect(rowsDrawn(app)[0]).toBe('row-r0')
        expect(rowsDrawn(app)).not.toContain('row-r59')
      }),
    ))

  it('follows a row that grows once asked for the end, waits under a resting finger, and catches up after', () =>
    run(
      Effect.gen(function* () {
        const { app, scroll } = yield* start()
        yield* app.press('to-end')
        yield* app.wait(60)
        yield* app.press('grow')
        yield* app.wait(60)
        // The last row is two lines now: the end moved by 50, and the list with it.
        expect(scroll.phone.offset).toBe(61 * ROW - VIEWPORT)
        yield* app.touchStart('row-r59')
        yield* app.wait(30)
        // The row grows by itself, as a reply does. (A second finger would take the touch away.)
        app.root.send(DemoMessage.PressedGrow())
        yield* app.wait(60)
        expect(scroll.furthest()).toBe(62 * ROW - VIEWPORT)
        expect(scroll.phone.offset).toBe(61 * ROW - VIEWPORT)
        yield* app.touchEnd('row-r59')
        yield* app.wait(60)
        expect(scroll.phone.offset).toBe(62 * ROW - VIEWPORT)
        expect(AnchoredList.numbers('demo')?.isFollowing).toBe(true)
      }),
    ))

  it('the numbers line is written by the list itself, with no draw by the program', () =>
    run(
      Effect.gen(function* () {
        const { app, scroll } = yield* start()
        expect(app.text('numbers')).toContain('offset 2400 of 2400, at end, following')
        const windows = app.root.model()?.windows
        scroll.drag(2300)
        yield* app.wait(150)
        expect(app.text('numbers')).toContain('offset 2300 of 2400, not at end, not following')
        expect(app.root.model()?.windows).toBe(windows)
      }),
    ))

  it('a tap on the list where no row took it is a Message, and a drag is not', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        yield* app.press('list')
        expect(app.root.model()?.taps).toBe(1)
        yield* app.touchStart('list')
        yield* app.emit('list', 'topScrollBeginDrag', { contentOffset: { x: 0, y: 0 } })
        yield* app.touchEnd('list')
        expect(app.root.model()?.taps).toBe(1)
      }),
    ))
})

describe('KeyboardBar', () => {
  it('on an iPhone build the phone moves the bar, the list is told what the bar covers, and the field is named for the drag', () =>
    run(
      Effect.gen(function* () {
        const animated = ChatPhone.usePhoneKeyboard()
        const app = yield* NativeTest.mount(Demo, { hasBar: true })
        const phone = yield* ChatPhone.start(app, { animated, composer: BAR, listId: 'list', rowHeight, viewport: VIEWPORT })
        stops.push(phone.stop)
        expect(phone.barLift(300)).toBe(300 - ChatPhone.HOME_INDICATOR)
        expect(AnchoredList.numbers('demo')?.bar).toBe(BAR + ChatPhone.HOME_INDICATOR)
        // The list ends at the bar's top.
        expect(phone.scroll.phone.offset).toBe(60 * ROW + BAR + ChatPhone.HOME_INDICATOR - VIEWPORT)
        const gesture = NativeTest.flatten(app.fabric.committed).find(node => node.viewName === 'KeyboardGestureArea')
        expect(gesture?.props['textInputNativeID']).toBe('demo-field')
        // The keyboard comes up: the list, at its end, rises with it. Nothing is laid out again.
        yield* phone.keyboardMoves(300)
        expect(AnchoredList.numbers('demo')?.inset).toBe(300 + BAR)
        expect(phone.scroll.phone.offset).toBe(60 * ROW + 300 + BAR - VIEWPORT)
      }),
    ))

  it('elsewhere the bar is padded by the keyboard from the Model, and the list has no inset', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Demo, { hasBar: true }, { platform: 'android' })
        yield* app.wait(40)
        expect(NativeTest.flatten(app.fabric.committed).some(node => node.viewName === 'KeyboardControllerView')).toBe(false)
        expect(AnchoredList.numbers('demo')?.inset).toBeUndefined()
        app.root.send(DemoMessage.ChangedKeyboard({ height: 280 }))
        yield* Effect.promise(() => new Promise<void>(resolve => setTimeout(resolve, 400)))
        yield* app.settle
        expect(NativeTest.flatten(app.fabric.committed).some(node => node.props['paddingBottom'] === 280)).toBe(true)
      }),
    ))
})

describe('focus', () => {
  it('a field that has the caret already is not asked again', () =>
    run(
      Effect.gen(function* () {
        const { app } = yield* start()
        const focuses = () => app.commands().filter(command => command.name === 'focus').length
        yield* app.press('focus')
        yield* app.wait(30)
        expect(focuses()).toBe(1)
        // The phone says the field has the caret.
        yield* app.emit('field', 'topFocus', {})
        yield* app.press('focus')
        yield* app.wait(30)
        expect(focuses()).toBe(1)
      }),
    ))
})
