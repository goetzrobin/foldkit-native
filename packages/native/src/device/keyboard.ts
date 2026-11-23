/**
 * The on-screen keyboard: put it away, and know when it shows and how tall
 * it is.
 *
 *   // app entry
 *   import { Keyboard as NativeKeyboard, Platform } from 'react-native'
 *   const resources = Keyboard.live(NativeKeyboard, {
 *     platform: Platform.OS,
 *     blurFocused: () => surface.engine.blurFocused(),
 *   })
 *
 *   // subscriptions
 *   Subscription.make<Model, Message, Keyboard.Keyboard>()(() => ({
 *     keyboard: Keyboard.changesEntry(message => Message.GotKeyboardMessage({ message })),
 *   }))
 *
 *   // update
 *   commands: [Command.mapMessage(Keyboard.Dismiss(), toMessage)]
 *
 * Pass `blurFocused`. React Native's own `Keyboard.dismiss()` only knows the
 * fields its `TextInput` component recorded, and this adapter draws the
 * native field without that component, so that call alone leaves the
 * keyboard up. The engine knows which field has the focus and blurs it.
 */
import { Context, Effect, Layer, Schema, Stream } from 'effect'
import { Command, Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import {
  type NativeSubscription,
  type Source,
  makeTestSource,
  streamOf,
} from './common.js'

export type KeyboardService = Readonly<{
  dismiss: Effect.Effect<void>
  /** The keyboard's height in points, 0 when it is hidden. */
  heights: Source<number>
}>

export class Keyboard extends Context.Service<Keyboard, KeyboardService>()(
  'foldkit-native/Keyboard',
) {}

type KeyboardEvent = Readonly<{ endCoordinates?: { height?: number } }>

/** The part of React Native's `Keyboard` used here. */
export interface KeyboardModule {
  dismiss(): void
  addListener(event: any, listener: (event: any) => void): NativeSubscription
  /** Where the keyboard is now, if it is up. Missing on older React Native. */
  metrics?(): { height: number } | null | undefined
}

const heightOf = (event: KeyboardEvent | undefined): number =>
  event?.endCoordinates?.height ?? 0

/**
 * Which events to hear differs by platform, as in React Native's own
 * KeyboardAvoidingView.
 *
 * iOS sends "will" events as the keyboard starts to move, so the app can
 * move with it. `keyboardWillChangeFrame` covers a keyboard that changes
 * height while up (the suggestions bar). iOS sends one beside every hide as
 * well, so it is ignored while the keyboard is down.
 *
 * Android sends no "will" events, only "did" ones.
 */
const heightsOf = (module: KeyboardModule, platform: string): Source<number> => ({
  subscribe: listener => {
    const now = module.metrics?.()?.height ?? 0
    let isUp = now > 0
    const show = (event: KeyboardEvent) => {
      isUp = true
      listener(heightOf(event))
    }
    const hide = () => {
      isUp = false
      listener(0)
    }
    const subscriptions =
      platform === 'ios'
        ? [
            module.addListener('keyboardWillShow', show),
            module.addListener('keyboardWillChangeFrame', (event: KeyboardEvent) => {
              if (isUp) listener(heightOf(event))
            }),
            module.addListener('keyboardWillHide', hide),
          ]
        : [
            module.addListener('keyboardDidShow', show),
            module.addListener('keyboardDidHide', hide),
          ]
    listener(now)
    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  },
})

export const live = (
  module: KeyboardModule,
  options: Readonly<{
    /** `Platform.OS` */
    platform: string
    /** `() => surface.engine.blurFocused()`. See the top of this file. */
    blurFocused?: () => void
  }>,
): Layer.Layer<Keyboard> =>
  Layer.succeed(Keyboard, {
    dismiss: Effect.sync(() => {
      try {
        options.blurFocused?.()
        module.dismiss()
      } catch (error) {
        console.warn('[foldkit-native] The keyboard could not be dismissed', error)
      }
    }),
    heights: heightsOf(module, options.platform),
  })

/**
 * A fake keyboard. `show(height)` and `hide()` move it as the phone would.
 * `dismissCount()` says how often the program put it away, which also hides
 * it. Pass `blurFocused` to have a dismiss blur the simulated phone's field.
 */
export const makeTest = (options: Readonly<{ blurFocused?: () => void }> = {}) => {
  const heights = makeTestSource(0)
  let dismissed = 0
  const layer = Layer.succeed(Keyboard, {
    dismiss: Effect.sync(() => {
      dismissed += 1
      options.blurFocused?.()
      heights.emit(0)
    }),
    heights: heights.source,
  })
  return {
    layer,
    show: (height: number) => heights.emit(height),
    hide: () => heights.emit(0),
    dismissCount: () => dismissed,
    listenerCount: heights.listenerCount,
  }
}

export const Message = defineMessageUnion({
  CompletedDismissKeyboard: {},
  /** The keyboard is up, or changed height while up. */
  ShownKeyboard: { height: Schema.Number },
  HidKeyboard: {},
})
export type Message = typeof Message.Type

/** Puts the keyboard away, as a tap outside the field does in other apps. */
export const Dismiss = Command.define('Keyboard.Dismiss', {
  messages: [Message.CompletedDismissKeyboard],
  execute: Keyboard.use(keyboard => keyboard.dismiss).pipe(
    Effect.as(Message.CompletedDismissKeyboard()),
  ),
})

/**
 * `HidKeyboard` or `ShownKeyboard` for the keyboard as it is when the
 * Subscription starts, then one for each change.
 */
export const changes: Stream.Stream<
  typeof Message.ShownKeyboard.Type | typeof Message.HidKeyboard.Type,
  never,
  Keyboard
> = Stream.unwrap(
  Keyboard.useSync(keyboard =>
    Stream.map(streamOf('keyboard', keyboard.heights), height =>
      height > 0 ? Message.ShownKeyboard({ height }) : Message.HidKeyboard(),
    ),
  ),
)

/** `changes` as a Subscription entry that runs for the life of the program. */
export const changesEntry = <AppMessage>(
  toMessage: (
    message: typeof Message.ShownKeyboard.Type | typeof Message.HidKeyboard.Type,
  ) => AppMessage,
) => Subscription.persistentEntry(Stream.map(changes, toMessage))
