/**
 * A list whose rows are added, removed and reordered, and a box whose style
 * follows the Model. This exercises the parts of the adapter a counter does
 * not: inserting, removing and moving views, and changing a style.
 */
import { Array, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { text, view as box } from '../src/index.js'

export const Model = Schema.Struct({
  rows: Schema.Array(Schema.String),
  next: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedAdd: {},
  PressedRemoveFirst: {},
  PressedReverse: {},
})
export type Message = typeof Message.Type

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedAdd: () => ({
      model: modifyFields(model, {
        rows: rows => [...rows, `row ${model.next}`],
        next: next => next + 1,
      }),
    }),
    PressedRemoveFirst: () => ({
      model: modifyFields(model, { rows: rows => rows.slice(1) }),
    }),
    PressedReverse: () => ({
      model: modifyFields(model, { rows: rows => Array.reverse(rows) }),
    }),
  })

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { rows: ['row 1', 'row 2', 'row 3'], next: 4 },
})

const button = <M>(h: HtmlBuilder<M>, id: string, message: M): Html =>
  box([h.Attribute('testID', id), h.OnClick(message)], [text([], [id])])

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [],
    [
      button(h, 'add', Message.PressedAdd()),
      button(h, 'remove', Message.PressedRemoveFirst()),
      button(h, 'reverse', Message.PressedReverse()),
      box(
        [
          h.Attribute('testID', 'rows'),
          h.Style({
            'background-color': model.rows.length > 3 ? 'red' : 'white',
          }),
        ],
        model.rows.map(row => text([h.Key(row)], [row])),
      ),
      model.rows.length === 0 ? text([], ['empty']) : h.empty,
    ],
  )

export const makeList = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container })
