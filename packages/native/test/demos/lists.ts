/**
 * The lists and motion demo.
 *
 * Screen one is a list of 5,000 rows of different heights. Only the rows near
 * the screen exist as views, and a label says how many. Buttons add, remove
 * and shuffle rows and jump to row 2,500. Pulling down at the top refreshes.
 *
 * Screen two has a box that fades and slides, chips that fade in and out as
 * they are added and removed, and a card to drag.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  header,
  onDismissed,
  prop,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  text,
  title,
  view as box,
} from '../../src/index.js'
import { list, listRowCount, scrollListToIndex } from '../../src/list/index.js'
import { animated, draggable, transition } from '../../src/motion/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

const LIST_ID = 'demo-rows'
const ROW_COUNT = 5000
const JUMP_TO = 2500

const Row = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  /** How many lines of extra text the row has, so rows differ in height. */
  lines: Schema.Number,
})
type Row = typeof Row.Type

export const Model = Schema.Struct({
  rows: Schema.Array(Row),
  nextId: Schema.Number,
  selected: Schema.Number,
  endsReached: Schema.Number,
  refreshes: Schema.Number,
  isRefreshing: Schema.Boolean,
  shuffles: Schema.Number,
  isMotionOpen: Schema.Boolean,
  isBoxShown: Schema.Boolean,
  chips: Schema.Array(Schema.Number),
  nextChip: Schema.Number,
  drops: Schema.Number,
  lastDrop: Schema.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  PressedRow: { id: Schema.Number },
  PressedAddRow: {},
  PressedRemoveRow: {},
  PressedShuffle: {},
  PressedJump: {},
  CompletedJump: {},
  ReachedEnd: {},
  PulledToRefresh: {},
  CompletedRefresh: {},
  PressedOpenMotion: {},
  PressedCloseMotion: {},
  PoppedByPhone: { count: Schema.Number },
  PressedToggleBox: {},
  PressedAddChip: {},
  PressedRemoveChip: {},
  DroppedCard: { dx: Schema.Number, dy: Schema.Number },
})
export type Message = typeof Message.Type

const makeRow = (id: number, label: string): Row => ({
  id,
  title: `${label} ${id}`,
  lines: id % 4,
})

/** The same shuffle for the same seed, so `update` stays a plain function. */
const shuffled = (rows: ReadonlyArray<Row>, seed: number): Array<Row> => {
  const result = [...rows]
  let state = (seed * 2654435761 + 1013904223) >>> 0
  for (let at = result.length - 1; at > 0; at--) {
    state = (state * 1664525 + 1013904223) >>> 0
    const other = state % (at + 1)
    const held = result[at] as Row
    result[at] = result[other] as Row
    result[other] = held
  }
  return result
}

const describeDrop = (dx: number, dy: number): string =>
  `${Math.abs(Math.round(dx))} ${dx < 0 ? 'left' : 'right'}, ` +
  `${Math.abs(Math.round(dy))} ${dy < 0 ? 'up' : 'down'}`

