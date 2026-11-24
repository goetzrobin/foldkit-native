/**
 * The voice recorder: the microphone, as Foldkit Commands and one
 * Subscription.
 *
 *   // app entry: nothing to import. Expo's audio module is found by name.
 *   const resources = Phone.live({ ..., audio: Phone.Native.audioModuleFromGlobal() })
 *
 *   // update
 *   PressedRecord: () => ({ model, commands: [lift(Recorder.RequestPermission())] })
 *   GotPermission 'granted': commands: [lift(Recorder.Start({ maxSeconds: 900, warnSeconds: 60 }))]
 *   PressedStop:   commands: [lift(Recorder.Stop())]   // answers StoppedRecording({ recording })
 *
 *   // subscriptions, only while a recording is live
 *   Recorder.status   a Stream of ChangedRecorderStatus / FinishedRecording / FailedRecording
 *
 * How it works, in plain words:
 *
 * - The phone does the recording. This file only tells it to start, pause
 *   and stop, and asks it ten times a second how it is getting on.
 * - Most of those answers go nowhere. A Message is sent only when something
 *   a person can read has changed: the whole second on the timer, recording
 *   or paused, or "nearly at the limit". That is about one Message a second.
 * - How loud the room is changes all the time, so it is not put in a Message
 *   at all. It is written to `levelMeter`, a plain box that the meter on
 *   screen reads when it draws.
 * - The recorder lives in the app, not in a screen. A program that starts
 *   later asks `Recorder.Snapshot()` and finds the recording still running.
 * - If the phone pauses the recording by itself (a call, the app going out of
 *   sight), the next answer says "not recording, but still ready". That is
 *   reported as paused `by: 'phone'`. If the phone carries on by itself, the
 *   answer after that says so too.
 * - The longest recording is given to the phone itself (`forDuration`), so
 *   it holds even if JavaScript is asleep. When the phone stops at the limit,
 *   the note is reported with `FinishedRecording`.
 *
 * See docs/VOICE_NOTES.md for what was read in expo-audio's source and what
 * only a real phone can show.
 */
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import {
  type AudioModule,
  type AudioSession,
  type FakeAudio,
  type NativeRecorder,
  type NativeRecordingStatus,
  makeAudioSession,
  makeFakeAudio,
  makeMemoryFiles,
  recordingOptions,
} from './audioNative.js'
import {
  DeviceError,
  type NativeSubscription,
  type Source,
  attempt,
  reasonOf,
  streamOf,
} from './common.js'

// ---------------------------------------------------------------- types

/**
 * What the phone says about the microphone.
 * `undetermined`: never asked. `denied`: said no, may be asked again.
 * `blocked`: said no and the phone will not ask again, so only Settings helps.
 */
export const Permission = Schema.Literals(['granted', 'denied', 'blocked', 'undetermined'])
export type Permission = typeof Permission.Type

/** `paused` is by the person. `interrupted` is by the phone. */
export const RecorderPhase = Schema.Literals(['idle', 'recording', 'paused', 'interrupted'])
export type RecorderPhase = typeof RecorderPhase.Type

/** A finished recording: a file the phone has closed. */
export const Recording = Schema.Struct({
  uri: Schema.String,
  durationMs: Schema.Number,
  sizeBytes: Schema.Number,
  /** `stop`: the person stopped it. `limit`: it reached the longest length. */
  endedBy: Schema.Literals(['stop', 'limit']),
})
export type Recording = typeof Recording.Type

/** The readable part of a live recording. */
export const RecorderStatus = Schema.Struct({
  phase: RecorderPhase,
  elapsedSeconds: Schema.Number,
  /** True from `warnSeconds` before the longest length. */
  isNearLimit: Schema.Boolean,
  maxSeconds: Schema.Number,
})
export type RecorderStatus = typeof RecorderStatus.Type

/** Whether recording carries on when the app is not in front. */
export const Background = Schema.Literals(['requested', 'off'])
export type Background = typeof Background.Type

