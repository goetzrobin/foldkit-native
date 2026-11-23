/**
 * Light or dark, as the user set the phone.
 *
 *   // app entry
 *   import { Appearance } from 'react-native'
 *   const resources = ColorScheme.live(Appearance)
 *
 *   // subscriptions
 *   colorScheme: ColorScheme.changesEntry(message =>
 *     Message.GotColorSchemeMessage({ message })),
 *
 * Keep the scheme in the Model and pick colors from it in the view.
 */
import { Context, Layer, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'

import {
  type NativeSubscription,
  type Source,
  makeTestSource,
  streamOf,
} from './common.js'

export const Scheme = Schema.Literals(['light', 'dark'])
export type Scheme = typeof Scheme.Type

export type ColorSchemeService = Readonly<{ schemes: Source<Scheme> }>

export class ColorScheme extends Context.Service<ColorScheme, ColorSchemeService>()(
  'foldkit-native/ColorScheme',
) {}

/** The part of React Native's `Appearance` used here. */
export interface AppearanceModule {
  getColorScheme(): string | null | undefined
  addChangeListener(listener: (preferences: any) => void): NativeSubscription
}

export const live = (module: AppearanceModule): Layer.Layer<ColorScheme> =>
  Layer.succeed(ColorScheme, {
    schemes: {
      subscribe: listener => {
        // No preference reads as light.
        const read = (): Scheme => (module.getColorScheme() === 'dark' ? 'dark' : 'light')
        // The phone also reports appearance changes that are not the scheme,
        // so each scheme is passed on once.
        let last = read()
        const subscription = module.addChangeListener(() => {
          const scheme = read()
          if (scheme === last) return
          last = scheme
          listener(scheme)
        })
        listener(last)
        return () => subscription.remove()
      },
    },
  })

/** A fake. `set('dark')` is the user switching the phone to dark mode. */
export const makeTest = (initial: Scheme = 'light') => {
  const schemes = makeTestSource<Scheme>(initial)
  return {
    layer: Layer.succeed(ColorScheme, { schemes: schemes.source }),
    set: schemes.emit,
    listenerCount: schemes.listenerCount,
  }
}

export const Message = defineMessageUnion({
  ChangedColorScheme: { scheme: Scheme },
})
export type Message = typeof Message.Type

/** The scheme when the Subscription starts, then each change. */
export const changes: Stream.Stream<Message, never, ColorScheme> = Stream.unwrap(
  ColorScheme.useSync(colorScheme =>
    Stream.map(streamOf('color scheme', colorScheme.schemes), scheme =>
      Message.ChangedColorScheme({ scheme }),
    ),
  ),
)

export const changesEntry = <AppMessage>(toMessage: (message: Message) => AppMessage) =>
  Subscription.persistentEntry(Stream.map(changes, toMessage))
