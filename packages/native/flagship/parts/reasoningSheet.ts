/**
 * A reply's reasoning, in a sheet: what the model thought before it wrote,
 * and for how long. It keeps which reply it shows. The reasoning itself comes
 * in from above, read from the chat's rows.
 */
import { Schema } from 'effect'
import { Submodel, type Update } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import type { ReasoningPart } from '../../src/aiChat/index.js'
import { prop, style } from '../../src/foldkit/attributes.js'
import { scrollView, text } from '../../src/foldkit/elements.js'
import { sheetContent, sheetHandle } from '../../src/foldkit/navigation/sheets.js'
import type { Context, Resources } from '../context.js'
import { thoughtFor } from '../model.js'
import { sheetScreen, sheetTitle } from '../sheetChrome.js'
import { SPACE, TYPE, paletteOf } from '../theme.js'

// MODEL

export const Model = Schema.Struct({ rowKey: Schema.String, detent: Schema.Number })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  /** Swiped down. */
  Dismissed: {},
  /** The phone moved the sheet to another of its heights. */
  ChangedDetent: { index: Schema.Number },
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({ Closed: {} })
export type OutMessage = typeof OutMessage.Type

// UPDATE

export const update = (model: Model, message: Message): Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources> =>
  Message.match<Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>>(message, {
    Dismissed: () => ({ model, outMessage: OutMessage.Closed() }),
    ChangedDetent: ({ index }) => ({ model: { ...model, detent: index } }),
  })

// VIEW

export type ViewInputs = Context & Readonly<{ reasoning: ReasoningPart | undefined }>

export const view = Submodel.defineView<Model, Message, ViewInputs>((_model, inputs, h) => {
  const { device, reasoning } = inputs
  const palette = paletteOf(inputs.shared.scheme)
  const title = reasoning === undefined || reasoning.seconds === 0 ? 'Thinking' : thoughtFor(reasoning.seconds)
  return sheetScreen(h, device, palette, 'reasoning', [0.5, 1], Message.Dismissed(), [
    sheetHandle(device, palette.line),
    sheetContent({ attributes: [prop('testID', 'reasoning')] }, [
      sheetTitle(h, palette, title),
      scrollView(
        [style({ flex: 1 }), prop('nestedScrollEnabled', true)],
        [
          text(
            [prop('testID', 'reasoning-text'), prop('selectable', true), style({ ...TYPE.replyBody, color: palette.ink2, paddingHorizontal: SPACE.xl, paddingBottom: SPACE.huge })],
            [reasoning?.text ?? ''],
          ),
        ],
      ),
    ]),
  ], index => Message.ChangedDetent({ index }))
})
