/**
 * Speech recognition: the phone turns what is said into text, as it is said.
 *
 *   // app entry
 *   const speech = Speech.live(Speech.moduleFromGlobal())
 *
 *   // a program
 *   yield* speech.requestPermission      // 'granted' or not
 *   yield* speech.start({ lang: 'en-US' })
 *   speech.events.subscribe(event => ...) // Started, Result, Ended, Failed
 *   yield* speech.stop
 *
 * The native half is the community package `expo-speech-recognition`
 * (github.com/jamsch/expo-speech-recognition). Its module is found by name,
 * `globalThis.expo.modules.ExpoSpeechRecognition`, so nothing here imports
 * React or the package. A build without it answers every call with a
 * `DeviceError` that says so.
 *
 * The phone sends many results while someone speaks. Each one holds the
 * whole text heard so far in this session, so a listener can show the newest
 * one and forget the rest. `isFinal` marks the last result of a sentence.
 *
 * `start({ audioUri })` reads a sound file in place of the microphone: this
 * is how a recorded voice note gets its words. iOS reads the files its own
 * recorder writes. Android needs version 13 or later.
 */
import { Context, Effect, Layer } from 'effect'

import { DeviceError, type NativeSubscription, type Source, attempt, makeFailure } from './common.js'

export const CAPABILITY = 'speech'

/** Whether the app may listen. `blocked`: refused, and the phone will not ask again. */
export type SpeechPermission = 'granted' | 'denied' | 'blocked'

export type SpeechEvent =
  | Readonly<{ _tag: 'Started' }>
  /** Everything heard so far in this session. */
  | Readonly<{ _tag: 'Result'; text: string; isFinal: boolean }>
  | Readonly<{ _tag: 'Ended' }>
  /** `code` is the package's own word: `no-speech`, `not-allowed`, `network`, `aborted` and so on. */
  | Readonly<{ _tag: 'Failed'; code: string; reason: string }>

export type SpeechStartOptions = Readonly<{
  /** A language tag such as `en-US`. Left out: the phone's own language. */
  lang?: string | undefined
  /** A sound file to read in place of the microphone. */
  audioUri?: string | undefined
}>

export type SpeechService = Readonly<{
  /** How speech is reached in this build, for a status line. */
  route: string
  /** Whether the phone has a recogniser at all. */
  isAvailable: Effect.Effect<boolean>
  /** Asks for the microphone and for speech recognition, if the phone may still ask. */
  requestPermission: Effect.Effect<SpeechPermission, DeviceError>
  start: (options: SpeechStartOptions) => Effect.Effect<void, DeviceError>
  /** Stops listening. The phone may send one last result first. */
  stop: Effect.Effect<void, DeviceError>
  /** Stops at once, with no last result. */
  abort: Effect.Effect<void, DeviceError>
  events: Source<SpeechEvent>
}>

export class Speech extends Context.Service<Speech, SpeechService>()('foldkit-native/Speech') {}

/** What the phone answers when asked for a permission. */
export type SpeechPermissionResponse = Readonly<{
  granted?: boolean
  canAskAgain?: boolean
  status?: string
}>

type ResultEvent = Readonly<{ isFinal?: boolean; results?: ReadonlyArray<Readonly<{ transcript?: string }>> }>
type ErrorEvent = Readonly<{ error?: string; message?: string }>

/** The part of `ExpoSpeechRecognitionModule` used here. */
export interface SpeechModule {
  start(options: Record<string, unknown>): void
  stop(): void
  abort(): void
  requestPermissionsAsync(): Promise<SpeechPermissionResponse>
  isRecognitionAvailable?(): boolean
  addListener(name: string, listener: (event: any) => void): NativeSubscription
}

export const MODULE_NAME = 'ExpoSpeechRecognition'

export const NO_SPEECH_MODULE = `this build has no expo-speech-recognition (globalThis.expo.modules.${MODULE_NAME} is missing)`

/** The native module, found by name. Null where the build has none. Never throws. */
export const moduleFromGlobal = (): SpeechModule | null => {
  try {
    const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules
    const module = modules?.[MODULE_NAME] as Partial<SpeechModule> | undefined
    return typeof module?.start === 'function' && typeof module.addListener === 'function' ? (module as SpeechModule) : null
  } catch {
    return null
  }
}

const permissionOf = (response: SpeechPermissionResponse): SpeechPermission =>
  response.granted === true ? 'granted' : response.canAskAgain === false ? 'blocked' : 'denied'

/** The words of a result: the first choice the phone offers. */
const textOf = (event: ResultEvent | null | undefined): string => event?.results?.[0]?.transcript ?? ''

