/**
 * One-off events that another part of the app must hear.
 *
 * Server data goes through Query: a screen names what it reads and the cache
 * keeps it fresh. An event is different. It happens once, it is not data
 * anyone reads later, and whoever caused it may be gone when it matters. A
 * chat that is deleted from its own screen closes that screen at once; if
 * the server then refuses, the list of chats is where the person is, and it
 * has to say so.
 *
 * So there is one small service, provided by a Layer: `publish` an event,
 * and hear every event from now on. `Announce` is the Command that
 * publishes a short line for the person (a toast). `toasts` is the
 * Subscription a screen uses to hear them. Nothing here is kept: a screen
 * that was not on screen when a line was said never sees it.
 */
import { Command, Subscription } from '@effect/ui'
import { Context, Effect, Layer, Queue, Schema, Stream } from 'effect'

export const Toast = Schema.Struct({
  text: Schema.String,
  tone: Schema.Literals(['info', 'error']),
})
export type Toast = typeof Toast.Type

export type ChatEvent = Readonly<{ _tag: 'Toast'; toast: Toast }>

export class ChatEvents extends Context.Service<
  ChatEvents,
  {
    readonly publish: (event: ChatEvent) => Effect.Effect<void>
    /** Every event from now on. */
    readonly events: Stream.Stream<ChatEvent>
  }
>()('chat/ChatEvents') {}

const eventsLayer: Layer.Layer<ChatEvents> = Layer.sync(ChatEvents, () => {
  const listeners = new Set<(event: ChatEvent) => void>()
  return {
    publish: event =>
      Effect.sync(() => {
        for (const listener of [...listeners]) listener(event)
      }),
    events: Stream.callback<ChatEvent>(queue =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = (event: ChatEvent): void => void Queue.offerUnsafe(queue, event)
          listeners.add(listener)
          return listener
        }),
        listener => Effect.sync(() => void listeners.delete(listener)),
      ),
    ),
  }
})

/** Says a short line to whichever screens are listening. */
export class Announce extends Command.Service<Announce>()('chat/Announce', {
  args: { text: Schema.String, tone: Schema.Literals(['info', 'error']) },
  success: Schema.Void,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const events = yield* ChatEvents
      return toast => events.publish({ _tag: 'Toast', toast })
    }),
  )
}

/** Every line said from now on, for a screen that shows them. */
export const toasts = <Msg>(toMessage: (toast: Toast) => Msg): Subscription.Subscription<Msg, ChatEvents> =>
  Subscription.make(
    'chat/toasts',
    Stream.unwrap(ChatEvents.use(events => Effect.succeed(Stream.map(events.events, event => toMessage(event.toast))))),
  )

export type Services = ChatEvents | Announce

/** The events service and its Command. */
export const layer: Layer.Layer<Services> = Announce.layer.pipe(Layer.provideMerge(eventsLayer))

/**
 * Waits, then answers with the same `token`. A screen uses it to take a
 * notice away again after a moment: the token says which notice the wait
 * was for, so a newer one is left alone.
 */
export const After = Command.make('chat/After', { args: { ms: Schema.Number, token: Schema.String } }, ({ ms, token }) =>
  Effect.as(Effect.sleep(`${ms} millis`), { token }),
)

/** How long a line such as "Copied" stays above the composer. */
export const NOTICE_MS = 2200
