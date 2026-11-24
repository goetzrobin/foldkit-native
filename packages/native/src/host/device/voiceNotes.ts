/**
 * Voice notes kept on the phone: the sound files and a list of them.
 *
 *   documents/voice-notes/
 *     index.json           the list: name, length, size, date, file name
 *     note-<id>.m4a        one file per note
 *
 * The recorder writes into the phone's cache, which the phone may empty when
 * it is short of room. `Add` moves a finished recording from there into the
 * folder above, which the phone keeps until the app is deleted, and writes
 * the list again. Reading the list drops any note whose file has gone.
 *
 * The list holds file names, not full addresses. On iOS the full address of
 * the app's folder can change when the app is updated, so the address is
 * worked out each time the list is read.
 *
 * Every Command answers with the whole list (`ChangedNotes`), newest first,
 * or with `FailedNotes`.
 *
 * UPLOAD GOES HERE. A note is a file at `note.uri`. A Command that sends it
 * to a server would live next to `Add` below and answer with its own
 * Messages (started, progress, done, failed). Nothing in this file uploads.
 */
import { Context, Effect, Layer, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import {
  type Files,
  type FileSystemModule,
  filesFrom,
  makeMemoryFiles,
} from './audioNative.js'
import { DeviceError, attempt } from './common.js'

export const Note = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** Where the sound is right now. Not saved: worked out when the list is read. */
  uri: Schema.String,
  durationMs: Schema.Number,
  sizeBytes: Schema.Number,
  /** When it was saved, in milliseconds since 1970. */
  createdAt: Schema.Number,
})
export type Note = typeof Note.Type

type Stored = Readonly<{
  id: string
  name: string
  fileName: string
  durationMs: number
  sizeBytes: number
  createdAt: number
}>

export type NewNote = Readonly<{
  /** The finished recording, wherever the recorder left it. */
  uri: string
  durationMs: number
  sizeBytes: number
  /** Left out, the note is called "Voice note 3" and so on. */
  name?: string
}>

export type VoiceNotesService = Readonly<{
  /** Where the notes are kept, for a status line. */
  folder: string
  list: Effect.Effect<ReadonlyArray<Note>, DeviceError>
  add: (note: NewNote) => Effect.Effect<ReadonlyArray<Note>, DeviceError>
  rename: (id: string, name: string) => Effect.Effect<ReadonlyArray<Note>, DeviceError>
  remove: (id: string) => Effect.Effect<ReadonlyArray<Note>, DeviceError>
}>

export class VoiceNotes extends Context.Service<VoiceNotes, VoiceNotesService>()(
  'foldkit-native/VoiceNotes',
) {}

const CAPABILITY = 'voice notes'
const INDEX = 'index.json'

const isStored = (value: unknown): value is Stored => {
  if (typeof value !== 'object' || value === null) return false
  const note = value as Record<string, unknown>
  return (
    typeof note['id'] === 'string' &&
    typeof note['name'] === 'string' &&
    typeof note['fileName'] === 'string' &&
    typeof note['durationMs'] === 'number' &&
    typeof note['sizeBytes'] === 'number' &&
    typeof note['createdAt'] === 'number'
  )
}

