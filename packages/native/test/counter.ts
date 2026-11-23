/**
 * An ordinary Foldkit program. Only the view's elements are native.
 */
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { text, view as box } from '../src/index.js'

export const Model = Schema.Struct({ count: Schema.Number })
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedDecrement: {},
  PressedIncrement: {},
})
export type Message = typeof Message.Type

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedDecrement: () => ({
      model: modifyFields(model, { count: count => count - 1 }),
    }),
    PressedIncrement: () => ({
      model: modifyFields(model, { count: count => count + 1 }),
    }),
  })

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { count: 0 },
})

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [h.Class('screen'), h.Style({ flex: '1', padding: '24px' })],
    [
      text([h.Attribute('testID', 'count')], [String(model.count)]),
      box(
        [h.Attribute('testID', 'minus'), h.OnClick(Message.PressedDecrement())],
        [text([], ['-'])],
      ),
      box(
        [h.Attribute('testID', 'plus'), h.OnClick(Message.PressedIncrement())],
        [text([], ['+'])],
      ),
    ],
  )

export const makeCounter = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container })
