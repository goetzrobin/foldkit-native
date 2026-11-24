/**
 * Fold Chat's words: the settings, the sheets, a notice, a recording, the
 * rows of a chat, and the pure functions the parts and the tests share: the
 * conversation list grouped by day, and search.
 *
 * The app has two screens on one native stack: the list of chats, and one
 * chat pushed over it. Sheets (settings, reasoning, rename, select text)
 * are presented over either. Each part keeps its own Model (see `parts/`);
 * the top of the app is in `appModel.ts`.
 */
import { Option, Schema } from 'effect'

import type { ConversationSummary, Part, TranscriptRow } from '../src/aiChat/index.js'

// SETTINGS

export const ThemePref = Schema.Literals(['system', 'light', 'dark'])
export type ThemePref = typeof ThemePref.Type

export const Speed = Schema.Literals(['slow', 'normal', 'fast'])
export type Speed = typeof Speed.Type

export const ChaosSchema = Schema.Struct({
  failMidStream: Schema.Boolean,
  dropConnection: Schema.Boolean,
  slowFirstToken: Schema.Boolean,
  refuseSend: Schema.Boolean,
})
export type ChaosSchema = typeof ChaosSchema.Type
export const ChaosName = Schema.Literals(['failMidStream', 'dropConnection', 'slowFirstToken', 'refuseSend'])
export type ChaosName = typeof ChaosName.Type

/** What is kept on the phone between launches. */
export const Settings = Schema.Struct({
  theme: ThemePref,
  speed: Speed,
})
export type Settings = typeof Settings.Type
export const DEFAULT_SETTINGS: Settings = { theme: 'system', speed: 'normal' }

// SHEETS

export const Sheet = Schema.Union([
  Schema.TaggedStruct('Settings', {}),
  /** The reasoning of one reply, by the row's key. */
  Schema.TaggedStruct('Reasoning', { rowKey: Schema.String }),
  Schema.TaggedStruct('Rename', { id: Schema.String, title: Schema.String }),
  /** A reply drawn with text selection on, for copying a part of it. */
  Schema.TaggedStruct('SelectText', { rowKey: Schema.String }),
])
export type Sheet = typeof Sheet.Type

/** The message a long press opened the action sheet for. */
export const MessageMenu = Schema.Struct({
  rowKey: Schema.String,
  text: Schema.String,
  canRegenerate: Schema.Boolean,
})
export type MessageMenu = typeof MessageMenu.Type

/** A line above the composer: a refused message, a copy. */
export const Notice = Schema.Struct({
  text: Schema.String,
  tone: Schema.Literals(['info', 'error']),
})
export type Notice = typeof Notice.Type

export const Recording = Schema.Struct({
  seconds: Schema.Number,
  isNearLimit: Schema.Boolean,
})

// THE ROWS OF A CHAT

/** One row of the transcript, with a key that stays the same from sending to saved. */
export type ChatRow = TranscriptRow &
  Readonly<{
    /** The newest reply: the one Regenerate writes again. */
    isLastReply: boolean
  }>

/** The text of a row: its text parts joined. */
export const textOf = (parts: ReadonlyArray<Part>): string =>
  parts.map(part => (part._tag === 'Text' ? part.text : '')).join('')

/** The key of the newest question in the chat, if any. */
export const lastQuestionKey = (rows: ReadonlyArray<ChatRow>): Option.Option<string> => {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]
    if (row !== undefined && row.role === 'user') return Option.some(row.key)
  }
  return Option.none()
}

// THE LIST, GROUPED BY DAY

const DAY_MS = 24 * 60 * 60 * 1000

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Midnight at the start of the day `ms` falls on, in the phone's time zone. */
const startOfDay = (ms: number): number => {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** The heading a conversation last changed at `updatedAt` goes under. */
export const dayGroupOf = (updatedAt: number, nowMs: number): string => {
  const today = startOfDay(nowMs)
  if (updatedAt >= today) return 'Today'
  if (updatedAt >= today - DAY_MS) return 'Yesterday'
  if (updatedAt >= today - 7 * DAY_MS) return 'Previous 7 days'
  if (updatedAt >= today - 30 * DAY_MS) return 'Previous 30 days'
  const date = new Date(updatedAt)
  const month = MONTHS[date.getMonth()] ?? ''
  return date.getFullYear() === new Date(nowMs).getFullYear() ? month : `${month} ${date.getFullYear()}`
}

export type ListItem =
  | Readonly<{ _tag: 'Header'; key: string; title: string }>
  | Readonly<{ _tag: 'Chat'; key: string; summary: ConversationSummary }>

/** Whether a conversation matches what was typed in search: title or preview, any case. */
export const matchesQuery = (summary: ConversationSummary, query: string): boolean => {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return true
  return summary.title.toLowerCase().includes(wanted) || summary.preview.toLowerCase().includes(wanted)
}

/**
 * The list's rows: a heading for each day group, then its conversations,
 * newest first. A search shows its matches with no headings.
 */
export const listItems = (
  summaries: ReadonlyArray<ConversationSummary>,
  nowMs: number,
  query: string,
): ReadonlyArray<ListItem> => {
  const sorted = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
  if (query.trim() !== '') {
    return sorted
      .filter(summary => matchesQuery(summary, query))
      .map(summary => ({ _tag: 'Chat', key: summary.id, summary }))
  }
  const items: Array<ListItem> = []
  let group = ''
  for (const summary of sorted) {
    const next = dayGroupOf(summary.updatedAt, nowMs)
    if (next !== group) {
      group = next
      items.push({ _tag: 'Header', key: `header-${next}`, title: next })
    }
    items.push({ _tag: 'Chat', key: summary.id, summary })
  }
  return items
}

/** "Thought for 4 s": whole seconds, at least one. */
export const thoughtFor = (seconds: number): string => `Thought for ${Math.max(1, Math.round(seconds))} s`

/** Minutes and seconds, as a voice note's length is shown: 0:07. */
export const clockOf = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