const makeUpdate = (env: DemoEnv) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => env.exit()).pipe(Effect.as(Message.CompletedExit())),
  })
  const Jump = Command.define('Jump', {
    args: { index: Schema.Number },
    messages: [Message.CompletedJump],
    execute: ({ index }) =>
      scrollListToIndex(LIST_ID, index).pipe(Effect.as(Message.CompletedJump())),
  })
  // Stands in for a request to a server.
  const Refresh = Command.define('Refresh', {
    messages: [Message.CompletedRefresh],
    execute: Effect.sleep(1000).pipe(Effect.as(Message.CompletedRefresh())),
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      PressedRow: ({ id }) => ({ model: modifyFields(model, { selected: () => id }) }),
      PressedAddRow: () => ({
        model: modifyFields(model, {
          rows: rows => [makeRow(model.nextId, 'Added row'), ...rows],
          nextId: nextId => nextId + 1,
        }),
      }),
      PressedRemoveRow: () => ({
        model: modifyFields(model, { rows: rows => rows.slice(1) }),
      }),
      PressedShuffle: () => ({
        model: modifyFields(model, {
          rows: rows => shuffled(rows, model.shuffles + 1),
          shuffles: shuffles => shuffles + 1,
        }),
      }),
      PressedJump: () => ({
        model,
        commands: [Jump({ index: Math.min(JUMP_TO, model.rows.length - 1) })],
      }),
      CompletedJump: () => ({ model }),
      ReachedEnd: () => ({
        model: modifyFields(model, { endsReached: count => count + 1 }),
      }),
      PulledToRefresh: () =>
        model.isRefreshing
          ? { model }
          : { model: modifyFields(model, { isRefreshing: () => true }), commands: [Refresh()] },
      CompletedRefresh: () => ({
        model: modifyFields(model, {
          isRefreshing: () => false,
          refreshes: refreshes => refreshes + 1,
          rows: rows => [
            makeRow(model.nextId + 2, 'Refreshed row'),
            makeRow(model.nextId + 1, 'Refreshed row'),
            makeRow(model.nextId, 'Refreshed row'),
            ...rows,
          ],
          nextId: nextId => nextId + 3,
        }),
      }),
      PressedOpenMotion: () => ({ model: modifyFields(model, { isMotionOpen: () => true }) }),
      PressedCloseMotion: () => ({ model: modifyFields(model, { isMotionOpen: () => false }) }),
      // The phone has already gone back by itself (a swipe from the edge).
      PoppedByPhone: () => ({ model: modifyFields(model, { isMotionOpen: () => false }) }),
      PressedToggleBox: () => ({
        model: modifyFields(model, { isBoxShown: isShown => !isShown }),
      }),
      PressedAddChip: () => ({
        model: modifyFields(model, {
          chips: chips => [...chips, model.nextChip],
          nextChip: nextChip => nextChip + 1,
        }),
      }),
      PressedRemoveChip: () => ({
        model: modifyFields(model, { chips: chips => chips.slice(1) }),
      }),
      DroppedCard: ({ dx, dy }) => ({
        model: modifyFields(model, {
          drops: drops => drops + 1,
          lastDrop: () => describeDrop(dx, dy),
        }),
      }),
    })
}

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    rows: Array.from({ length: ROW_COUNT }, (_unused, id) => makeRow(id, 'Row')),
    nextId: ROW_COUNT,
    selected: -1,
    endsReached: 0,
    refreshes: 0,
    isRefreshing: false,
    shuffles: 0,
    isMotionOpen: false,
    isBoxShown: true,
    chips: [1, 2, 3],
    nextChip: 4,
    drops: 0,
    lastDrop: 'not yet',
  },
})

const INK = '#111111'
const MUTED = '#6b6b6b'
const LINE = '#e3e3e3'
const PAPER = '#ffffff'
const ACCENT = '#e8590c'
const TINT = '#fff1e6'

const button = (h: HtmlBuilder<Message>, id: string, label: string, message: Message): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: INK,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 15, fontWeight: '600' })], [label])],
  )

const note = (id: string, words: string): Html =>
  text([prop('testID', id), style({ color: MUTED, fontSize: 13 })], [words])

const heading = (words: string): Html =>
  text([style({ color: INK, fontSize: 17, fontWeight: '700' })], [words])

const BODY = 'This row has more text than its neighbours, so it is taller. '

const rowView =
  (model: Model, h: HtmlBuilder<Message>) =>
  (row: Row): Html =>
    box(
      [
        h.Attribute('testID', `row-${row.id}`),
        h.OnClick(Message.PressedRow({ id: row.id })),
        style({
          paddingVertical: 14,
          paddingHorizontal: 16,
          gap: 4,
          borderBottomWidth: 1,
          borderBottomColor: LINE,
          backgroundColor: row.id === model.selected ? TINT : PAPER,
        }),
      ],
      [
        text([style({ color: INK, fontSize: 17 })], [
          row.id === model.selected ? `${row.title} (pressed)` : row.title,
        ]),
        ...(row.lines === 0
          ? []
          : [text([style({ color: MUTED, fontSize: 14 })], [BODY.repeat(row.lines).trim()])]),
      ],
    )

const listScreen = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  screen(
    [h.Key('list'), h.Attribute('testID', 'screen-list')],
    [
      header([title('Lists')], []),
      safeArea(device, { hasHeader: true }, [
        box(
          [style({ flex: 1, backgroundColor: PAPER })],
          [
            box(
              [style({ padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: LINE })],
              [
                box(
                  [style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })],
                  [
                    button(h, 'exit', 'Exit', Message.PressedExit()),
                    button(h, 'open-motion', 'Motion demo', Message.PressedOpenMotion()),
                    button(h, 'jump', 'Go to row 2,500', Message.PressedJump()),
                    button(h, 'add-row', 'Add at top', Message.PressedAddRow()),
                    button(h, 'remove-row', 'Remove first', Message.PressedRemoveRow()),
                    button(h, 'shuffle', 'Shuffle', Message.PressedShuffle()),
                  ],
                ),
                note(
                  'model-status',
                  `${model.rows.length} rows in the Model. End reached ${model.endsReached} times. ` +
                    `Refreshed ${model.refreshes} times.`,
                ),
                listRowCount(
                  LIST_ID,
                  [h.Attribute('testID', 'row-count'), style({ color: ACCENT, fontSize: 15, fontWeight: '600' })],
                  stats =>
                    `Row views that exist now: ${stats.rowViews} ` +
                    `(rows ${stats.first + 1} to ${stats.end})`,
                ),
                note(
                  'list-hint',
                  'Scroll fast: the orange number should stay small. Press a row to mark it. ' +
                    'Pull down at the top to refresh: three rows arrive after a second.',
                ),
              ],
            ),
            list(h, {
              id: LIST_ID,
              items: model.rows,
              key: row => row.id,
              estimatedRowHeight: 72,
              row: rowView(model, h),
              onEndReached: () => Message.ReachedEnd(),
              refresh: {
                platform: device.platform,
                refreshing: model.isRefreshing,
                onRefresh: () => Message.PulledToRefresh(),
              },
              attributes: [h.Attribute('testID', 'rows'), style({ flex: 1 })],
            }),
          ],
        ),
      ]),
    ],
  )

