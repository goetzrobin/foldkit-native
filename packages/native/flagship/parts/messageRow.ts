/**
 * One row of the transcript: a question you sent, or a reply with its
 * reasoning, its tools, its text and the small buttons under it.
 *
 * A row keeps nothing of its own. What it shows comes in as view inputs (the
 * row, the scheme, the reply stream), and everything a finger does on
 * it goes up to the transcript as an OutMessage. The status line under the
 * reply being written is the reply stream's own view.
 */
import { Option, Schema } from 'effect'
import { Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import type { Part, ReasoningPart, ToolCallPart } from '../../src/aiChat/index.js'
import { prop, pressedStyle, style } from '../../src/foldkit/attributes.js'
import { text, view as box } from '../../src/foldkit/elements.js'
import type { Device } from '../../src/foldkit/navigation/stack.js'
import { markdown } from '../../src/markdown/index.js'
import { animated } from '../../src/motion/index.js'
import type { Resources } from '../context.js'
import { onLongPress } from '../longPress.js'
import { type ChatRow, textOf, thoughtFor } from '../model.js'
import { thinkingLabel } from '../shimmer.js'
import { EASE_OUT_EXPO, ENTER_RISE, MOTION, type Palette, RADIUS, SPACE, TYPE, paletteOf } from '../theme.js'
import { attachmentChip, copyIcon, regenerateIcon, roundButton, shareIcon, spinner, textButton, tick } from '../ui.js'
import * as ReplyStream from './replyStream.js'

// MODEL: none. A row is drawn from its inputs.

export const Model = Schema.Struct({})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  LongPressed: {},
  /** A tap that no button, link or hold took. */
  Tapped: {},
  /** One of the small buttons under a finished reply: copy, share, regenerate. */
  PressedReplyAction: { key: Schema.String },
  PressedReasoning: {},
  PressedLink: { url: Schema.String },
  CopiedCode: { language: Schema.String },
  PressedTryAgain: {},
  GotReplyStreamMessage: { message: ReplyStream.Message },
})
export type Message = typeof Message.Type

/** Everything a row says, with the row's key. */
export const OutMessage = defineMessageUnion({
  LongPressed: { rowKey: Schema.String },
  Tapped: {},
  PressedReplyAction: { rowKey: Schema.String, key: Schema.String },
  PressedReasoning: { rowKey: Schema.String },
  PressedLink: { url: Schema.String },
  CopiedCode: { language: Schema.String },
  PressedTryAgain: {},
  GotReplyStreamMessage: { message: ReplyStream.Message },
})
export type OutMessage = typeof OutMessage.Type

// UPDATE

export const update = (
  model: Model,
  message: Message,
  rowKey: string,
): Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources> => ({
  model,
  outMessage: Message.match<OutMessage>(message, {
    LongPressed: () => OutMessage.LongPressed({ rowKey }),
    Tapped: () => OutMessage.Tapped(),
    PressedReplyAction: ({ key }) => OutMessage.PressedReplyAction({ rowKey, key }),
    PressedReasoning: () => OutMessage.PressedReasoning({ rowKey }),
    PressedLink: ({ url }) => OutMessage.PressedLink({ url }),
    CopiedCode: ({ language }) => OutMessage.CopiedCode({ language }),
    PressedTryAgain: () => OutMessage.PressedTryAgain(),
    GotReplyStreamMessage: ({ message: reply }) => OutMessage.GotReplyStreamMessage({ message: reply }),
  }),
})

// VIEW

export type ViewInputs = Readonly<{
  row: ChatRow
  /** The row's place in the transcript. The first question has less room above it. */
  index: number
  scheme: 'light' | 'dark'
  device: Device
  /** The reply stream, whose status line is drawn under the reply being written. */
  reply: ReplyStream.Model
}>

const TOOL_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  get_weather: ['Checking the weather', 'Checked the weather'],
  search_notes: ['Searching your notes', 'Searched your notes'],
}

const toolWords = (part: ToolCallPart): string => {
  const words = TOOL_WORDS[part.name] ?? [`Using ${part.name}`, `Used ${part.name}`]
  return part.output === null ? words[0] : words[1]
}

const isStreamingRow = (row: ChatRow): boolean => row.status === 'streaming'