export type RecorderEvent =
  | Readonly<{ _tag: 'Status'; status: RecorderStatus }>
  | Readonly<{ _tag: 'Finished'; recording: Recording }>
  | Readonly<{ _tag: 'Failed'; reason: string }>

export type StartOptions = Readonly<{
  /** The longest recording, in seconds. The phone stops by itself then. */
  maxSeconds: number
  /** How long before the end `isNearLimit` turns true. */
  warnSeconds: number
}>

export type Snapshot = Readonly<{
  status: RecorderStatus
  /** A recording that ended at its limit while no program was listening. Handed out once. */
  unsaved: Recording | undefined
  route: string
  background: Background
}>

/** A plain box holding how loud the microphone hears the room, 0 to 1. */
export type Meter = Readonly<{
  read: () => number
  write: (level: number) => void
}>

export const makeMeter = (): Meter => {
  let level = 0
  return {
    read: () => level,
    write: next => {
      level = next
    },
  }
}

/**
 * The meter the recorder writes to unless given another. A phone has one
 * microphone, so one box for the whole app is enough. A view reads it when
 * it draws. It is never in a Model.
 */
export const levelMeter: Meter = makeMeter()

/** Decibels (-160 silence, 0 loudest) to 0..1, with the quiet 100 dB cut off. */
export const levelOf = (decibels: number | null | undefined): number => {
  if (typeof decibels !== 'number' || Number.isNaN(decibels)) return 0
  return Math.max(0, Math.min(1, (decibels + 60) / 60))
}

export type RecorderService = Readonly<{
  /** How the microphone is reached in this build, for a status line. */
  route: string
  permission: Effect.Effect<Permission, DeviceError>
  /** Shows the phone's question if it may still be asked. */
  requestPermission: Effect.Effect<Permission, DeviceError>
  /** Opens this app's page in the phone's Settings. */
  openSettings: Effect.Effect<void, DeviceError>
  start: (options: StartOptions) => Effect.Effect<Background, DeviceError>
  pause: Effect.Effect<void, DeviceError>
  /** Carries on after a pause, the person's or the phone's. */
  resume: Effect.Effect<void, DeviceError>
  stop: Effect.Effect<Recording, DeviceError>
  /** Stops and deletes the file. */
  cancel: Effect.Effect<void, DeviceError>
  snapshot: Effect.Effect<Snapshot>
  /** Frees the native recorder if nothing is being recorded. Safe at any time. */
  release: Effect.Effect<void>
  events: Source<RecorderEvent>
}>

export class Recorder extends Context.Service<Recorder, RecorderService>()(
  'foldkit-native/Recorder',
) {}

// ---------------------------------------------------------------- live

export type Timers = Readonly<{
  setInterval: (run: () => void, everyMs: number) => unknown
  clearInterval: (id: unknown) => void
}>

export type RecorderOptions = Readonly<{
  /** `Platform.OS`. */
  platform: string
  /** Shared with the player. Made here when left out. */
  session?: AudioSession
  /** Deletes a file by address, for `cancel`. Without it a cancelled file stays in the cache. */
  removeFile?: (uri: string) => void
  /** Bytes of a file by address, used when the recorder does not say. */
  fileSize?: (uri: string) => number
  /** `() => Linking.openSettings()` from react-native. */
  openSettings?: () => Promise<unknown> | unknown
  /**
   * Ask the phone to keep recording when the app is not in front. If the
   * build refuses (no background service), recording starts without it.
   * Default true.
   */
  backgroundRecording?: boolean
  /** How often the phone is asked for its status. Default 100 ms. */
  pollMs?: number
  meter?: Meter
  timers?: Timers
  route?: string
}>

const CAPABILITY = 'recorder'
const IDLE: RecorderStatus = { phase: 'idle', elapsedSeconds: 0, isNearLimit: false, maxSeconds: 0 }

/** Past the limit by this much with the phone still recording: stop it from here. */
const LIMIT_GRACE_MS = 1500

