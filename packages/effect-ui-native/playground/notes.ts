/**
 * Notes: a text field tied to the Model, a list you can add to and delete
 * from, and a press that asks the app to open a note on its own screen.
 *
 * The component owns the notes. It does not own the screens: it tells its
 * parent `OpenedNote` and the app pushes the detail screen, with the phone's
 * own title bar and swipe back.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native } from '../src/index.js'
import * as Look from './look.js'

const Note = Schema.Struct({ id: Schema.String, text: Schema.String })

export const NotesMessage = UiSchema.TaggedEnum({
  ChangedDraft: { text: Schema.String },
  PressedAdd: {},
  SubmittedDraft: {},
  PressedDelete: { id: Schema.String },
  PressedNote: { id: Schema.String },
})

export const NotesEvents = UiSchema.TaggedEnum({
  OpenedNote: { id: Schema.String, text: Schema.String },
})

const NotesModel = Schema.Struct({
  draft: Schema.String,
  notes: Schema.Array(Note),
  nextId: Schema.Number,
})

/** Letters over this many are refused, to show the Model can say no to the field. */
export const MAX_DRAFT = 40

type NotesModel = typeof NotesModel.Type

/** The draft becomes a note, unless it is empty. */
const added = (model: NotesModel): NotesModel => {
  const text = model.draft.trim()
  if (text === '') return model
  return { draft: '', notes: [...model.notes, { id: `n${model.nextId}`, text }], nextId: model.nextId + 1 }
}

export const Notes = Native.component({
  name: 'Notes',
  model: NotesModel,
  message: NotesMessage,
  events: NotesEvents,
}).make({
  init: () => ({ draft: '', notes: [{ id: 'n0', text: 'Press me to open' }], nextId: 1 }),
  update: {
    // Longer than the limit: the Model stays as it is, and the field is put back.
    ChangedDraft: ($, { text }) => (text.length > MAX_DRAFT ? $.model : $.evolve({ draft: text })),
    PressedAdd: $ => added($.model),
    SubmittedDraft: $ => added($.model),
    PressedDelete: ($, { id }) => $.evolve({ notes: $.model.notes.filter(note => note.id !== id) }),
    PressedNote: ($, { id }) => {
      const note = $.model.notes.find(each => each.id === id)
      return note === undefined ? $.model : $.emit(NotesEvents.OpenedNote({ id: note.id, text: note.text }))
    },
  },
  view: (h, model) =>
    h.view.style(Look.page).children(
      h.view.style({ ...Look.pad, flexDirection: 'row', alignItems: 'center' }).children(
        h.textInput
          .testId('notes-field')
          .style({ flex: 1, fontSize: 16, padding: 10, borderWidth: 1, borderColor: Look.LINE, borderRadius: 8 })
          .placeholder(`A note, up to ${MAX_DRAFT} letters`)
          .set({ returnKeyType: 'done' })
          .value(model.draft)
          .on('changeText', ({ text }) => NotesMessage.ChangedDraft({ text }))
          .on('submit', NotesMessage.SubmittedDraft()),
        Look.plainButton(h, 'notes-add', 'Add', NotesMessage.PressedAdd()),
      ),
      h.text.testId('notes-count').style({ ...Look.small, paddingHorizontal: 16 }).children(
        `${model.notes.length} notes. Draft: ${model.draft.length} letters.`,
      ),
      h.scrollView.testId('notes-list').style({ flex: 1 }).children(
        model.notes.map(note =>
          h.view.key(note.id).style({ ...Look.row, flexDirection: 'row', alignItems: 'center', gap: 12 }).children(
            h.pressable
              .testId(`note-${note.id}`)
              .style({ flex: 1 })
              .pressedStyle({ opacity: 0.5 })
              .on('press', NotesMessage.PressedNote({ id: note.id }))
              .children(h.text.style(Look.label).children(note.text)),
            h.pressable
              .testId(`note-delete-${note.id}`)
              .pressedStyle({ opacity: 0.5 })
              .on('press', NotesMessage.PressedDelete({ id: note.id }))
              .children(h.text.style({ fontSize: 15, color: Look.RED }).children('Delete')),
          ),
        ),
      ),
    ),
})

/** One note on its own screen. Drawn from props only. */
export const NoteDetail = Native.component({
  name: 'NoteDetail',
  props: Schema.Struct({ text: Schema.String }),
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: $ => $.model,
  view: h =>
    h.view.style(Look.pad).children(
      h.text.testId('note-detail-text').style({ fontSize: 22, color: Look.INK }).children(h.props.text),
      h.text.style(Look.small).children('Swipe from the left edge, or press Back, to return.'),
    ),
})