const metaRow = (
  id: string,
  children: ReadonlyArray<Html>,
  attributes: ReadonlyArray<unknown> = [],
): Html =>
  box(
    [
      prop('testID', id),
      style({ flexDirection: 'row', alignItems: 'center', gap: SPACE.s, minHeight: TYPE.meta.lineHeight, opacity: 1 }),
      ...(attributes as ReadonlyArray<never>),
    ],
    children,
  )

const reasoningRow = (h: HtmlBuilder<Message>, palette: Palette, row: ChatRow, part: ReasoningPart): Html => {
  const isThinking = part.seconds === 0 && isStreamingRow(row)
  return metaRow(
    `${row.key}-reasoning`,
    isThinking
      ? [thinkingLabel(h, palette)]
      : [
          text(
            [style({ ...TYPE.meta, color: palette.ink2 })],
            [part.seconds > 0 ? thoughtFor(part.seconds) : 'Thought for a moment'],
          ),
          text([style({ ...TYPE.meta, color: palette.ink3 })], ['›']),
        ],
    [
      h.OnClick(Message.PressedReasoning()),
      pressedStyle({ opacity: 0.5 }),
      prop('accessibilityRole', 'button'),
      prop('accessibilityHint', 'Shows the reasoning'),
    ],
  )
}

const toolRow = (device: Device, palette: Palette, row: ChatRow, part: ToolCallPart): Html =>
  metaRow(`${row.key}-tool-${part.callId}`, [
    part.output === null ? spinner(device, palette.ink3, 16) : tick(palette.ink3),
    text([style({ ...TYPE.meta, color: palette.ink2 })], [toolWords(part)]),
  ])

const markdownStyle = (palette: Palette) => ({
  colors: {
    text: palette.ink,
    heading: palette.ink,
    muted: palette.ink2,
    link: palette.accent,
    bullet: palette.ink2,
    rule: palette.line,
    inlineCodeBackground: palette.surface,
    inlineCodeBorder: palette.line,
    codeBackground: palette.surface,
    codeBorder: palette.line,
    quoteBar: palette.line,
    quoteBackground: palette.bg,
    tableBorder: palette.line,
    tableHeaderBackground: palette.surface,
    tableRowEven: palette.bg,
    tableRowOdd: palette.bg,
    checkboxChecked: palette.ink,
    checkboxBorder: palette.ink3,
    selection: palette.accent,
  },
  spacing: { radius: RADIUS.chip },
})

const partView = (h: HtmlBuilder<Message>, inputs: ViewInputs, palette: Palette, part: Part, index: number): Html => {
  const { row } = inputs
  switch (part._tag) {
    case 'Reasoning':
      return reasoningRow(h, palette, row, part)
    case 'ToolCall':
      return toolRow(inputs.device, palette, row, part)
    case 'Text':
      return markdown(h, {
        id: `${row.key}-${index}`,
        text: part.text,
        isStreaming: isStreamingRow(row),
        colorScheme: inputs.scheme,
        style: markdownStyle(palette),
        // A long press opens the row's own menu; Select text is in it.
        selectable: false,
        onLink: url => Message.PressedLink({ url }),
        onCopyCode: copy => Message.CopiedCode({ language: copy.language }),
      })
  }
}

/** What is said under a reply that did not end well, and what can be done about it. */
const endOfReply = (h: HtmlBuilder<Message>, inputs: ViewInputs, palette: Palette): ReadonlyArray<Html> => {
  const { row } = inputs
  const live = Option.filter(inputs.reply.live, each => each.messageId === row.key)
  if (Option.exists(live, ReplyStream.isLost)) {
    return [
      h.submodel({
        slotId: `reply-${row.key}`,
        view: ReplyStream.view,
        model: inputs.reply,
        viewInputs: { rowKey: row.key, scheme: inputs.scheme },
        toParentMessage: (message: ReplyStream.Message) => Message.GotReplyStreamMessage({ message }),
      }),
    ]
  }
  if (row.status === 'stopped') {
    return [text([prop('testID', `${row.key}-stopped`), style({ ...TYPE.caption, color: palette.ink3 })], ['Stopped'])]
  }
  if (row.status === 'failed') {
    return [
      text(
        [prop('testID', `${row.key}-failed`), style({ ...TYPE.caption, color: palette.danger })],
        [row.failure ?? 'The reply stopped early.'],
      ),
      ...(row.isLastReply ? [textButton(h, 'try-again', 'Try again', palette.ink, Message.PressedTryAgain())] : []),
    ]
  }
  return []
}