const permissionOf = (
  answer: Readonly<{ status?: string; granted: boolean; canAskAgain?: boolean }>,
): Permission => {
  if (answer.granted) return 'granted'
  if (answer.status === 'undetermined') return 'undetermined'
  return answer.canAskAgain === false ? 'blocked' : 'denied'
}

type Session = {
  recorder: NativeRecorder
  subscription: NativeSubscription
  uri: string
  maxMs: number
  warnMs: number
  lastDurationMs: number
  phase: Exclude<RecorderPhase, 'idle'>
  pausedByUser: boolean
  /** Set while this file is ending the recording itself, so the phone's "finished" event is not read as the limit. */
  isEnding: boolean
  timer: unknown
}

const defaultTimers: Timers = {
  setInterval: (run, everyMs) => setInterval(run, everyMs),
  clearInterval: id => clearInterval(id as ReturnType<typeof setInterval>),
}

/**
 * The recorder over Expo's audio module. The object returned holds the live
 * recording, so make it once for the app and give the same one to every
 * program: that is what lets a recording outlive a screen.
 */
export const make = (audio: AudioModule, options: RecorderOptions): RecorderService => {
  const timers = options.timers ?? defaultTimers
  const meter = options.meter ?? levelMeter
  const pollMs = options.pollMs ?? 100
  const audioSession = options.session ?? makeAudioSession(audio, options.platform)
  const listeners = new Set<(event: RecorderEvent) => void>()

  let session: Session | undefined
  let lastStatus: RecorderStatus = IDLE
  let unsaved: Recording | undefined
  let background: Background = 'off'

  const statusOf = (live: Session): RecorderStatus => ({
    phase: live.phase,
    elapsedSeconds: Math.floor(live.lastDurationMs / 1000),
    isNearLimit: live.lastDurationMs >= live.maxMs - live.warnMs,
    maxSeconds: Math.round(live.maxMs / 1000),
  })

  const send = (event: RecorderEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }

  const sendStatusIfChanged = (): void => {
    const next = session === undefined ? IDLE : statusOf(session)
    const isSame =
      next.phase === lastStatus.phase &&
      next.elapsedSeconds === lastStatus.elapsedSeconds &&
      next.isNearLimit === lastStatus.isNearLimit
    lastStatus = next
    if (!isSame) send({ _tag: 'Status', status: next })
  }

  /** Lets go of the native recorder and everything attached to it. */
  const letGo = (live: Session): void => {
    timers.clearInterval(live.timer)
    try {
      live.subscription.remove()
    } catch {
      // The listener is gone either way.
    }
    try {
      live.recorder.release?.()
    } catch {
      // Already released.
    }
    if (session === live) session = undefined
    audioSession.setRecording(false)
    meter.write(0)
    lastStatus = IDLE
    // The speaker gets the session back. Nothing waits for this.
    void audioSession.forPlayback().catch(() => {})
  }

  const sizeOf = (live: Session): number => {
    let size = 0
    try {
      size = live.recorder.getStatus().fileSize ?? 0
    } catch {
      size = 0
    }
    return size > 0 ? size : (options.fileSize?.(live.uri) ?? 0)
  }

  /** The phone ended the recording by itself: it reached its longest length. */
  const finishAtLimit = (live: Session): void => {
    if (live.isEnding || session !== live) return
    live.isEnding = true
    const recording: Recording = {
      uri: live.uri,
      // After the phone stops, it reports a length of 0. The limit is the length.
      durationMs: live.maxMs,
      sizeBytes: sizeOf(live),
      endedBy: 'limit',
    }
    letGo(live)
    if (listeners.size === 0) unsaved = recording
    send({ _tag: 'Finished', recording })
  }

  const fail = (live: Session, reason: string): void => {
    if (live.isEnding || session !== live) return
    live.isEnding = true
    letGo(live)
    send({ _tag: 'Failed', reason })
  }

  const poll = (live: Session): void => {
    if (session !== live || live.isEnding) return
    let state
    try {
      state = live.recorder.getStatus()
    } catch (error) {
      fail(live, reasonOf(error))
      return
    }
    if (state.mediaServicesDidReset === true) {
      fail(live, 'The phone reset its audio service. The recording was lost.')
      return
    }
    if (state.isRecording) {
      live.phase = 'recording'
      live.pausedByUser = false
      live.lastDurationMs = Math.max(live.lastDurationMs, state.durationMillis)
      meter.write(levelOf(state.metering))
    } else if (!state.canRecord) {
      // Not recording and not ready either: the phone has closed the file.
      finishAtLimit(live)
      return
    } else {
      live.phase = live.pausedByUser ? 'paused' : 'interrupted'
      live.lastDurationMs = Math.max(live.lastDurationMs, state.durationMillis)
      meter.write(0)
    }
    if (live.lastDurationMs >= live.maxMs + LIMIT_GRACE_MS) {
      // The phone should have stopped by now. Stop it from here.
      live.isEnding = true
      void live.recorder
        .stop()
        .catch(() => {})
        .then(() => {
          live.isEnding = false
          finishAtLimit(live)
        })
      return
    }
    sendStatusIfChanged()
  }

  const onNativeStatus = (live: Session, status: NativeRecordingStatus): void => {
    if (status.mediaServicesDidReset === true) {
      fail(live, 'The phone reset its audio service. The recording was lost.')
    } else if (status.hasError) {
      fail(live, status.error ?? 'The recording stopped with an error.')
    } else if (status.isFinished) {
      finishAtLimit(live)
    }
  }

  /** One try at starting. Throws if any native step does. */
  const begin = async (start: StartOptions, wantsBackground: boolean): Promise<void> => {
    await audioSession.forRecording(wantsBackground)
    const recorder = new audio.AudioRecorder(recordingOptions(options.platform))
    try {
      await recorder.prepareToRecordAsync()
      recorder.record({ forDuration: start.maxSeconds })
      const state = recorder.getStatus()
      if (!state.isRecording) throw new Error('The phone did not start recording.')
      const uri = state.url ?? recorder.uri ?? ''
      const live: Session = {
        recorder,
        subscription: { remove: () => {} },
        uri,
        maxMs: start.maxSeconds * 1000,
        warnMs: start.warnSeconds * 1000,
        lastDurationMs: 0,
        phase: 'recording',
        pausedByUser: false,
        isEnding: false,
        timer: undefined,
      }
      live.subscription = recorder.addListener('recordingStatusUpdate', status =>
        onNativeStatus(live, status),
      )
      live.timer = timers.setInterval(() => poll(live), pollMs)
      session = live
      audioSession.setRecording(true)
      background = wantsBackground ? 'requested' : 'off'
    } catch (error) {
      try {
        recorder.release?.()
      } catch {
        // Nothing more to do.
      }
      throw error
    }
  }

  const startRecording = async (start: StartOptions): Promise<Background> => {
    if (session !== undefined) throw new Error('A recording is already running.')
    const wantsBackground = options.backgroundRecording ?? true
    try {
      await begin(start, wantsBackground)
    } catch (error) {
      if (!wantsBackground) throw error
      // Android refuses to record in the background in a build without its
      // recording service. Recording in front still works, so try that.
      await begin(start, false)
    }
    sendStatusIfChanged()
    return background
  }

  const live = (): Session => {
    if (session === undefined || session.isEnding) throw new Error('Nothing is being recorded.')
    return session
  }

  const stopRecording = async (): Promise<Recording> => {
    const current = live()
    current.isEnding = true
    try {
      // Read the length first: after `stop` the phone reports 0.
      const before = current.recorder.getStatus()
      const durationMs = Math.max(current.lastDurationMs, before.durationMillis)
      await current.recorder.stop()
      const recording: Recording = {
        uri: current.uri,
        durationMs,
        sizeBytes: sizeOf(current),
        endedBy: 'stop',
      }
      letGo(current)
      return recording
    } catch (error) {
      letGo(current)
      throw error
    }
  }

  const cancelRecording = async (): Promise<void> => {
    const current = live()
    current.isEnding = true
    try {
      await current.recorder.stop()
    } catch {
      // A recorder that will not stop is released below all the same.
    }
    letGo(current)
    options.removeFile?.(current.uri)
  }

  return {
    route: options.route ?? 'expo-audio native objects, no React',
    permission: Effect.map(
      attempt(CAPABILITY, () => audio.getRecordingPermissionsAsync()),
      permissionOf,
    ),
    requestPermission: Effect.map(
      attempt(CAPABILITY, () => audio.requestRecordingPermissionsAsync()),
      permissionOf,
    ),
    openSettings: Effect.asVoid(
      attempt(CAPABILITY, async () => {
        if (options.openSettings === undefined) {
          throw new Error('This build was not told how to open Settings.')
        }
        await options.openSettings()
      }),
    ),
    start: start => attempt(CAPABILITY, () => startRecording(start)),
    pause: attempt(CAPABILITY, () => {
      const current = live()
      current.recorder.pause()
      current.pausedByUser = true
      poll(current)
    }),
    resume: attempt(CAPABILITY, () => {
      const current = live()
      // No options: the phone keeps the limit it was given at the start.
      current.recorder.record()
      current.pausedByUser = false
      poll(current)
    }),
    stop: attempt(CAPABILITY, stopRecording),
    cancel: attempt(CAPABILITY, cancelRecording),
    snapshot: Effect.sync(() => {
      if (session !== undefined) poll(session)
      const handedOut = unsaved
      unsaved = undefined
      return {
        status: session === undefined ? IDLE : statusOf(session),
        unsaved: handedOut,
        route: options.route ?? 'expo-audio native objects, no React',
        background,
      }
    }),
    // A live recording holds the only native object there is, and it is
    // let go when the recording ends. So there is nothing to free here
    // unless a start was left half done, which `begin` already cleans up.
    release: Effect.sync(() => {
      if (session === undefined) meter.write(0)
    }),
    events: {
      subscribe: listener => {
        listeners.add(listener)
        if (session !== undefined) listener({ _tag: 'Status', status: statusOf(session) })
        return () => {
          listeners.delete(listener)
        }
      },
    },
  }
}

