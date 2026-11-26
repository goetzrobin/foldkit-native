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
import { NativeHost, NativeQuery, Phone } from '../src/index.js'
import { App } from './app.js'
import * as ServerState from './serverState.js'

export type PlaygroundOptions = NativeHost.SurfaceOptions &
  Readonly<{
    fabric: FabricUIManager
    rootTag: number
    platform: string
    /** The phone's services: `Phone.live(modules)`, or a test's fakes. */
    device: Layer.Layer<Phone.Services>
    hasReadout?: boolean
    /** How long the pretend server of the Server state screen takes to answer. */
    serverDelayMs?: number
    onSurface?: (surface: NativeHost.NativeSurface) => void
  }>

/**
 * What the app's components ask for, over the phone's services: the phone
 * Commands, the Server state screen's query and writes with their pretend
 * server, and whether the app is in front, for the query cache.
 */
export const playgroundServices = (
  device: Layer.Layer<Phone.Services>,
  options: Readonly<{ serverDelayMs?: number }> = {},
) =>
  Layer.mergeAll(
    Phone.layer,
    Layer.provideMerge(
      ServerState.layer,
      ServerState.fakeServer(options.serverDelayMs === undefined ? {} : { delayMs: options.serverDelayMs }),
    ),
    NativeQuery.visibility,
  ).pipe(Layer.provide(device))

/** The whole app as one Layer: the mount, the Command services, the phone's services. */
export const playgroundLayer = (options: PlaygroundOptions): Layer.Layer<never> => {
  const { platform, device, hasReadout = true, serverDelayMs, ...mountOptions } = options
  registerNavigation()
  return NativeHost.mount(App, { platform, hasReadout }, mountOptions).pipe(
    Layer.provide(playgroundServices(device, serverDelayMs === undefined ? {} : { serverDelayMs })),
    Layer.provide(device),
  )
}

/** Starts it. Returns a function that stops it. */
export const startPlayground = (options: PlaygroundOptions): (() => void) =>
  NativeHost.run(playgroundLayer(options))
