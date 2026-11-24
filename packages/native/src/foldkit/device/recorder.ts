/**
 * The voice recorder as Foldkit Commands and one Subscription.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/recorder.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Option, Schema, Stream } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { DeviceError, streamOf } from '../../host/device/common.js'
import { CAPABILITY, Recorder, Background, Permission, type RecorderEvent, type RecorderService, RecorderStatus, Recording } from '../../host/device/recorder.js'

export * from '../../host/device/recorder.js'

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