/** The recorder where the build has no audio module: every call says so. */
export const unavailable = (reason: string): RecorderService => {
  const failed = Effect.fail(new DeviceError({ capability: CAPABILITY, reason }))
  return {
    route: `not available: ${reason}`,
    permission: failed,
    requestPermission: failed,
    openSettings: failed,
    start: () => failed,
    pause: failed,
    resume: failed,
    stop: failed,
    cancel: failed,
    snapshot: Effect.succeed({
      status: IDLE,
      unsaved: undefined,
      route: `not available: ${reason}`,
      background: 'off',
    }),
    release: Effect.void,
    events: { subscribe: () => () => {} },
  }
}

export const NO_AUDIO_MODULE =
  'this build has no expo-audio (globalThis.expo.modules.ExpoAudio is missing)'

/** `Recorder.live(audioModuleFromGlobal(), { platform: Platform.OS })`. */
export const live = (
  audio: AudioModule | null | undefined,
  options: RecorderOptions,
): Layer.Layer<Recorder> =>
  Layer.succeed(
    Recorder,
    audio === null || audio === undefined ? unavailable(NO_AUDIO_MODULE) : make(audio, options),
  )

/**
 * The real recorder code over a pretend phone. `audio` is the pretend phone:
 * `audio.advance(3000)` lets three seconds pass, `audio.interrupt()` is a
 * call coming in. `listenerCount()` is how many Subscriptions listen now.
 */
