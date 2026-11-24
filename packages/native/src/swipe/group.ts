/**
 * Which rows are open, and the one rule they share: in a group, only one
 * row is open at a time.
 *
 * Every driver's rows join here, so the rule holds across drivers, and so
 * `closeSwipe` and `closeAllSwipes` reach a row whatever moves it.
 */
import { Effect } from 'effect'

export const DEFAULT_GROUP = 'default'

export type SwipeMember = Readonly<{
  group: string
  id: string
  /** Whether the row is open, opening, or held by a finger. */
  isOpen: () => boolean
  /** Closes the row. `animated` false jumps. */
  close: (animated: boolean) => void
}>

const members = new Set<SwipeMember>()

/** A row joins when it is drawn. Returns how it leaves. */
export const joinSwipeGroup = (member: SwipeMember): (() => void) => {
  members.add(member)
  return () => {
    members.delete(member)
  }
}

/** A row calls this when a finger starts to move it, and when it opens. The others close. */
export const closeOtherSwipes = (member: SwipeMember): void => {
  for (const other of [...members]) {
    if (other !== member && other.group === member.group && other.isOpen()) other.close(true)
  }
}

const closeWhere = (matches: (member: SwipeMember) => boolean, animated: boolean): void => {
  for (const member of [...members]) {
    if (matches(member) && member.isOpen()) member.close(animated)
  }
}

export type CloseOptions = Readonly<{
  /** Default `'default'`. */
  group?: string
  /** Default true. */
  animated?: boolean
}>

/**
 * Closes one row. An Effect, for a Command:
 *
 *   execute: closeSwipe(id).pipe(Effect.as(Message.CompletedCloseSwipe()))
 */
export const closeSwipe = (id: string, options: CloseOptions = {}): Effect.Effect<void> =>
  Effect.sync(() => {
    const group = options.group ?? DEFAULT_GROUP
    closeWhere(member => member.group === group && member.id === id, options.animated ?? true)
  })

/** Closes every open row of a group, or of every group when none is named. An Effect, for a Command. */
export const closeAllSwipes = (
  group?: string,
  options: Readonly<{ animated?: boolean }> = {},
): Effect.Effect<void> =>
  Effect.sync(() => {
    closeWhere(member => group === undefined || member.group === group, options.animated ?? true)
  })

/** How many rows are open in a group. For tests and status lines. */
export const openSwipeCount = (group: string = DEFAULT_GROUP): number =>
  [...members].filter(member => member.group === group && member.isOpen()).length