/** The service over a module, real or pretend. */
export const make = (module: SpeechModule, route = 'expo-speech-recognition'): SpeechService => ({
  route,
  isAvailable: Effect.sync(() => {
    try {
      return module.isRecognitionAvailable?.() ?? true
    } catch {
      return false
    }
  }),
  requestPermission: Effect.map(
    attempt(CAPABILITY, () => module.requestPermissionsAsync()),
    permissionOf,
  ),
  start: options =>
    attempt(CAPABILITY, () =>
      module.start({
        ...(options.lang === undefined ? {} : { lang: options.lang }),
        // Words appear while they are spoken, not only at the end.
        interimResults: true,
        // One session runs until it is stopped, across pauses in speech.
        continuous: true,
        addsPunctuation: true,
        ...(options.audioUri === undefined ? {} : { audioSource: { uri: options.audioUri } }),
      }),
    ),
  stop: attempt(CAPABILITY, () => module.stop()),
  abort: attempt(CAPABILITY, () => module.abort()),
  events: {
    subscribe: listener => {
      const subscriptions = [
        module.addListener('start', () => listener({ _tag: 'Started' })),
        module.addListener('result', (event: ResultEvent | null) =>
          listener({ _tag: 'Result', text: textOf(event), isFinal: event?.isFinal === true }),
        ),
        module.addListener('end', () => listener({ _tag: 'Ended' })),
        module.addListener('error', (event: ErrorEvent | null) =>
          listener({ _tag: 'Failed', code: event?.error ?? 'unknown', reason: event?.message ?? event?.error ?? 'unknown' }),
        ),
      ]
      return () => {
        for (const subscription of subscriptions) subscription.remove()
      }
    },
  },
})

/** For a build without the module: every call fails with `reason`, and nothing is ever heard. */
export const unavailable = (reason: string): SpeechService => {
  const fail = Effect.fail(new DeviceError({ capability: CAPABILITY, reason }))
  return {
    route: `not available (${reason})`,
    isAvailable: Effect.succeed(false),
    requestPermission: fail,
    start: () => fail,
    stop: fail,
    abort: fail,
    events: { subscribe: () => () => {} },
  }
}

/** `Speech.live(Speech.moduleFromGlobal())`. */
export const live = (module: SpeechModule | null | undefined): Layer.Layer<Speech> =>
  Layer.succeed(Speech, module === null || module === undefined ? unavailable(NO_SPEECH_MODULE) : make(module))

/**
 * The real service code over a pretend phone. A test plays the phone:
 * `hear('hello')` is a result while someone speaks, `end()` is the phone
 * closing the session, `fail('no-speech', '...')` is an error. `permission`
 * sets what the phone answers when asked. `calls` lists what the program
 * asked for, with the options of each `start`.
 */
export const makeTest = (options: Readonly<{ permission?: SpeechPermission }> = {}) => {
  const calls: Array<string> = []
  const starts: Array<Record<string, unknown>> = []
  const listeners = new Map<string, Set<(event: any) => void>>()
  let permission: SpeechPermission = options.permission ?? 'granted'
  let isListening = false
  const { failNext, guard } = makeFailure(CAPABILITY)
  const emit = (name: string, event: unknown): void => {
    for (const listener of [...(listeners.get(name) ?? [])]) listener(event)
  }
  const end = (): void => {
    if (!isListening) return
    isListening = false
    emit('end', null)
  }
  const module: SpeechModule = {
    start: startOptions => {
      calls.push('start')
      starts.push(startOptions)
      isListening = true
      emit('start', null)
    },
    stop: () => {
      calls.push('stop')
      end()
    },
    abort: () => {
      calls.push('abort')
      end()
    },
    requestPermissionsAsync: () => {
      calls.push('requestPermission')
      return Promise.resolve({ granted: permission === 'granted', canAskAgain: permission !== 'blocked' })
    },
    isRecognitionAvailable: () => true,
    addListener: (name, listener) => {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return { remove: () => void set.delete(listener) }
    },
  }
  const real = make(module, 'test fake')
  const service: SpeechService = {
    ...real,
    // `failNext('why')` makes the next start fail, as a phone with no recogniser would.
    start: startOptions => Effect.flatMap(guard(() => undefined), () => real.start(startOptions)),
  }
  return {
    layer: Layer.succeed(Speech, service),
    service,
    module,
    calls,
    starts,
    failNext,
    setPermission: (next: SpeechPermission) => {
      permission = next
    },
    /** The phone heard this much so far. */
    hear: (text: string, isFinal = false) => emit('result', { isFinal, results: [{ transcript: text }] }),
    end,
    fail: (code: string, reason: string) => {
      emit('error', { error: code, message: reason })
      end()
    },
    isListening: () => isListening,
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  }
}