const section = (children: ReadonlyArray<Html>): Html =>
  box([style({ gap: 10, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: LINE })], children)

const motionScreen = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  screen(
    [
      h.Key('motion'),
      h.Attribute('testID', 'screen-motion'),
      onDismissed<Message>(count => Message.PoppedByPhone({ count })),
    ],
    [
      header([title('Motion')], []),
      safeArea(device, { hasHeader: true }, [
        scrollView(
          [style({ flex: 1, backgroundColor: PAPER })],
          [
            box(
              [style({ padding: 16, gap: 20 })],
              [
                button(h, 'close-motion', 'Back to the list', Message.PressedCloseMotion()),
                section([
                  heading('1. Fade and slide'),
                  note('fade-hint', 'Press the button. The box should fade and slide for a quarter of a second, not jump.'),
                  button(h, 'toggle-box', model.isBoxShown ? 'Hide the box' : 'Show the box', Message.PressedToggleBox()),
                  box(
                    [
                      h.Attribute('testID', 'fade-box'),
                      transition({
                        opacity: { duration: 250, easing: 'easeOut' },
                        transform: { duration: 250, easing: 'easeOut' },
                      }),
                      style({
                        width: 120,
                        height: 80,
                        borderRadius: 12,
                        backgroundColor: ACCENT,
                        opacity: model.isBoxShown ? 1 : 0,
                        transform: [{ translateX: model.isBoxShown ? 0 : 120 }] as never,
                      }),
                    ],
                    [],
                  ),
                ]),
                section([
                  heading('2. Appear and leave'),
                  note('chip-hint', 'Added chips should fade in and rise. Removed chips should fade out before they go.'),
                  box(
                    [style({ flexDirection: 'row', gap: 8 })],
                    [
                      button(h, 'add-chip', 'Add a chip', Message.PressedAddChip()),
                      button(h, 'remove-chip', 'Remove the first', Message.PressedRemoveChip()),
                    ],
                  ),
                  box(
                    [h.Attribute('testID', 'chips'), style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 40 })],
                    model.chips.map(chip =>
                      animated(
                        {
                          enter: {
                            from: { opacity: 0, transform: [{ translateY: 16 }] },
                            duration: 250,
                            easing: 'easeOut',
                          },
                          exit: { to: { opacity: 0 }, duration: 200, easing: 'easeIn' },
                        },
                        box(
                          [
                            h.Key(String(chip)),
                            h.Attribute('testID', `chip-${chip}`),
                            style({
                              paddingVertical: 8,
                              paddingHorizontal: 14,
                              borderRadius: 20,
                              backgroundColor: TINT,
                              opacity: 1,
                              transform: [{ translateY: 0 }] as never,
                            }),
                          ],
                          [text([style({ color: INK, fontSize: 15 })], [`Chip ${chip}`])],
                        ),
                      ),
                    ),
                  ),
                ]),
                section([
                  heading('3. Drag'),
                  note('drag-hint', 'Drag the card. It should follow your finger, then ease back when you let go.'),
                  note('drag-status', `Dropped ${model.drops} times. Last drop: ${model.lastDrop}.`),
                  draggable<Message>(
                    { onRelease: drag => Message.DroppedCard(drag) },
                    [
                      h.Attribute('testID', 'card'),
                      style({
                        width: 160,
                        height: 100,
                        borderRadius: 16,
                        backgroundColor: INK,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }),
                    ],
                    [text([style({ color: PAPER, fontSize: 17, fontWeight: '600' })], ['Drag me'])],
                  ),
                ]),
              ],
            ),
          ],
        ),
      ]),
    ],
  )

const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'demo-stack')],
      [
        listScreen(model, h, device),
        ...(model.isMotionOpen ? [motionScreen(model, h, device)] : []),
      ],
    )

export const makeDemo = (container: HTMLElement, env: DemoEnv) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env),
    view: makeView(env.device),
    container,
  })
