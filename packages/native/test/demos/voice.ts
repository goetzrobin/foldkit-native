/**
 * The Voice notes demo: record a note, keep it, play it back.
 *
 * HOW IT IS BUILT, IN PLAIN WORDS
 *
 * A Foldkit program has four parts, and each has one job here.
 *
 * 1. The Model is everything the screen is drawn from. Here it holds:
 *    - the recorder's phase: Idle, AskingPermission, Recording, Paused,
 *      Saving or Failed,
 *    - the seconds on the timer,
 *    - the list of saved notes,
 *    - which note is loaded in the player, and where playback has got to.
 *    It does NOT hold how loud the room is. See 4.
 *
 * 2. Commands are requests to the phone. "Ask for the microphone", "start",
 *    "pause", "stop and give me the file", "throw it away", "play this
 *    note", "save this recording in the list". Each one answers with a
 *    Message that says what happened, and the Model changes only then.
 *
 * 3. Subscriptions are the phone talking without being asked. There are two
 *    for sound, and each runs only when it has something to say:
 *    - the recorder's status, while a recording is live: about one Message
 *      a second (the timer moved, or the phone paused the recording),
 *    - the player's position, while a note is loaded: four a second while
 *      it plays, none while it is paused.
 *    A third, small one says when the app comes back to the front, so the
 *    screen can ask the recorder what happened while it was away.
 *
 * 4. The level meter is drawn outside the Model. The recorder writes the
 *    loudness into a plain box (`Recorder.levelMeter`) ten times a second.
 *    The meter is a canvas that reads that box when it draws a frame. No
 *    Message is sent and the view does not run, so the rest of the screen is
 *    left alone. The canvas uses Skia where the build has it and plain views
 *    where it does not, and a status line says which.
 *
 * The recorder itself lives in the app, not in this screen. Leave the demo
 * while recording and the recording carries on. Come back and the first
 * thing the program does is ask the recorder for a snapshot, and the timer
 * picks up where it really is.
 *
 * Nothing here uploads, transcribes or tags a note. The line "Upload: not
 * built in this demo" on screen marks where that would be reported, and the
 * comment "UPLOAD GOES HERE" below marks where its Command would be sent.
 */
import { Effect, type Layer, Option, Schema, Stream } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  AppState,
  ColorScheme,
  Haptics,
  Player,
  Recorder,
  type Services,
  VoiceNotes,
} from '../../src/device/index.js'
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
} from '../../src/index.js'
import { type Scene, canvas, rendererFor } from '../../src/skia/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

/** The longest note: 15 minutes. A minute before the end the screen says so. */
export const MAX_SECONDS = 15 * 60
export const WARN_SECONDS = 60
/** The test button's recording: five seconds, stopped by the phone itself. */
export const TEST_SECONDS = 5
export const TEST_WARN_SECONDS = 2

export const UPLOAD_LINE = 'Upload: not built in this demo'

// MODEL

export const Phase = defineTaggedUnion({
  Idle: {},
  AskingPermission: {},
  Recording: { elapsedSeconds: Schema.Number, isNearLimit: Schema.Boolean },
  /** `by` says who paused it: `you`, or the `phone` (a call, the app out of sight). */
  Paused: { elapsedSeconds: Schema.Number, by: Schema.Literals(['you', 'phone']) },
  Saving: {},
  Failed: { reason: Schema.String },
})
export type Phase = typeof Phase.Type

const LoadedNote = Schema.Struct({
  noteId: Schema.String,
  positionMs: Schema.Number,
  durationMs: Schema.Number,
  isPlaying: Schema.Boolean,
})

export const Model = Schema.Struct({
  phase: Phase,
  /** `unknown` until the phone has answered. */
  permission: Schema.Literals(['unknown', 'granted', 'denied', 'blocked', 'undetermined']),
  /** How the microphone is reached in this build. */
  route: Schema.String,
  /** Whether the phone was asked to keep recording out of sight. */
  background: Schema.String,
  /** The length the next or the running recording stops at. */
  maxSeconds: Schema.Number,
  warnSeconds: Schema.Number,
  notes: Schema.Array(VoiceNotes.Note),
  maybeLoaded: Schema.Option(LoadedNote),
  rate: Schema.Number,
  maybeEditing: Schema.Option(Schema.Struct({ id: Schema.String, draft: Schema.String })),
  lastEvent: Schema.String,
  uploadLine: Schema.String,
  maybeScheme: Schema.Option(ColorScheme.Scheme),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedRecord: {},
  PressedRecordFiveSeconds: {},
  PressedPause: {},
  PressedResume: {},
  PressedStop: {},
  PressedDiscard: {},
  PressedOpenSettings: {},
  PressedPlay: { id: Schema.String },
  PressedPausePlayback: {},
  PressedSeek: { positionMs: Schema.Number },
  PressedRate: { rate: Schema.Number },
  PressedRename: { id: Schema.String },
  ChangedNameDraft: { text: Schema.String },
  PressedSaveName: {},
  PressedCancelRename: {},
  PressedDelete: { id: Schema.String },
  PressedExit: {},
  CompletedExit: {},
  GotRecorderMessage: { message: Recorder.Message },
  GotPlayerMessage: { message: Player.Message },
  GotNotesMessage: { message: VoiceNotes.Message },
  GotHapticsMessage: { message: Haptics.Message },
  GotAppStateMessage: { message: AppState.Message },
  GotColorSchemeMessage: { message: ColorScheme.Message },
})
export type Message = typeof Message.Type

