/** The thin wrappers over the other native views, on a build that has none of them: each draws its fallback. */
import { UiSchema } from '@effect/ui'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Native, NativeViews } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'
import { run } from './support.js'

const Message = UiSchema.TaggedEnum({ PressedMore: {}, ClosedSheet: {} })

const DrawBars = NativeViews.makeCanvas('DrawBars', { values: Schema.Array(Schema.Number) }, (pen, size, { values }) => {
  values.forEach((value, index) => pen.rect(index * 12, size.height - value, 10, value, { color: '#0A60FF' }))
})

const Demo = Native.component({
  name: 'ViewsDemo',
  model: Schema.Struct({ values: Schema.Array(Schema.Number), isSheetOpen: Schema.Boolean }),
  message: Message,
}).make({
  init: () => ({ values: [10, 20], isSheetOpen: true }),
  update: {
    PressedMore: $ => $.evolve({ values: values => [...values, 30] }),
    ClosedSheet: $ => $.evolve({ isSheetOpen: false }),
  },
  view: (h, model) =>
    h.stack.children(
      h.screen.key('main').children(
        NativeViews.glass(h, { style: { borderRadius: 20 } }).attr('testID', 'glass').children(h.text('on glass')),
        h.view.testId('markdown').children(NativeViews.markdown(h, { text: '# Title\n\nSome **bold** words.' })),
        h.view.testId('canvas').style({ height: 100 }).set({ collapsable: false }).onMount(DrawBars({ values: model.values })),
        h.pressable.testId('more').on('press', Message.PressedMore()).children(h.text('more')),
      ),
      model.isSheetOpen &&
        h.modalScreen
          .key('sheet')
          .testId('sheet')
          .set(NativeViews.sheet({ detents: [0.4, 1], hasGrabber: true }))
          .on('dismissed', Message.ClosedSheet())
          .children(h.sheetContent.children(h.text('in the sheet'))),
    ),
})

describe('native view wrappers', () => {
  it('glass and Markdown fall back to plain views, and say why', () =>
    run(
      Effect.gen(function* () {
        NativeViews.registerNavigation()
        const app = yield* NativeTest.mount(Demo, {})
        expect(app.byTestId('glass').viewName).toBe('View')
        expect(app.byTestId('glass').props['borderRadius']).toBe(20)
        expect(app.text('markdown')).toContain('Some **bold** words.')
        expect(NativeViews.glassStatus()).not.toBe('')
        expect(NativeViews.markdownStatus()).toContain('plain text')
        expect(NativeViews.canvasStatus()).toContain('plain views')
      }),
    ))

  it('a sheet is a modal screen with the sheet props, and closing it by hand is reported', () =>
    run(
      Effect.gen(function* () {
        NativeViews.registerNavigation()
        const app = yield* NativeTest.mount(Demo, {})
        const sheet = app.byTestId('sheet')
        expect(sheet.viewName).toBe('RNSModalScreen')
        expect(sheet.props['stackPresentation']).toBe('formSheet')
        expect(sheet.props['sheetAllowedDetents']).toEqual([0.4, 1])
        expect(sheet.props['sheetGrabberVisible']).toBe(true)
        yield* app.emit('sheet', 'topDismissed', { dismissCount: 1 })
        expect(app.has('sheet')).toBe(false)
      }),
    ))

  it('a canvas Mount draws from its args, again when they change, and cleans up', () =>
    run(
      Effect.gen(function* () {
        NativeViews.registerNavigation()
        const app = yield* NativeTest.mount(Demo, {})
        yield* app.emit('canvas', 'topLayout', { layout: { x: 0, y: 0, width: 200, height: 100 } })
        expect(app.byTestId('canvas').children).toHaveLength(2)
        yield* app.press('more')
        expect(app.byTestId('canvas').children).toHaveLength(3)
      }),
    ))
})
