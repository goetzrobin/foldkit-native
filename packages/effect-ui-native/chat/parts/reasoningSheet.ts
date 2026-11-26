/**
 * A sheet that shows one piece of text to read and select: what the model
 * thought before a reply ("Thought for 4 s"), or a message opened with
 * Select text.
 *
 * It keeps nothing. The text comes in as props, as it was when the sheet
 * was opened. The sheet has two heights, half and full, and the phone moves
 * it between them under a finger. A swipe down closes it, and so does Done
 * in its footer, which stays at the sheet's bottom edge.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native, NativeViews } from '../../src/index.js'
import { HAIRLINE, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { sheetTitle, textButton } from '../ui.js'

export const ReasoningSheetProps = Schema.Struct({
  platform: Schema.String,
  scheme: Scheme,
  /** `reasoning` or `select`: the sheet's name on the phone, and its first height. */
  kind: Schema.Literals(['reasoning', 'select']),
  title: Schema.String,
  text: Schema.String,
  /** Draw the text as Markdown, as a reply is drawn. */
  isMarkdown: Schema.Boolean,
})

export const ReasoningSheetMessage = UiSchema.TaggedEnum({ Closed: {} })
export const ReasoningSheetEvents = UiSchema.TaggedEnum({ Closed: {} })

export const ReasoningSheet = Native.component({
  name: 'ReasoningSheet',
  props: ReasoningSheetProps,
  model: Schema.Null,
  message: ReasoningSheetMessage,
  events: ReasoningSheetEvents,
}).make({
  init: () => null,
  update: { Closed: $ => $.emit(ReasoningSheetEvents.Closed()) },
  view: h => {
    const { platform, scheme, kind, title, text, isMarkdown } = h.props
    const palette = paletteOf(scheme)
    const body = h.scrollView
      .key('text-scroll')
      .style({ flex: 1 })
      .prop('nestedScrollEnabled', true)
      .children(
        sheetTitle(h, palette, title),
        h.view
          .testId(`${kind}-text`)
          .style({ paddingHorizontal: SPACE.xl, paddingBottom: SPACE.huge })
          .children(
            isMarkdown
              ? NativeViews.markdown(h, { text, scheme, style: { ...TYPE.replyBody, color: palette.ink } as Native.ViewStyle })
              : h.text
                  .set({ selectable: true })
                  .style({ ...TYPE.replyBody, color: kind === 'reasoning' ? palette.ink2 : palette.ink })
                  .children(text),
          ),
      )
    const footer = h.view
      .testId(`${kind}-footer`)
      .style({
        alignItems: 'flex-end',
        paddingHorizontal: SPACE.xl,
        paddingVertical: SPACE.m,
        borderTopWidth: HAIRLINE,
        borderTopColor: palette.line,
        backgroundColor: palette.bg,
      })
      .children(textButton(h, `${kind}-done`, 'Done', palette.ink, ReasoningSheetMessage.Closed()))
    return h.modalScreen
      .testId(`sheet-${kind}`)
      .set(NativeViews.sheet({ detents: kind === 'reasoning' ? [0.5, 1] : [0.6, 1], hasGrabber: true }))
      .style({ backgroundColor: palette.bg })
      .on('dismissed', ReasoningSheetMessage.Closed())
      .children(...NativeViews.sheetParts(h, { platform, testId: kind, body, footer, handleColor: palette.line }))
  },
})