// COMMAND

const fromRecorder = (message: Recorder.Message) => Message.GotRecorderMessage({ message })
const fromPlayer = (message: Player.Message) => Message.GotPlayerMessage({ message })
const fromNotes = (message: VoiceNotes.Message) => Message.GotNotesMessage({ message })
const fromHaptics = (message: Haptics.Message) => Message.GotHapticsMessage({ message })

const recorder = <A extends Recorder.Message, E, R>(command: Command.Command<A, E, R>) =>
  Command.mapMessage(command, fromRecorder)
const player = <A extends Player.Message, E, R>(command: Command.Command<A, E, R>) =>
  Command.mapMessage(command, fromPlayer)
const notes = <A extends VoiceNotes.Message, E, R>(command: Command.Command<A, E, R>) =>
  Command.mapMessage(command, fromNotes)
const haptic = <A extends Haptics.Message, E, R>(command: Command.Command<A, E, R>) =>
  Command.mapMessage(command, fromHaptics)

const makeExit = (exit: () => void) =>
  Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      exit()
      return Message.CompletedExit()
    }),
  })

// UPDATE

type Return = Update.Return<Model, Message, Services>

const isLive = (model: Model): boolean =>
  model.phase._tag === 'Recording' || model.phase._tag === 'Paused'

const canStart = (model: Model): boolean =>
  model.phase._tag === 'Idle' || model.phase._tag === 'Failed'

