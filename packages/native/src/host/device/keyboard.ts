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
 *
 * HOW MUCH ROOM TO MAKE. `ShownKeyboard` carries two numbers. `height` is the
 * keyboard's own height. `covers` is how much of the app's window it covers,
 * which is what a composer must be raised by. On iOS they are the same. On
 * Android the system usually makes the app's window shorter by itself when
 * the keyboard opens, and then `covers` is 0: raising the composer as well
 * would leave a gap as tall as the keyboard and squeeze the messages out.
 *
 * Whether the window is made shorter is found out on the phone, not read
 * from the app's settings (Expo Go ignores those). Pass `measureWindow`. The
 * window is measured while the keyboard is down and again shortly after it
 * has come up. Until that says otherwise, and always without
 * `measureWindow`, Android reports `covers: 0`.
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

/** The keyboard as it is now. Both are 0 while it is hidden. */
export type KeyboardFrame = Readonly<{
  /** The keyboard's own height in points. */
  height: number
  /** How much of the app's window it covers. See the top of this file. */
  covers: number
}>

export type KeyboardService = Readonly<{
  dismiss: Effect.Effect<void>
  /** The keyboard's height in points, 0 when it is hidden. */
  heights: Source<number>
  /** The same, with how much of the app's window the keyboard covers. */
  frames: Source<KeyboardFrame>
}>

/** Asks for the height of the app's window. May never answer. */
export type MeasureWindow = (use: (height: number) => void) => void

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
/** How long after the keyboard has come up or gone the window is measured. */
const WINDOW_SETTLE_MS = 150

const framesOf = (
  module: KeyboardModule,
  platform: string,
  measureWindow: MeasureWindow | undefined,
): Source<KeyboardFrame> => ({
  subscribe: tell => {
    const now = module.metrics?.()?.height ?? 0
    let isUp = now > 0
    let height = now
    let isStopped = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const later = (run: () => void): void => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!isStopped) run()
      }, WINDOW_SETTLE_MS)
      timers.add(timer)
    }

    // Android only, from here to `listener`.
    /** The window's height with the keyboard down, once measured. */
    let restingWindow: number | undefined
    /** Whether the system makes the window shorter. Unknown before the first keyboard. */
    let windowResizes: boolean | undefined
    const measureResting = (): void => {
      measureWindow?.(measured => {
        if (!isUp && measured > 0) restingWindow = measured
      })
    }
    /**
     * With the keyboard up: is the window shorter than it was? If it is not,
     * the keyboard lies over the app and the app must make the room.
     */
    const checkWindow = (shown: number): void => {
      if (measureWindow === undefined || restingWindow === undefined) return
      const resting = restingWindow
      later(() =>
        measureWindow(measured => {
          if (isStopped || !isUp || height !== shown || measured <= 0) return
          const shorterBy = resting - measured
          windowResizes = shorterBy >= shown / 2
          if (!windowResizes) tell({ height: shown, covers: shown })
        }),
      )
    }
    const coversOf = (shown: number): number => {
      if (platform === 'ios') return shown
      // Not known to lie over the app: no room is made. See the top of this file.
      return windowResizes === false ? shown : 0
    }

    const listener = (shown: number): void => {
      height = shown
      tell({ height: shown, covers: coversOf(shown) })
      if (platform === 'ios') return
      if (shown > 0) {
        if (windowResizes === undefined) checkWindow(shown)
      } else later(measureResting)
    }
    if (platform !== 'ios' && !isUp) measureResting()

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
      isStopped = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      for (const subscription of subscriptions) subscription.remove()
    }
  },
})

const heightsFrom = (frames: Source<KeyboardFrame>): Source<number> => ({
  subscribe: listener => {
    let last: number | undefined
    return frames.subscribe(frame => {
      // A second report for the same keyboard only changes `covers`.
      if (frame.height === last) return
      last = frame.height
      listener(frame.height)
    })
  },
})

export const live = (
  module: KeyboardModule,
  options: Readonly<{
    /** `Platform.OS` */
    platform: string
    /** `() => surface.engine.blurFocused()`. See the top of this file. */
    blurFocused?: () => void
    /**
     * Android: how to measure the app's window, to learn whether the system
     * makes it shorter for the keyboard. `measureAppWindow` from
     * `../keyboard` does it. See the top of this file.
     */
    measureWindow?: MeasureWindow
  }>,
): Layer.Layer<Keyboard> => {
  const frames = framesOf(module, options.platform, options.measureWindow)
  return Layer.succeed(Keyboard, {
    dismiss: Effect.sync(() => {
      try {
        options.blurFocused?.()
        module.dismiss()
      } catch (error) {
        console.warn('[foldkit-native] The keyboard could not be dismissed', error)
      }
    }),
    heights: heightsFrom(frames),
    frames,
  })
}

/**
 * A fake keyboard. `show(height)` and `hide()` move it as the phone would.
 * `dismissCount()` says how often the program put it away, which also hides
 * it. Pass `blurFocused` to have a dismiss blur the simulated phone's field.
 */
export const makeTest = (options: Readonly<{ blurFocused?: () => void }> = {}) => {
  const frames = makeTestSource<KeyboardFrame>({ height: 0, covers: 0 })
  let dismissed = 0
  const layer = Layer.succeed(Keyboard, {
    dismiss: Effect.sync(() => {
      dismissed += 1
      options.blurFocused?.()
      frames.emit({ height: 0, covers: 0 })
    }),
    heights: heightsFrom(frames.source),
    frames: frames.source,
  })
  return {
    layer,
    /**
     * `covers` is how much of the app's window the keyboard covers: all of
     * its height by default, 0 for an Android window that made itself shorter.
     */
    show: (height: number, covers: number = height) => frames.emit({ height, covers }),
    hide: () => frames.emit({ height: 0, covers: 0 }),
    dismissCount: () => dismissed,
    listenerCount: frames.listenerCount,
  }
}

export const Message = defineMessageUnion({
  CompletedDismissKeyboard: {},
  /**
   * The keyboard is up, or changed height while up. `covers` is how much of
   * the app's window it covers: raise a composer by that, not by `height`.
   */
  ShownKeyboard: { height: Schema.Number, covers: Schema.Number },
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
    Stream.map(streamOf('keyboard', keyboard.frames), ({ height, covers }) =>
      height > 0 ? Message.ShownKeyboard({ height, covers }) : Message.HidKeyboard(),
    ),
  ),
)

/** `changes` as a Subscription entry that runs for the life of the program. */
export const changesEntry = <AppMessage>(
  toMessage: (
    message: typeof Message.ShownKeyboard.Type | typeof Message.HidKeyboard.Type,
  ) => AppMessage,
) => Subscription.persistentEntry(Stream.map(changes, toMessage))