export const make = (
  files: Files,
  options: Readonly<{ now?: () => number }> = {},
): VoiceNotesService => {
  const now = options.now ?? (() => Date.now())
  const indexUri = `${files.root}${INDEX}`
  const uriOf = (stored: Stored): string => `${files.root}${stored.fileName}`

  /** The saved list, without notes whose file has gone. A list that cannot be read counts as empty. */
  const read = (): ReadonlyArray<Stored> => {
    const text = files.readText(indexUri)
    if (text === null) return []
    try {
      const parsed = JSON.parse(text) as { notes?: unknown }
      const notes = Array.isArray(parsed.notes) ? parsed.notes.filter(isStored) : []
      return notes.filter(note => files.exists(uriOf(note)))
    } catch {
      return []
    }
  }

  const write = (notes: ReadonlyArray<Stored>): void => {
    files.writeText(indexUri, JSON.stringify({ version: 1, notes }))
  }

  const shown = (notes: ReadonlyArray<Stored>): ReadonlyArray<Note> =>
    [...notes]
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
      .map(note => ({
        id: note.id,
        name: note.name,
        uri: uriOf(note),
        durationMs: note.durationMs,
        sizeBytes: note.sizeBytes,
        createdAt: note.createdAt,
      }))

  const nextNumber = (notes: ReadonlyArray<Stored>): number =>
    notes.reduce((highest, note) => {
      const match = /^Voice note (\d+)$/.exec(note.name)
      return match === null ? highest : Math.max(highest, Number(match[1]))
    }, 0) + 1

  let counter = 0

  return {
    folder: files.root,
    list: attempt(CAPABILITY, () => shown(read())),
    add: note =>
      attempt(CAPABILITY, () => {
        const notes = read()
        const createdAt = now()
        const id = `${createdAt.toString(36)}-${(counter++).toString(36)}`
        const extension = /\.[a-z0-9]+$/i.exec(note.uri)?.[0] ?? '.m4a'
        const stored: Stored = {
          id,
          name: note.name ?? `Voice note ${nextNumber(notes)}`,
          fileName: `note-${id}${extension}`,
          durationMs: note.durationMs,
          sizeBytes: note.sizeBytes,
          createdAt,
        }
        // The file first: a list entry with no file is dropped on the next
        // read, but a file with no entry would sit there for ever.
        files.move(note.uri, uriOf(stored))
        const size = files.size(uriOf(stored))
        const next = [...notes, size > 0 ? { ...stored, sizeBytes: size } : stored]
        write(next)
        return shown(next)
      }),
    rename: (id, name) =>
      attempt(CAPABILITY, () => {
        const trimmed = name.trim()
        if (trimmed === '') throw new Error('A note needs a name.')
        const notes = read()
        if (!notes.some(note => note.id === id)) throw new Error('That note is not there any more.')
        const next = notes.map(note => (note.id === id ? { ...note, name: trimmed } : note))
        write(next)
        return shown(next)
      }),
    remove: id =>
      attempt(CAPABILITY, () => {
        const notes = read()
        const target = notes.find(note => note.id === id)
        const next = notes.filter(note => note.id !== id)
        // The list first: if deleting the file then fails, the note is gone
        // from the list and only a stray file is left.
        write(next)
        if (target !== undefined) files.remove(uriOf(target))
        return shown(next)
      }),
  }
}

export const unavailable = (reason: string): VoiceNotesService => {
  const failed = Effect.fail(new DeviceError({ capability: CAPABILITY, reason }))
  return {
    folder: `not available: ${reason}`,
    list: failed,
    add: () => failed,
    rename: () => failed,
    remove: () => failed,
  }
}

/** `VoiceNotes.live(fileSystemFromGlobal())`. */
export const live = (module: FileSystemModule | null | undefined): Layer.Layer<VoiceNotes> => {
  if (module === null || module === undefined) {
    return Layer.succeed(
      VoiceNotes,
      unavailable(
        'this build has no expo-file-system (globalThis.expo.modules.FileSystem is missing)',
      ),
    )
  }
  try {
    return Layer.succeed(VoiceNotes, make(filesFrom(module)))
  } catch (error) {
    return Layer.succeed(
      VoiceNotes,
      unavailable(error instanceof Error ? error.message : String(error)),
    )
  }
}

/**
 * The real store over files in memory. Pass the same `files` to a second
 * `makeTest` to stand for closing and reopening the app.
 */
export const makeTest = (
  options: Readonly<{ files?: ReturnType<typeof makeMemoryFiles>; now?: () => number }> = {},
) => {
  const files = options.files ?? makeMemoryFiles()
  let clock = 1_700_000_000_000
  const service = make(files.files, {
    now:
      options.now ??
      (() => {
        clock += 60_000
        return clock
      }),
  })
  return { layer: Layer.succeed(VoiceNotes, service), service, files }
}

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
