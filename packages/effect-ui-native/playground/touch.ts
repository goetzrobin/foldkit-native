/**
 * Touch tests: four things a finger does in a scrolling list, each with a
 * counter at the top, so a person holding the phone can say yes or no.
 *
 * 1. Press a row: "Row presses" goes up by one. Scroll the list with a
 *    finger: it must NOT go up.
 * 2. Hold a row for half a second: "Row holds" goes up, and lifting the
 *    finger afterwards does not count as a press.
 * 3. Press the small button inside a row: "Button presses" goes up and
 *    "Row presses" does not.
 * 4. Turn on "Auto scroll": the program scrolls the list by itself. Press and
 *    hold rows while it moves: both must still count.
 *
 * The line under the counters is the host's own count: presses it kept
 * through a scroll the program made (the workaround for ng-native 0.25.0)
 * and presses it called off.
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Effect, Schema, Stream } from 'effect'

import { Native, NativeCommand } from '../src/index.js'
import * as Look from './look.js'

export const TOUCH_ROWS = 40

export const TouchMessage = UiSchema.TaggedEnum({
  PressedRow: { index: Schema.Number },
  HeldRow: { index: Schema.Number },
  PressedInnerButton: { index: Schema.Number },
  PressedAutoScroll: {},
  TickedAutoScroll: {},
  PressedClear: {},
  UpdatedHostCounts: { kept: Schema.Number, cancelled: Schema.Number },
})

const TouchModel = Schema.Struct({
  rowPresses: Schema.Number,
  rowHolds: Schema.Number,
  buttonPresses: Schema.Number,
  last: Schema.String,
  isAutoScrolling: Schema.Boolean,
  autoY: Schema.Number,
  autoStep: Schema.Number,
  kept: Schema.Number,
  cancelled: Schema.Number,
})

export const TouchProps = Schema.Struct({ hasReadout: Schema.Boolean })

const ListRef = Native.ref('touch-list')

const autoScrollTicks = Subscription.make(
  'Touch/autoScroll',
  Stream.tick('100 millis').pipe(Stream.drop(1), Stream.as(TouchMessage.TickedAutoScroll())),
)

const hostCounts = Subscription.make(
  'Touch/hostCounts',
  Stream.unwrap(
    Native.Host.use(host =>
      Effect.succeed(
        Stream.tick('500 millis').pipe(
          Stream.map(() =>
            TouchMessage.UpdatedHostCounts({
              kept: host.stats['keptThroughScroll'] ?? 0,
              cancelled: host.stats['cancelled'] ?? 0,
            }),
          ),
        ),
      ),
    ),
  ),
)

export const Touch = Native.component({
  name: 'Touch',
  props: TouchProps,
  model: TouchModel,
  message: TouchMessage,
}).make({
  init: () => ({
    rowPresses: 0,
    rowHolds: 0,
    buttonPresses: 0,
    last: 'nothing yet',
    isAutoScrolling: false,
    autoY: 0,
    autoStep: 12,
    kept: 0,
    cancelled: 0,
  }),
  update: {
    PressedRow: ($, { index }) => $.evolve({ rowPresses: n => n + 1, last: `pressed row ${index + 1}` }),
    HeldRow: ($, { index }) => $.evolve({ rowHolds: n => n + 1, last: `held row ${index + 1}` }),
    PressedInnerButton: ($, { index }) =>
      $.evolve({ buttonPresses: n => n + 1, last: `pressed the button in row ${index + 1}` }),
    PressedAutoScroll: $ => $.evolve({ isAutoScrolling: on => !on }),
    TickedAutoScroll: $ => {
      // Down 600 points and back, a little at a time, by a scroll the program makes.
      const next = $.model.autoY + $.model.autoStep
      const step = next > 600 || next < 0 ? -$.model.autoStep : $.model.autoStep
      const y = Math.max(0, Math.min(600, next))
      return $.evolve({ autoY: y, autoStep: step }).run(
        NativeCommand.scrollTo(ListRef, { y, animated: false }).pipe(Command.asNoop),
      )
    },
    PressedClear: $ => $.evolve({ rowPresses: 0, rowHolds: 0, buttonPresses: 0, last: 'cleared' }),
    // The same numbers as before: the same Model, and no draw.
    UpdatedHostCounts: ($, { kept, cancelled }) =>
      kept === $.model.kept && cancelled === $.model.cancelled ? $.model : $.evolve({ kept, cancelled }),
  },
  subscriptions: ({ model, props }) => [model.isAutoScrolling && autoScrollTicks, props.hasReadout && hostCounts],
  view: (h, model) =>
    h.view.style(Look.page).children(
      h.view.style({ padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: Look.LINE }).children(
        h.text.testId('touch-counts').style(Look.label).children(
          `Row presses ${model.rowPresses}  Row holds ${model.rowHolds}  Button presses ${model.buttonPresses}`,
        ),
        h.text.testId('touch-last').style(Look.small).children(`Last: ${model.last}`),
        h.text.testId('touch-host').style(Look.small).children(
          `Host: kept through a program scroll ${model.kept}, called off ${model.cancelled}`,
        ),
        h.view.style({ flexDirection: 'row', gap: 8 }).children(
          Look.plainButton(
            h,
            'touch-auto',
            model.isAutoScrolling ? 'Auto scroll: on' : 'Auto scroll: off',
            TouchMessage.PressedAutoScroll(),
          ),
          Look.plainButton(h, 'touch-clear', 'Clear', TouchMessage.PressedClear()),
        ),
      ),
      h.scrollView
        .testId('touch-list')
        .ref(ListRef)
        .style({ flex: 1 })
        .set({ scrollEventThrottle: 16 })
        .children(
          Array.from({ length: TOUCH_ROWS }, (_, index) =>
            h.pressable
              .key(String(index))
              .testId(`touch-row-${index}`)
              .style({ ...Look.row, flexDirection: 'row', alignItems: 'center', minHeight: 64 })
              .pressedStyle(Look.rowPressed)
              .on('press', TouchMessage.PressedRow({ index }))
              .on('longPress', TouchMessage.HeldRow({ index }))
              .children(
                h.text.style({ ...Look.label, flex: 1 }).children(`Row ${index + 1}: press, or hold`),
                h.pressable
                  .testId(`touch-button-${index}`)
                  .style({ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, backgroundColor: Look.BLUE })
                  .pressedStyle(Look.buttonPressed)
                  .on('press', TouchMessage.PressedInnerButton({ index }))
                  .children(h.text.style({ fontSize: 14, color: Look.PAPER }).children('Button')),
              ),
          ),
        ),
    ),
})
