/**
 * Counter: the smallest Effect UI component on native views. A number and
 * three buttons.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native } from '../src/index.js'
import * as Look from './look.js'

export const CounterMessage = UiSchema.TaggedEnum({
  PressedDecrement: {},
  PressedIncrement: {},
  PressedReset: {},
})

export const Counter = Native.component({
  name: 'Counter',
  model: Schema.Struct({ count: Schema.Number }),
  message: CounterMessage,
}).make({
  init: () => ({ count: 0 }),
  update: {
    PressedDecrement: $ => $.evolve({ count: count => count - 1 }),
    PressedIncrement: $ => $.evolve({ count: count => count + 1 }),
    PressedReset: $ => $.evolve({ count: 0 }),
  },
  view: (h, model) =>
    h.view.style({ ...Look.pad, alignItems: 'center' }).children(
      h.text.testId('counter-count').style(Look.big).children(String(model.count)),
      h.view.style({ flexDirection: 'row', gap: 12 }).children(
        Look.plainButton(h, 'counter-minus', 'Minus', CounterMessage.PressedDecrement()),
        Look.plainButton(h, 'counter-reset', 'Reset', CounterMessage.PressedReset()),
        Look.plainButton(h, 'counter-plus', 'Plus', CounterMessage.PressedIncrement()),
      ),
      h.text.style(Look.small).children('Each press is one Message and one draw.'),
    ),
})