/** The small buttons under a finished reply. Regenerate only under the newest. */
const replyActions = (h: HtmlBuilder<Message>, palette: Palette, row: ChatRow): Html => {
  const action = (key: string, label: string, icon: Html) =>
    roundButton(
      h,
      { id: `${row.key}-${key}`, label, fill: 'transparent', size: 32, onPress: Message.PressedReplyAction({ key }) },
      icon,
    )
  return box(
    [style({ flexDirection: 'row', gap: 2, marginLeft: -8 })],
    [
      action('copy', 'Copy', copyIcon(palette.ink3, palette.bg)),
      action('share', 'Share', shareIcon(palette.ink3)),
      ...(row.isLastReply ? [action('regenerate', 'Regenerate', regenerateIcon(palette.ink3))] : []),
    ],
  )
}

/** Fades in once your question has risen into place, as it does in Margelo's app. */
const THINKING_ENTER = { from: { opacity: 0 }, delay: 300, duration: 200, easing: 'easeOut' } as const

const replyRow = (h: HtmlBuilder<Message>, inputs: ViewInputs, palette: Palette): Html => {
  const { row } = inputs
  const hasText = row.parts.some(part => part._tag === 'Text' && part.text !== '')
  // "Thinking" until the first word, except while a running tool or the
  // reasoning row already says what is going on.
  const last = row.parts[row.parts.length - 1]
  const isBusyElsewhere =
    (last?._tag === 'ToolCall' && last.output === null) || (last?._tag === 'Reasoning' && last.seconds === 0)
  const isWaiting = isStreamingRow(row) && !hasText && !isBusyElsewhere
  return box(
    [
      prop('testID', `row-${row.key}`),
      // Held while it streams too: the menu then offers Copy so far and Stop.
      ...(hasText || isStreamingRow(row) ? onLongPress<Message>(Message.LongPressed(), Message.Tapped()) : []),
      style({ paddingHorizontal: SPACE.xl, paddingTop: SPACE.m, gap: SPACE.s, backgroundColor: palette.bg }),
    ],
    [
      ...(isWaiting
        ? [animated({ enter: THINKING_ENTER }, metaRow(`${row.key}-thinking`, [thinkingLabel(h, palette)], [h.Key('thinking')]))]
        : []),
      ...row.parts.map((part, index) => partView(h, inputs, palette, part, index)),
      ...endOfReply(h, inputs, palette),
      ...(hasText && (row.status === 'complete' || row.status === 'stopped') ? [replyActions(h, palette, row)] : []),
    ],
  )
}

const questionRow = (h: HtmlBuilder<Message>, palette: Palette, row: ChatRow, isFirst: boolean): Html => {
  const bubble = box(
    [
      prop('testID', `row-${row.key}`),
      ...onLongPress<Message>(Message.LongPressed(), Message.Tapped()),
      style({
        maxWidth: '84%',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: RADIUS.bubble,
        backgroundColor: palette.surface,
        gap: SPACE.s,
      }),
    ],
    [
      ...row.attachments.map(each => attachmentChip(palette, each.name)),
      text([prop('selectable', false), style({ ...TYPE.message, color: palette.ink })], [textOf(row.parts)]),
    ],
  )
  const outer = box(
    [
      h.Key(`q-${row.key}`),
      style({
        paddingHorizontal: SPACE.xl,
        paddingTop: isFirst ? SPACE.l : SPACE.xxl,
        alignItems: 'flex-end',
        backgroundColor: palette.bg,
        opacity: 1,
        transform: [{ translateY: 0 }],
      }),
    ],
    [bubble],
  )
  // A message you just sent rises into place. Only while it is on its way:
  // a saved row scrolled back into view must not move again.
  return row.source === 'pending'
    ? animated(
        { enter: { from: { opacity: 0, transform: [{ translateY: ENTER_RISE }] }, duration: MOTION.messageEnter, easing: EASE_OUT_EXPO } },
        outer,
      )
    : outer
}

export const view = Submodel.defineView<Model, Message, ViewInputs>((_model, inputs, h) => {
  const palette = paletteOf(inputs.scheme)
  return inputs.row.role === 'user'
    ? questionRow(h, palette, inputs.row, inputs.index === 0)
    : replyRow(h, inputs, palette)
})
