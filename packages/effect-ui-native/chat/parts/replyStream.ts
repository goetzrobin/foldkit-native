/**
 * One reply from the assistant: the saved text, and while the reply is
 * still being written, the live text on top.
 *
 * The saved text comes in through props, from the chat's query. The live
 * text comes from the reply's stream: numbered events, read through the
 * `followTurn` Subscription in bundles of 32 ms, and kept in this part's
 * Model as a `LiveTurn`. The row follows a turn for as long as its props
 * name one (`followTurnId`).
 *
 * While the saved copy still says "being written", the live text is shown.
 * Once the saved copy is finished, it is shown instead. Both are the same
 * words by then, and the row and its native Markdown view are the same
 * ones, so nothing moves on screen.
 *
 * Under a finished reply are three small buttons: Copy, Share and, under
 * the newest reply, one that writes it again. The row does not act on them.
 * It tells the transcript which was pressed. "Thought for 4 s" is a button
 * too: it tells the transcript the reasoning, to open in a sheet.
 *
 * The first words of a reply come with a small tick under the finger, and a
 * reply that fails with the phone's error pattern.
 *
 * The chat screen can ask this row to copy what is written so far
 * (`copyRequest`). Only the row has the live text, and a parent cannot call
 * a child, so the request is a number in the props that goes up by one.
 *
 * If the connection drops, the row asks for the rest of the reply again
 * after 0.25, 0.5, 1 and 2 seconds, from the last event it has. After four
 * tries in a row it shows a Reconnect button. Coming back to the app while
 * a reply is being written asks again at once.
 *
 * Which mode the reply is in (waiting, thinking, streaming, reconnecting,
 * done and so on) is a state machine, and its rules are in
 * `machines/reply.ts`. The state is kept in this row's Model (`reply`).
 * Each Message is turned into one event of the machine, and the machine
 * says what the next state is. An event the current state has no rule for
 * changes nothing here and starts nothing: words after Stop, Reconnect
 * while the connection is fine, Try again while the reply is still being
 * written. The view asks the state what it may draw (`allowed`).
 */
import { Command, Subscription, UiSchema } from '@effect/ui'
import { Schema, Stream } from 'effect'

import { TurnUpdate } from '../../../native/src/host/aiChat/turns.js'
import { MessageStatus, Part, applyToParts } from '../../../native/src/host/aiChat/wire.js'
import { Motion, Native, NativeViews, Phone } from '../../src/index.js'
import { RefreshChat, ResumeTurn, followTurn } from '../data.js'
import { copyIcon, regenerateIcon, shareIcon, tick } from '../icons.js'
import { Reply, ReplyEvent, ReplyState, allowed, fromSaved, hasWords, reconnectDelayMs } from '../machines/reply.js'
import { thinkingLabel } from '../shimmer.js'
import { ReplyText } from './replyText.js'
import { MOTION, SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { roundButton, textButton } from '../ui.js'

export const ReplyStreamProps = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  /** The saved reply, as far as the server has it. */
  parts: Schema.Array(Part),
  status: MessageStatus,
  failure: Schema.NullOr(Schema.String),
  /** The turn that is writing this reply, while it is being written. */
  followTurnId: Schema.NullOr(Schema.String),
  scheme: Scheme,
  platform: Schema.String,
  /** The newest reply of the chat: the one that can be written again. */
  isLast: Schema.Boolean,
  /** Raised by one each time the chat screen wants what is written so far on the clipboard. 0: never asked. */
  copyRequest: Schema.Number,
})

export const ReplyAction = Schema.Literals(['copy', 'share', 'regenerate'])
export type ReplyAction = typeof ReplyAction.Type

export const ReplyStreamEvents = UiSchema.TaggedEnum({
  /** One of the small buttons under the reply. */
  PressedAction: { action: ReplyAction },
  /** "Thought for 4 s" was pressed. */
  PressedReasoning: { title: Schema.String, text: Schema.String },
  PressedTryAgain: {},
  /** What was written so far is on the clipboard. */
  CopiedSoFar: {},
})

export const ReplyStreamMessage = UiSchema.TaggedEnum({
  ReceivedTurnUpdate: { update: TurnUpdate },
  ChangedAppState: { status: Phone.Device.AppState.AppStatus },
  PressedReconnect: {},
  PressedAction: { action: ReplyAction },
  PressedReasoning: { title: Schema.String, text: Schema.String },
  PressedTryAgain: {},
  RequestedCopy: {},
  Copied: {},
  Resumed: {},
  Refreshed: {},
})

