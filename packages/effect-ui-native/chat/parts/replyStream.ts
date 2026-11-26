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
 * If the connection drops, the row asks for the rest of the reply again
 * after 0.25, 0.5, 1 and 2 seconds, from the last event it has. After four
 * tries in a row it shows a Reconnect button. Coming back to the app while
 * a reply is being written asks again at once.
 */
import { Command, UiSchema } from '@effect/ui'
import { Option, Schema } from 'effect'

import {
  LiveTurn,
  LiveTurnOps,
  MAX_RECONNECTS,
  TurnUpdate,
  reconnectDelayMs,
} from '../../../native/src/host/aiChat/turns.js'
import { MessageStatus, Part } from '../../../native/src/host/aiChat/wire.js'
import { Native, NativeViews, Phone } from '../../src/index.js'
import { RefreshChat, ResumeTurn, followTurn } from '../data.js'
import { SPACE, Scheme, TYPE, paletteOf } from '../theme.js'
import { textButton } from '../ui.js'

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
})

export const ReplyStreamMessage = UiSchema.TaggedEnum({
  ReceivedTurnUpdate: { update: TurnUpdate },
  ChangedAppState: { status: Phone.Device.AppState.AppStatus },
  PressedReconnect: {},
  Resumed: {},
  Refreshed: {},
})

const ReplyStreamModel = Schema.Struct({
  live: Schema.Option(LiveTurn),
  /** The app went out of sight while this reply was being written. */
  wasAway: Schema.Boolean,
})

const resumed = Command.as(ReplyStreamMessage.Resumed())

/** Asked for too many times in a row: the person decides when to try again. */
const hasGivenUp = (live: LiveTurn): boolean => live.connection === 'lost' && live.lostCount > MAX_RECONNECTS

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
}).make({
  init: () => ({ live: Option.none(), wasAway: false }),
  update: {
    ReceivedTurnUpdate: ($, { update }) => {
      const live =
        update._tag === 'TurnStarted' && Option.isNone($.model.live)
          ? Option.some(LiveTurnOps.start(update))
          : LiveTurnOps.apply($.model.live, update)
      const next = $.evolve({ live })
      if (update._tag === 'TurnGone') {
        // The server has forgotten the turn. Its saved copy has the end of it.
        return next.run(
          RefreshChat.make({ conversationId: $.props.conversationId }).pipe(Command.as(ReplyStreamMessage.Refreshed())),
        )
      }
      if (update._tag === 'ConnectionLost' && Option.isSome(live) && live.value.connection === 'lost') {
        return hasGivenUp(live.value)
          ? next
          : next.run(
              ResumeTurn.make({
                turnId: live.value.turnId,
                delayMs: reconnectDelayMs(live.value.lostCount),
              }).pipe(resumed),
            )
      }
      return next
    },
    ChangedAppState: ($, { status }) => {
      if (status !== 'active') return $.evolve({ wasAway: true })
      if (!$.model.wasAway) return $.model
      const next = $.evolve({ wasAway: false })
      // The phone may have closed the connection without saying so.
      return Option.isSome($.model.live) && $.model.live.value.status === 'streaming'
        ? next.run(ResumeTurn.make({ turnId: $.model.live.value.turnId, delayMs: 0 }).pipe(resumed))
        : next
    },
    PressedReconnect: $ =>
      Option.isSome($.model.live)
        ? $.evolve({ live: Option.map($.model.live, live => ({ ...live, lostCount: 0 })) }).run(
            ResumeTurn.make({ turnId: $.model.live.value.turnId, delayMs: 0 }).pipe(resumed),
          )
        : $.model,
    Resumed: $ => $.model,
    Refreshed: $ => $.model,
  },
  subscriptions: ({ props, model }) => [
    props.followTurnId !== null &&
      followTurn(props.followTurnId, update => ReplyStreamMessage.ReceivedTurnUpdate({ update })),
    props.followTurnId !== null &&
      LiveTurnOps.isStreaming(model.live) &&
      Phone.appState(status => ReplyStreamMessage.ChangedAppState({ status })),
  ],
  view: (h, model) => {
    const props = h.props
    const palette = paletteOf(props.scheme)
    // The live copy leads for as long as the saved one is still being written.
    const live = props.status === 'streaming' ? Option.getOrUndefined(model.live) : undefined
    // A chat opened in the middle of a reply has a saved part of it. The live
    // copy takes over once it holds at least as much.
    const parts = live !== undefined && sizeOf(live.parts) >= sizeOf(props.parts) ? live.parts : props.parts
    const status = live?.status ?? props.status
    const failure = live?.failure ?? props.failure
    const isStreaming = status === 'streaming'
    const meta = (key: string, words: string) =>
      h.text.key(key).testId(`reply-meta-${props.id}`).style({ ...TYPE.meta, color: palette.ink2 }).children(words)
    return h.view
      .testId(`reply-${props.id}`)
      .style({ paddingHorizontal: SPACE.xl, paddingTop: SPACE.m, gap: SPACE.s })
      .children(
        parts.length === 0 && isStreaming
          ? h.text
              .key('thinking')
              .testId(`reply-thinking-${props.id}`)
              .style({ ...TYPE.meta, color: palette.ink3 })
              .children('Thinking')
          : null,
        parts.map((part, index) =>
          part._tag === 'Text'
            ? h.view
                .key(`part-${index}`)
                .testId(`reply-text-${props.id}`)
                .children(
                  NativeViews.markdown(h, {
                    text: part.text,
                    scheme: props.scheme,
                    isStreaming,
                    style: { ...TYPE.replyBody, color: palette.ink } as Native.ViewStyle,
                  }),
                )
            : part._tag === 'Reasoning'
              ? meta(`part-${index}`, part.seconds > 0 ? `Thought for ${part.seconds} s` : 'Thinking it through')
              : meta(`part-${index}`, toolLine(part.name, part.output !== null)),
        ),
        status === 'stopped'
          ? h.text.key('stopped').style({ ...TYPE.caption, color: palette.ink3 }).children('Stopped')
          : null,
        status === 'failed'
          ? h.text
              .key('failed')
              .testId(`reply-failed-${props.id}`)
              .style({ ...TYPE.caption, color: palette.danger })
              .children(failure ?? 'The reply failed.')
          : null,
        live !== undefined && isStreaming && hasGivenUp(live)
          ? h.view.key('lost').style({ flexDirection: 'row', gap: SPACE.m, alignItems: 'center' }).children(
              h.text.style({ ...TYPE.caption, color: palette.ink3 }).children('The connection was lost.'),
              textButton(h, `reply-reconnect-${props.id}`, 'Reconnect', palette.accent, ReplyStreamMessage.PressedReconnect()),
            )
          : null,
      )
  },
})
