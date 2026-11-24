/**
 * A small program with swipe rows, for the swipe tests: three rows in a
 * scroll view, each with a button inside, and a line that lists every
 * Message the rows sent.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { scrollView, style, text, view as box } from '../src/index.js'
import {
  type SwipeDriverName,
  type SwipeStyle,
  closeAllSwipes,
  closeSwipe,
  swipeAction,
  swipeActions,
  swipeInfo,
  swipeRow,
  tiles,
} from '../src/swipe/index.js'

export type SwipeFixtureOptions = Readonly<{
  driver?: SwipeDriverName | 'auto'
  style?: SwipeStyle
  rightToLeft?: boolean
  reduceMotion?: boolean
  allowsFullSwipe?: boolean
  /** Show a time behind each row in place of trailing actions. */
  trailingInfo?: boolean
  /** Give each row its own group, so several may be open at once. */
  separateGroups?: boolean
}>

export const Model = Schema.Struct({
  rows: Schema.Array(Schema.String),
  log: Schema.Array(Schema.String),
  presses: Schema.Number,
  isHidden: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  TriggeredAction: { id: Schema.String, key: Schema.String },
  OpenedRow: { id: Schema.String, side: Schema.String },
  ClosedRow: { id: Schema.String },
  ArmedFullSwipe: { id: Schema.String, isArmed: Schema.Boolean },
  PressedInside: { id: Schema.String },
  PressedHide: {},
  PressedCloseFirst: {},
  PressedCloseAll: {},
  CompletedClose: {},
})
export type Message = typeof Message.Type

const CloseFirst = Command.define('CloseFirst', {
  messages: [Message.CompletedClose],
  execute: closeSwipe('a').pipe(Effect.as(Message.CompletedClose())),
})
const CloseAll = Command.define('CloseAll', {
  messages: [Message.CompletedClose],
  execute: closeAllSwipes().pipe(Effect.as(Message.CompletedClose())),
})

const logged = (model: Model, line: string): Model =>
  modifyFields(model, { log: log => [...log, line] })

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    TriggeredAction: ({ id, key }) => ({
      model: modifyFields(logged(model, `triggered ${id} ${key}`), {
        rows: rows => (key === 'delete' ? rows.filter(row => row !== id) : rows),
      }),
    }),
    OpenedRow: ({ id, side }) => ({ model: logged(model, `opened ${id} ${side}`) }),
    ClosedRow: ({ id }) => ({ model: logged(model, `closed ${id}`) }),
    ArmedFullSwipe: ({ id, isArmed }) => ({
      model: logged(model, `${isArmed ? 'armed' : 'disarmed'} ${id}`),
    }),
    PressedInside: () => ({ model: modifyFields(model, { presses: presses => presses + 1 }) }),
    PressedHide: () => ({ model: modifyFields(model, { isHidden: isHidden => !isHidden }) }),
    PressedCloseFirst: () => ({ model, commands: [CloseFirst()] }),
    PressedCloseAll: () => ({ model, commands: [CloseAll()] }),
    CompletedClose: () => ({ model }),
  })

const button = <M>(h: HtmlBuilder<M>, id: string, message: M): Html =>
  box([h.Attribute('testID', id), h.OnClick(message)], [text([], [id])])

export const makeSwipeFixture = (container: HTMLElement, options: SwipeFixtureOptions = {}) => {
  const row = (h: HtmlBuilder<Message>, id: string): Html =>
    swipeRow(
      h,
      {
        id,
        ...(options.separateGroups === true ? { group: id } : {}),
        driver: options.driver ?? 'auto',
        style: options.style ?? tiles,
        rightToLeft: options.rightToLeft ?? false,
        reduceMotion: options.reduceMotion ?? false,
        leading: [
          swipeAction({
            key: 'read',
            label: 'Read',
            onTriggered: Message.TriggeredAction({ id, key: 'read' }),
          }),
        ],
        trailing:
          options.trailingInfo === true
            ? swipeInfo(text([], ['09:41']), { width: 64 })
            : swipeActions(
                [
                  swipeAction({
                    key: 'delete',
                    label: 'Delete',
                    role: 'destructive',
                    onTriggered: Message.TriggeredAction({ id, key: 'delete' }),
                  }),
                  swipeAction({
                    key: 'flag',
                    label: 'Flag',
                    onTriggered: Message.TriggeredAction({ id, key: 'flag' }),
                  }),
                ],
                { allowsFullSwipe: options.allowsFullSwipe ?? false },
              ),
        onOpened: side => Message.OpenedRow({ id, side }),
        onClosed: () => Message.ClosedRow({ id }),
        onFullSwipeArmed: isArmed => Message.ArmedFullSwipe({ id, isArmed }),
        accessibilityLabel: `Row ${id}`,
        attributes: [h.Key(id), h.Attribute('testID', id)],
      },
      [
        box(
          [style({ height: 72, flexDirection: 'row' })],
          [text([], [`row ${id}`]), button(h, `${id}-button`, Message.PressedInside({ id }))],
        ),
      ],
    )

  const view = (model: Model, h: HtmlBuilder<Message>): Html =>
    box(
      [style({ flex: 1 })],
      [
        text([h.Attribute('testID', 'log')], [model.log.join(' | ')]),
        text([h.Attribute('testID', 'presses')], [String(model.presses)]),
        button(h, 'hide', Message.PressedHide()),
        button(h, 'close-first', Message.PressedCloseFirst()),
        button(h, 'close-all', Message.PressedCloseAll()),
        box([h.Attribute('testID', 'outside'), style({ height: 40 })], []),
        scrollView(
          [h.Attribute('testID', 'scroll'), style({ flex: 1 })],
          model.isHidden ? [] : model.rows.map(id => row(h, id)),
        ),
      ],
    )

  const init: Runtime.ElementInit<Model, Message> = () => ({
    model: { rows: ['a', 'b', 'c'], log: [], presses: 0, isHidden: false },
  })

  return Runtime.makeElement({ Model, init, update, view, container })
}
