/**
 * An AI chat on Legend List's own core.
 *
 * The list here is `legendList`: the arithmetic is Legend List's code
 * (vendored, version 3.7.3) and React is not involved. The screen copies
 * Legend's "AI chat" example:
 *
 *   - It opens at the newest message.
 *   - Sending puts your message near the top of the screen and leaves room
 *     under it. The reply then streams into that room word by word, and the
 *     screen does not move while it does.
 *   - Scrolling up and pressing "Load older" adds messages above without
 *     moving what you are reading.
 *
 * The composer is a plain text field and a Send button. It is lifted by the
 * keyboard's height when the keyboard is up.
 */
import { Effect, type Layer, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { Keyboard } from '../../src/device/index.js'
import {
  type Device,
  header,
  prop,
  safeArea,
  screen,
  stack,
  style,
  text,
  textInput,
  title,
  view as box,
} from '../../src/index.js'
import { legendList, scrollLegendListToEnd } from '../../src/legend/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

const LIST_ID = 'legend-chat'
/** How long between two words of a reply, in milliseconds. */
const WORD_MS = 45
/** How long the reply "thinks" before its first word. */
const THINK_MS = 700
/** As in Legend's example: two lines of text and the bubble's padding. */
const ANCHOR_MAX_SIZE = 2 * 20 + 32
const ANCHOR_OFFSET = 16
const OLDER_BATCH = 10

const ChatMessage = Schema.Struct({
  id: Schema.String,
  sender: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
  isStreaming: Schema.Boolean,
})
type ChatMessage = typeof ChatMessage.Type

export const Model = Schema.Struct({
  messages: Schema.Array(ChatMessage),
  draft: Schema.String,
  nextId: Schema.Number,
  /** How many batches of older messages were loaded. */
  olderLoaded: Schema.Number,
  /** The row to hold near the top: the message last sent. -1 before any was sent. */
  anchorIndex: Schema.Number,
  /** The words of the reply being streamed, and how many are shown. */
  replyWords: Schema.Array(Schema.String),
  replyShown: Schema.Number,
  replyId: Schema.String,
  keyboardHeight: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  PressedLatest: {},
  PressedLoadOlder: {},
  CompletedScroll: {},
  StreamedWord: { replyId: Schema.String },
  GotKeyboardMessage: { message: Keyboard.Message },
})
export type Message = typeof Message.Type

const TOPICS = [
  'How does a list know which rows to draw?',
  'It keeps a height for every row, a guess until the row has been measured, and adds them up. The rows whose span crosses the screen are drawn, plus a margin above and below.',
  'What happens when a guess was wrong?',
  'Everything below that row moves. If the row is above the screen, the list shifts its scroll position by the same amount in the same frame, so what you are reading stays where it is.',
  'And recycling?',
  'A row that scrolls off is not thrown away. Its native views are kept and handed the next row that scrolls on, which is cheaper than making new ones.',
  'Why does a chat need more than that?',
  'A chat opens at its end, grows at its end, and the newest message matters most. A long reply should not push your own question off the screen while it is being written.',
] as const

const seedMessage = (at: number, idPrefix: string): ChatMessage => ({
  id: `${idPrefix}-${at}`,
  sender: at % 2 === 0 ? 'user' : 'assistant',
  text: `${TOPICS[at % TOPICS.length]}${at % 5 === 4 ? ` ${TOPICS[(at + 2) % TOPICS.length]}` : ''}`,
  isStreaming: false,
})

const replyTo = (prompt: string, turn: number): string =>
  `You asked: "${prompt}". This reply is written one word at a time. ` +
  'While it grows, your message should stay where it is near the top of the screen. ' +
  `${TOPICS[(turn * 2 + 1) % TOPICS.length]} ` +
  'Once the reply is taller than the room below your message, it runs on under the composer and you can scroll down to follow it. ' +
  `${TOPICS[(turn * 2 + 3) % TOPICS.length]}`

const fromKeyboard = (message: Keyboard.Message) => Message.GotKeyboardMessage({ message })

const makeUpdate = (env: DemoEnv) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => env.exit()).pipe(Effect.as(Message.CompletedExit())),
  })
  const ScrollToEnd = Command.define('ScrollToEnd', {
    args: { animated: Schema.Boolean },
    messages: [Message.CompletedScroll],
    execute: ({ animated }) =>
      scrollLegendListToEnd(LIST_ID, { animated }).pipe(Effect.as(Message.CompletedScroll())),
  })
  // Stands in for the next piece of a reply arriving from a server.
  const StreamWord = Command.define('StreamWord', {
    args: { replyId: Schema.String, wait: Schema.Number },
    messages: [Message.StreamedWord],
    execute: ({ replyId, wait }) =>
      Effect.sleep(wait).pipe(Effect.as(Message.StreamedWord({ replyId }))),
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      ChangedDraft: ({ text: draft }) => ({ model: modifyFields(model, { draft: () => draft }) }),
      PressedSend: () => {
        const prompt = model.draft.trim()
        if (prompt === '') return { model }
        const replyId = `assistant-${model.nextId + 1}`
        return {
          model: modifyFields(model, {
            messages: messages => [
              // A reply still being written is cut off where it stands.
              ...messages.map(each => (each.isStreaming ? { ...each, isStreaming: false } : each)),
              { id: `user-${model.nextId}`, sender: 'user' as const, text: prompt, isStreaming: false },
              { id: replyId, sender: 'assistant' as const, text: '', isStreaming: true },
            ],
            draft: () => '',
            nextId: nextId => nextId + 2,
            anchorIndex: () => model.messages.length,
            replyWords: () => replyTo(prompt, model.nextId).split(/(\s+)/),
            replyShown: () => 0,
            replyId: () => replyId,
          }),
          commands: [
            ScrollToEnd({ animated: true }),
            StreamWord({ replyId, wait: THINK_MS }),
          ],
        }
      },
      StreamedWord: ({ replyId }) => {
        // A word for a reply that was cut off by a newer message is dropped.
        if (replyId !== model.replyId) return { model }
        // A word and the space after it.
        const shown = Math.min(model.replyShown + 2, model.replyWords.length)
        const isDone = shown >= model.replyWords.length
        return {
          model: modifyFields(model, {
            replyShown: () => shown,
            messages: messages =>
              messages.map(each =>
                each.id === replyId
                  ? { ...each, text: model.replyWords.slice(0, shown).join(''), isStreaming: !isDone }
                  : each,
              ),
          }),
          commands: isDone ? [] : [StreamWord({ replyId, wait: WORD_MS })],
        }
      },
      PressedLatest: () => ({ model, commands: [ScrollToEnd({ animated: true })] }),
      PressedLoadOlder: () => ({
        model: modifyFields(model, {
          messages: messages => [
            ...Array.from({ length: OLDER_BATCH }, (_unused, at) =>
              seedMessage(at, `older-${model.olderLoaded}`),
            ),
            ...messages,
          ],
          olderLoaded: count => count + 1,
          // The anchored row is the same message, now further down the list.
          anchorIndex: index => (index < 0 ? index : index + OLDER_BATCH),
        }),
      }),
      CompletedScroll: () => ({ model }),
      GotKeyboardMessage: ({ message: keyboard }) => ({
        model: modifyFields(model, {
          keyboardHeight: height =>
            Keyboard.Message.match(keyboard, {
              ShownKeyboard: ({ height: shown }) => shown,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => height,
            }),
        }),
      }),
    })
}