export const makeTest = (
  options: Readonly<{
    audio?: FakeAudio
    files?: ReturnType<typeof makeMemoryFiles>
    session?: AudioSession
    meter?: Meter
    platform?: string
    backgroundRecording?: boolean
  }> = {},
) => {
  const files = options.files ?? makeMemoryFiles()
  const audio = options.audio ?? makeFakeAudio({ files })
  const meter = options.meter ?? levelMeter
  meter.write(0)
  const service = make(audio.module, {
    platform: options.platform ?? 'ios',
    timers: audio.timers,
    meter,
    removeFile: files.files.remove,
    fileSize: files.files.size,
    route: 'test fake',
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.backgroundRecording === undefined
      ? {}
      : { backgroundRecording: options.backgroundRecording }),
    openSettings: () => {
      audio.calls.push('openSettings')
    },
  })
  let listening = 0
  const counted: RecorderService = {
    ...service,
    events: {
      subscribe: listener => {
        listening += 1
        const stop = service.events.subscribe(listener)
        return () => {
          listening -= 1
          stop()
        }
      },
    },
  }
  return {
    layer: Layer.succeed(Recorder, counted),
    service: counted,
    audio,
    files,
    meter,
    listenerCount: () => listening,
  }
}

// ---------------------------------------------------------------- messages

