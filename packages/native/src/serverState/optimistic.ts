/**
 * Optimistic writes: show a change at once, before the server has answered.
 *
 * When a person renames something and presses Save, waiting half a second
 * to see the new name feels broken. So the screen shows the new name right
 * away, as a thin layer over what the server last said. If the server says
 * yes, the layer stays until fresh data arrives and then goes. If the server
 * says no, the layer is taken off, the old name is back, and the screen says
 * why.
 *
 * For engineers. The layer is a field in the Model, so it is plain Foldkit:
 *
 *   overlay: Optimistic.Overlay(Schema.Struct({ name: Schema.String }))
 *
 *   PressedSave      overlay = Optimistic.begin(writeId, { name })   + the write Command
 *   SucceededSave    overlay = Optimistic.confirm(overlay, writeId)
 *   FailedSave       overlay = Optimistic.rollBack(overlay, writeId) + say why
 *   ChangedMember    overlay = Optimistic.settle(overlay, result)
 *   view             Optimistic.shown(overlay, member, (member, patch) => ({ ...member, ...patch }))
 *
 * The write announces its sync topic when it succeeds (see `sync.ts`). That
 * makes the read load again, and `settle` drops the layer when that fresh
 * value arrives. `writeId` is a number the Model counts up. It stops the
 * answer to an older write from touching the layer of a newer one.
 *
 * Known limit: if the fresh value arrives before the write's own answer, the
 * layer is confirmed late and stays until the next load. It then shows what
 * the server confirmed, so the screen is right, only for longer than needed.
 */
import { Option, Schema } from 'effect'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'

/** The Schema of an overlay field for a patch of the given shape. */
export const Overlay = <Patch extends Schema.Top>(patch: Patch) =>
  Schema.Option(
    Schema.Struct({
      /** Which write put this here. */
      writeId: Schema.Number,
      patch,
      /** False while the write is on its way, true once the server said yes. */
      isConfirmed: Schema.Boolean,
    }),
  )

export type Overlay<Patch> = Option.Option<
  Readonly<{ writeId: number; patch: Patch; isConfirmed: boolean }>
>

export const none = <Patch>(): Overlay<Patch> => Option.none()

/** Show `patch` now. Replaces the layer of any write still on its way. */
export const begin = <Patch>(writeId: number, patch: Patch): Overlay<Patch> =>
  Option.some({ writeId, patch, isConfirmed: false })

const isFrom = <Patch>(overlay: Overlay<Patch>, writeId: number): boolean =>
  Option.isSome(overlay) && overlay.value.writeId === writeId

/** The server said yes. The layer stays until fresh data arrives. */
export const confirm = <Patch>(overlay: Overlay<Patch>, writeId: number): Overlay<Patch> =>
  isFrom(overlay, writeId)
    ? Option.map(overlay, each => ({ ...each, isConfirmed: true }))
    : overlay

/** The server said no. The layer comes off and the old value shows again. */
export const rollBack = <Patch>(overlay: Overlay<Patch>, writeId: number): Overlay<Patch> =>
  isFrom(overlay, writeId) ? Option.none() : overlay

/**
 * A read reported a result. A confirmed layer is dropped once that result
 * is a finished, successful load. Anything else leaves the layer alone.
 */
export const settle = <Patch, A, E>(
  overlay: Overlay<Patch>,
  result: AsyncResult.AsyncResult<A, E>,
): Overlay<Patch> =>
  Option.isSome(overlay) &&
  overlay.value.isConfirmed &&
  result._tag === 'Success' &&
  !result.waiting
    ? Option.none()
    : overlay

/** What the screen should draw: the server's value with the layer on top. */
export const shown = <Patch, A>(
  overlay: Overlay<Patch>,
  value: A,
  apply: (value: A, patch: Patch) => A,
): A =>
  Option.match(overlay, {
    onNone: () => value,
    onSome: ({ patch }) => apply(value, patch),
  })

/** Whether a write is still on its way. For a "Saving…" label. */
export const isPending = <Patch>(overlay: Overlay<Patch>): boolean =>
  Option.isSome(overlay) && !overlay.value.isConfirmed
