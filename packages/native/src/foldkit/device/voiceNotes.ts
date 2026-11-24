/**
 * Saved voice notes as Foldkit Commands.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/voiceNotes.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError } from '../../host/device/common.js'
import { VoiceNotes, Note, type VoiceNotesService } from '../../host/device/voiceNotes.js'

export * from '../../host/device/voiceNotes.js'

export const Message = defineMessageUnion({
  /** The whole list after a read or a change, newest first. `action` is list, add, rename or remove. */
  ChangedNotes: { action: Schema.String, notes: Schema.Array(Note) },
  FailedNotes: { action: Schema.String, reason: Schema.String },
})
export type Message = typeof Message.Type

const report = (
  action: string,
  run: (store: VoiceNotesService) => Effect.Effect<ReadonlyArray<Note>, DeviceError>,
) =>
  VoiceNotes.use(run).pipe(
    Effect.map(notes => Message.ChangedNotes({ action, notes })),
    Effect.catch(error =>
      Effect.succeed(Message.FailedNotes({ action, reason: error.reason })),
    ),
  )

const messages = [Message.ChangedNotes, Message.FailedNotes] as const

export const List = Command.define('VoiceNotes.List', {
  messages,
  execute: report('list', store => store.list),
})

/** Moves a finished recording into the notes folder and adds it to the list. */
export const Add = Command.define('VoiceNotes.Add', {
  args: { uri: Schema.String, durationMs: Schema.Number, sizeBytes: Schema.Number },
  messages,
  execute: ({ uri, durationMs, sizeBytes }) =>
    report('add', store => store.add({ uri, durationMs, sizeBytes })),
})

export const Rename = Command.define('VoiceNotes.Rename', {
  args: { id: Schema.String, name: Schema.String },
  messages,
  execute: ({ id, name }) => report('rename', store => store.rename(id, name)),
})

export const Remove = Command.define('VoiceNotes.Remove', {
  args: { id: Schema.String },
  messages,
  execute: ({ id }) => report('remove', store => store.remove(id)),
})
