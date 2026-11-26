import { UiSchema } from '@effect/ui'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { Native } from '../src/index.js'
import { NativeTest } from '../src/testing/index.js'

const Message = UiSchema.TaggedEnum({ PressedAdd: {}, PressedReset: {} })

const Counter = Native.component({
  name: 'Counter',
  model: Schema.Struct({ count: Schema.Number }),
  message: Message,
}).make({
  init: () => ({ count: 0 }),
  update: {
    PressedAdd: $ => $.evolve({ count: n => n + 1 }),
    PressedReset: $ => $.evolve({ count: 0 }),
  },
  view: (h, model) =>
    h.view.style({ padding: 16 }).children(
      h.text.testId('count').children(String(model.count)),
      h.pressable.testId('add').on('press', Message.PressedAdd()).children(h.text('Add')),
      h.pressable.testId('reset').on('press', Message.PressedReset()).children(h.text('Reset')),
    ),
})

const run = <A>(effect: Effect.Effect<A, never, any>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)

describe('counter', () => {
  it('draws, counts presses, and commits once per Message', () =>
    run(
      Effect.gen(function* () {
        const app = yield* NativeTest.mount(Counter, {})
        expect(app.text('count')).toBe('0')
        const before = app.commitCount()
        yield* app.press('add')
        expect(app.text('count')).toBe('1')
        expect(app.root.model()?.count).toBe(1)
        expect(app.commitCount() - before).toBe(1)
        yield* app.press('add')
        yield* app.press('reset')
        expect(app.text('count')).toBe('0')
      }),
    ))
})