export const clock = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const sizeText = (bytes: number): string =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : bytes >= 1000
      ? `${Math.round(bytes / 1000)} KB`
      : `${bytes} bytes`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const dateText = (ms: number): string => {
  const date = new Date(ms)
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getHours()}:${minutes}`
}

const said = (model: Model, lastEvent: string): Model =>
  modifyFields(model, { lastEvent: () => lastEvent })

/** The Model's phase for what the recorder reports. */
const phaseOf = (status: Recorder.RecorderStatus): Phase => {
  switch (status.phase) {
    case 'recording':
      return Phase.Recording({
        elapsedSeconds: status.elapsedSeconds,
        isNearLimit: status.isNearLimit,
      })
    case 'paused':
      return Phase.Paused({ elapsedSeconds: status.elapsedSeconds, by: 'you' })
    case 'interrupted':
      return Phase.Paused({ elapsedSeconds: status.elapsedSeconds, by: 'phone' })
    case 'idle':
      return Phase.Idle()
  }
}

const describePhaseChange = (before: Phase, after: Phase): string | undefined => {
  if (after._tag === 'Paused' && after.by === 'phone' && !(before._tag === 'Paused' && before.by === 'phone')) {
    return `The phone paused the recording at ${clock(after.elapsedSeconds)}`
  }
  if (after._tag === 'Recording' && before._tag === 'Paused' && before.by === 'phone') {
    return 'The phone carried on recording by itself'
  }
  if (after._tag === 'Recording' && after.isNearLimit && !(before._tag === 'Recording' && before.isNearLimit)) {
    return 'Nearly at the longest length'
  }
  return undefined
}

/** A finished recording goes into the list. */
const save = (model: Model, recording: Recorder.Recording, lastEvent: string): Return => ({
  model: modifyFields(model, { phase: () => Phase.Saving(), lastEvent: () => lastEvent }),
  commands: [
    notes(
      VoiceNotes.Add({
        uri: recording.uri,
        durationMs: recording.durationMs,
        sizeBytes: recording.sizeBytes,
      }),
    ),
    haptic(Haptics.Notify({ type: 'success' })),
    // UPLOAD GOES HERE. Once `ChangedNotes` with action `add` comes back, a
    // Command would send the new note's file to a server and the screen's
    // upload line would follow its Messages. This demo sends nothing.
  ],
})

const start = (model: Model, maxSeconds: number, warnSeconds: number): Return =>
  canStart(model)
    ? {
        model: modifyFields(model, {
          phase: () => Phase.AskingPermission(),
          maxSeconds: () => maxSeconds,
          warnSeconds: () => warnSeconds,
          maybeLoaded: () => Option.none(),
          lastEvent: () => 'Asking the phone for the microphone',
        }),
        // The player is let go first: one use of the phone's sound at a time.
        commands: [player(Player.Stop()), recorder(Recorder.RequestPermission())],
      }
    : { model }

const BLOCKED =
  'The microphone is blocked for this app. Open Settings, allow the microphone, and come back.'
const DENIED = 'The microphone was not allowed. Press Record to be asked again.'

const updateRecorder = (model: Model, message: Recorder.Message): Return =>
  Recorder.Message.match<Return>(message, {
    GotPermission: ({ permission, wasAsked }) => {
      const known = modifyFields(model, { permission: () => permission })
      if (model.phase._tag !== 'AskingPermission' || !wasAsked) return { model: known }
      if (permission === 'granted') {
        return {
          model: said(known, 'Microphone allowed. Starting.'),
          commands: [
            recorder(
              Recorder.Start({ maxSeconds: model.maxSeconds, warnSeconds: model.warnSeconds }),
            ),
          ],
        }
      }
      const reason = permission === 'blocked' ? BLOCKED : DENIED
      return {
        model: modifyFields(known, {
          phase: () => Phase.Failed({ reason }),
          lastEvent: () => `Microphone permission: ${permission}`,
        }),
      }
    },
    FailedPermission: ({ reason }) => ({
      model:
        model.phase._tag === 'AskingPermission'
          ? modifyFields(model, {
              phase: () => Phase.Failed({ reason }),
              lastEvent: () => `Could not ask for the microphone: ${reason}`,
            })
          : said(model, `Could not read the microphone permission: ${reason}`),
    }),
    OpenedSettings: () => ({ model: said(model, 'Opened Settings') }),
    FailedOpenSettings: ({ reason }) => ({
      model: said(model, `Could not open Settings: ${reason}`),
    }),
    StartedRecording: ({ background }) => ({
      model: modifyFields(model, {
        phase: () => Phase.Recording({ elapsedSeconds: 0, isNearLimit: false }),
        background: () => background,
        lastEvent: () => `Recording started. It stops by itself at ${clock(model.maxSeconds)}.`,
      }),
      commands: [haptic(Haptics.Impact({ style: 'medium' }))],
    }),
    FailedStartRecording: ({ reason }) => ({
      model: modifyFields(model, {
        phase: () => Phase.Failed({ reason }),
        lastEvent: () => `Could not start recording: ${reason}`,
      }),
    }),
    PausedRecording: () => ({
      model:
        model.phase._tag === 'Recording'
          ? modifyFields(model, {
              phase: () =>
                Phase.Paused({
                  elapsedSeconds:
                    model.phase._tag === 'Recording' ? model.phase.elapsedSeconds : 0,
                  by: 'you',
                }),
              lastEvent: () => 'Paused',
            })
          : said(model, 'Paused'),
    }),
    ResumedRecording: () => ({ model: said(model, 'Recording again') }),
    StoppedRecording: ({ recording }) =>
      save(model, recording, `Stopped at ${clock(recording.durationMs / 1000)}. Saving.`),
    CanceledRecording: () => ({
      model: modifyFields(model, {
        phase: () => Phase.Idle(),
        lastEvent: () => 'Discarded. No file was kept.',
      }),
    }),
    FailedRecorderAction: ({ action, reason }) => ({
      model:
        model.phase._tag === 'Saving'
          ? modifyFields(model, {
              phase: () => Phase.Failed({ reason }),
              lastEvent: () => `Could not ${action}: ${reason}`,
            })
          : said(model, `Could not ${action}: ${reason}`),
    }),
    GotRecorderSnapshot: ({ status, maybeUnsaved, route, background }) => {
      const known = modifyFields(model, {
        route: () => route,
        background: () => (status.phase === 'idle' ? model.background : background),
      })
      if (Option.isSome(maybeUnsaved)) {
        return save(
          known,
          maybeUnsaved.value,
          'A recording reached its longest length while this screen was closed. Saving.',
        )
      }
      if (status.phase !== 'idle') {
        // A recording is running: started on an earlier visit to this
        // screen, or carried on while the app was out of sight.
        const next = phaseOf(status)
        return {
          model: modifyFields(known, {
            phase: () => next,
            maxSeconds: () => status.maxSeconds,
            lastEvent: () =>
              isLive(model)
                ? (describePhaseChange(model.phase, next) ?? model.lastEvent)
                : `Found a recording still running at ${clock(status.elapsedSeconds)}`,
          }),
        }
      }
      return isLive(model)
        ? {
            model: modifyFields(known, {
              phase: () => Phase.Idle(),
              lastEvent: () => 'The recording is no longer running',
            }),
          }
        : { model: known }
    },
    ReleasedRecorder: () => ({ model }),
    ChangedRecorderStatus: ({ status }) => {
      if (!isLive(model) || status.phase === 'idle') return { model }
      const next = phaseOf(status)
      return {
        model: modifyFields(model, {
          phase: () => next,
          lastEvent: () => describePhaseChange(model.phase, next) ?? model.lastEvent,
        }),
      }
    },
    FinishedRecording: ({ recording }) =>
      save(
        model,
        recording,
        `Reached the longest length, ${clock(recording.durationMs / 1000)}. The phone stopped by itself. Saving.`,
      ),
    FailedRecording: ({ reason }) => ({
      model: modifyFields(model, {
        phase: () => Phase.Failed({ reason }),
        lastEvent: () => `The recording broke: ${reason}`,
      }),
    }),
  })

const noteOf = (model: Model, id: string) => model.notes.find(note => note.id === id)

const updatePlayer = (model: Model, message: Player.Message): Return =>
  Player.Message.match<Return>(message, {
    StartedPlayback: () => ({
      model: modifyFields(model, {
        maybeLoaded: () =>
          Option.map(model.maybeLoaded, loaded => ({ ...loaded, isPlaying: true })),
        lastEvent: () => `Playing at ${model.rate}x`,
      }),
    }),
    PausedPlayback: () => ({
      model: modifyFields(model, {
        maybeLoaded: () =>
          Option.map(model.maybeLoaded, loaded => ({ ...loaded, isPlaying: false })),
        lastEvent: () => 'Playback paused',
      }),
    }),
    SoughtPlayback: ({ positionMs }) => ({
      model: modifyFields(model, {
        maybeLoaded: () => Option.map(model.maybeLoaded, loaded => ({ ...loaded, positionMs })),
        lastEvent: () => `Moved to ${clock(positionMs / 1000)}`,
      }),
    }),
    ChangedPlaybackRate: ({ rate }) => ({ model: said(model, `Speed ${rate}x`) }),
    StoppedPlayback: () => ({ model }),
    FailedPlayback: ({ action, reason }) => ({
      model: modifyFields(model, {
        maybeLoaded: () => (action === 'play' ? Option.none() : model.maybeLoaded),
        lastEvent: () => `Could not ${action}: ${reason}`,
      }),
    }),
    ChangedPlayback: ({ playback }) => ({
      model: modifyFields(model, {
        maybeLoaded: () =>
          Option.map(model.maybeLoaded, loaded =>
            noteOf(model, loaded.noteId)?.uri === playback.uri
              ? {
                  ...loaded,
                  positionMs: playback.positionMs,
                  // The phone knows the true length once it has read the file.
                  durationMs: playback.durationMs > 0 ? playback.durationMs : loaded.durationMs,
                  isPlaying: playback.isPlaying,
                }
              : loaded,
          ),
      }),
    }),
    FinishedPlayback: () => ({
      model: modifyFields(model, {
        maybeLoaded: () =>
          Option.map(model.maybeLoaded, loaded => ({
            ...loaded,
            positionMs: 0,
            isPlaying: false,
          })),
        lastEvent: () => 'Played to the end',
      }),
    }),
  })

const updateNotes = (model: Model, message: VoiceNotes.Message): Return =>
  VoiceNotes.Message.match<Return>(message, {
    ChangedNotes: ({ action, notes: list }) => {
      const wasSaving = model.phase._tag === 'Saving' && action === 'add'
      const newest = list[0]
      return {
        model: modifyFields(model, {
          notes: () => list,
          phase: () => (wasSaving ? Phase.Idle() : model.phase),
          maybeEditing: () => (action === 'rename' ? Option.none() : model.maybeEditing),
          lastEvent: () =>
            action === 'add' && newest !== undefined
              ? `Saved "${newest.name}", ${clock(newest.durationMs / 1000)}, ${sizeText(newest.sizeBytes)}`
              : action === 'rename'
                ? 'Renamed'
                : action === 'remove'
                  ? 'Deleted the note and its file'
                  : model.lastEvent,
        }),
      }
    },
    FailedNotes: ({ action, reason }) => ({
      model: modifyFields(model, {
        phase: () =>
          model.phase._tag === 'Saving' && action === 'add'
            ? Phase.Failed({ reason: `The recording could not be saved: ${reason}` })
            : model.phase,
        lastEvent: () => `Notes, could not ${action}: ${reason}`,
      }),
    }),
  })

export const makeUpdate = (exit: () => void) => {
  const Exit = makeExit(exit)
  return (model: Model, message: Message): Return =>
    Message.match<Return>(message, {
      PressedRecord: () => start(model, MAX_SECONDS, WARN_SECONDS),
      PressedRecordFiveSeconds: () => start(model, TEST_SECONDS, TEST_WARN_SECONDS),
      PressedPause: () =>
        model.phase._tag === 'Recording'
          ? { model, commands: [recorder(Recorder.Pause())] }
          : { model },
      PressedResume: () =>
        model.phase._tag === 'Paused'
          ? { model, commands: [recorder(Recorder.Resume())] }
          : { model },
      PressedStop: () =>
        isLive(model)
          ? {
              model: modifyFields(model, {
                phase: () => Phase.Saving(),
                lastEvent: () => 'Stopping',
              }),
              commands: [recorder(Recorder.Stop())],
            }
          : { model },
      PressedDiscard: () =>
        isLive(model) ? { model, commands: [recorder(Recorder.Cancel())] } : { model },
      PressedOpenSettings: () => ({ model, commands: [recorder(Recorder.OpenSettings())] }),

      PressedPlay: ({ id }) => {
        const note = noteOf(model, id)
        if (note === undefined || !canStart(model)) return { model }
        const isSame = Option.match(model.maybeLoaded, {
          onNone: () => false,
          onSome: loaded => loaded.noteId === id,
        })
        return {
          model: isSame
            ? model
            : modifyFields(model, {
                maybeLoaded: () =>
                  Option.some({
                    noteId: id,
                    positionMs: 0,
                    durationMs: note.durationMs,
                    isPlaying: false,
                  }),
              }),
          commands: [player(Player.Play({ uri: note.uri, rate: model.rate }))],
        }
      },
      PressedPausePlayback: () => ({ model, commands: [player(Player.Pause())] }),
      PressedSeek: ({ positionMs }) =>
        Option.isSome(model.maybeLoaded)
          ? { model, commands: [player(Player.Seek({ positionMs }))] }
          : { model },
      PressedRate: ({ rate }) => ({
        model: modifyFields(model, { rate: () => rate }),
        commands: Option.isSome(model.maybeLoaded) ? [player(Player.SetRate({ rate }))] : [],
      }),

      PressedRename: ({ id }) => ({
        model: modifyFields(model, {
          maybeEditing: () =>
            Option.some({ id, draft: noteOf(model, id)?.name ?? '' }),
        }),
      }),
      ChangedNameDraft: ({ text: draft }) => ({
        model: modifyFields(model, {
          maybeEditing: () => Option.map(model.maybeEditing, editing => ({ ...editing, draft })),
        }),
      }),
      PressedSaveName: () =>
        Option.match(model.maybeEditing, {
          onNone: (): Return => ({ model }),
          onSome: ({ id, draft }): Return => ({
            model,
            commands: [notes(VoiceNotes.Rename({ id, name: draft }))],
          }),
        }),
      PressedCancelRename: () => ({
        model: modifyFields(model, { maybeEditing: () => Option.none() }),
      }),
      PressedDelete: ({ id }) => {
        const isLoaded = Option.match(model.maybeLoaded, {
          onNone: () => false,
          onSome: loaded => loaded.noteId === id,
        })
        return {
          model: modifyFields(model, {
            maybeLoaded: () => (isLoaded ? Option.none() : model.maybeLoaded),
            maybeEditing: () => Option.none(),
          }),
          commands: [
            ...(isLoaded ? [player(Player.Stop())] : []),
            notes(VoiceNotes.Remove({ id })),
          ],
        }
      },

      // Leaving frees the player. A live recording is left running on
      // purpose: the recorder belongs to the app, not to this screen.
      PressedExit: () => ({
        model: modifyFields(model, { maybeLoaded: () => Option.none() }),
        commands: [player(Player.Stop()), recorder(Recorder.Release()), Exit()],
      }),
      CompletedExit: () => ({ model }),

      GotRecorderMessage: ({ message: inner }) => updateRecorder(model, inner),
      GotPlayerMessage: ({ message: inner }) => updatePlayer(model, inner),
      GotNotesMessage: ({ message: inner }) => updateNotes(model, inner),
      GotHapticsMessage: () => ({ model }),
      GotAppStateMessage: ({ message: inner }) =>
        // JavaScript may have been asleep while the app was out of sight,
        // and the person may have been in Settings. The recorder is asked
        // what is true now, and the permission is read again.
        inner.status === 'active'
          ? {
              model,
              commands: [
                recorder(Recorder.TakeSnapshot()),
                recorder(Recorder.CheckPermission()),
              ],
            }
          : { model },
      GotColorSchemeMessage: ({ message: inner }) => ({
        model: modifyFields(model, { maybeScheme: () => Option.some(inner.scheme) }),
      }),
    })
}

// INIT

export const init = (): Return => ({
  model: {
    phase: Phase.Idle(),
    permission: 'unknown',
    route: 'asking',
    background: 'not asked yet',
    maxSeconds: MAX_SECONDS,
    warnSeconds: WARN_SECONDS,
    notes: [],
    maybeLoaded: Option.none(),
    rate: 1,
    maybeEditing: Option.none(),
    lastEvent: 'Nothing yet',
    uploadLine: UPLOAD_LINE,
    maybeScheme: Option.none(),
  },
  commands: [
    recorder(Recorder.TakeSnapshot()),
    recorder(Recorder.CheckPermission()),
    notes(VoiceNotes.List()),
  ],
})

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message, Services>()(entry => ({
  // Listens only while a recording is live. About one Message a second.
  recorder: entry(
    { isLive: Schema.Boolean },
    {
      modelToDependencies: model => ({ isLive: isLive(model) }),
      dependenciesToStream: dependencies =>
        dependencies.isLive ? Stream.map(Recorder.status, fromRecorder) : Stream.empty,
    },
  ),
  // Listens only while a note is loaded in the player.
  player: entry(
    { isLoaded: Schema.Boolean },
    {
      modelToDependencies: model => ({ isLoaded: Option.isSome(model.maybeLoaded) }),
      dependenciesToStream: dependencies =>
        dependencies.isLoaded ? Stream.map(Player.positions, fromPlayer) : Stream.empty,
    },
  ),
  appState: AppState.changesEntry(message => Message.GotAppStateMessage({ message })),
  colorScheme: ColorScheme.changesEntry(message =>
    Message.GotColorSchemeMessage({ message }),
  ),
}))

// VIEW

type Palette = Readonly<{
  paper: string
  card: string
  ink: string
  muted: string
  line: string
  accent: string
  record: string
  onAccent: string
}>

const LIGHT: Palette = {
  paper: '#f4f4f2',
  card: '#ffffff',
  ink: '#111111',
  muted: '#5f5f5f',
  line: '#dcdcd8',
  accent: '#0a66d8',
  record: '#c62828',
  onAccent: '#ffffff',
}

const DARK: Palette = {
  paper: '#0f0f10',
  card: '#1c1c1e',
  ink: '#f2f2f2',
  muted: '#a3a3a3',
  line: '#333336',
  accent: '#4d9bff',
  record: '#ff6b60',
  onAccent: '#0f0f10',
}

const paletteOf = (model: Model): Palette =>
  Option.match(model.maybeScheme, {
    onNone: () => LIGHT,
    onSome: scheme => (scheme === 'dark' ? DARK : LIGHT),
  })

/**
 * The meter. `live` adds a bar ten times a second from the level box.
 * `held` keeps the bars as they were (paused). `flat` clears them.
 */
type MeterProps = Readonly<{ mode: 'live' | 'held' | 'flat'; color: string; quiet: string }>

const BARS = 36
const SAMPLE_MS = 100

export const makeMeterScene = (meter: Recorder.Meter): Scene<MeterProps> => ({
  start: (surface, first) => {
    let props = first
    let isLooping = false
    let isStopped = false
    let lastSampleAt = 0
    const bars: Array<number> = Array.from({ length: BARS }, () => 0)

    const paint = (): void =>
      surface.draw((pen, size) => {
        if (size.width <= 0 || size.height <= 0) return
        const step = size.width / BARS
        bars.forEach((level, index) => {
          const height = Math.max(2, level * size.height)
          pen.rect(index * step + 1, (size.height - height) / 2, Math.max(1, step - 2), height, {
            color: props.mode === 'live' ? props.color : props.quiet,
          })
        })
      })

    const loop = (): void => {
      if (isStopped || props.mode !== 'live') {
        isLooping = false
        return
      }
      surface.frame(now => {
        if (now - lastSampleAt >= SAMPLE_MS) {
          lastSampleAt = now
          bars.shift()
          bars.push(meter.read())
          paint()
        }
        loop()
      })
    }

    const follow = (): void => {
      if (props.mode === 'flat') bars.fill(0)
      paint()
      if (props.mode === 'live' && !isLooping) {
        isLooping = true
        loop()
      }
    }

    follow()
    return {
      update: next => {
        const isSame =
          next.mode === props.mode && next.color === props.color && next.quiet === props.quiet
        props = next
        if (!isSame) follow()
      },
      resize: paint,
      stop: () => {
        isStopped = true
      },
    }
  },
})

const meterScene = makeMeterScene(Recorder.levelMeter)

const button = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  id: string,
  label: string,
  message: Message,
  kind: 'accent' | 'record' | 'quiet' = 'accent',
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor:
          kind === 'quiet' ? palette.line : kind === 'record' ? palette.record : palette.accent,
        backgroundColor:
          kind === 'quiet' ? palette.card : kind === 'record' ? palette.record : palette.accent,
        alignItems: 'center',
      }),
    ],
    [
      text(
        [
          style({
            color: kind === 'quiet' ? palette.ink : palette.onAccent,
            fontSize: 16,
            fontWeight: '600',
          }),
        ],
        [label],
      ),
    ],
  )

const row = (children: ReadonlyArray<Html>): Html =>
  box([style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' })], children)

const section = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  heading: string,
  hint: string,
  children: ReadonlyArray<Html>,
): Html =>
  box(
    [h.Key(heading), style({ backgroundColor: palette.card, borderRadius: 14, padding: 14, gap: 10 })],
    [
      text([style({ color: palette.ink, fontSize: 18, fontWeight: '700' })], [heading]),
      text([style({ color: palette.muted, fontSize: 14 })], [hint]),
      ...children,
    ],
  )

const line = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  id: string,
  label: string,
  value: string,
): Html =>
  box(
    [style({ flexDirection: 'row', justifyContent: 'space-between', gap: 12 })],
    [
      text([style({ color: palette.muted, fontSize: 15 })], [label]),
      text(
        [
          h.Attribute('testID', id),
          style({ color: palette.ink, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' }),
        ],
        [value],
      ),
    ],
  )

const phaseText = (phase: Phase): string =>
  Phase.match(phase, {
    Idle: () => 'Idle',
    AskingPermission: () => 'Asking for the microphone',
    Recording: () => 'Recording',
    Paused: ({ by }) => (by === 'you' ? 'Paused by you' : 'Paused by the phone'),
    Saving: () => 'Saving',
    Failed: ({ reason }) => `Failed: ${reason}`,
  })

const elapsedOf = (phase: Phase): number =>
  phase._tag === 'Recording' || phase._tag === 'Paused' ? phase.elapsedSeconds : 0

const limitText = (model: Model): string => {
  if (model.phase._tag === 'Recording' && model.phase.isNearLimit) {
    const left = Math.max(0, model.maxSeconds - model.phase.elapsedSeconds)
    return `Nearly at the longest length. ${clock(left)} left, then it stops and saves by itself.`
  }
  return `Stops and saves by itself at ${clock(model.maxSeconds)}.`
}

const permissionText = (permission: Model['permission']): string => {
  switch (permission) {
    case 'unknown':
      return 'waiting for the phone'
    case 'granted':
      return 'allowed'
    case 'denied':
      return 'not allowed, can be asked again'
    case 'blocked':
      return 'blocked, only Settings can change it'
    case 'undetermined':
      return 'not asked yet'
  }
}

const backgroundText = (background: string): string =>
  background === 'requested'
    ? 'asked the phone to keep recording out of sight'
    : background === 'off'
      ? 'off: the phone pauses the recording out of sight'
      : 'decided when a recording starts'

const SEGMENTS = 12

/** A row of blocks. The filled ones are what has played. Press one to jump there. */
const scrubber = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  positionMs: number,
  durationMs: number,
): Html =>
  box(
    [h.Attribute('testID', 'scrubber'), style({ flexDirection: 'row', gap: 3, height: 28 })],
    Array.from({ length: SEGMENTS }, (_, index) => {
      const startsAt = Math.round((durationMs * index) / SEGMENTS)
      const isPlayed = durationMs > 0 && positionMs > startsAt
      return box(
        [
          h.Key(`seek-${index}`),
          h.Attribute('testID', `seek-${index}`),
          h.OnClick(Message.PressedSeek({ positionMs: startsAt })),
          style({
            flex: 1,
            borderRadius: 4,
            backgroundColor: isPlayed ? palette.accent : palette.line,
          }),
        ],
        [],
      )
    }),
  )

const RATES: ReadonlyArray<Readonly<{ rate: number; id: string }>> = [
  { rate: 1, id: 'rate-1x' },
  { rate: 1.5, id: 'rate-1-5x' },
  { rate: 2, id: 'rate-2x' },
]

const noteCard = (
  h: HtmlBuilder<Message>,
  palette: Palette,
  model: Model,
  note: VoiceNotes.Note,
  index: number,
): Html => {
  const loaded = Option.getOrUndefined(model.maybeLoaded)
  const isLoaded = loaded?.noteId === note.id
  const editing = Option.getOrUndefined(model.maybeEditing)
  const isEditing = editing?.id === note.id
  const canPlay = canStart(model)
  return box(
    [
      h.Key(note.id),
      h.Attribute('testID', `note-${index}`),
      style({ borderTopWidth: 1, borderColor: palette.line, paddingTop: 10, gap: 8 }),
    ],
    [
      text(
        [
          h.Attribute('testID', `note-${index}-name`),
          style({ color: palette.ink, fontSize: 16, fontWeight: '600' }),
        ],
        [note.name],
      ),
      text(
        [h.Attribute('testID', `note-${index}-details`), style({ color: palette.muted, fontSize: 14 })],
        [
          `${clock(note.durationMs / 1000)}, ${sizeText(note.sizeBytes)}, ${dateText(note.createdAt)}`,
        ],
      ),
      row([
        isLoaded && loaded.isPlaying
          ? button(h, palette, `note-${index}-pause`, 'Pause', Message.PressedPausePlayback())
          : canPlay
            ? button(h, palette, `note-${index}-play`, 'Play', Message.PressedPlay({ id: note.id }))
            : text([style({ color: palette.muted, fontSize: 14 })], ['Stop recording to play']),
        button(h, palette, `note-${index}-rename`, 'Rename', Message.PressedRename({ id: note.id }), 'quiet'),
        button(h, palette, `note-${index}-delete`, 'Delete', Message.PressedDelete({ id: note.id }), 'quiet'),
      ]),
      ...(isLoaded
        ? [
            scrubber(h, palette, loaded.positionMs, loaded.durationMs),
            text(
              [h.Attribute('testID', 'playback-position'), style({ color: palette.muted, fontSize: 14 })],
              [`${clock(loaded.positionMs / 1000)} of ${clock(loaded.durationMs / 1000)}`],
            ),
          ]
        : []),
      ...(isEditing
        ? [
            textInput(
              [
                h.Attribute('testID', 'name-field'),
                h.Attribute('value', editing.draft),
                h.Placeholder('Name of the note'),
                prop('editable', true),
                h.OnInput(draft => Message.ChangedNameDraft({ text: draft })),
                style({
                  height: 44,
                  fontSize: 17,
                  color: palette.ink,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: palette.line,
                  borderRadius: 10,
                }),
              ],
              [],
            ),
            row([
              button(h, palette, 'name-save', 'Save name', Message.PressedSaveName()),
              button(h, palette, 'name-cancel', 'Cancel', Message.PressedCancelRename(), 'quiet'),
            ]),
          ]
        : []),
    ],
  )
}

export const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const palette = paletteOf(model)
    const live = isLive(model)
    const isRecording = model.phase._tag === 'Recording'
    return stack(
      [h.Attribute('testID', 'stack')],
      [
        screen(
          [h.Key('voice'), h.Attribute('testID', 'screen-voice')],
          [
            header([title('Voice notes')], []),
            safeArea(device, { hasHeader: true }, [
              scrollView(
                [h.Attribute('testID', 'scroll'), style({ flex: 1, backgroundColor: palette.paper })],
                [
                  box(
                    [style({ padding: 16, gap: 14 })],
                    [
                      section(
                        h,
                        palette,
                        'Status',
                        'How this build reaches the microphone, and what the phone allows.',
                        [
                          line(h, palette, 'voice-route', 'Route', model.route),
                          line(
                            h,
                            palette,
                            'voice-permission',
                            'Microphone',
                            permissionText(model.permission),
                          ),
                          line(
                            h,
                            palette,
                            'voice-background',
                            'Out of sight',
                            backgroundText(model.background),
                          ),
                          line(
                            h,
                            palette,
                            'voice-meter-renderer',
                            'Meter drawn with',
                            rendererFor('auto') === 'skia' ? 'Skia' : 'plain views (no Skia here)',
                          ),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Record',
                        'Press the round button and talk. The bars move with your voice. Press it again to stop and save.',
                        [
                          box(
                            [style({ alignItems: 'center', gap: 10 })],
                            [
                              box(
                                [
                                  h.Attribute('testID', 'record'),
                                  h.OnClick(live ? Message.PressedStop() : Message.PressedRecord()),
                                  style({
                                    width: 132,
                                    height: 132,
                                    borderRadius: 66,
                                    borderWidth: 4,
                                    borderColor: palette.record,
                                    backgroundColor: live ? palette.card : palette.record,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }),
                                ],
                                [
                                  text(
                                    [
                                      h.Attribute('testID', 'elapsed'),
                                      style({
                                        color: live ? palette.record : palette.onAccent,
                                        fontSize: 30,
                                        fontWeight: '700',
                                      }),
                                    ],
                                    [live ? clock(elapsedOf(model.phase)) : 'Record'],
                                  ),
                                  text(
                                    [
                                      style({
                                        color: live ? palette.muted : palette.onAccent,
                                        fontSize: 13,
                                      }),
                                    ],
                                    [live ? 'press to stop' : 'press to start'],
                                  ),
                                ],
                              ),
                              text(
                                [
                                  h.Attribute('testID', 'phase'),
                                  style({ color: palette.ink, fontSize: 16, fontWeight: '600', textAlign: 'center' }),
                                ],
                                [phaseText(model.phase)],
                              ),
                            ],
                          ),
                          canvas(
                            h,
                            {
                              id: 'meter',
                              scene: meterScene,
                              props: {
                                mode: isRecording ? 'live' : live ? 'held' : 'flat',
                                color: palette.record,
                                quiet: palette.line,
                              } satisfies MeterProps,
                              background: palette.paper,
                            },
                            [style({ height: 56, borderRadius: 8 })],
                          ),
                          text(
                            [h.Attribute('testID', 'limit'), style({ color: palette.muted, fontSize: 14 })],
                            [limitText(model)],
                          ),
                          ...(live
                            ? [
                                row([
                                  model.phase._tag === 'Paused'
                                    ? button(h, palette, 'resume', 'Resume', Message.PressedResume())
                                    : button(h, palette, 'pause', 'Pause', Message.PressedPause()),
                                  button(h, palette, 'stop', 'Stop and save', Message.PressedStop(), 'record'),
                                  button(h, palette, 'discard', 'Discard', Message.PressedDiscard(), 'quiet'),
                                ]),
                              ]
                            : []),
                          ...(canStart(model)
                            ? [
                                row([
                                  button(
                                    h,
                                    palette,
                                    'record-five',
                                    'Record 5 seconds and stop',
                                    Message.PressedRecordFiveSeconds(),
                                    'quiet',
                                  ),
                                ]),
                              ]
                            : []),
                          ...(model.permission === 'blocked'
                            ? [
                                row([
                                  button(
                                    h,
                                    palette,
                                    'open-settings',
                                    'Open Settings',
                                    Message.PressedOpenSettings(),
                                  ),
                                ]),
                              ]
                            : []),
                        ],
                      ),
                      section(
                        h,
                        palette,
                        'Saved notes',
                        'Kept on this phone. They are still here after you close the app.',
                        [
                          row([
                            text([style({ color: palette.muted, fontSize: 15 })], ['Speed']),
                            ...RATES.map(({ rate, id }) =>
                              button(
                                h,
                                palette,
                                id,
                                `${rate}x`,
                                Message.PressedRate({ rate }),
                                model.rate === rate ? 'accent' : 'quiet',
                              ),
                            ),
                          ]),
                          text(
                            [h.Attribute('testID', 'notes-count'), style({ color: palette.muted, fontSize: 14 })],
                            [
                              model.notes.length === 0
                                ? 'No notes yet'
                                : model.notes.length === 1
                                  ? '1 note'
                                  : `${model.notes.length} notes`,
                            ],
                          ),
                          ...model.notes.map((note, index) => noteCard(h, palette, model, note, index)),
                        ],
                      ),
                      section(h, palette, 'What just happened', 'The newest thing the phone told the program.', [
                        line(h, palette, 'last-event', 'Last event', model.lastEvent),
                        text(
                          [h.Attribute('testID', 'upload-line'), style({ color: palette.muted, fontSize: 15 })],
                          [model.uploadLine],
                        ),
                      ]),
                      row([button(h, palette, 'exit', 'Exit', Message.PressedExit(), 'quiet')]),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )
  }

/**
 * `resources` is the Layer with every phone service: `Phone.live({...})` in
 * an app, `Phone.makeTest().layer` in a test.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Services>,
) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env.exit),
    view: makeView(env.device),
    subscriptions,
    resources,
    container,
  })
