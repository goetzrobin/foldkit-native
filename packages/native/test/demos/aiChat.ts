/**
 * The AI chat demo: a question goes to the top of the screen and the answer
 * streams in below it, word by word.
 *
 * What it shows:
 * - The list opens at the newest message.
 * - Sending a question scrolls it to the top of the screen. The list keeps
 *   blank space below it (`anchoredEndSpace`), so the answer has room.
 * - "Thinking..." shows for a moment, then the answer grows in place. The
 *   question does not move while it does.
 * - Once the answer is longer than the screen, it runs off the bottom and a
 *   round button appears that scrolls to the end.
 *
 * The button "Keyboard: inset" / "following" / "simple" goes round the three
 * ways of keeping the composer above the keyboard (see `chatShared.ts`). With
 * "inset", the button "Lift: ..." chooses what the messages do as the
 * keyboard opens, and a question at the top of the screen must not move when
 * the keyboard opens or closes. "Show numbers" lays the list's own numbers
 * over it, for a screenshot.
 *
 * The "Thinking..." wait is a Command. The stream is a Subscription that
 * ticks while an answer is being written, and each tick adds a word.
 *
 * Modelled on Legend List's AI chat example. The sample text is our own.
 */
import { Duration, Effect, type Layer, Option, Schema, Stream } from 'effect'
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
  Lift,
  PAPER,
  bubble,
  bubbleNote,
  bubbleText,
  dismissOnDrag,
  dockModeButton,
  dockModeNote,
  isInset,
  liftButton,
  liftNote,
  messagesAndComposer,
  nextDockMode,
  nextLift,
  numbersButton,
  numbersOverlay,
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

export type AiChatOptions = Readonly<{
  /** How long "Thinking..." shows, in milliseconds. */
  thinkingMs?: number
  /** The time between two words of the answer, in milliseconds. */
  wordMs?: number
}>

export const LIST_ID = 'ai-chat-messages'

/** A question taller than two lines of text shows only its last two lines
 *  at the top, so the answer always has room. 22 is the line height, 28 the
 *  bubble's own padding. */
const ANCHOR_MAX_SIZE = 2 * 22 + 28
const ANCHOR_OFFSET = 16

const AiMessage = Schema.Struct({
  id: Schema.Number,
  sender: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
})
type AiMessage = typeof AiMessage.Type

/** An answer on its way. */
const Reply = Schema.Struct({
  messageId: Schema.Number,
  /** The whole answer, cut into words and the spaces between them. */
  pieces: Schema.Array(Schema.String),
  /** How many pieces are on screen so far. */
  shown: Schema.Number,
  isThinking: Schema.Boolean,
})

export const Model = Schema.Struct({
  messages: Schema.Array(AiMessage),
  draft: Schema.String,
  nextId: Schema.Number,
  /** The question that should sit at the top of the screen, once one is sent. */
  maybeAnchorIndex: Schema.Option(Schema.Number),
  maybeReply: Schema.Option(Reply),
  /** Whether the end of the list is on screen. The list says when this flips. */
  isAtEnd: Schema.Boolean,
  /** 0 while the keyboard is hidden. */
  keyboardHeight: Schema.Number,
  /** How much of the app's window the keyboard covers. 0 on an Android
   *  window that made itself shorter. The composer is raised by this. */
  keyboardCovers: Schema.Number,
  /** Which of the three docks holds the composer. A button goes round them. */
  dockMode: DockMode,
  /** With "inset": what the messages do as the keyboard opens. */
  lift: Lift,
  /** Whether the list's own numbers are laid over it. */
  showsNumbers: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  PressedSample: {},
  FinishedThinking: { messageId: Schema.Number },
  TickedStream: {},
  ChangedAtEnd: { isAtEnd: Schema.Boolean },
  DraggedListWithKeyboardUp: {},
  PressedScrollToEnd: {},
  CompletedScrollToEnd: {},
  PressedDockMode: {},
  PressedLift: {},
  PressedNumbers: {},
  GotKeyboardMessage: { message: Keyboard.Message },
})
export type Message = typeof Message.Type

const HISTORY: ReadonlyArray<readonly [string, string]> = [
  [
    'Why does my chat list jump when a new message comes in?',
    'Usually because the list measures the new row after it has drawn it. For one frame the ' +
      'row has a guessed height, then the real one, and everything below shifts by the difference.',
  ],
  [
    'How do I stop that?',
    'Decide what should stay still. At the end of a chat it is the bottom edge. Higher up ' +
      'it is the row the person is reading. Then correct the scroll position by the same ' +
      'amount the heights changed, in the same frame.',
  ],
  [
    'Does that work with thousands of messages?',
    'Yes, if only the rows near the screen exist as views. The rest are kept as heights, ' +
      'so the list still knows how long it is and where each row starts.',
  ],
  [
    'What is different about an AI chat?',
    'The answer grows while you read it. So the question is moved to the top first, with ' +
      'empty room below, and the answer fills that room instead of pushing the question away.',
  ],
]

const SAMPLE_QUESTION = 'What should I look for when I test this screen?'

