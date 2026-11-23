/**
 * The keyboard dock demo: a list of lines, and under it a text field that
 * rides on top of the keyboard.
 *
 * A label at the top says which way the dock works in this build of the app:
 * "following the keyboard natively" or "fallback". See
 * `src/keyboard/detect.ts` for what decides it.
 *
 * What to try: tap the field, and watch whether the bar travels up with the
 * keyboard or arrives separately. Then drag the list downwards. In native
 * mode the keyboard follows the finger and the bar stays on top of it.
 */
import { Effect, type Layer, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'
import { element } from 'foldkit/renderTarget'

import { Keyboard } from '../../src/device/index.js'
import {
  type Device,
  header,
  prop,
  screen,
  scrollView,
  stack,
  style,
  text,
  textInput,
  title,
  view as box,
} from '../../src/index.js'
import {
  dismissKeyboardOnDrag,
  keyboardDock,
  keyboardDockFallbackReason,
  keyboardDockMode,
} from '../../src/keyboard/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

const FIRST_LINES = 30

export const Model = Schema.Struct({
  /** The newest line is first. */
  lines: Schema.Array(Schema.String),
  draft: Schema.String,
  /** From the phone's keyboard events. The dock reads it in fallback mode. */
  keyboardHeight: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  GotKeyboardMessage: { message: Keyboard.Message },
})
export type Message = typeof Message.Type

const makeUpdate = (env: DemoEnv) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => env.exit()).pipe(Effect.as(Message.CompletedExit())),
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      ChangedDraft: ({ text: draft }) => ({ model: modifyFields(model, { draft: () => draft }) }),
      PressedSend: () => {
        const line = model.draft.trim()
        if (line === '') return { model }
        return {
          model: modifyFields(model, {
            lines: lines => [line, ...lines],
            draft: () => '',
          }),
        }
      },
      GotKeyboardMessage: ({ message: keyboard }) => ({
        model: modifyFields(model, {
          keyboardHeight: height =>
            Keyboard.Message.match(keyboard, {
              ShownKeyboard: shown => shown.height,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => height,
            }),
        }),
      }),
    })
}

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    lines: Array.from({ length: FIRST_LINES }, (_, index) => `Line ${FIRST_LINES - index}`),
    draft: '',
    keyboardHeight: 0,
  },
})

const subscriptions = Subscription.make<Model, Message, Keyboard.Keyboard>()(() => ({
  keyboard: Keyboard.changesEntry(message => Message.GotKeyboardMessage({ message })),
}))

const INK = '#111111'
const PAPER = '#ffffff'
const MUTED = '#6b6b6b'
const LINE = '#e3e3e3'
const ACCENT = '#c2410c'
const BAR = '#f4f4f4'

const el = element<any>()

/**
 * The phone's safe area with the bottom edge left alone: the dock keeps
 * clear of the home indicator itself.
 */
const safeAreaAboveDock = (device: Device, children: ReadonlyArray<Html>): Html =>
  el('screen-safe-area')(
    [
      prop('edges', {
        // As in `safeArea`: Android already starts a screen below its title bar.
        top: device.platform !== 'android',
        right: true,
        bottom: false,
        left: true,
      }),
    ] as never,
    children as never,
  )

const button = (h: HtmlBuilder<Message>, id: string, label: string, message: Message): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: INK,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 15, fontWeight: '600' })], [label])],
  )

const modeLabel = (): string =>
  keyboardDockMode() === 'native'
    ? 'Mode: following the keyboard natively'
    : `Mode: fallback (${keyboardDockFallbackReason()})`

const whatToExpect = (): string =>
  keyboardDockMode() === 'native'
    ? 'Tap the field: the bar should travel up with the keyboard, never apart from it. ' +
      'Then drag the list down: the keyboard should follow your finger with the bar on top.'
    : 'Tap the field: the bar eases up over a quarter of a second, close to the keyboard ' +
      'but not locked to it. Drag the list: the keyboard leaves as the drag starts.'

const panel = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [style({ padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: LINE })],
    [
      box(
        [style({ flexDirection: 'row', gap: 8 })],
        [button(h, 'exit', 'Exit', Message.PressedExit())],
      ),
      text(
        [prop('testID', 'dock-mode'), style({ color: ACCENT, fontSize: 15, fontWeight: '600' })],
        [modeLabel()],
      ),
      text([prop('testID', 'dock-hint'), style({ color: MUTED, fontSize: 13 })], [whatToExpect()]),
      text(
        [prop('testID', 'keyboard-height'), style({ color: MUTED, fontSize: 13 })],
        [
          model.keyboardHeight === 0
            ? 'The program was told: keyboard hidden.'
            : `The program was told: keyboard ${Math.round(model.keyboardHeight)} points tall.`,
        ],
      ),
    ],
  )

const lineView = (line: string, index: number, count: number): Html =>
  box(
    [
      style({
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: LINE,
      }),
    ],
    [text([prop('testID', `line-${count - index}`), style({ color: INK, fontSize: 16 })], [line])],
  )

const composer = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [style({ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 })],
    [
      textInput(
        [
          h.Attribute('testID', 'draft'),
          h.Attribute('value', model.draft),
          h.Placeholder('Write a line'),
          prop('editable', true),
          h.OnInput(draft => Message.ChangedDraft({ text: draft })),
          style({
            flex: 1,
            height: 40,
            fontSize: 16,
            color: INK,
            paddingHorizontal: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: LINE,
            backgroundColor: PAPER,
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
      [],
      [
        screen(
          [h.Key('keyboard'), h.Attribute('testID', 'screen-keyboard')],
          [
            header([title('Keyboard dock')], []),
            safeAreaAboveDock(device, [
              box(
                [style({ flex: 1, backgroundColor: PAPER })],
                [
                  panel(model, h),
                  keyboardDock(h, {
                    keyboardHeight: model.keyboardHeight,
                    backgroundColor: BAR,
                    above: [
                      scrollView(
                        [prop('testID', 'lines'), dismissKeyboardOnDrag(), style({ flex: 1 })],
                        model.lines.map((line, index) =>
                          lineView(line, index, model.lines.length),
                        ),
                      ),
                    ],
                    children: [composer(model, h)],
                  }),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

/**
 * `resources` is the Layer with the phone's keyboard in it: `Phone.live({...})`
 * in an app, `Phone.makeTest().layer` in a test.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Keyboard.Keyboard>,
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
