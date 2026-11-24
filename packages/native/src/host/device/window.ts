/**
 * How big the app's window is, and which way up the phone is held.
 *
 *   // app entry
 *   import { Dimensions } from 'react-native'
 *   const resources = Window.live(Dimensions)
 *
 *   // subscriptions
 *   window: Window.changesEntry(message => Message.GotWindowMessage({ message })),
 *
 * The size is in points, the unit styles use. It changes when the phone
 * turns, and on a tablet when the app shares the screen.
 */
import { Context, Layer, Schema } from 'effect'

import { type NativeSubscription, type Source, makeTestSource } from './common.js'

export const Orientation = Schema.Literals(['portrait', 'landscape'])
export type Orientation = typeof Orientation.Type

export type WindowSize = Readonly<{ width: number; height: number }>

export type WindowService = Readonly<{ sizes: Source<WindowSize> }>

export class Window extends Context.Service<Window, WindowService>()(
  'foldkit-native/Window',
) {}

/** The part of React Native's `Dimensions` used here. */
export interface DimensionsModule {
  get(dimension: any): { width: number; height: number }
  addEventListener(event: any, listener: (sizes: any) => void): NativeSubscription
}

export const live = (module: DimensionsModule): Layer.Layer<Window> =>
  Layer.succeed(Window, {
    sizes: {
      subscribe: listener => {
        const subscription = module.addEventListener(
          'change',
          (sizes: { window: WindowSize }) =>
            listener({ width: sizes.window.width, height: sizes.window.height }),
        )
        const now = module.get('window')
        listener({ width: now.width, height: now.height })
        return () => subscription.remove()
      },
    },
  })

/** A fake. `resize(852, 393)` is the user turning the phone on its side. */
export const makeTest = (initial: WindowSize = { width: 393, height: 852 }) => {
  const sizes = makeTestSource<WindowSize>(initial)
  return {
    layer: Layer.succeed(Window, { sizes: sizes.source }),
    resize: (width: number, height: number) => sizes.emit({ width, height }),
    listenerCount: sizes.listenerCount,
  }
}

export const orientationOf = (size: WindowSize): Orientation =>
  size.width > size.height ? 'landscape' : 'portrait'