export const Message = defineMessageUnion({
  GotPermission: { permission: Permission, wasAsked: Schema.Boolean },
  FailedPermission: { reason: Schema.String },
  OpenedSettings: {},
  FailedOpenSettings: { reason: Schema.String },
  StartedRecording: { background: Background },
  FailedStartRecording: { reason: Schema.String },
  PausedRecording: {},
  ResumedRecording: {},
  /** The person stopped the recording. The file is closed and ready. */
  StoppedRecording: { recording: Recording },
  CanceledRecording: {},
  /** A pause, resume, stop or cancel did not work. `action` says which. */
  FailedRecorderAction: { action: Schema.String, reason: Schema.String },
  GotRecorderSnapshot: {
    status: RecorderStatus,
    maybeUnsaved: Schema.Option(Recording),
    route: Schema.String,
    background: Background,
  },
  ReleasedRecorder: {},
  /** From the Subscription: the timer's second, the phase or the warning changed. */
  ChangedRecorderStatus: { status: RecorderStatus },
  /** From the Subscription: the recording reached its longest length and the phone closed it. */
  FinishedRecording: { recording: Recording },
  /** From the Subscription: the recording broke. */
  FailedRecording: { reason: Schema.String },
})
export type Message = typeof Message.Type

// ---------------------------------------------------------------- commands

const use = <A>(
  run: (recorder: RecorderService) => Effect.Effect<A, DeviceError>,
): Effect.Effect<A, DeviceError, Recorder> => Recorder.use(run)

const action = <A>(name: string, effect: Effect.Effect<A, DeviceError, Recorder>) =>
  Effect.catch(effect, error =>
    Effect.succeed(Message.FailedRecorderAction({ action: name, reason: error.reason })),
  )

const permissionMessages = [Message.GotPermission, Message.FailedPermission] as const

/** Reads the microphone permission without asking the person anything. */
export const CheckPermission = Command.define('Recorder.CheckPermission', {
  messages: permissionMessages,
  execute: use(recorder => recorder.permission).pipe(
    Effect.map(permission => Message.GotPermission({ permission, wasAsked: false })),
    Effect.catch(error => Effect.succeed(Message.FailedPermission({ reason: error.reason }))),
  ),
})

/** Shows the phone's microphone question, if the phone will still ask. */
export const RequestPermission = Command.define('Recorder.RequestPermission', {
  messages: permissionMessages,
  execute: use(recorder => recorder.requestPermission).pipe(
    Effect.map(permission => Message.GotPermission({ permission, wasAsked: true })),
    Effect.catch(error => Effect.succeed(Message.FailedPermission({ reason: error.reason }))),
  ),
})

