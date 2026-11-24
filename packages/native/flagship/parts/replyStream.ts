/**
 * The reply being written: which turn is live, how much of it has arrived,
 * whether its connection was lost, and joining a turn that was already
 * running when its chat was opened.
 *
 * The words themselves arrive as `ReceivedTurnUpdate` Messages from the
 * client's Subscription (`liveTurnEntry`), a few a second. The chat screen
 * starts a turn (`started`), stops one (`stop`), and settles it against the
 * server's copy (`settle`). The row of the reply draws this part's view: the
 * line that says the connection dropped, with Reconnect.
 */
import { Option, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type AiChat,
  AiWire,
  type Conversation,
  LiveTurn,
  LiveTurnOps,
  MAX_RECONNECTS,
  TurnUpdate,
  reconnectDelayMs,
} from '../../src/aiChat/index.js'
import { prop, style } from '../../src/foldkit/attributes.js'
import { text, view as box } from '../../src/foldkit/elements.js'
import type { Resources } from '../context.js'
import { haptics } from '../effects.js'
import { SPACE, TYPE, paletteOf } from '../theme.js'
import { textButton } from '../ui.js'

// MODEL

export const Model = Schema.Struct({
  live: Schema.Option(LiveTurn),
  /** A turn found running when a chat was opened, being joined. */
  // effect-ui: h.isRunning (the Resume Command that joins it)
  joiningTurnId: Schema.Option(Schema.String),
  /** The turn whose first words have had their haptic. Kept across chats. */
  tickedTurnId: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ live: Option.none(), joiningTurnId: Option.none(), tickedTurnId: Option.none() })

// MESSAGE

