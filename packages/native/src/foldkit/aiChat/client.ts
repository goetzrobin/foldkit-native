/**
 * The AI chat client for a Foldkit program: the host client
 * (`src/host/aiChat/client.ts`), plus `liveTurnEntry`, the Subscription
 * entry that follows the reply being written.
 */
import { Option, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'

import {
  type AiChatOptions,
  type TurnUpdate,
  makeAiChat as makeHostAiChat,
} from '../../host/aiChat/client.js'
import type { ServerState } from '../../host/serverState/store.js'

export type LiveTurnEntryConfig<Model, Message> = Readonly<{
  /** The turn to follow, or none. Following starts when this turns to some. */
  modelToTurnId: (model: Model) => Option.Option<string>
  /** `receivedAt` is the clock's time in milliseconds when the update left the client. */
  toMessage: (update: TurnUpdate, receivedAt: number) => Message
  /** The window in which text pieces are joined into one Message. Default 32 ms. */
  batchMs?: number
}>

/**
 * Makes the client for one program. Put `layer` in the program's
 * `resources`. The handle points at that program's registry: two programs
 * running at once need two clients.
 */
export const makeAiChat = (options: AiChatOptions) => {
  const chat = makeHostAiChat(options)
  return {
    ...chat,
    /**
     * A Subscription entry that follows the live turn while the Model names
     * one. See `followTurn` for how the pieces are joined.
     */
    liveTurnEntry: <Model, Message>(config: LiveTurnEntryConfig<Model, Message>) =>
      Subscription.make<Model, Message, ServerState>()(entry => ({
        turn: entry(
          { maybeTurnId: Schema.Option(Schema.String) },
          {
            modelToDependencies: model => ({ maybeTurnId: config.modelToTurnId(model) }),
            dependenciesToStream: ({ maybeTurnId }) =>
              Option.match(maybeTurnId, {
                onNone: () => Stream.empty,
                onSome: turnId => chat.followTurn(turnId, config.toMessage, config.batchMs),
              }),
          },
        ),
      })).turn,
  }
}

export type AiChat = ReturnType<typeof makeAiChat>
