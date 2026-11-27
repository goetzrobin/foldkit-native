/**
 * The timeline as a file, and the recorder's place in Effect UI's log.
 * Development builds and tests only.
 *
 * A release build keeps no timeline, so it does not load this file. The
 * app loads it by its path, inside `if (__DEV__)`, the way it loads
 * `NativeDevTools`, and gives `kit` to `startChat`:
 *
 *   if (__DEV__) timeline = require('./native/effect-ui-native/chat/timelineFile').kit
 *   startChat({ ..., timeline })
 *
 * `toJson` writes a merged timeline as JSON. Entries of the screens' log
 * are written the way Effect UI sends them to its dev tools, so
 * `Story.fromLog` and `replay` can read them back. `fromJson` reads what
 * `toJson` wrote.
 */
import * as MessageLog from '@effect/ui/MessageLog'
import { Context, Effect, Layer, Schema } from 'effect'

import type { SharedClockService } from './clock.js'
import { PlayerStep } from './machines/player.js'
import { type Item, type Kit, type LogEntry, type Recorder, makeRecorder } from './timeline.js'

export const TIMELINE_VERSION = 1

const StepJson = Schema.toCodecJson(PlayerStep)
const encodeStep = Schema.encodeSync(StepJson)
const decodeStep = Schema.decodeUnknownSync(StepJson)

/**
 * A live entry holds its component itself, and has to be put through the
 * component's Schemas. A written one names its component. The two kinds of
 * entry with no component are plain data either way.
 */
const isLive = (entry: LogEntry): entry is MessageLog.Entry => {
  const component = (entry as { readonly component?: unknown }).component
  return component !== undefined && typeof component !== 'string'
}

/** The timeline as JSON. */
export const toJson = (items: ReadonlyArray<Item>): string => {
  const encoder = MessageLog.makeEncoder()
  return JSON.stringify({
    version: TIMELINE_VERSION,
    items: items.map(item =>
      item.from === 'player'
        ? { n: item.n, from: item.from, step: encodeStep(item.step) }
        : { n: item.n, from: item.from, entry: isLive(item.entry) ? encoder.encode(item.entry) : item.entry },
    ),
  })
}

/** Reads what `toJson` wrote. */
export const fromJson = (text: string): ReadonlyArray<Item> => {
  const file = JSON.parse(text) as { readonly version?: number; readonly items?: ReadonlyArray<Record<string, unknown>> }
  if (file.version !== TIMELINE_VERSION || !Array.isArray(file.items)) throw new Error('This is not a timeline file.')
  return file.items.map(item =>
    item['from'] === 'player'
      ? { n: item['n'] as number, from: 'player' as const, step: decodeStep(item['step']) }
      : { n: item['n'] as number, from: 'screens' as const, entry: item['entry'] as MessageLog.WireEntry },
  )
}

/**
 * Effect UI's log goes to the recorder, and also to whatever log `inner`
 * provides (the dev tools). Everything else `inner` provides is kept.
 */
export const recording = (recorder: Recorder, inner: Layer.Layer<never> = Layer.empty): Layer.Layer<never> =>
  Layer.effectContext(
    Effect.map(Layer.build(inner), built =>
      Context.add(built, MessageLog.MessageLog, MessageLog.fanoutAll([Context.get(built, MessageLog.MessageLog), recorder.log])),
    ),
  ) as Layer.Layer<never>

/** What `startChat` needs to keep a timeline, over the app's shared clock. */
export const kit = (clock: SharedClockService): Kit => {
  const recorder = makeRecorder(clock)
  return { recorder, logs: inner => recording(recorder, inner), toJson }
}
