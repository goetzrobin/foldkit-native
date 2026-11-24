/**
 * The native side of `expo-audio` and `expo-file-system`, as this project
 * uses it: with no React.
 *
 * `expo-audio` is usually used through React hooks (`useAudioRecorder`,
 * `useAudioPlayer`). Under the hooks are plain native objects, and the hooks
 * do three things only: make the object with `new`, listen to its events,
 * and call `release()` on it when the component goes away. This project does
 * those three things itself.
 *
 * The native module is found by name on the JavaScript global that Expo sets
 * up at startup:
 *
 *   globalThis.expo.modules.ExpoAudio      recorder, player, permission, mode
 *   globalThis.expo.modules.FileSystem     files and folders
 *
 * The `expo-audio` JavaScript package is never imported, because its entry
 * file imports `react`. That has a cost: the package's entry also wraps a few
 * native methods to tidy their arguments. Those wrappers do not run here, so
 * this file does the same tidying by hand:
 *
 * - Recording options are written flat, per platform (`recordingOptions`).
 * - A sound to play is given as `{ uri }`, never a `require()` number.
 * - `setPlaybackRate` is called with one argument (Android takes only one).
 * - `setAudioModeAsync` gets only the keys each platform knows (`modeFor`).
 *
 * Everything else in this folder talks to the interfaces below, so a test can
 * pass `makeFakeAudio()` and run in plain Node.
 */
import type { NativeSubscription } from './common.js'

// ---------------------------------------------------------------- recorder

/** What `recorder.getStatus()` answers. Times are in milliseconds. */
export type NativeRecorderState = Readonly<{
  /** Prepared, recording or paused. False once the recording has stopped. */
  canRecord: boolean
  isRecording: boolean
  durationMillis: number
  fileSize?: number
  /** Loudness in decibels, -160 (silence) to 0 (as loud as it gets). */
  metering?: number | null
  url?: string | null
  mediaServicesDidReset?: boolean
}>

/** The `recordingStatusUpdate` event. It is sent when a recording ends, not while it runs. */
export type NativeRecordingStatus = Readonly<{
  isFinished: boolean
  hasError: boolean
  error?: string | null
  url?: string | null
  mediaServicesDidReset?: boolean
}>

/** `AudioModule.AudioRecorder`: a shared object that owns the microphone recording. */
export interface NativeRecorder {
  readonly uri?: string | null
  prepareToRecordAsync(options?: unknown): Promise<void>
  /** Starts, or carries on after a pause. `forDuration` is in seconds. */
  record(options?: Readonly<{ forDuration?: number }>): unknown
  pause(): void
  stop(): Promise<unknown>
  getStatus(): NativeRecorderState
  addListener(
    event: 'recordingStatusUpdate',
    listener: (status: NativeRecordingStatus) => void,
  ): NativeSubscription
  /** Every Expo shared object has this. It frees the native object now. */
  release?(): void
}

// ---------------------------------------------------------------- player

/** The `playbackStatusUpdate` event. Times are in seconds. */
export type NativePlaybackStatus = Readonly<{
  currentTime: number
  duration: number
  playing: boolean
  didJustFinish: boolean
  isLoaded?: boolean
  error?: string | null
}>

/** `AudioModule.AudioPlayer`: a shared object that plays one sound. */
export interface NativePlayer {
  play(): void
  pause(): void
  seekTo(seconds: number): Promise<void>
  setPlaybackRate(rate: number): void
  /** Takes the player off the module's list. Followed by `release()`. */
  remove(): void
  addListener(
    event: 'playbackStatusUpdate',
    listener: (status: NativePlaybackStatus) => void,
  ): NativeSubscription
  release?(): void
}

// ---------------------------------------------------------------- module

/** What the two permission functions answer. */
export type NativePermission = Readonly<{
  status?: string
  granted: boolean
  canAskAgain?: boolean
}>

/** `globalThis.expo.modules.ExpoAudio`, the part used here. */
export interface AudioModule {
  AudioRecorder: new (options: unknown) => NativeRecorder
  AudioPlayer: new (
    source: Readonly<{ uri: string }> | null,
    updateIntervalMs: number,
    keepAudioSessionActive: boolean,
    preferredForwardBufferDuration: number,
    allowsExternalPlayback: boolean,
  ) => NativePlayer
  setAudioModeAsync(mode: unknown): Promise<void>
  requestRecordingPermissionsAsync(): Promise<NativePermission>
  getRecordingPermissionsAsync(): Promise<NativePermission>
}

