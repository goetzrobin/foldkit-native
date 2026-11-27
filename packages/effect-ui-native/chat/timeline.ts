/**
 * One timeline for the whole app: what the screens did and what the player
 * did, in one list, in the order it happened.
 *
 * Effect UI already keeps a log of the screens: every Message, what sent
 * it, what it changed. The player is not a screen. It is an actor, and it
 * keeps its own record (`Player.log()`). Neither list knows about the
 * other.
 *
 * What joins them is the shared clock (`clock.ts`). The player takes a
 * number from it for every event it handles. `makeRecorder` here is a
 * second reader of Effect UI's log that takes a number from the same clock
 * for every entry. Effect UI's own numbers (`seq`) count only its own
 * entries, and its times are whole milliseconds, in which many things
 * happen. So neither can say whether the player's step came before or
 * after a screen's Message. One counter for both can.
 *
 * `merge` puts the two lists into one. `lines` writes it out for a person:
 *
 *   41  MessageRow   PressedNote, sends Pause to the player
 *   42  player       Playing to Paused, on Pause by voice-row
 *   43  MiniPlayer   HeardPlayer, step 42
 *
 * `toJson` writes it out for a file. In a development build, Settings has
 * a row that copies that JSON (`CopyTimeline`).
 */
import * as MessageLog from '@effect/ui/MessageLog'
import { Command } from '@effect/ui'
import { Context, Effect, Layer, Schema } from 'effect'

import * as Device from '../../native/src/host/device/index.js'
import type { SharedClockService } from './clock.js'
import { PlayerStep } from './machines/player.js'
import { Player } from './machines/playerActor.js'

/** An entry of Effect UI's log, live or as written to a file. */
export type LogEntry = MessageLog.Entry | MessageLog.WireEntry

export type ScreenItem = Readonly<{ n: number; from: 'screens'; entry: LogEntry }>
export type PlayerItem = Readonly<{ n: number; from: 'player'; step: PlayerStep }>
/** One thing that happened. `n` is its number from the shared clock. */
export type Item = ScreenItem | PlayerItem

export type Recorder = Readonly<{
  /** Give this to Effect UI as a log. */
  log: MessageLog.MessageLog
  /** What it has kept, oldest first, each with its number from the shared clock. */
  entries: () => ReadonlyArray<ScreenItem>
}>

/** How many entries of the screens' log are kept. */
export const RECORDER_SIZE = 3000

/** A reader of Effect UI's log that numbers every entry from the shared clock. */
export const makeRecorder = (clock: SharedClockService, size = RECORDER_SIZE): Recorder => {
  const kept: Array<ScreenItem> = []
  return {
    log: {
      enabled: true,
      record: entry => {
        kept.push({ n: clock.next(), from: 'screens', entry })
        if (kept.length > size) kept.splice(0, kept.length - size)
      },
    },
    entries: () => kept.slice(),
  }
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

/** The two records as one list, lowest number first. */
export const merge = (screens: ReadonlyArray<ScreenItem>, player: ReadonlyArray<PlayerStep>): ReadonlyArray<Item> =>
  [...screens, ...player.map((step): PlayerItem => ({ n: step.seq, from: 'player', step }))].sort((a, b) => a.n - b.n)

const nameOf = (entry: LogEntry): string => {
  const component = (entry as { readonly component?: unknown }).component
  return typeof component === 'string'
    ? component
    : ((component as { readonly definition?: { readonly name?: string } } | undefined)?.definition?.name ?? '')
}

type Tagged = { readonly _tag?: string }

/** One line for a person, or null for an entry that is not a Message or a step of the player. */
export const lineOf = (item: Item): string | null => {
  if (item.from === 'player') {
    const { before, after, event, changed } = item.step
    const what = changed ? `${before._tag} to ${after._tag}` : `${before._tag}, ignored`
    return `${item.n}  player  ${what}, on ${event._tag} by ${event.by.name}`
  }
  const entry = item.entry as { readonly _tag: string; readonly message?: unknown; readonly commands?: ReadonlyArray<unknown> }
  if (entry._tag !== 'Update') return null
  const message = entry.message as Tagged & { readonly step?: { readonly seq?: number } }
  const sends = (entry.commands ?? [])
    .map(command => command as { readonly name?: string; readonly args?: { readonly event?: Tagged } })
    .filter(command => command.name === 'chat/SendToPlayer')
    .map(command => `, sends ${command.args?.event?._tag ?? 'an event'} to the player`)
    .join('')
  const heard = typeof message.step?.seq === 'number' ? `, step ${message.step.seq}` : ''
  return `${item.n}  ${nameOf(entry as LogEntry)}  ${message._tag ?? 'a Message'}${heard}${sends}`
}

/** The timeline for a person: the Messages and the player's steps, one per line. */
export const lines = (items: ReadonlyArray<Item>): ReadonlyArray<string> =>
  items.map(lineOf).filter((line): line is string => line !== null)

// AS A FILE

/**
 * A live entry holds its component itself, and has to be put through the
 * component's Schemas. A written one names its component. The two kinds of
 * entry with no component are plain data either way.
 */
const isLive = (entry: LogEntry): entry is MessageLog.Entry =>
  typeof (entry as { readonly component?: unknown }).component === 'object'

export const TIMELINE_VERSION = 1

const StepJson = Schema.toCodecJson(PlayerStep)
const encodeStep = Schema.encodeSync(StepJson)
const decodeStep = Schema.decodeUnknownSync(StepJson)

/** The timeline as JSON. Entries of the screens' log are written the way Effect UI sends them to its dev tools. */
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

/** What copying the timeline answers: how many things it held, or why it could not be copied. */
export const Copied = Schema.Struct({ count: Schema.Number, failure: Schema.NullOr(Schema.String) })

/**
 * Copies the merged timeline to the clipboard as JSON. For a development
 * build: it is how a timeline gets off a phone and into a bug report.
 */
export class CopyTimeline extends Command.Service<CopyTimeline>()('chat/CopyTimeline', {
  args: {},
  success: Copied,
}) {
  /** `recorder` is null in a build that does not record the screens. The player's own record is still copied. */
  static readonly layerFor = (recorder: Recorder | null) =>
    this.toLayer(
      Effect.gen(function* () {
        const player = yield* Player
        const clipboard = yield* Device.Clipboard.Clipboard
        return () =>
          Effect.suspend(() => {
            const items = merge(recorder?.entries() ?? [], player.log())
            return Effect.match(clipboard.copy(toJson(items)), {
              onSuccess: () => ({ count: items.length, failure: null as string | null }),
              onFailure: error => ({ count: items.length, failure: error.reason as string | null }),
            })
          })
      }),
    )
}
