/**
 * The chat demo: two people, a composer, and a list that lives at its end.
 *
 * What it shows:
 * - The list opens at the newest message.
 * - Sending adds a message, and a canned reply arrives a moment later. While
 *   the user is at the end the list stays there.
 * - A user who has scrolled up to read is not moved when a message arrives.
 *   A round button appears instead, and takes them back to the end. "Message
 *   me in 3 s" is there to try this: press it, scroll up, and wait.
 * - Sending always goes to the end, wherever the user was.
 * - "Short chat" leaves two messages, which sit at the bottom of the list.
 * - The keyboard pushes the composer and the last message up. The button
 *   "Keyboard: following" / "Keyboard: simple" switches between the two ways
 *   of doing that (see `chatShared.ts`).
 *
 * Modelled on Legend List's chat example. The sample messages are our own.
 */
import { Effect, type Layer, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { chatSafeArea } from '../../src/chat/index.js'
import { Keyboard } from '../../src/device/index.js'
import { type Device, header, screen, stack, style, title, view as box } from '../../src/index.js'
import { list, scrollListToEnd } from '../../src/list/index.js'
import {
  DockMode,
  PAPER,
  bubble,
  bubbleNote,
  bubbleText,
  dismissOnDrag,
  dockModeButton,
  dockModeNote,
  messagesAndComposer,
  nextDockMode,
  roundButtonBottom,
  scrollToEndButton,
  smallButton,
  topStrip,
} from './chatShared.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

export type ChatOptions = Readonly<{
  /** How long the other person takes to answer, in milliseconds. */
  replyDelayMs?: number
  /** How long "Message me in 3 s" waits, in milliseconds. */
  incomingDelayMs?: number
}>

export const LIST_ID = 'chat-messages'
const OTHER = 'Alex'

const ChatMessage = Schema.Struct({
  id: Schema.Number,
  sender: Schema.Literals(['me', 'them']),
  text: Schema.String,
})
type ChatMessage = typeof ChatMessage.Type

export const Model = Schema.Struct({
  messages: Schema.Array(ChatMessage),
  draft: Schema.String,
  nextId: Schema.Number,
  /** Whether the newest message is on screen. The list says when this flips. */
  isAtEnd: Schema.Boolean,
  /** 0 while the keyboard is hidden. */
  keyboardHeight: Schema.Number,
  /** How much of the app's window the keyboard covers. 0 on an Android
   *  window that made itself shorter. The composer is raised by this. */
  keyboardCovers: Schema.Number,
  /** Which of the three docks holds the composer. A button goes round them. */
  dockMode: DockMode,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  ReceivedReply: { to: Schema.String },
  PressedMessageMe: {},
  ReceivedMessage: {},
  PressedShortChat: {},
  PressedLongChat: {},
  ChangedAtEnd: { isAtEnd: Schema.Boolean },
  DraggedListWithKeyboardUp: {},
  PressedScrollToEnd: {},
  CompletedScrollToEnd: {},
  PressedDockMode: {},
  GotKeyboardMessage: { message: Keyboard.Message },
})
export type Message = typeof Message.Type

const OPENING: ReadonlyArray<readonly ['me' | 'them', string]> = [
  ['them', 'Morning. Did the list work get merged?'],
  ['me', 'Last night. The chat screen opens at the newest message now.'],
  ['them', 'Without scrolling down in front of you?'],
  ['me', 'That is the idea. It is put in place before it is shown.'],
  ['them', 'What happens when I am reading old messages and you write to me?'],
  ['me', 'Nothing moves. You get a small button to go back to the end.'],
  ['them', 'Good. I lose my place in every other app.'],
  ['me', 'And if you are at the end already, the new message just appears.'],
  ['them', 'What about long messages? Those always break things.'],
  [
    'me',
    'A long message is one tall row. The list asks the phone how tall each row really is ' +
      'and corrects its sums, so a tall row above you does not push the text you are reading.',
  ],
  ['them', 'How many rows does the phone draw?'],
  ['me', 'Only the ones near the screen. The rest are numbers until you scroll to them.'],
  ['them', 'So a thread with ten thousand messages is fine.'],
  ['me', 'It should be. That is on the list of things to try on a real phone.'],
  ['them', 'And the keyboard?'],
  ['me', 'The composer sits on top of it and the last message stays in view.'],
  ['them', 'Does it slide up with the keyboard?'],
  ['me', 'It should, with "Keyboard: following" at the top. Press that to compare with "simple".'],
  ['them', 'Fair. Send me something so I can see a reply come in.'],
  ['me', 'Type below and press Send.'],
]

const REPLIES = [
  'Got it.',
  'That came through. The list should still be at the end.',
  'Noted. Scroll up before you send the next one and see whether my answer moves what you are reading.',
  'Same here.',
  'A longer answer this time, so the new row is taller than the others and the list has ' +
    'further to go to stay at the end. If the bottom of this message is cut off, tell us.',
]

const openingMessages = (): Array<ChatMessage> =>
  OPENING.map(([sender, words], id) => ({ id, sender, text: words }))

const fromKeyboard = (message: Keyboard.Message) => Message.GotKeyboardMessage({ message })

const makeUpdate = (env: DemoEnv, options: ChatOptions) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => env.exit()).pipe(Effect.as(Message.CompletedExit())),
  })
  // Stands in for the other person typing an answer.
  const WaitForReply = Command.define('WaitForReply', {
    args: { to: Schema.String },
    messages: [Message.ReceivedReply],
    execute: ({ to }) =>
      Effect.sleep(options.replyDelayMs ?? 900).pipe(Effect.as(Message.ReceivedReply({ to }))),
  })
  const WaitForMessage = Command.define('WaitForMessage', {
    messages: [Message.ReceivedMessage],
    execute: Effect.sleep(options.incomingDelayMs ?? 3000).pipe(
      Effect.as(Message.ReceivedMessage()),
    ),
  })
  const ScrollToEnd = Command.define('ScrollToEnd', {
    messages: [Message.CompletedScrollToEnd],
    execute: scrollListToEnd(LIST_ID, { animated: true }).pipe(
      Effect.as(Message.CompletedScrollToEnd()),
    ),
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message, Keyboard.Keyboard>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text }) }),
      PressedSend: () => {
        const words = model.draft.trim()
        if (words === '') return { model }
        return {
          model: modifyFields(model, {
            messages: messages => [...messages, { id: model.nextId, sender: 'me', text: words }],
            nextId: nextId => nextId + 1,
            draft: () => '',
          }),
          // Their own message is what the user wants to see, wherever they
          // had scrolled to.
          commands: [ScrollToEnd(), WaitForReply({ to: words })],
        }
      },
      ReceivedReply: ({ to }) => ({
        model: modifyFields(model, {
          messages: messages => [
            ...messages,
            {
              id: model.nextId,
              sender: 'them',
              text: `"${to}"\n${REPLIES[model.nextId % REPLIES.length] ?? ''}`,
            },
          ],
          nextId: nextId => nextId + 1,
        }),
      }),
      PressedMessageMe: () => ({ model, commands: [WaitForMessage()] }),
      ReceivedMessage: () => ({
        model: modifyFields(model, {
          messages: messages => [
            ...messages,
            {
              id: model.nextId,
              sender: 'them',
              text: 'This one arrived by itself. If you had scrolled up, you should still be where you were.',
            },
          ],
          nextId: nextId => nextId + 1,
        }),
      }),
      PressedShortChat: () => ({
        model: modifyFields(model, { messages: messages => messages.slice(-2) }),
      }),
      PressedLongChat: () => ({
        model: modifyFields(model, {
          messages: () =>
            openingMessages().map((each, at) => ({ ...each, id: model.nextId + at })),
          nextId: nextId => nextId + OPENING.length,
        }),
      }),
      ChangedAtEnd: ({ isAtEnd }) => ({ model: modifyFields(model, { isAtEnd: () => isAtEnd }) }),
      // Scrolling through the messages puts the keyboard away, as in other chat apps.
      DraggedListWithKeyboardUp: () => ({
        model,
        commands: [Command.mapMessage(Keyboard.Dismiss(), fromKeyboard)],
      }),
      PressedScrollToEnd: () => ({ model, commands: [ScrollToEnd()] }),
      CompletedScrollToEnd: () => ({ model }),
      PressedDockMode: () => ({
        model: modifyFields(model, {
          dockMode: nextDockMode,
          // The docks are built from different views, so the list is
          // made again, and a new list opens at its end.
          isAtEnd: () => true,
        }),
        // The field is made again as well. The keyboard goes with the old one.
        commands: [Command.mapMessage(Keyboard.Dismiss(), fromKeyboard)],
      }),
      GotKeyboardMessage: ({ message: keyboardMessage }) => ({
        model: modifyFields(model, {
          keyboardCovers: covers =>
            Keyboard.Message.match(keyboardMessage, {
              ShownKeyboard: shown => shown.covers,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => covers,
            }),
          keyboardHeight: height =>
            Keyboard.Message.match(keyboardMessage, {
              ShownKeyboard: shown => shown.height,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => height,
            }),
        }),
      }),
    })
}

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    messages: openingMessages(),
    draft: '',
    nextId: OPENING.length,
    // The list opens at its end, and only reports when that changes.
    isAtEnd: true,
    keyboardHeight: 0,
    keyboardCovers: 0,
    dockMode: 'inset',
  },
})

