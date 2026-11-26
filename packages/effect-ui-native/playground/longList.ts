/**
 * Long list: 1,000 rows as an Effect UI component ("way A").
 *
 * The scroll view's `scroll` event is a Message. The Model holds which rows
 * are drawn (the window). Each row is a child component. See
 * `src/VirtualList.ts` for how the window is chosen.
 *
 * On screen, above the list:
 * - a readout, twice a second: how long JavaScript frames take, how long
 *   the last scroll step took in JavaScript, and how many times the list's
 *   view and the rows' views have run;
 * - "Scroll to end";
 * - "Stream": the last row grows 30 times a second, as an AI reply does.
 *   Hold another row meanwhile: the hold must still count;
 * - "Recycle": rows reuse views by slot instead of being made and thrown away.
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Effect, Schema, Stream } from 'effect'

import { Native, NativeCommand, VirtualList } from '../src/index.js'
import { makeFrameMeter } from './frameMeter.js'
import * as Look from './look.js'

export const ROW_COUNT = 1000

const WORDS = [
  'the', 'window', 'holds', 'rows', 'near', 'the', 'screen', 'and', 'a', 'spacer', 'stands', 'in', 'for', 'the',
  'rest', 'so', 'a', 'thousand', 'rows', 'cost', 'about', 'as', 'much', 'as', 'thirty',
]

/** A sentence of `count` words, the same every time for the same row. */
const sentence = (seed: number, count: number): string => {
  const out: Array<string> = []
  for (let at = 0; at < count; at++) out.push(WORDS[(seed * 7 + at * 3) % WORDS.length] ?? 'row')
  return out.join(' ')
}

export type RowData = Readonly<{ title: string; body: string; bullets: string; code: string }>

/** Markdown-like rows: a heading, a paragraph of one to four lines, sometimes bullets or code. */
export const rowData = (index: number): RowData => ({
  title: `Row ${index + 1}`,
  body: sentence(index, 8 + (index % 4) * 9),
  bullets: index % 3 === 0 ? `• ${sentence(index + 1, 4)}\n• ${sentence(index + 2, 5)}` : '',
  code: index % 5 === 0 ? `const row = rows[${index}]` : '',
})

/** How many times each view has run, for the readout and the tests. */
export const viewRuns = { list: 0, rows: 0 }

const RowProps = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  bullets: Schema.String,
  code: Schema.String,
})

/** One row. Drawn from props only, so it draws again only when its props change. */
export const Row = Native.component({
  name: 'Row',
  props: RowProps,
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: $ => $.model,
  view: h => {
    viewRuns.rows++
    const { title, body, bullets, code } = h.props
    return h.view.style({ gap: 4 }).children(
      h.text.style({ fontSize: 17, fontWeight: '700', color: Look.INK }).children(title),
      h.text.style({ fontSize: 15, lineHeight: 21, color: Look.INK }).children(body),
      bullets !== '' && h.text.style({ fontSize: 15, lineHeight: 21, color: Look.DIM }).children(bullets),
      code !== '' &&
        h.view
          .style({ backgroundColor: Look.WASH, borderRadius: 6, padding: 8 })
          .children(h.text.style({ fontSize: 13, fontFamily: 'Menlo', color: Look.INK }).children(code)),
    )
  },
})

const Readout = Schema.Struct({
  /** JavaScript frames in the last half second: the average and the longest, in ms. */
  frameMs: Schema.Number,
  worstFrameMs: Schema.Number,
  /** JavaScript time of the last event that was handled, and the longest ever, in ms. */
  stepMs: Schema.Number,
  worstStepMs: Schema.Number,
  /** How many times the list's view and the rows' views have run. */
  listRuns: Schema.Number,
  rowRuns: Schema.Number,
  commits: Schema.Number,
  liveViews: Schema.Number,
})
type Readout = typeof Readout.Type

export const LongListMessage = UiSchema.TaggedEnum({
  ScrolledList: { at: VirtualList.ScrollAt },
  MeasuredRow: { index: Schema.Number, height: Schema.Number },
  PressedRow: { index: Schema.Number },
  HeldRow: { index: Schema.Number },
  PressedScrollToEnd: {},
  PressedScrollToTop: {},
  PressedStream: {},
  PressedRecycle: {},
  TickedStream: {},
  UpdatedReadout: { readout: Readout },
})

const LongListModel = Schema.Struct({
  list: VirtualList.Model,
  pressed: Schema.Number,
  held: Schema.Number,
  lastRow: Schema.String,
  isStreaming: Schema.Boolean,
  streamed: Schema.String,
  isRecycling: Schema.Boolean,
  readout: Readout,
})

export const LongListProps = Schema.Struct({
  /** Off in tests that count draws: the readout is itself a draw twice a second. */
  hasReadout: Schema.Boolean,
})

const ListRef = Native.ref('long-list')

const EMPTY_READOUT: Readout = {
  frameMs: 0,
  worstFrameMs: 0,
  stepMs: 0,
  worstStepMs: 0,
  listRuns: 0,
  rowRuns: 0,
  commits: 0,
  liveViews: 0,
}

const meter = makeFrameMeter()

const round = (value: number): number => Math.round(value * 10) / 10

/** Twice a second: the frame meter, the host's counters and the view counters, as one Message. */
const readoutTicks = Subscription.make(
  'LongList/readout',
  Stream.unwrap(
    Native.Host.use(host =>
      Effect.sync(() => {
        meter.start()
        return Stream.tick('500 millis').pipe(
          Stream.map(() => {
            const frame = meter.read()
            return LongListMessage.UpdatedReadout({
              readout: {
                frameMs: round(frame.averageMs),
                worstFrameMs: round(frame.worstMs),
                stepMs: round(host.stats['lastStepMs'] ?? 0),
                worstStepMs: round(host.stats['maxStepMs'] ?? 0),
                listRuns: viewRuns.list,
                rowRuns: viewRuns.rows,
                commits: host.stats['commits'] ?? 0,
                liveViews: host.stats['live'] ?? 0,
              },
            })
          }),
          Stream.ensuring(Effect.sync(() => meter.stop())),
        )
      }),
    ),
  ),
)