/** A file, as `FileSystem.FileSystemFile` makes one from a `file://` address. */
export interface NativeFile {
  readonly exists: boolean
  readonly size: number | null
  textSync(): string
  writeSync(content: string): void
  delete(): void
  moveSync(destination: NativeFile): void
}

export interface NativeDirectory {
  readonly exists: boolean
  create(options?: Readonly<{ intermediates?: boolean; idempotent?: boolean }>): void
}

/** `globalThis.expo.modules.FileSystem`, the part used here. */
export interface FileSystemModule {
  /** `file:///.../Documents/`. Kept by the phone until the app is deleted. */
  documentDirectory: string | null | undefined
  FileSystemFile: new (uri: string) => NativeFile
  FileSystemDirectory: new (uri: string) => NativeDirectory
}

type ExpoGlobal = { expo?: { modules?: Record<string, unknown> } }

const moduleNamed = (name: string): unknown => {
  try {
    return (globalThis as ExpoGlobal).expo?.modules?.[name] ?? null
  } catch {
    return null
  }
}

/** Expo's audio module, or null where the build does not have it. */
export const audioModuleFromGlobal = (): AudioModule | null => {
  const found = moduleNamed('ExpoAudio') as Partial<AudioModule> | null
  return found !== null && typeof found.AudioRecorder === 'function'
    ? (found as AudioModule)
    : null
}

/** Expo's file module, or null where the build does not have it. */
export const fileSystemFromGlobal = (): FileSystemModule | null => {
  const found = moduleNamed('FileSystem') as Partial<FileSystemModule> | null
  return found !== null && typeof found.FileSystemFile === 'function'
    ? (found as FileSystemModule)
    : null
}

// ---------------------------------------------------------------- options

/**
 * How a voice note is recorded: one channel, AAC in an `.m4a` file, 64
 * kilobits a second. That is about half a megabyte a minute, so a 15 minute
 * note is about 7 megabytes. Loudness readings are switched on for the meter.
 *
 * `expo-audio`'s own entry file flattens `{ ios: {...}, android: {...} }`
 * into this shape before calling native. It is written flat here.
 */
export const recordingOptions = (platform: string): Readonly<Record<string, unknown>> => {
  const common = {
    extension: '.m4a',
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
    isMeteringEnabled: true,
  }
  return platform === 'android'
    ? { ...common, outputFormat: 'mpeg4', audioEncoder: 'aac' }
    : {
        ...common,
        // The four letters AVFoundation uses for AAC. The space belongs.
        outputFormat: 'aac ',
        // `AudioQuality.HIGH` in expo-audio.
        audioQuality: 0x60,
      }
}

// ---------------------------------------------------------------- session

/**
 * The phone has one audio session for the whole app, and recording and
 * playing want it set differently. The recorder and the player share this
 * object so that they never pull it two ways at once.
 *
 * On iOS, switching recording off in the session stops any recording. So the
 * player must not touch the session while a recording runs.
 */
export type AudioSession = Readonly<{
  /** Ready the session for the microphone. `background` asks to keep going when the app is not in front. */
  forRecording: (background: boolean) => Promise<void>
  /** Ready the session for the speaker, heard with the silent switch on. Does nothing while recording. */
  forPlayback: () => Promise<void>
  /** The recorder says when it holds the microphone. */
  setRecording: (isRecording: boolean) => void
  isRecording: () => boolean
}>

const modeFor = (
  platform: string,
  mode: Readonly<{ allowsRecording: boolean; background: boolean }>,
): Readonly<Record<string, unknown>> => {
  const shared = {
    playsInSilentMode: true,
    // Other apps' sound stops while a note records or plays.
    interruptionMode: 'doNotMix',
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
    allowsBackgroundRecording: mode.background,
  }
  // Android's native record has no `allowsRecording`. expo-audio's entry
  // file leaves it out on Android, and so does this.
  return platform === 'ios' ? { ...shared, allowsRecording: mode.allowsRecording } : shared
}