export const subscriptions = Subscription.make<Model, Message, Keyboard.Keyboard>()(() => ({
  keyboard: Keyboard.changesEntry(fromKeyboard),
}))

const row = (message: ChatMessage): Html => {
  const side = message.sender === 'me' ? 'mine' : 'theirs'
  return bubble(`message-${message.id}`, side, [
    bubbleNote(side, message.sender === 'me' ? 'You' : OTHER),
    bubbleText(side, message.text),
  ])
}

const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'chat-stack')],
      [
        screen(
          [h.Key('chat'), h.Attribute('testID', 'screen-chat')],
          [
            header([title('Chat')], []),
            chatSafeArea(device, { hasHeader: true }, [
              box(
                [style({ flex: 1, backgroundColor: PAPER })],
                [
                  topStrip(
                    [
                      smallButton(h, 'exit', 'Exit', Message.PressedExit()),
                      smallButton(h, 'short-chat', 'Short chat', Message.PressedShortChat()),
                      smallButton(h, 'long-chat', 'Long chat', Message.PressedLongChat()),
                      smallButton(h, 'message-me', 'Message me in 3 s', Message.PressedMessageMe()),
                      dockModeButton(h, model.dockMode, Message.PressedDockMode()),
                    ],
                    `${model.messages.length} messages. At the end: ${model.isAtEnd ? 'yes' : 'no'}.`,
                    'Send a message: a reply comes in a second and the list stays at the end. ' +
                      'Press "Message me in 3 s" and scroll up: what you are reading should ' +
                      'not move, and a round button takes you back. "Short chat" leaves two ' +
                      'messages at the bottom.',
                    dockModeNote(model.dockMode),
                  ),
                  ...messagesAndComposer(h, {
                    draft: model.draft,
                    placeholder: 'Message',
                    keyboardHeight: model.keyboardCovers,
                    dockMode: model.dockMode,
                    listId: LIST_ID,
                    onChange: words => Message.ChangedDraft({ text: words }),
                    onSend: Message.PressedSend(),
                    messages: box(
                      // A key per dock, so the list is made again with it.
                      [h.Key(`messages-${model.dockMode}`), style({ flex: 1 })],
                      [
                        list(h, {
                          id: LIST_ID,
                          items: model.messages,
                          key: each => each.id,
                          row,
                          estimatedRowHeight: 72,
                          alignItemsAtEnd: true,
                          initialScrollAtEnd: true,
                          maintainScrollAtEnd: true,
                          // "inset": the messages always rise with the
                          // keyboard, as in a messaging app.
                          ...(model.dockMode === 'inset'
                            ? { keyboardInset: { lift: 'always' as const } }
                            : {}),
                          onAtEndChanged: isAtEnd => Message.ChangedAtEnd({ isAtEnd }),
                          attributes: [
                            h.Attribute('testID', 'messages'),
                            style({ flex: 1 }),
                            ...dismissOnDrag(
                              model.dockMode,
                              model.keyboardHeight > 0,
                              Message.DraggedListWithKeyboardUp(),
                            ),
                          ],
                        }),
                        ...(model.isAtEnd
                          ? []
                          : [
                              scrollToEndButton(
                                h,
                                Message.PressedScrollToEnd(),
                                roundButtonBottom(model.dockMode, model.keyboardHeight),
                              ),
                            ]),
                      ],
                    ),
                  }),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

/**
 * `resources` supplies the keyboard: `Phone.live({...})` in an app,
 * `Phone.makeTest().layer` or `Keyboard.makeTest().layer` in a test.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Keyboard.Keyboard>,
  options: ChatOptions = {},
) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env, options),
    view: makeView(env.device),
    subscriptions,
    resources,
    container,
  })
