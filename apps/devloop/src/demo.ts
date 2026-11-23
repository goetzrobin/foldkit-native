/**
 * The dev loop demo: one screen to try hot reload and the crash screen on.
 *
 * What to try on the phone:
 *   1. Press +, type in the field, add a few items.
 *   2. Change the words of EDIT_ME below and save. The new words should
 *      appear while the count, the typed text and the items stay.
 *   3. Press "Crash on purpose". A red crash screen should appear.
 *   4. Save any file again. The program should come back with the same
 *      count and items.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { keepModel, nativeCrash } from './foldkit-native/devLoop'
import {
  type Device,
  header,
  prop,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  text,
  textInput,
  title,
  view as box,
} from './foldkit-native'

export type DemoEnv = Readonly<{
  device: Device
  /** Leaves the demo, back to the menu. */
  exit: () => void
}>

/** Change these words and save: only they should change on the phone. */
export const EDIT_ME = 'Edit me in src/demo.ts and save'

const Item = Schema.Struct({ id: Schema.Number, text: Schema.String })

export const Model = Schema.Struct({
  count: Schema.Number,
  draft: Schema.String,
  items: Schema.Array(Item),
  nextId: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedDecrement: {},
  PressedIncrement: {},
  ChangedDraft: { text: Schema.String },
  PressedAdd: {},
  PressedCrash: {},
  PressedExit: {},
  CompletedExit: {},
})
export type Message = typeof Message.Type

export const CRASH_MESSAGE = 'This crash was asked for by the Crash button.'

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { count: 0, draft: '', items: [], nextId: 1 },
})

export const makeUpdate = (env: DemoEnv) => {
  // Leaving the demo is a side effect, so it is a Command and not a line in
  // `update`.
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedDecrement: () => ({
        model: modifyFields(model, { count: count => count - 1 }),
      }),
      PressedIncrement: () => ({
        model: modifyFields(model, { count: count => count + 1 }),
      }),
      ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text }) }),
      PressedAdd: () =>
        model.draft.trim() === ''
          ? { model }
          : {
              model: modifyFields(model, {
                items: items => [...items, { id: model.nextId, text: model.draft.trim() }],
                nextId: nextId => nextId + 1,
                draft: () => '',
              }),
            },
      // A program crashes when its code throws. This throws on purpose.
      PressedCrash: () => {
        throw new Error(CRASH_MESSAGE)
      },
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
    })
}

const INK = '#111111'
const MUTED = '#6b6b6b'
const LINE = '#e3e3e3'
const PAPER = '#ffffff'
const ACCENT = '#0a66d8'
const DANGER = '#c62828'
const NOTE_PAPER = '#fff6d6'

const button = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  color: string,
  message: Message,
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 17, fontWeight: '600' })], [label])],
  )

const hint = (words: string): Html => text([style({ color: MUTED, fontSize: 13 })], [words])

/** `editMe` is a parameter so a test can stand in for an edited file. */
export const makeView =
  (env: DemoEnv, editMe: string = EDIT_ME) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'stack')],
      [
        screen(
          [h.Key('dev-loop'), h.Attribute('testID', 'screen-dev-loop')],
          [
            header([title('Dev loop')], []),
            safeArea(env.device, { hasHeader: true }, [
              box(
                [style({ flex: 1, backgroundColor: PAPER, padding: 16, gap: 12 })],
                [
                  box(
                    [style({ backgroundColor: NOTE_PAPER, borderRadius: 10, padding: 12, gap: 4 })],
                    [
                      text(
                        [
                          h.Attribute('testID', 'edit-me'),
                          style({ color: INK, fontSize: 17, fontWeight: '600' }),
                        ],
                        [editMe],
                      ),
                      hint('After a save, everything below should stay as it is.'),
                    ],
                  ),
                  box(
                    [style({ flexDirection: 'row', gap: 12, alignItems: 'center' })],
                    [
                      button(h, 'minus', '−', ACCENT, Message.PressedDecrement()),
                      text(
                        [
                          h.Attribute('testID', 'count'),
                          style({ color: INK, fontSize: 28, minWidth: 48, textAlign: 'center' }),
                        ],
                        [String(model.count)],
                      ),
                      button(h, 'plus', '+', ACCENT, Message.PressedIncrement()),
                      hint('Counter'),
                    ],
                  ),
                  box(
                    [style({ flexDirection: 'row', gap: 8, alignItems: 'center' })],
                    [
                      textInput(
                        [
                          h.Attribute('testID', 'draft'),
                          h.Attribute('value', model.draft),
                          h.Placeholder('Type, then save a file'),
                          prop('editable', true),
                          h.OnInput(text => Message.ChangedDraft({ text })),
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
                      button(h, 'add', 'Add', ACCENT, Message.PressedAdd()),
                    ],
                  ),
                  text(
                    [h.Attribute('testID', 'summary'), style({ color: MUTED, fontSize: 13 })],
                    [`${model.items.length} items · ${model.draft.length} characters typed`],
                  ),
                  scrollView(
                    [h.Attribute('testID', 'items'), style({ flex: 1 })],
                    model.items.map(item =>
                      box(
                        [
                          h.Key(String(item.id)),
                          h.Attribute('testID', `item-${item.id}`),
                          style({
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: LINE,
                          }),
                        ],
                        [text([style({ color: INK, fontSize: 17 })], [item.text])],
                      ),
                    ),
                  ),
                  hint('Crash shows the red crash screen. Save a file to come back.'),
                  button(h, 'crash', 'Crash on purpose', DANGER, Message.PressedCrash()),
                  button(h, 'exit', 'Exit', INK, Message.PressedExit()),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

export const makeDemo = (container: HTMLElement, env: DemoEnv) =>
  Runtime.makeElement(
    keepModel({
      Model,
      init,
      update: makeUpdate(env),
      view: makeView(env),
      container,
      crash: nativeCrash<Model, Message>(),
    }),
  )