export const Message = defineMessageUnion({
  ReceivedTurnUpdate: { update: TurnUpdate },
  Resumed: { turnId: Schema.String },
  StoppedTurn: {},
  FailedStop: { reason: Schema.String },
  PressedReconnect: {},
  CompletedSideEffect: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  /** Stopping did not work. The chat screen says so. */
  FailedWrite: { action: Schema.String, reason: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// COMMANDS

export const makeCommands = (chat: AiChat) => ({
  Stop: Command.define('ChatStop', {
    args: { turnId: Schema.String },
    messages: [Message.StoppedTurn, Message.FailedStop],
    execute: ({ turnId }) =>
      chat.stop(
        turnId,
        () => Message.StoppedTurn(),
        reason => Message.FailedStop({ reason }),
      ),
  }),
  Resume: Command.define('ChatResume', {
    args: { turnId: Schema.String, delayMs: Schema.Number },
    messages: [Message.Resumed],
    execute: ({ turnId, delayMs }) => chat.resume(turnId, delayMs, () => Message.Resumed({ turnId })),
  }),
})
export type Commands = ReturnType<typeof makeCommands>

/** What an update reads besides its Model: the Commands, and the open chat as the server last sent it. */
export type Inputs = Readonly<{ commands: Commands; conversation: Option.Option<Conversation> }>

// UPDATE

type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>

const haptic = haptics(() => Message.CompletedSideEffect())

export const isStreaming = (model: Model): boolean => LiveTurnOps.isStreaming(model.live)

/** Lost, and out of tries: only Reconnect brings it back. */
export const isLost = (live: LiveTurn): boolean =>
  live.status === 'streaming' && live.connection === 'lost' && live.lostCount > MAX_RECONNECTS

const streamingTurn = (model: Model): Option.Option<LiveTurn> =>
  Option.filter(model.live, each => each.status === 'streaming')

/** A reply found running when a chat opens, as a live turn to follow. */
const joinedLive = (conversation: Conversation, turnId: string): Option.Option<LiveTurn> => {
  const index = conversation.messages.findIndex(each => each.turnId === turnId && each.role === 'assistant')
  const reply = conversation.messages[index]
  const question = conversation.messages.slice(0, Math.max(0, index)).reverse().find(each => each.role === 'user')
  if (reply === undefined || question === undefined) return Option.none()
  return Option.some({
    turnId,
    conversationId: conversation.id,
    messageId: reply.id,
    userMessageId: question.id,
    lastSeq: 0,
    parts: [],
    status: 'streaming',
    connection: 'open',
    lostCount: 0,
    isStopping: false,
    failure: null,
    isRetryable: false,
    usage: null,
  })
}

const onTurnUpdate = (model: Model, update: TurnUpdate, inputs: Inputs): Return => {
  const next = modifyFields(model, { live: () => LiveTurnOps.apply(model.live, update) })
  if (Option.isNone(next.live)) return { model: next }
  const live = next.live.value
  if (update._tag === 'TextBatch' && !Option.contains(model.tickedTurnId, live.turnId)) {
    return {
      model: modifyFields(next, { tickedTurnId: () => Option.some(live.turnId) }),
      commands: [haptic.tick()],
    }
  }
  if (update._tag === 'TurnFailed') return { model: next, commands: [haptic.error()] }
  if (update._tag === 'ConnectionLost' && live.status === 'streaming') {
    if (live.lostCount > MAX_RECONNECTS) return { model: next }
    return {
      model: modifyFields(next, { live: () => Option.some(LiveTurnOps.resuming(live)) }),
      commands: [inputs.commands.Resume({ turnId: live.turnId, delayMs: reconnectDelayMs(live.lostCount) })],
    }
  }
  return { model: next }
}

export const update = (model: Model, message: Message, inputs: Inputs): Return =>
  Message.match<Return>(message, {
    ReceivedTurnUpdate: ({ update: turnUpdate }) => onTurnUpdate(model, turnUpdate, inputs),
    Resumed: ({ turnId }) =>
      Option.contains(model.joiningTurnId, turnId)
        ? {
            model: modifyFields(model, {
              joiningTurnId: () => Option.none(),
              live: live =>
                Option.isSome(live)
                  ? live
                  : Option.flatMap(inputs.conversation, conversation => joinedLive(conversation, turnId)),
            }),
          }
        : { model },
    StoppedTurn: () => ({ model }),
    FailedStop: ({ reason }) => ({ model, outMessage: OutMessage.FailedWrite({ action: 'stop the reply', reason }) }),
    PressedReconnect: () =>
      Option.match(streamingTurn(model), {
        onNone: () => ({ model }),
        onSome: live => ({
          model: modifyFields(model, { live: () => Option.some({ ...LiveTurnOps.resuming(live), lostCount: 0 }) }),
          commands: [inputs.commands.Resume({ turnId: live.turnId, delayMs: 0 })],
        }),
      }),
    CompletedSideEffect: () => ({ model }),
  })

// WHAT THE CHAT SCREEN ASKS OF IT

/** A new chat, or another one: nothing live. The haptic's memory stays. */
export const reset = (model: Model): Model =>
  modifyFields(model, { live: () => Option.none(), joiningTurnId: () => Option.none() })

/** The server started the turn a Send asked for. */
export const started = (model: Model, turn: typeof AiWire.TurnStarted.Type): Model =>
  modifyFields(model, { live: () => Option.some(LiveTurnOps.start(turn)), joiningTurnId: () => Option.none() })

/** The server started writing the last reply again. */
export const regenerated = (model: Model, turn: typeof AiWire.TurnStarted.Type): Model =>
  modifyFields(model, { live: () => Option.some(LiveTurnOps.start(turn)) })

/**
 * Stop. The button shows Stop until the server confirms.
 * `LiveTurnOps.stopping` sets the turn's `isStopping`.
 */
// effect-ui: h.isRunning (the Stop Command, in place of `isStopping`)
export const stop = (model: Model, inputs: Inputs): Update.Return<Model, Message, Resources> =>
  Option.match(streamingTurn(model), {
    onNone: () => ({ model }),
    onSome: live => ({
      model: modifyFields(model, { live: () => Option.some(LiveTurnOps.stopping(live)) }),
      commands: [inputs.commands.Stop({ turnId: live.turnId }), haptic.medium()],
    }),
  })

/**
 * Follows a reply again from its last piece: after the app or the network was away.
 * `LiveTurnOps.resuming` sets the turn's connection to `resuming`.
 */
// effect-ui: h.isRunning (the Resume Command, in place of `connection: 'resuming'`)
export const resume = (model: Model, inputs: Inputs): Update.Return<Model, Message, Resources> =>
  Option.match(streamingTurn(model), {
    onNone: () => ({ model }),
    onSome: live => ({
      model: modifyFields(model, { live: () => Option.some(LiveTurnOps.resuming(live)) }),
      commands: [inputs.commands.Resume({ turnId: live.turnId, delayMs: 0 })],
    }),
  })

/** The server's copy of the chat arrived: a finished turn is no longer live. */
export const settle = (model: Model, conversation: Conversation): Model =>
  modifyFields(model, { live: live => LiveTurnOps.settle(live, conversation) })

/** A reply still being written when the chat was opened: join it. */
export const join = (model: Model, turnId: string, inputs: Inputs): Update.Return<Model, Message, Resources> =>
  Option.isNone(model.live) && Option.isNone(model.joiningTurnId)
    ? {
        model: modifyFields(model, { joiningTurnId: () => Option.some(turnId) }),
        commands: [inputs.commands.Resume({ turnId, delayMs: 0 })],
      }
    : { model }

/** A write failed: a Stop that was on its way is off. */
export const writeFailed = (model: Model): Model =>
  modifyFields(model, { live: live => Option.map(live, each => ({ ...each, isStopping: false })) })

// VIEW

export type ViewInputs = Readonly<{ rowKey: string; scheme: 'light' | 'dark' }>

/** Under the reply: the connection dropped, and a way to try again. */
export const view = Submodel.defineView<Model, Message, ViewInputs>((_model, inputs, h): Html => {
  const palette = paletteOf(inputs.scheme)
  return box(
    [style({ gap: SPACE.s })],
    [
      text([prop('testID', `${inputs.rowKey}-lost`), style({ ...TYPE.caption, color: palette.ink3 })], ['The connection dropped.']),
      textButton(h, 'reconnect', 'Reconnect', palette.ink, Message.PressedReconnect()),
    ],
  )
})