const PARAGRAPHS = [
  'Start with the question you just sent. It should be near the top of the screen, with a ' +
    'small gap above it, and it should have got there in one smooth move.',
  'Now watch this answer. Each word is added to the same row, so the row keeps getting ' +
    'taller. The question above must not move at all while that happens. If it creeps up or ' +
    'down by even a little, the blank space under the answer is the wrong size.',
  'After a few paragraphs the answer is taller than the room that was left for it. From ' +
    'then on it runs off the bottom of the screen, as it does in other AI apps, and you ' +
    'keep reading at your own pace. A round button should appear at the bottom right.',
  'Press that button and the list should glide to the end of the answer. Scroll back up ' +
    'by hand and the button should come back. It should never flicker on and off while ' +
    'you are scrolling.',
  'Then try the keyboard. Tap the field: the composer should sit on top of the keyboard. ' +
    'Send a second question while this answer is still being written. This answer should ' +
    'finish at once and the new question should go to the top.',
  'Last, scroll far up into the older messages and send a question from there. The list ' +
    'should travel all the way down and stop with the new question at the top.',
]

/** Words and the spaces between them, so the answer is put back together exactly. */
const piecesOf = (words: string): Array<string> => words.split(/(\s+)/)

const answerTo = (question: string, variant: number): string => {
  const from = variant % 2
  const body = [...PARAGRAPHS.slice(from), ...PARAGRAPHS.slice(0, from)]
  return [`You asked: "${question}"`, ...body, 'That is the whole answer.'].join('\n\n')
}

const history = (): Array<AiMessage> =>
  HISTORY.flatMap(([question, answer], at) => [
    { id: at * 2, sender: 'user' as const, text: question },
    { id: at * 2 + 1, sender: 'assistant' as const, text: answer },
  ])

const fromKeyboard = (message: Keyboard.Message) => Message.GotKeyboardMessage({ message })

/** Puts the whole of an answer on screen, for one cut short by a new question. */
const finished = (model: Model): ReadonlyArray<AiMessage> =>
  Option.match(model.maybeReply, {
    onNone: () => model.messages,
    onSome: reply =>
      model.messages.map(each =>
        each.id === reply.messageId ? { ...each, text: reply.pieces.join('') } : each,
      ),
  })

