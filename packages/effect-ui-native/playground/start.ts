/**
 * Starts the playground on a phone screen.
 *
 *   startPlayground({ fabric: getFabricUIManager(), rootTag, platform: Platform.OS, modules })
 *
 * `modules` are the real native modules, as the app imports them. A test
 * passes a `device` Layer of fakes instead.
 */
import type { FabricUIManager } from '@ng-native/fabric'
import { Layer } from 'effect'

import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { NativeHost, Phone } from '../src/index.js'
import { App } from './app.js'

export type PlaygroundOptions = NativeHost.SurfaceOptions &
  Readonly<{
    fabric: FabricUIManager
    rootTag: number
    platform: string
    /** The phone's services: `Phone.live(modules)`, or a test's fakes. */
    device: Layer.Layer<Phone.Services>
    hasReadout?: boolean
    onSurface?: (surface: NativeHost.NativeSurface) => void
  }>

/** The whole app as one Layer: the mount, the Command services, the phone's services. */
export const playgroundLayer = (options: PlaygroundOptions): Layer.Layer<never> => {
  const { platform, device, hasReadout = true, ...mountOptions } = options
  registerNavigation()
  return NativeHost.mount(App, { platform, hasReadout }, mountOptions).pipe(
    Layer.provide(Phone.layer),
    Layer.provide(device),
  )
}

/** Starts it. Returns a function that stops it. */
export const startPlayground = (options: PlaygroundOptions): (() => void) =>
  NativeHost.run(playgroundLayer(options))