/** What has arrived of the reply being written. */
const Turn = Schema.Struct({
  turnId: Schema.String,
  /** The newest event applied. Older ones, sent again, are skipped. */
  lastSeq: Schema.Number,
  parts: Schema.Array(Part),
})
type Turn = typeof Turn.Type

const ReplyStreamModel = Schema.Struct({
  /** The reply's mode: the state of the machine in `machines/reply.ts`. */
  reply: ReplyState,
  /** The words and the rest that have arrived. Null until the server has started. */
  turn: Schema.NullOr(Turn),
  /** The app went out of sight while this reply was being written. */
  wasAway: Schema.Boolean,
})

/** The machine event a turn update stands for. */
const eventOf = (update: TurnUpdate): ReplyEvent => {
  switch (update._tag) {
    case 'TurnStarted':
      return ReplyEvent.Started
    case 'TextBatch':
      return ReplyEvent.Words
    case 'TurnFinished':
      return ReplyEvent.Finished({ wasStopped: update.reason === 'stopped' })
    case 'TurnFailed':
      return ReplyEvent.Failed({ reason: update.reason })
    case 'ConnectionLost':
      return ReplyEvent.LostConnection
    case 'TurnGone':
      return ReplyEvent.Forgotten
    default:
      return ReplyEvent.Worked
  }
}

/** What an update adds to what has arrived. Pieces that were here already are skipped. */
const withUpdate = (turn: Turn | null, update: TurnUpdate): Turn | null => {
  if (update._tag === 'TurnStarted') return turn ?? { turnId: update.turnId, lastSeq: update.seq, parts: [] }
  if (turn === null || update._tag === 'ConnectionLost' || update._tag === 'TurnGone') return turn
  if (update._tag === 'TextBatch' || update._tag === 'ReasoningBatch') {
    const tag = update._tag === 'TextBatch' ? ('TextDelta' as const) : ('ReasoningDelta' as const)
    let { parts, lastSeq } = turn
    update.pieces.forEach((text, index) => {
      const seq = update.fromSeq + index
      if (seq <= lastSeq) return
      parts = applyToParts(parts, { _tag: tag, seq, text })
      lastSeq = seq
    })
    return { ...turn, parts, lastSeq }
  }
  return { ...turn, lastSeq: update.seq, parts: applyToParts(turn.parts, update) }
}

/** An update the row has had already: the server sends some again after a new connection. */
const isOld = (turn: Turn | null, update: TurnUpdate): boolean =>
  turn !== null && 'seq' in update && update._tag !== 'TurnStarted' && update.seq <= turn.lastSeq

/** One Message each time the chat screen raises `copyRequest`. */
const copyRequests = (request: number) =>
  Subscription.make('chat/reply/copy', request, () => Stream.succeed(ReplyStreamMessage.RequestedCopy()))

/** "Thought for 4 s": whole seconds, at least one. */
export const thoughtFor = (seconds: number): string => `Thought for ${Math.max(1, Math.round(seconds))} s`

const textOf = (parts: ReadonlyArray<typeof Part.Type>): string =>
  parts.map(part => (part._tag === 'Text' ? part.text : '')).join('')

const resumed = Command.as(ReplyStreamMessage.Resumed())

/**
 * The state the row acts on and draws. Once the saved copy says the reply
 * has ended, that is the state, whatever the live copy last heard.
 */
const shown = (props: { readonly status: typeof MessageStatus.Type; readonly failure: string | null }, live: ReplyState): ReplyState =>
  props.status === 'streaming' ? live : fromSaved(props.status, props.failure)

const TOOL_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  get_weather: ['Checking the weather', 'Checked the weather'],
  search_notes: ['Searching your notes', 'Searched your notes'],
}

const toolLine = (name: string, isDone: boolean): string => {
  const words = TOOL_WORDS[name] ?? [`Using ${name}`, `Used ${name}`]
  return isDone ? words[1] : words[0]
}

/** How much of a reply a list of parts holds. */
const sizeOf = (parts: ReadonlyArray<typeof Part.Type>): number =>
  parts.reduce((sum, part) => sum + 1 + (part._tag === 'ToolCall' ? (part.output?.length ?? 0) : part.text.length), 0)

