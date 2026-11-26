/**
 * The list of chats as rows: a heading for each day group, then its chats,
 * newest first. A search shows its matches with no headings.
 *
 * Pure functions, shared by the list's view and its tests. They are Fold
 * Chat's (`packages/native/flagship/model.ts`), copied, because this program
 * may not import from there.
 */
import type { ConversationSummary } from '../../native/src/host/aiChat/wire.js'

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

/** The heading a chat last changed at `updatedAt` goes under. */
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

/** Whether a chat matches what was typed in search: title or preview, any case. */
export const matchesQuery = (summary: ConversationSummary, query: string): boolean => {
  const wanted = query.trim().toLowerCase()
  if (wanted === '') return true
  return summary.title.toLowerCase().includes(wanted) || summary.preview.toLowerCase().includes(wanted)
}

export const listItems = (
  summaries: ReadonlyArray<ConversationSummary>,
  nowMs: number,
  query: string,
): ReadonlyArray<ListItem> => {
  const sorted = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)
  if (query.trim() !== '') {
    return sorted.filter(summary => matchesQuery(summary, query)).map(summary => ({ _tag: 'Chat', key: summary.id, summary }))
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

/** Minutes and seconds, as a voice note's length is shown: 0:07. */
export const clockOf = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