const makeUpdate = (env: DemoEnv, options: AiChatOptions) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => env.exit()).pipe(Effect.as(Message.CompletedExit())),
  })
  // Stands in for the wait before a model starts to answer.
  const Think = Command.define('Think', {
    args: { messageId: Schema.Number },
    messages: [Message.FinishedThinking],
    execute: ({ messageId }) =>
      Effect.sleep(options.thinkingMs ?? 1000).pipe(
        Effect.as(Message.FinishedThinking({ messageId })),
      ),
  })
  const ScrollToEnd = Command.define('ScrollToEnd', {
    messages: [Message.CompletedScrollToEnd],
    execute: scrollListToEnd(LIST_ID, { animated: true }).pipe(
      Effect.as(Message.CompletedScrollToEnd()),
    ),
  })

  const send = (model: Model, question: string): Update.Return<Model, Message, Keyboard.Keyboard> => {
    if (question === '') return { model }
    const settled = finished(model)
    const answerId = model.nextId + 1
    return {
      model: modifyFields(model, {
        messages: () => [
          ...settled,
          { id: model.nextId, sender: 'user', text: question },
          // Empty until the first word arrives. Drawn as "Thinking...".
          { id: answerId, sender: 'assistant', text: '' },
        ],
        nextId: nextId => nextId + 2,
        draft: () => '',
        // The list scrolls to this row by itself when it changes.
        maybeAnchorIndex: () => Option.some(settled.length),
        maybeReply: () =>
          Option.some({
            messageId: answerId,
            pieces: piecesOf(answerTo(question, model.nextId / 2)),
            shown: 0,
            isThinking: true,
          }),
      }),
      commands: [
        Think({ messageId: answerId }),
        // The answer needs the whole screen.
        Command.mapMessage(Keyboard.Dismiss(), fromKeyboard),
      ],
    }
  }

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message, Keyboard.Keyboard>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text }) }),
      PressedSend: () => send(model, model.draft.trim()),
      PressedSample: () => send(model, SAMPLE_QUESTION),
      FinishedThinking: ({ messageId }) => ({
        model: modifyFields(model, {
          maybeReply: maybeReply =>
            Option.map(maybeReply, reply =>
              // A wait that belongs to an answer already cut short is ignored.
              reply.messageId === messageId ? { ...reply, isThinking: false } : reply,
            ),
        }),
      }),
      TickedStream: () =>
        Option.match(model.maybeReply, {
          onNone: () => ({ model }),
          onSome: reply => {
            // A word and the space after it.
            const shown = Math.min(reply.pieces.length, reply.shown + 2)
            const words = reply.pieces.slice(0, shown).join('')
            return {
              model: modifyFields(model, {
                messages: messages =>
                  messages.map(each =>
                    each.id === reply.messageId ? { ...each, text: words } : each,
                  ),
                maybeReply: () =>
                  shown >= reply.pieces.length ? Option.none() : Option.some({ ...reply, shown }),
              }),
            }
          },
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
      PressedLift: () => ({ model: modifyFields(model, { lift: nextLift }) }),
      PressedNumbers: () => ({
        model: modifyFields(model, { showsNumbers: shows => !shows }),
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
    messages: history(),
    draft: '',
    nextId: HISTORY.length * 2,
    maybeAnchorIndex: Option.none(),
    maybeReply: Option.none(),
    // The list opens at its end, and only reports when that changes.
    isAtEnd: true,
    keyboardHeight: 0,
    keyboardCovers: 0,
    dockMode: 'inset',
    lift: 'whenAtEnd',
    showsNumbers: false,
  },
})

const isStreaming = (model: Model): boolean =>
  Option.match(model.maybeReply, { onNone: () => false, onSome: reply => !reply.isThinking })

const makeSubscriptions = (options: AiChatOptions) =>
  Subscription.make<Model, Message, Keyboard.Keyboard>()(entry => ({
    keyboard: Keyboard.changesEntry(fromKeyboard),
    // Ticks only while an answer is being written.
    stream: entry(
      { isStreaming: Schema.Boolean },
      {
        modelToDependencies: model => ({ isStreaming: isStreaming(model) }),
        dependenciesToStream: dependencies =>
          Stream.when(
            Stream.tick(Duration.millis(options.wordMs ?? 45)).pipe(
              // The first tick comes at once. A word should wait its turn.
              Stream.drop(1),
              Stream.map(() => Message.TickedStream()),
            ),
            Effect.sync(() => dependencies.isStreaming),
          ),
      },
    ),
  }))

const row =
  (model: Model) =>
  (message: AiMessage): Html => {
    const side = message.sender === 'user' ? 'mine' : 'theirs'
    const isBeingWritten = Option.match(model.maybeReply, {
      onNone: () => false,
      onSome: reply => reply.messageId === message.id,
    })
    return bubble(`message-${message.id}`, side, [
      bubbleText(side, message.text === '' ? 'Thinking...' : message.text),
      ...(isBeingWritten ? [bubbleNote(side, 'Writing...')] : []),
    ])
  }

const statusOf = (model: Model): string => {
  const writing = Option.match(model.maybeReply, {
    onNone: () => 'No answer on its way',
    onSome: reply => (reply.isThinking ? 'Thinking' : 'Writing the answer'),
  })
  return `${writing}. At the end: ${model.isAtEnd ? 'yes' : 'no'}.`
}

const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'ai-chat-stack')],
      [
        screen(
          [h.Key('ai-chat'), h.Attribute('testID', 'screen-ai-chat')],
          [
            header([title('AI chat')], []),
            chatSafeArea(device, { hasHeader: true }, [
              box(
                [style({ flex: 1, backgroundColor: PAPER })],
                [
                  topStrip(
                    [
                      smallButton(h, 'exit', 'Exit', Message.PressedExit()),
                      smallButton(h, 'sample', 'Ask a sample question', Message.PressedSample()),
                      dockModeButton(h, model.dockMode, Message.PressedDockMode()),
                      ...(isInset(model.dockMode)
                        ? [liftButton(h, model.lift, Message.PressedLift())]
                        : []),
                      numbersButton(h, model.showsNumbers, Message.PressedNumbers()),
                    ],
                    statusOf(model),
                    'Ask something. Your question should go to the top and stay still while ' +
                      'the answer is written under it. When the answer runs off the screen, ' +
                      'a round button appears.',
                    isInset(model.dockMode)
                      ? `${dockModeNote(model.dockMode)} ${liftNote(model.lift)}`
                      : dockModeNote(model.dockMode),
                  ),
                  ...messagesAndComposer(h, {
                    draft: model.draft,
                    placeholder: 'Ask about lists',
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
                          row: row(model),
                          estimatedRowHeight: 120,
                          initialScrollAtEnd: true,
                          // The keyboard must not cover the last message. An
                          // answer that grows is left to run off the screen.
                          maintainScrollAtEnd: { onlyWhenResized: true },
                          // "inset": the list is not made shorter at all. Its
                          // scroll view makes the room. Ignored where the
                          // phone cannot do that.
                          ...(model.dockMode === 'inset'
                            ? { keyboardInset: { lift: model.lift } }
                            : {}),
                          ...Option.match(model.maybeAnchorIndex, {
                            onNone: () => ({}),
                            onSome: anchorIndex => ({
                              anchoredEndSpace: {
                                anchorIndex,
                                anchorMaxSize: ANCHOR_MAX_SIZE,
                                anchorOffset: ANCHOR_OFFSET,
                              },
                            }),
                          }),
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
                        ...(model.showsNumbers ? [numbersOverlay(LIST_ID)] : []),
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
  options: AiChatOptions = {},
) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env, options),
    view: makeView(env.device),
    subscriptions: makeSubscriptions(options),
    resources,
    container,
  })