export const makeAudioSession = (audio: AudioModule, platform: string): AudioSession => {
  let recording = false
  let isReadyForPlayback = false
  return {
    forRecording: async background => {
      isReadyForPlayback = false
      await audio.setAudioModeAsync(modeFor(platform, { allowsRecording: true, background }))
    },
    forPlayback: async () => {
      if (recording || isReadyForPlayback) return
      await audio.setAudioModeAsync(modeFor(platform, { allowsRecording: false, background: false }))
      isReadyForPlayback = true
    },
    setRecording: isRecording => {
      recording = isRecording
    },
    isRecording: () => recording,
  }
}

// ---------------------------------------------------------------- files

/**
 * The few things the recorder and the notes store do with files, so a test
 * can hold them in memory. Every address is a `file://` one.
 */
export type Files = Readonly<{
  /** Where notes are kept, ending in `/`. */
  root: string
  exists: (uri: string) => boolean
  /** Bytes, or 0 when the file is not there. */
  size: (uri: string) => number
  /** The text of a file, or null when it is not there. */
  readText: (uri: string) => string | null
  writeText: (uri: string, text: string) => void
  move: (from: string, to: string) => void
  /** Deleting a file that is not there is not an error. */
  remove: (uri: string) => void
}>

const withSlash = (uri: string): string => (uri.endsWith('/') ? uri : `${uri}/`)

/** Files in a folder under the app's documents, over Expo's file module. */
export const filesFrom = (module: FileSystemModule, folder = 'voice-notes'): Files => {
  const documents = module.documentDirectory
  if (typeof documents !== 'string' || documents === '') {
    throw new Error('expo-file-system did not say where documents are kept')
  }
  const root = `${withSlash(documents)}${folder}/`
  const ensureRoot = (): void => {
    const directory = new module.FileSystemDirectory(root)
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true })
  }
  return {
    root,
    exists: uri => new module.FileSystemFile(uri).exists,
    size: uri => {
      const file = new module.FileSystemFile(uri)
      return file.exists ? (file.size ?? 0) : 0
    },
    readText: uri => {
      const file = new module.FileSystemFile(uri)
      return file.exists ? file.textSync() : null
    },
    writeText: (uri, text) => {
      ensureRoot()
      new module.FileSystemFile(uri).writeSync(text)
    },
    move: (from, to) => {
      ensureRoot()
      new module.FileSystemFile(from).moveSync(new module.FileSystemFile(to))
    },
    remove: uri => {
      const file = new module.FileSystemFile(uri)
      if (file.exists) file.delete()
    },
  }
}

/**
 * Files in memory, for tests. `entries` maps an address to the file's text.
 * Keep the object and hand it to a second program to stand for closing and
 * reopening the app.
 */
export const makeMemoryFiles = (root = 'file:///documents/voice-notes/') => {
  const entries = new Map<string, string>()
  const files: Files = {
    root,
    exists: uri => entries.has(uri),
    size: uri => entries.get(uri)?.length ?? 0,
    readText: uri => entries.get(uri) ?? null,
    writeText: (uri, text) => {
      entries.set(uri, text)
    },
    move: (from, to) => {
      const content = entries.get(from)
      if (content === undefined) throw new Error(`No file at ${from}`)
      entries.delete(from)
      entries.set(to, content)
    },
    remove: uri => {
      entries.delete(uri)
    },
  }
  return { files, entries }
}

// ---------------------------------------------------------------- fake

/** A recorder made by the fake module, with what a test may look at. */
export type FakeRecorder = NativeRecorder & {
  readonly options: unknown
  readonly uri: string
  isReleased: boolean
  /** The seconds given to `record({ forDuration })`, if any. */
  limitSeconds: number | undefined
}

export type FakePlayer = NativePlayer & {
  readonly uri: string
  isReleased: boolean
  isRemoved: boolean
  isPlaying: boolean
  rate: number
  positionSeconds: number
  durationSeconds: number
}

type FakeTimer = { id: number; everyMs: number; nextAt: number; run: () => void }

