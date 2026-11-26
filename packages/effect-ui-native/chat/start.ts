/**
 * Starts Effect Chat on a phone screen.
 *
 *   startChat({ fabric: getFabricUIManager(), rootTag, platform: Platform.OS, device })
 *
 * `device` is the phone's services: `Phone.Device.live(modules)` over the
 * real native modules, or a test's fakes.
 *
 * The pretend AI server runs inside the app. It keeps the chats on `disk`:
 * files on a phone, memory in a test.
 */
import type { FabricUIManager } from '@ng-native/fabric'
import { Layer } from 'effect'

import { type AiServer, type Disk, makeAiServer, memoryDisk } from '../../native/src/host/aiChat/server.js'
import { type InProcessLink, layerInProcess, makeInProcessLink } from '../../native/src/host/aiChat/transport.js'
import { registerNavigation } from '../../native/src/host/navigation/views.js'
import { NativeHost, NativeQuery, Phone } from '../src/index.js'
import { App } from './app.js'
import * as Data from './data.js'

/** The phone services the app reads. */
export type DeviceServices = Phone.Services | Phone.Device.Network.Network

export type ChatServicesOptions = Readonly<{
  /** The pretend server. A test passes its own to set its speed and read its log. */
  server?: AiServer
  /** Where the server keeps the chats when no server is given. Memory if left out. */
  disk?: Disk
  /** The cable between the app and the server. A test passes its own to cut it. */
  link?: InProcessLink
  /** The window in which pieces of a reply become one Message. 32 ms if left out. */
  batchMs?: number
}>

export type ChatOptions = NativeHost.SurfaceOptions &
  ChatServicesOptions &
  Readonly<{
    fabric: FabricUIManager
    rootTag: number
    platform: string
    device: Layer.Layer<DeviceServices>
    onSurface?: (surface: NativeHost.NativeSurface) => void
  }>

/**
 * What the app's components ask for, over the phone's services: the queries
 * and Commands with the server behind them, the phone Commands, and the two
 * facts the query cache needs (app in front, phone online).
 */
export const chatServices = (device: Layer.Layer<DeviceServices>, options: ChatServicesOptions = {}) => {
  const server = options.server ?? makeAiServer({ disk: options.disk ?? memoryDisk().disk })
  const transport = layerInProcess(server, options.link ?? makeInProcessLink())
  return Layer.mergeAll(
    Data.layer.pipe(Layer.provide(transport)),
    Phone.layer,
    NativeQuery.layer,
    options.batchMs === undefined ? Layer.empty : Layer.succeed(Data.BatchMs, options.batchMs),
  ).pipe(Layer.provide(device))
}

/** The whole app as one Layer: the mount, and everything it asks for. */
export const chatLayer = (options: ChatOptions): Layer.Layer<never> => {
  const { platform, device, server, disk, link, batchMs, ...mountOptions } = options
  registerNavigation()
  return NativeHost.mount(App, { platform }, mountOptions).pipe(
    Layer.provide(
      chatServices(device, {
        ...(server === undefined ? {} : { server }),
        ...(disk === undefined ? {} : { disk }),
        ...(link === undefined ? {} : { link }),
        ...(batchMs === undefined ? {} : { batchMs }),
      }),
    ),
    Layer.provide(device),
  )
}

/** Starts it. Returns a function that stops it. */
export const startChat = (options: ChatOptions): (() => void) => NativeHost.run(chatLayer(options))