const SEED_COUNT = 40

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    messages: Array.from({ length: SEED_COUNT }, (_unused, at) => seedMessage(at, 'seed')),
    draft: '',
    nextId: 0,
    olderLoaded: 0,
    anchorIndex: -1,
    replyWords: [],
    replyShown: 0,
    replyId: '',
    keyboardHeight: 0,
  },
})

const INK = '#111111'
const MUTED = '#6b6b6b'
const LINE = '#e3e3e3'
const PAPER = '#ffffff'
const WASH = '#f4f4f2'
const ACCENT = '#e8590c'

const button = (h: HtmlBuilder<Message>, id: string, label: string, message: Message): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: INK,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 15, fontWeight: '600' })], [label])],
  )

const note = (id: string, words: string): Html =>
  text([prop('testID', id), style({ color: MUTED, fontSize: 13 })], [words])

const bubble = (message: ChatMessage): Html => {
  const isUser = message.sender === 'user'
  return box(
    [prop('testID', `message-${message.id}`), style({ paddingHorizontal: 12, paddingVertical: 6 })],
    [
      box(
        [
          style({
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            maxWidth: '86%',
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 16,
            backgroundColor: isUser ? INK : WASH,
            gap: 4,
          }),
        ],
        [
          text([style({ color: isUser ? PAPER : INK, fontSize: 16, lineHeight: 20 })], [
            message.text === '' ? 'Thinking…' : message.text,
          ]),
          text([style({ color: isUser ? '#c9c9c9' : MUTED, fontSize: 12 })], [
            message.isStreaming ? 'Writing…' : isUser ? 'You' : 'Assistant',
          ]),
        ],
      ),
    ],
  )
}

