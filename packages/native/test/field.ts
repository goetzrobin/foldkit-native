/**
 * A text field tied to the Model. The program refuses digits, so what the
 * Model holds can differ from what was typed.
 */
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { text, textInput, view as box } from '../src/index.js'

export const Model = Schema.Struct({ draft: Schema.String })
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedDraft: { text: Schema.String },
  PressedClear: {},
})
export type Message = typeof Message.Type

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ChangedDraft: ({ text }) => ({
      model: modifyFields(model, { draft: () => text.replace(/[0-9]/g, '') }),
    }),
    PressedClear: () => ({ model: modifyFields(model, { draft: () => '' }) }),
  })

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { draft: '' },
})

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [],
    [
      textInput(
        [
          h.Attribute('testID', 'field'),
          h.Attribute('value', model.draft),
          h.Placeholder('Type here'),
          h.OnInput(text => Message.ChangedDraft({ text })),
        ],
        [],
      ),
      text([h.Attribute('testID', 'echo')], [model.draft]),
      box(
        [h.Attribute('testID', 'clear'), h.OnClick(Message.PressedClear())],
        [text([], ['Clear'])],
      ),
    ],
  )

export const makeField = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container })