export const OpenSettings = Command.define('Recorder.OpenSettings', {
  messages: [Message.OpenedSettings, Message.FailedOpenSettings],
  execute: use(recorder => recorder.openSettings).pipe(
    Effect.as(Message.OpenedSettings()),
    Effect.catch(error => Effect.succeed(Message.FailedOpenSettings({ reason: error.reason }))),
  ),
})

export const Start = Command.define('Recorder.Start', {
  args: { maxSeconds: Schema.Number, warnSeconds: Schema.Number },
  messages: [Message.StartedRecording, Message.FailedStartRecording],
  execute: ({ maxSeconds, warnSeconds }) =>
    use(recorder => recorder.start({ maxSeconds, warnSeconds })).pipe(
      Effect.map(background => Message.StartedRecording({ background })),
      Effect.catch(error =>
        Effect.succeed(Message.FailedStartRecording({ reason: error.reason })),
      ),
    ),
})

export const Pause = Command.define('Recorder.Pause', {
  messages: [Message.PausedRecording, Message.FailedRecorderAction],
  execute: action(
    'pause',
    use(recorder => recorder.pause).pipe(Effect.as(Message.PausedRecording())),
  ),
})

export const Resume = Command.define('Recorder.Resume', {
  messages: [Message.ResumedRecording, Message.FailedRecorderAction],
  execute: action(
    'resume',
    use(recorder => recorder.resume).pipe(Effect.as(Message.ResumedRecording())),
  ),
})

/** Stops and keeps the file. Answers with where it is, how long and how big. */
export const Stop = Command.define('Recorder.Stop', {
  messages: [Message.StoppedRecording, Message.FailedRecorderAction],
  execute: action(
    'stop',
    use(recorder => recorder.stop).pipe(
      Effect.map(recording => Message.StoppedRecording({ recording })),
    ),
  ),
})

/** Stops and deletes the file. */
export const Cancel = Command.define('Recorder.Cancel', {
  messages: [Message.CanceledRecording, Message.FailedRecorderAction],
  execute: action(
    'cancel',
    use(recorder => recorder.cancel).pipe(Effect.as(Message.CanceledRecording())),
  ),
})

/** What the recorder is doing right now. Ask at startup and on coming back to the app. */
export const TakeSnapshot = Command.define('Recorder.TakeSnapshot', {
  messages: [Message.GotRecorderSnapshot],
  execute: Recorder.use(recorder => recorder.snapshot).pipe(
    Effect.map(snapshot =>
      Message.GotRecorderSnapshot({
        status: snapshot.status,
        maybeUnsaved: Option.fromNullishOr(snapshot.unsaved),
        route: snapshot.route,
        background: snapshot.background,
      }),
    ),
  ),
})

export const Release = Command.define('Recorder.Release', {
  messages: [Message.ReleasedRecorder],
  execute: Recorder.use(recorder => recorder.release).pipe(
    Effect.as(Message.ReleasedRecorder()),
  ),
})

// ---------------------------------------------------------------- subscription

const messageOf = (event: RecorderEvent): Message => {
  switch (event._tag) {
    case 'Status':
      return Message.ChangedRecorderStatus({ status: event.status })
    case 'Finished':
      return Message.FinishedRecording({ recording: event.recording })
    case 'Failed':
      return Message.FailedRecording({ reason: event.reason })
  }
}

/**
 * The recorder's status as a Stream, for a Subscription that runs only while
 * a recording is live:
 *
 *   recorder: entry({ isLive: Schema.Boolean }, {
 *     modelToDependencies: model => ({ isLive: isLive(model) }),
 *     dependenciesToStream: ({ isLive }) =>
 *       isLive ? Stream.map(Recorder.status, toMessage) : Stream.empty,
 *   })
 *
 * About one Message a second while recording. Never one per audio frame.
 */
export const status: Stream.Stream<Message, never, Recorder> = Stream.unwrap(
  Recorder.useSync(recorder => Stream.map(streamOf(CAPABILITY, recorder.events), messageOf)),
)
