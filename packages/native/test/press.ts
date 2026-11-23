/**
 * A button that counts presses, written with the native attributes: `onPress`,
 * `pressedStyle`, typed `style`, `testId`.
 */
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { onPress, pressable, pressedStyle, style, testId, text, view as box } from '../src/index.js'

export const Model = Schema.Struct({ presses: Schema.Number })
export type Model = typeof Model.Type

export const Message = defineMessageUnion({ PressedButton: {} })
export type Message = typeof Message.Type

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedButton: () => ({
      model: modifyFields(model, { presses: presses => presses + 1 }),
    }),
  })

export const init: Runtime.ElementInit<Model, Message> = () => ({ model: { presses: 0 } })

export const view = (model: Model): Html =>
  box(
    [style({ flex: 1, padding: 24, gap: 12 })],
    [
      text([testId('presses')], [String(model.presses)]),
      pressable(
        [
          testId('button'),
          style({ backgroundColor: '#0a66d8', padding: 12, borderRadius: 10 }),
          pressedStyle({ opacity: 0.6 }),
          onPress(Message.PressedButton()),
        ],
        [text([style({ color: '#ffffff', fontWeight: '600' })], ['Press'])],
      ),
    ],
  )

export const makePress = (container: HTMLElement) =>
  Runtime.makeElement({ Model, init, update, view, container })
