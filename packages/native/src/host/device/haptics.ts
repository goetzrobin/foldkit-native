/**
 * Haptics: the small taps and buzzes the phone makes under a finger.
 *
 *   // app entry
 *   import * as ExpoHaptics from 'expo-haptics'
 *   const resources = Haptics.live(ExpoHaptics)
 *
 *   // update
 *   PressedSave: () => ({
 *     model,
 *     commands: [
 *       Command.mapMessage(Haptics.Notify({ type: 'success' }), message =>
 *         Message.GotHapticsMessage({ message })),
 *     ],
 *   })
 *
 * The phone decides whether anything is felt. A simulator, a phone in low
 * power mode and an Android phone with touch feedback off all stay still and
 * report success.
 */
import { Context, Effect, Layer, Schema } from 'effect'

import { type DeviceError, attempt, makeFailure } from './common.js'

/** How hard a tap feels. */
export const ImpactStyle = Schema.Literals(['light', 'medium', 'heavy'])
export type ImpactStyle = typeof ImpactStyle.Type

/** What happened, for the three patterns the phone plays for an outcome. */
export const NotificationType = Schema.Literals(['success', 'warning', 'error'])
export type NotificationType = typeof NotificationType.Type

export type HapticsService = Readonly<{
  impact: (style: ImpactStyle) => Effect.Effect<void, DeviceError>
  selection: Effect.Effect<void, DeviceError>
  notification: (type: NotificationType) => Effect.Effect<void, DeviceError>
}>

export class Haptics extends Context.Service<Haptics, HapticsService>()(
  'foldkit-native/Haptics',
) {}

/**
 * The part of `expo-haptics` used here. Its enums are the same words as the
 * styles above (`ImpactFeedbackStyle.Light` is `'light'`), so the words are
 * passed straight through.
 */
export interface HapticsModule {
  impactAsync(style: any): Promise<void>
  selectionAsync(): Promise<void>
  notificationAsync(type: any): Promise<void>
}

/** `Haptics.live(await import('expo-haptics'))`, or the namespace import. */
export const live = (module: HapticsModule): Layer.Layer<Haptics> =>
  Layer.succeed(Haptics, {
    impact: style => attempt('haptics', () => module.impactAsync(style)),
    selection: attempt('haptics', () => module.selectionAsync()),
    notification: type => attempt('haptics', () => module.notificationAsync(type)),
  })

/** A fake that records each tap as a word: `impact:light`, `selection`, `notification:error`. */
export const makeTest = () => {
  const calls: Array<string> = []
  const { failNext, guard } = makeFailure('haptics')
  const record = (call: string) =>
    guard(() => {
      calls.push(call)
    })
  const layer = Layer.succeed(Haptics, {
    impact: style => record(`impact:${style}`),
    selection: record('selection'),
    notification: type => record(`notification:${type}`),
  })
  return { layer, calls, failNext }
}