/**
 * A stand-in for `globalThis.expo.modules.ExpoAudio`, for tests. It behaves
 * as the native code was read to behave (see docs/VOICE_NOTES.md), and a test
 * drives the parts a person or the phone would:
 *
 *   const fake = makeFakeAudio()
 *   fake.advance(3000)              three seconds pass
 *   fake.setLevel(-20)              the room gets louder
 *   fake.interrupt() / fake.endInterruption()   a phone call comes and goes
 *   fake.permission = { granted: false, canAskAgain: false }
 *
 * `timers` is the clock the recorder's own polling runs on, so no test waits
 * for real time: `advance` moves the recording and the polling together.
 */
export const makeFakeAudio = (
  options: Readonly<{
    files?: ReturnType<typeof makeMemoryFiles>
    /** Throw from `record()` while background recording is asked for, as Android does without its service. */
    refusesBackground?: boolean
  }> = {},
) => {
  const calls: Array<string> = []
  const recorders: Array<FakeRecorder> = []
  const players: Array<FakePlayer> = []
  const modes: Array<Readonly<Record<string, unknown>>> = []
  const store = options.files
  let now = 0
  let nextTimerId = 1
  let nextFile = 1
  const timerList: Array<FakeTimer> = []

  const state = {
    /** What the permission functions answer. */
    permission: { status: 'granted', granted: true, canAskAgain: true } as NativePermission,
    /** What asking answers, when it differs from what checking answers. */
    permissionAfterAsking: undefined as NativePermission | undefined,
    levelDb: -30,
    /** Make the next call of this native method throw, once. */
    failNext: undefined as { method: string; reason: string } | undefined,
  }

  const maybeFail = (method: string): void => {
    if (state.failNext?.method === method) {
      const { reason } = state.failNext
      state.failNext = undefined
      throw new Error(reason)
    }
  }

  const currentMode = (): Readonly<Record<string, unknown>> => modes.at(-1) ?? {}

  type RecorderInner = {
    phase: 'new' | 'prepared' | 'recording' | 'paused' | 'stopped'
    pausedBySystem: boolean
    durationMs: number
    listeners: Set<(status: NativeRecordingStatus) => void>
  }
  const inner = new Map<FakeRecorder, RecorderInner>()

  class Recorder implements NativeRecorder {
    readonly uri: string
    isReleased = false
    limitSeconds: number | undefined = undefined
    readonly options: unknown
    constructor(recorderOptions: unknown) {
      maybeFail('AudioRecorder')
      this.options = recorderOptions
      this.uri = `file:///cache/ExpoAudio/recording-${nextFile++}.m4a`
      calls.push('new AudioRecorder')
      inner.set(this, {
        phase: 'new',
        pausedBySystem: false,
        durationMs: 0,
        listeners: new Set(),
      })
      recorders.push(this)
    }
    async prepareToRecordAsync(): Promise<void> {
      calls.push('prepareToRecordAsync')
      maybeFail('prepareToRecordAsync')
      if (!state.permission.granted) throw new Error('Missing audio recording permission')
      inner.get(this)!.phase = 'prepared'
    }
    record(recordOptions?: Readonly<{ forDuration?: number }>): unknown {
      calls.push(
        recordOptions?.forDuration === undefined
          ? 'record'
          : `record(forDuration: ${recordOptions.forDuration})`,
      )
      maybeFail('record')
      if (options.refusesBackground === true && currentMode()['allowsBackgroundRecording'] === true) {
        throw new Error(
          'The service connection is not bound, but `allowsBackgroundRecording` is set to `true`',
        )
      }
      const mine = inner.get(this)!
      // As on the phone: recording from any other state does nothing.
      if (mine.phase !== 'prepared' && mine.phase !== 'paused') return undefined
      if (recordOptions?.forDuration !== undefined) this.limitSeconds = recordOptions.forDuration
      mine.phase = 'recording'
      mine.pausedBySystem = false
      // The phone makes the file as soon as recording starts.
      store?.entries.set(this.uri, 'audio')
      return undefined
    }
    pause(): void {
      calls.push('pause')
      maybeFail('pause')
      const mine = inner.get(this)!
      if (mine.phase === 'recording') mine.phase = 'paused'
      mine.pausedBySystem = false
    }
    async stop(): Promise<unknown> {
      calls.push('stop')
      maybeFail('stop')
      const mine = inner.get(this)!
      if (mine.phase !== 'recording' && mine.phase !== 'paused') return undefined
      finish(this, false)
      return undefined
    }
    getStatus(): NativeRecorderState {
      const mine = inner.get(this)!
      const isLive = mine.phase === 'recording' || mine.phase === 'paused'
      return {
        canRecord: mine.phase === 'prepared' || isLive,
        isRecording: mine.phase === 'recording',
        // As on the phone: the length reads 0 once the recording has stopped.
        durationMillis: isLive ? mine.durationMs : 0,
        fileSize: store?.files.size(this.uri) ?? Math.round(mine.durationMs * 8),
        metering: mine.phase === 'recording' ? state.levelDb : -160,
        url: this.uri,
      }
    }
    addListener(
      _event: 'recordingStatusUpdate',
      listener: (status: NativeRecordingStatus) => void,
    ): NativeSubscription {
      const mine = inner.get(this)!
      mine.listeners.add(listener)
      return { remove: () => void mine.listeners.delete(listener) }
    }
    release(): void {
      calls.push('recorder.release')
      this.isReleased = true
      inner.get(this)!.listeners.clear()
    }
  }

  const finish = (recorder: FakeRecorder, hasError: boolean, error?: string): void => {
    const mine = inner.get(recorder)!
    mine.phase = 'stopped'
    // One byte for each 125 microseconds: 64 kilobits a second.
    if (store?.entries.has(recorder.uri) === true) {
      store.entries.set(recorder.uri, 'a'.repeat(Math.max(1, Math.round(mine.durationMs * 8))))
    }
    for (const listener of [...mine.listeners]) {
      listener({ isFinished: true, hasError, error: error ?? null, url: hasError ? null : recorder.uri })
    }
  }

  type PlayerInner = { listeners: Set<(status: NativePlaybackStatus) => void> }
  const playerInner = new Map<FakePlayer, PlayerInner>()

  const tell = (player: FakePlayer, didJustFinish = false): void => {
    for (const listener of [...playerInner.get(player)!.listeners]) {
      listener({
        currentTime: player.positionSeconds,
        duration: player.durationSeconds,
        playing: player.isPlaying,
        didJustFinish,
        isLoaded: true,
      })
    }
  }

  /** How long each sound is, by address. A sound not listed is 10 seconds long. */
  const durations = new Map<string, number>()

  class Player implements NativePlayer {
    readonly uri: string
    isReleased = false
    isRemoved = false
    isPlaying = false
    rate = 1
    positionSeconds = 0
    durationSeconds: number
    readonly updateIntervalMs: number
    constructor(source: Readonly<{ uri: string }> | null, updateIntervalMs: number) {
      maybeFail('AudioPlayer')
      this.updateIntervalMs = updateIntervalMs
      this.uri = source?.uri ?? ''
      this.durationSeconds = durations.get(this.uri) ?? 10
      calls.push(`new AudioPlayer(${this.uri})`)
      playerInner.set(this, { listeners: new Set() })
      players.push(this)
    }
    play(): void {
      calls.push('play')
      maybeFail('play')
      this.isPlaying = true
      tell(this)
    }
    pause(): void {
      calls.push('player.pause')
      this.isPlaying = false
      tell(this)
    }
    async seekTo(seconds: number): Promise<void> {
      calls.push(`seekTo(${seconds})`)
      maybeFail('seekTo')
      this.positionSeconds = Math.max(0, Math.min(seconds, this.durationSeconds))
      tell(this)
    }
    setPlaybackRate(rate: number): void {
      calls.push(`setPlaybackRate(${rate})`)
      this.rate = rate
    }
    remove(): void {
      calls.push('player.remove')
      this.isRemoved = true
      this.isPlaying = false
    }
    addListener(
      _event: 'playbackStatusUpdate',
      listener: (status: NativePlaybackStatus) => void,
    ): NativeSubscription {
      const mine = playerInner.get(this)!
      mine.listeners.add(listener)
      return { remove: () => void mine.listeners.delete(listener) }
    }
    release(): void {
      calls.push('player.release')
      this.isReleased = true
      playerInner.get(this)!.listeners.clear()
    }
  }

  const module: AudioModule = {
    AudioRecorder: Recorder,
    AudioPlayer: Player as unknown as AudioModule['AudioPlayer'],
    setAudioModeAsync: async mode => {
      maybeFail('setAudioModeAsync')
      modes.push(mode as Readonly<Record<string, unknown>>)
      // As on iOS: taking recording out of the session stops any recording.
      if ((mode as { allowsRecording?: boolean }).allowsRecording === false) {
        for (const recorder of recorders) {
          const mine = inner.get(recorder)!
          if (mine.phase === 'recording') mine.phase = 'stopped'
        }
      }
    },
    requestRecordingPermissionsAsync: async () => {
      calls.push('requestRecordingPermissionsAsync')
      maybeFail('requestRecordingPermissionsAsync')
      if (state.permissionAfterAsking !== undefined) {
        state.permission = state.permissionAfterAsking
        state.permissionAfterAsking = undefined
      }
      return state.permission
    },
    getRecordingPermissionsAsync: async () => {
      calls.push('getRecordingPermissionsAsync')
      maybeFail('getRecordingPermissionsAsync')
      return state.permission
    },
  }

  /** Moves recordings and playing sounds on by `ms`, in steps no longer than `stepMs`. */
  const pass = (ms: number): void => {
    for (const recorder of recorders) {
      const mine = inner.get(recorder)!
      if (mine.phase !== 'recording') continue
      mine.durationMs += ms
      const limitMs = recorder.limitSeconds === undefined ? Infinity : recorder.limitSeconds * 1000
      if (mine.durationMs >= limitMs) {
        mine.durationMs = limitMs
        // The phone stops a recording that has reached its length by itself.
        finish(recorder, false)
      }
    }
    for (const player of players) {
      if (!player.isPlaying || player.isReleased) continue
      player.positionSeconds += (ms / 1000) * player.rate
      if (player.positionSeconds >= player.durationSeconds) {
        player.positionSeconds = player.durationSeconds
        player.isPlaying = false
        tell(player, true)
      } else {
        tell(player)
      }
    }
  }

  const advance = (ms: number): void => {
    const end = now + ms
    for (;;) {
      const due = timerList
        .filter(timer => timer.nextAt <= end)
        .sort((a, b) => a.nextAt - b.nextAt)[0]
      if (due === undefined) break
      pass(due.nextAt - now)
      now = due.nextAt
      due.nextAt += due.everyMs
      due.run()
    }
    pass(end - now)
    now = end
  }

  return {
    module,
    /** Native calls, oldest first. */
    calls,
    recorders,
    players,
    /** Every audio mode asked for, oldest first. */
    modes,
    state,
    durations,
    /** The clock to give the recorder: `Recorder.make(module, { timers })`. */
    timers: {
      setInterval: (run: () => void, everyMs: number): unknown => {
        const timer = { id: nextTimerId++, everyMs, nextAt: now + everyMs, run }
        timerList.push(timer)
        return timer.id
      },
      clearInterval: (id: unknown): void => {
        const at = timerList.findIndex(timer => timer.id === id)
        if (at >= 0) timerList.splice(at, 1)
      },
    },
    /** How many polling timers run now. */
    timerCount: () => timerList.length,
    advance,
    setLevel: (decibels: number): void => {
      state.levelDb = decibels
    },
    /** A phone call arrives, or the app goes to the background: the phone pauses the recording. */
    interrupt: (): void => {
      for (const recorder of recorders) {
        const mine = inner.get(recorder)!
        if (mine.phase === 'recording') {
          mine.phase = 'paused'
          mine.pausedBySystem = true
        }
      }
    },
    /** The call ends, or the app comes back: the phone carries on by itself. */
    endInterruption: (): void => {
      for (const recorder of recorders) {
        const mine = inner.get(recorder)!
        if (mine.phase === 'paused' && mine.pausedBySystem) {
          mine.phase = 'recording'
          mine.pausedBySystem = false
        }
      }
    },
    /** The recording breaks, as when the phone's media service crashes. */
    breakRecording: (reason: string): void => {
      for (const recorder of recorders) {
        const mine = inner.get(recorder)!
        if (mine.phase === 'recording' || mine.phase === 'paused') finish(recorder, true, reason)
      }
    },
  }
}

export type FakeAudio = ReturnType<typeof makeFakeAudio>
