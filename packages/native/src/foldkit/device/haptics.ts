/**
 * Haptics as Foldkit Commands: the small taps and buzzes under a finger.
 *
 * The service, its live Layer and its test fake are in
 * `src/host/device/haptics.ts`, which knows nothing of Foldkit. They are
 * re-exported here, so this module is the whole feature for a Foldkit program.
 */
import { Effect, Schema } from 'effect'
import { Command } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import { type DeviceError } from '../../host/device/common.js'
import { Haptics, ImpactStyle, NotificationType } from '../../host/device/haptics.js'

export * from '../../host/device/haptics.js'

export const Message = defineMessageUnion({
  /** The phone accepted the request. `feedback` is `impact:light` and so on. */
  CompletedPlayHaptic: { feedback: Schema.String },
  FailedPlayHaptic: { feedback: Schema.String, reason: Schema.String },
})
export type Message = typeof Message.Type

const play = (feedback: string, effect: Effect.Effect<void, DeviceError, Haptics>) =>
  effect.pipe(
    Effect.as(Message.CompletedPlayHaptic({ feedback })),
    Effect.catch(error =>
      Effect.succeed(Message.FailedPlayHaptic({ feedback, reason: error.reason })),
    ),
  )

const messages = [Message.CompletedPlayHaptic, Message.FailedPlayHaptic] as const

/** One element bumped into another: a toggle landing, a card snapping. */
export const Impact = Command.define('Haptics.Impact', {
  args: { style: ImpactStyle },
  messages,
  execute: ({ style }) =>
    play(
      `impact:${style}`,
      Haptics.use(haptics => haptics.impact(style)),
    ),
})

/** The selection moved: a picker wheel ticking over. The lightest of all. */
export const Select = Command.define('Haptics.Select', {
  messages,
  execute: play(
    'selection',
    Haptics.use(haptics => haptics.selection),
  ),
})

/** A task ended well, doubtfully or badly. */
export const Notify = Command.define('Haptics.Notify', {
  args: { type: NotificationType },
  messages,
  execute: ({ type }) =>
    play(
      `notification:${type}`,
      Haptics.use(haptics => haptics.notification(type)),
    ),
})