const composer = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [
      prop('testID', 'composer'),
      style({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: LINE,
        backgroundColor: PAPER,
        // Lifted clear of the keyboard.
        marginBottom: model.keyboardHeight,
      }),
    ],
    [
      textInput(
        [
          h.Attribute('testID', 'draft'),
          h.Attribute('value', model.draft),
          h.Placeholder('Ask something, then press Send'),
          prop('editable', true),
          h.OnInput(draft => Message.ChangedDraft({ text: draft })),
          style({
            flex: 1,
            height: 44,
            fontSize: 17,
            color: INK,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderWidth: 1,
            borderColor: LINE,
            borderRadius: 10,
          }),
        ],
        [],
      ),
      button(h, 'send', 'Send', Message.PressedSend()),
    ],
  )

const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'demo-stack')],
      [
        screen(
          [h.Key('chat'), h.Attribute('testID', 'screen-chat')],
          [
            header([title('AI chat on Legend List')], []),
            safeArea(device, { hasHeader: true }, [
              box(
                [style({ flex: 1, backgroundColor: PAPER })],
                [
                  box(
                    [style({ padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: LINE })],
                    [
                      box(
                        [style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })],
                        [
                          button(h, 'exit', 'Exit', Message.PressedExit()),
                          button(h, 'latest', 'Go to latest', Message.PressedLatest()),
                          button(h, 'load-older', 'Load older', Message.PressedLoadOlder()),
                        ],
                      ),
                      text(
                        [prop('testID', 'chat-status'), style({ color: ACCENT, fontSize: 15, fontWeight: '600' })],
                        [
                          `${model.messages.length} messages. ` +
                            (model.anchorIndex < 0
                              ? 'Nothing sent yet.'
                              : `Message ${model.anchorIndex + 1} is held near the top.`),
                        ],
                      ),
                      note(
                        'chat-hint',
                        'The list should open at the newest message. Type and press Send: your message ' +
                          'should move near the top and stay there while the reply is written under it. ' +
                          'Scroll up and press "Load older": what you are reading should not move.',
                      ),
                    ],
                  ),
                  legendList(h, {
                    id: LIST_ID,
                    platform: device.platform,
                    items: model.messages,
                    key: message => message.id,
                    row: bubble,
                    estimatedItemSize: 120,
                    initialScrollAtEnd: true,
                    alignItemsAtEnd: true,
                    maintainVisibleContentPosition: true,
                    // Stay at the newest message when the keyboard makes the list shorter.
                    maintainScrollAtEnd: { on: { layout: true } },
                    recycleItems: true,
                    paddingTop: 8,
                    paddingBottom: 8,
                    ...(model.anchorIndex >= 0
                      ? {
                          anchoredEndSpace: {
                            anchorIndex: model.anchorIndex,
                            anchorMaxSize: ANCHOR_MAX_SIZE,
                            anchorOffset: ANCHOR_OFFSET,
                          },
                        }
                      : {}),
                    attributes: [h.Attribute('testID', 'chat-list'), style({ flex: 1 })],
                  }),
                  composer(model, h),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

const subscriptions = Subscription.make<Model, Message, Keyboard.Keyboard>()(() => ({
  keyboard: Keyboard.changesEntry(fromKeyboard),
}))

/**
 * `resources` supplies the keyboard (`Phone.live(...)` in an app,
 * `Phone.makeTest().layer` in a test). Left out, the demo runs with a
 * keyboard that never shows, so the composer is never lifted.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Keyboard.Keyboard> = Keyboard.makeTest().layer,
) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env),
    view: makeView(env.device),
    subscriptions,
    resources,
    container,
  })