export const ReplyStream = Native.component({
  name: 'ReplyStream',
  props: ReplyStreamProps,
  model: ReplyStreamModel,
  message: ReplyStreamMessage,
  events: ReplyStreamEvents,
}).make({
  init: () => ({ reply: ReplyState.Waiting, turn: null, wasAway: false }),
  update: {
    ReceivedTurnUpdate: ($, { update }) => {
      const before = shown($.props, $.model.reply)
      const event = eventOf(update)
      // No rule for this event in this state, or an event the row has had: nothing changes and nothing starts.
      if (!Reply.handles(before, event) || isOld($.model.turn, update)) return $.model
      const reply = Reply.step(before, event)
      const settled = $.evolve({ reply, turn: withUpdate($.model.turn, update) })
      const isFirstWords = ReplyState.$is('Streaming')(reply) && !hasWords(before)
      // One step, whichever of the two is felt: a step of two kinds would lose what it needs from the phone.
      const next = settled.run(
        ...(isFirstWords
          ? [Phone.Selection.make({}).pipe(resumed)]
          : ReplyState.$is('Failed')(reply)
            ? [Phone.Notify.make({ type: 'error' }).pipe(resumed)]
            : []),
      )
      // The server has forgotten the turn. Its saved copy has the end of it.
      if (ReplyState.$is('Gone')(reply)) {
        return next.run(
          RefreshChat.make({ conversationId: $.props.conversationId }).pipe(Command.as(ReplyStreamMessage.Refreshed())),
        )
      }
      // The connection dropped, and not too often yet: ask for the rest after a wait.
      if (ReplyEvent.$is('LostConnection')(event) && ReplyState.$is('Reconnecting')(reply) && $.model.turn !== null) {
        return next.run(
          ResumeTurn.make({ turnId: $.model.turn.turnId, delayMs: reconnectDelayMs(reply.attempt) }).pipe(resumed),
        )
      }
      return next
    },
    ChangedAppState: ($, { status }) => {
      if (status !== 'active') return $.evolve({ wasAway: true })
      if (!$.model.wasAway) return $.model
      const next = $.evolve({ wasAway: false })
      const before = shown($.props, $.model.reply)
      // The phone may have closed the connection without saying so.
      return Reply.handles(before, ReplyEvent.CameBack) && $.model.turn !== null
        ? next.run(ResumeTurn.make({ turnId: $.model.turn.turnId, delayMs: 0 }).pipe(resumed))
        : next
    },
    PressedReconnect: $ => {
      const before = shown($.props, $.model.reply)
      return Reply.handles(before, ReplyEvent.Reconnect) && $.model.turn !== null
        ? $.evolve({ reply: Reply.step(before, ReplyEvent.Reconnect) }).run(
            ResumeTurn.make({ turnId: $.model.turn.turnId, delayMs: 0 }).pipe(resumed),
          )
        : $.model
    },
    PressedAction: ($, { action }) => $.emit(ReplyStreamEvents.PressedAction({ action })),
    PressedReasoning: ($, { title, text }) => $.emit(ReplyStreamEvents.PressedReasoning({ title, text })),
    // Only a reply that failed can be tried again.
    PressedTryAgain: $ =>
      Reply.handles(shown($.props, $.model.reply), ReplyEvent.TryAgain)
        ? $.emit(ReplyStreamEvents.PressedTryAgain())
        : $.model,
    RequestedCopy: $ => {
      const live = $.props.status === 'streaming' ? $.model.turn : null
      const text = textOf(live === null ? $.props.parts : live.parts)
      return text === '' ? $.model : $.run(Phone.Copy.make({ text }).pipe(Command.as(ReplyStreamMessage.Copied())))
    },
    Copied: $ => $.emit(ReplyStreamEvents.CopiedSoFar()),
    Resumed: $ => $.model,
    Refreshed: $ => $.model,
  },
  subscriptions: ({ props, model }) => [
    props.copyRequest > 0 && copyRequests(props.copyRequest),
    props.followTurnId !== null &&
      followTurn(props.followTurnId, update => ReplyStreamMessage.ReceivedTurnUpdate({ update })),
    props.followTurnId !== null &&
      Reply.handles(model.reply, ReplyEvent.CameBack) &&
      Phone.appState(status => ReplyStreamMessage.ChangedAppState({ status })),
  ],
  view: (h, model) => {
    const props = h.props
    const palette = paletteOf(props.scheme)
    // The live copy leads for as long as the saved one is still being written.
    const live = props.status === 'streaming' ? model.turn : null
    // A chat opened in the middle of a reply has a saved part of it. The live
    // copy takes over once it holds at least as much.
    const parts = live !== null && sizeOf(live.parts) >= sizeOf(props.parts) ? live.parts : props.parts
    // Everything below is drawn only if the reply's state allows it.
    const may = allowed(shown(props, model.reply))
    const isStreaming = may.isWriting
    const hasText = parts.some(part => part._tag === 'Text' && part.text !== '')
    // "Thinking" until the first word, except while a running tool or the
    // reasoning row already says what is going on.
    const lastPart = parts[parts.length - 1]
    const isBusyElsewhere =
      (lastPart?._tag === 'ToolCall' && lastPart.output === null) || (lastPart?._tag === 'Reasoning' && lastPart.seconds === 0)
    const metaStyle = { flexDirection: 'row', alignItems: 'center', gap: SPACE.s, minHeight: TYPE.meta.lineHeight } as const
    const action = (key: ReplyAction, label: string, icon: Native.NoTextContent<typeof ReplyStreamMessage.Type>) =>
      roundButton(
        h,
        { id: `reply-${key}-${props.id}`, label, fill: 'transparent', size: 32, message: ReplyStreamMessage.PressedAction({ action: key }) },
        icon,
      )
    return h.view
      .testId(`reply-${props.id}`)
      .style({ paddingHorizontal: SPACE.xl, paddingTop: SPACE.m, gap: SPACE.s })
      .children(
        // "Thinking" fades in a moment after the question has risen into place.
        isStreaming && !hasText && !isBusyElsewhere
          ? Motion.animate(h.view.key('thinking-in').testId(`reply-thinking-motion-${props.id}`), {
              from: { opacity: 0 },
              to: { opacity: 1 },
              ms: MOTION.thinkingIn,
              delayMs: MOTION.thinkingDelay,
            }).children(thinkingLabel(h, palette, `reply-thinking-${props.id}`))
          : null,
        parts.map((part, index) =>
          part._tag === 'Text'
            ? h.view
                .key(`part-${index}`)
                .testId(`reply-text-${props.id}`)
                .children(
                  // Its links and its code blocks' Copy buttons can be tapped: see `replyText.ts`.
                  ReplyText(h, { key: 'text', props: { text: part.text, scheme: props.scheme, isStreaming } }),
                )
            : part._tag === 'Reasoning'
              ? part.seconds === 0 && isStreaming
                ? h.view.key(`part-${index}`).style(metaStyle).children(thinkingLabel(h, palette, `reply-meta-${props.id}`))
                : h.pressable
                    .key(`part-${index}`)
                    .testId(`reply-reasoning-${props.id}`)
                    .set({ accessibilityRole: 'button', accessibilityLabel: 'Show the reasoning' })
                    .style(metaStyle)
                    .pressedStyle({ opacity: 0.5 })
                    .on(
                      'press',
                      ReplyStreamMessage.PressedReasoning({
                        title: part.seconds > 0 ? thoughtFor(part.seconds) : 'Thinking',
                        text: part.text,
                      }),
                    )
                    .children(
                      h.text
                        .testId(`reply-meta-${props.id}`)
                        .style({ ...TYPE.meta, color: palette.ink2 })
                        .children(part.seconds > 0 ? thoughtFor(part.seconds) : 'Thought for a moment'),
                      h.text.style({ ...TYPE.meta, color: palette.ink3 }).children('›'),
                    )
              : h.view
                  .key(`part-${index}`)
                  .testId(`reply-tool-${props.id}`)
                  .style(metaStyle)
                  .children(
                    part.output === null ? NativeViews.spinner(h, props.platform, palette.ink3, 16) : tick(h, palette.ink3),
                    h.text.style({ ...TYPE.meta, color: palette.ink2 }).children(toolLine(part.name, part.output !== null)),
                  ),
        ),
        may.stopped
          ? h.text.key('stopped').style({ ...TYPE.caption, color: palette.ink3 }).children('Stopped')
          : null,
        may.failure !== null
          ? h.text
              .key('failed')
              .testId(`reply-failed-${props.id}`)
              .style({ ...TYPE.caption, color: palette.danger })
              .children(may.failure)
          : null,
        may.failure !== null && props.isLast
          ? h.view.key('try-again').style({ alignSelf: 'flex-start' }).children(
              textButton(h, `reply-try-again-${props.id}`, 'Try again', palette.ink, ReplyStreamMessage.PressedTryAgain()),
            )
          : null,
        may.reconnect
          ? h.view.key('lost').style({ flexDirection: 'row', gap: SPACE.m, alignItems: 'center' }).children(
              h.text.style({ ...TYPE.caption, color: palette.ink3 }).children('The connection was lost.'),
              textButton(h, `reply-reconnect-${props.id}`, 'Reconnect', palette.accent, ReplyStreamMessage.PressedReconnect()),
            )
          : null,
        hasText && may.actions
          ? h.view
              .key('actions')
              .testId(`reply-actions-${props.id}`)
              .style({ flexDirection: 'row', gap: 2, marginLeft: -8 })
              .children(
                action('copy', 'Copy', copyIcon(h, palette.ink3, palette.bg)),
                action('share', 'Share', shareIcon(h, palette.ink3)),
                props.isLast ? action('regenerate', 'Write the reply again', regenerateIcon(h, palette.ink3)) : null,
              )
          : null,
      )
  },
})