/** The stream: a word 30 times a second. */
const streamTicks = Subscription.make(
  'LongList/stream',
  Stream.tick('33 millis').pipe(Stream.drop(1), Stream.as(LongListMessage.TickedStream())),
)

/** The streamed row starts again when it gets this long, so a long test stays cheap. */
const STREAM_LIMIT = 3000

export const LongList = Native.component({
  name: 'LongList',
  props: LongListProps,
  model: LongListModel,
  message: LongListMessage,
}).make({
  init: () => ({
    list: VirtualList.init({ count: ROW_COUNT, estimate: 96 }),
    pressed: 0,
    held: 0,
    lastRow: 'none',
    isStreaming: false,
    streamed: 'The last row. Press Stream and it grows.',
    isRecycling: false,
    readout: EMPTY_READOUT,
  }),
  update: {
    ScrolledList: ($, { at }) => {
      const list = VirtualList.scrolled($.model.list, at, ROW_COUNT)
      // Most scroll events change nothing: the same Model, and no draw.
      return list === $.model.list ? $.model : $.evolve({ list })
    },
    MeasuredRow: ($, { index, height }) => {
      const list = VirtualList.measured($.model.list, index, height, ROW_COUNT)
      return list === $.model.list ? $.model : $.evolve({ list })
    },
    PressedRow: ($, { index }) => $.evolve({ pressed: n => n + 1, lastRow: `pressed ${index + 1}` }),
    HeldRow: ($, { index }) => $.evolve({ held: n => n + 1, lastRow: `held ${index + 1}` }),
    PressedScrollToEnd: $ => $.run(NativeCommand.scrollToEnd(ListRef, true).pipe(Command.asNoop)),
    PressedScrollToTop: $ => $.run(NativeCommand.scrollTo(ListRef, { y: 0, animated: true }).pipe(Command.asNoop)),
    PressedStream: $ => $.evolve({ isStreaming: on => !on }),
    PressedRecycle: $ => $.evolve({ isRecycling: on => !on }),
    TickedStream: $ => {
      const text = $.model.streamed.length > STREAM_LIMIT ? 'Again.' : $.model.streamed
      const word = WORDS[text.length % WORDS.length] ?? 'word'
      // The list follows its end as the row grows: a scroll the program makes.
      return $.evolve({ streamed: `${text} ${word}` }).run(
        NativeCommand.scrollToEnd(ListRef, false).pipe(Command.asNoop),
      )
    },
    UpdatedReadout: ($, { readout }) => $.evolve({ readout }),
  },
  subscriptions: ({ model, props }) => [props.hasReadout && readoutTicks, model.isStreaming && streamTicks],
  view: (h, model) => {
    viewRuns.list++
    const { readout } = model
    return h.view.style(Look.page).children(
      h.view.style({ padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: Look.LINE }).children(
        h.text.testId('list-frames').style(Look.small).children(
          `JS frame: ${readout.frameMs} ms average, ${readout.worstFrameMs} ms longest (last half second)`,
        ),
        h.text.testId('list-steps').style(Look.small).children(
          `Last event: ${readout.stepMs} ms in JS. Longest: ${readout.worstStepMs} ms`,
        ),
        h.text.testId('list-runs').style(Look.small).children(
          `Views run: list ${readout.listRuns}, rows ${readout.rowRuns}. Native views alive: ${readout.liveViews}`,
        ),
        h.text.testId('list-window').style(Look.small).children(
          `Rows drawn: ${model.list.first + 1} to ${model.list.end} of ${ROW_COUNT}. Presses ${model.pressed}, holds ${model.held}, last: ${model.lastRow}`,
        ),
        h.view.style({ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }).children(
          Look.plainButton(h, 'list-to-end', 'Scroll to end', LongListMessage.PressedScrollToEnd()),
          Look.plainButton(h, 'list-to-top', 'Top', LongListMessage.PressedScrollToTop()),
          Look.plainButton(h, 'list-stream', model.isStreaming ? 'Stream: on' : 'Stream: off', LongListMessage.PressedStream()),
          Look.plainButton(h, 'list-recycle', model.isRecycling ? 'Recycle: on' : 'Recycle: off', LongListMessage.PressedRecycle()),
        ),
      ),
      VirtualList.view(h, {
        model: model.list,
        count: ROW_COUNT,
        recycle: model.isRecycling,
        ref: ListRef,
        testId: 'long-list',
        onScroll: at => LongListMessage.ScrolledList({ at }),
        onRowLayout: (index, height) => LongListMessage.MeasuredRow({ index, height }),
        row: (index, key) =>
          h.pressable
            .testId(`row-${index}`)
            .style(Look.row)
            .pressedStyle(Look.rowPressed)
            .on('press', LongListMessage.PressedRow({ index }))
            .on('longPress', LongListMessage.HeldRow({ index }))
            .children(Row(h, { key, props: rowData(index) })),
        footer: h.view
          .key('streamed')
          .testId('row-streamed')
          .style({ ...Look.row, backgroundColor: Look.WASH })
          .children(
            h.text.style({ fontSize: 17, fontWeight: '700', color: Look.INK }).children('Streamed row'),
            h.text.testId('streamed-text').style({ fontSize: 15, lineHeight: 21, color: Look.INK }).children(model.streamed),
          ),
      }),
    )
  },
})
