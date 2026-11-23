/**
 * The Phase 1 program: a list of notes with a text field, and a second screen
 * for one note. It uses the phone's own screen stack, so swipe-back works,
 * and the Model catches up when the phone goes back by itself.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  header,
  nativeCrash,
  onDismissed,
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
} from '../src/index'

const Note = Schema.Struct({ id: Schema.Number, text: Schema.String })
type Note = typeof Note.Type

export const Model = Schema.Struct({
  notes: Schema.Array(Note),
  draft: Schema.String,
  nextId: Schema.Number,
  /** The notes open above the list, the last one on top. */
  open: Schema.Array(Schema.Number),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  ChangedDraft: { text: Schema.String },
  PressedAdd: {},
  PressedNote: { id: Schema.Number },
  PressedBack: {},
  PressedDelete: { id: Schema.Number },
  PoppedByPhone: { count: Schema.Number },
  PressedMenu: {},
  CompletedExit: {},
})
export type Message = typeof Message.Type

/** Extras for running inside the showcase. */
export type NotesOptions = Readonly<{
  /** Leave the program. Shows a "Menu" button when given. */
  exit?: () => void
  crashed?: (error: Error) => void
}>

export const makeUpdate = (options: NotesOptions = {}) => {
  const Exit = Command.define('Exit', {
    args: {},
    messages: [Message.CompletedExit],
    execute: () =>
      Effect.sync(() => options.exit?.()).pipe(Effect.as(Message.CompletedExit())),
  })
  return (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    PressedMenu: () => ({ model, commands: [Exit({})] }),
    CompletedExit: () => ({ model }),
    ChangedDraft: ({ text }) => ({ model: modifyFields(model, { draft: () => text }) }),
    PressedAdd: () =>
      model.draft.trim() === ''
        ? { model }
        : {
            model: modifyFields(model, {
              notes: notes => [...notes, { id: model.nextId, text: model.draft.trim() }],
              nextId: nextId => nextId + 1,
              draft: () => '',
            }),
          },
    PressedNote: ({ id }) => ({
      model: modifyFields(model, { open: open => [...open, id] }),
    }),
    PressedBack: () => ({
      model: modifyFields(model, { open: open => open.slice(0, -1) }),
    }),
    PressedDelete: ({ id }) => ({
      model: modifyFields(model, {
        notes: notes => notes.filter(note => note.id !== id),
        open: open => open.filter(openId => openId !== id),
      }),
    }),
    // The phone has already popped these screens. Drop the same number.
    PoppedByPhone: ({ count }) => ({
      model: modifyFields(model, {
        open: open => open.slice(0, Math.max(0, open.length - count)),
      }),
    }),
  })
}

export const update = makeUpdate()

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    notes: [
      { id: 1, text: 'Swipe from the left edge to go back' },
      { id: 2, text: 'Type fast in the field above' },
      // Enough rows to run off the bottom of the screen, so the list must scroll.
      ...Array.from({ length: 22 }, (_unused, index) => ({
        id: index + 3,
        text: `Filler note ${index + 1}`,
      })),
    ],
    draft: '',
    nextId: 25,
    open: [],
  },
})

const INK = '#111111'
const MUTED = '#6b6b6b'
const LINE = '#e3e3e3'
const PAPER = '#ffffff'
const ACCENT = '#0a66d8'
const DANGER = '#c62828'

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

const homeScreen = (
  model: Model,
  h: HtmlBuilder<Message>,
  device: Device,
  options: NotesOptions,
): Html =>
  screen(
    [h.Key('home'), h.Attribute('testID', 'screen-home')],
    [
      header([title('Notes')], []),
      safeArea(device, { hasHeader: true }, [
        box(
          [
            style({
              flex: 1,
              backgroundColor: PAPER,
              padding: 16,
              gap: 12,
            }),
          ],
          [
            ...(options.exit === undefined
              ? []
              : [button(h, 'menu', 'Menu', MUTED, Message.PressedMenu())]),
            text(
              [h.Attribute('testID', 'probe'), style({ color: INK, fontSize: 13 })],
              [`${device.platform} ${device.osVersion}`],
            ),
            box(
              [style({ flexDirection: 'row', gap: 8, alignItems: 'center' })],
              [
                textInput(
                  [
                    h.Attribute('testID', 'draft'),
                    h.Attribute('value', model.draft),
                    h.Placeholder('New note'),
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
              [h.Attribute('testID', 'count'), style({ color: MUTED, fontSize: 13 })],
              [`${model.notes.length} notes · ${model.draft.length} characters typed`],
            ),
            scrollView(
              [h.Attribute('testID', 'list'), style({ flex: 1 })],
              model.notes.map(note =>
                box(
                  [
                    h.Key(String(note.id)),
                    h.Attribute('testID', `note-${note.id}`),
                    h.OnClick(Message.PressedNote({ id: note.id })),
                    style({
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: LINE,
                    }),
                  ],
                  [text([style({ color: INK, fontSize: 17 })], [note.text])],
                ),
              ),
            ),
          ],
        ),
      ]),
    ],
  )

const noteScreen = (
  note: Note,
  depth: number,
  h: HtmlBuilder<Message>,
  device: Device,
): Html =>
  screen(
    [
      // The same note can be open twice, so its place in the stack is part of the key.
      h.Key(`note-${note.id}-${depth}`),
      h.Attribute('testID', `screen-note-${note.id}`),
      onDismissed<Message>(count => Message.PoppedByPhone({ count })),
    ],
    [
      header([title('Note')], []),
      safeArea(device, { hasHeader: true }, [
        box(
          [style({ flex: 1, backgroundColor: PAPER, padding: 16, gap: 16 })],
          [
            text(
              [h.Attribute('testID', 'note-text'), style({ color: INK, fontSize: 22 })],
              [note.text],
            ),
            button(h, 'back', 'Back (from the Model)', ACCENT, Message.PressedBack()),
            button(h, 'delete', 'Delete', DANGER, Message.PressedDelete({ id: note.id })),
          ],
        ),
      ]),
    ],
  )

export const makeView =
  (device: Device, options: NotesOptions = {}) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'stack')],
      [
        homeScreen(model, h, device, options),
        ...model.open.flatMap((id, depth) => {
          const note = model.notes.find(each => each.id === id)
          return note === undefined ? [] : [noteScreen(note, depth, h, device)]
        }),
      ],
    )

export const makeNotes = (container: HTMLElement, device: Device, options: NotesOptions = {}) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(options),
    view: makeView(device, options),
    container,
    crash: nativeCrash(options.crashed),
  })
