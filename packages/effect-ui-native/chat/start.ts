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

import { type AiServer, type Disk, diskFromFiles, makeAiServer, memoryDisk } from '../../native/src/host/aiChat/server.js'
import { type InProcessLink, layerInProcess, makeInProcessLink } from '../../native/src/host/aiChat/transport.js'
import { registerNavigation, registerSearchBar } from '../../native/src/host/navigation/views.js'
import { Menus, NativeCrash, NativeHost, NativeQuery, Phone } from '../src/index.js'
import { App } from './app.js'
import { SharedClock, type SharedClockService, makeClock } from './clock.js'
import * as Data from './data.js'
import * as Events from './events.js'
import * as Playback from './playback.js'
import * as Timeline from './timeline.js'

/** The phone services the app reads: all of them. */
export type DeviceServices = Phone.Device.Services

export type ChatServicesOptions = Readonly<{
  /** The pretend server. A test passes its own to set its speed and read its log. */
  server?: AiServer
  /** Where the server keeps the chats when no server is given. Memory if left out. */
  disk?: Disk
  /** The cable between the app and the server. A test passes its own to cut it. */
  link?: InProcessLink
  /** The window in which pieces of a reply become one Message. 32 ms if left out. */
  batchMs?: number
  /** The phone's list of choices. The real one if left out. A test passes `Menus.makeTest().layer`. */
  menus?: Layer.Layer<Menus.ActionSheet>
  /** The clock for "Today" and "Yesterday". The phone's if left out. */
  now?: () => number
  /**
   * The shared clock that numbers the player's steps and, where a recorder
   * is given, the screens' log entries. A new one if left out.
   */
  clock?: SharedClockService
  /** Development only: keeps the screens' log, so the merged timeline can be copied from Settings. */
  recorder?: Timeline.Recorder
}>

export type ChatOptions = NativeHost.SurfaceOptions &
  ChatServicesOptions &
  Readonly<{
    fabric: FabricUIManager
    rootTag: number
    platform: string
    device: Layer.Layer<DeviceServices>
    onSurface?: (surface: NativeHost.NativeSurface) => void
    /**
     * Development only: `NativeDevTools.layer(...)`, which sends the app's
     * message log to the dev tools server. See docs/DEV_TOOLS.md.
     */
    devTools?: Layer.Layer<never>
    /**
     * Development only: `true` keeps the screens' log beside the player's
     * own record, and Settings gets a row that copies the two as one
     * timeline. See docs/STATE_MACHINES.md.
     */
    timeline?: boolean
  }>

/**
 * Where the chats are kept on a phone: files in the app's documents, which
 * are still there after the app closes. In a build without the file module:
 * memory, kept while the app runs.
 */
export const phoneDisk = (): Disk => {
  try {
    const module = Phone.Device.Native.fileSystemFromGlobal()
    return module === null ? memoryDisk().disk : diskFromFiles(Phone.Device.Native.filesFrom(module, 'effect-chat'))
  } catch {
    return memoryDisk().disk
  }
}

/**
 * What the app's components ask for, over the phone's services: the queries
 * and Commands with the server behind them, the phone Commands, and the two
 * facts the query cache needs (app in front, phone online).
 */
export const chatServices = (device: Layer.Layer<DeviceServices>, options: ChatServicesOptions = {}) => {
  const server = options.server ?? makeAiServer({ disk: options.disk ?? memoryDisk().disk })
  const transport = layerInProcess(server, options.link ?? makeInProcessLink())
  // The app's one audio player. It is built here, once, and lives until the
  // app's Layer closes. No screen makes it, so it outlives every screen.
  const player = Playback.Player.Live.pipe(Layer.provide(Layer.succeed(SharedClock, options.clock ?? makeClock())))
  return Layer.mergeAll(
    Layer.merge(Playback.layer, Timeline.CopyTimeline.layerFor(options.recorder ?? null)).pipe(Layer.provideMerge(player)),
    Data.layer.pipe(Layer.provide(transport)),
    // The pretend server's switches, for the demo controls in Settings.
    Data.SetServerDials.layerFor(server),
    // One-off events between screens. See `events.ts`.
    Events.layer,
    Phone.layerAll,
    Menus.layer.pipe(Layer.provide(options.menus ?? Menus.live)),
    NativeQuery.layer,
    options.batchMs === undefined ? Layer.empty : Layer.succeed(Data.BatchMs, options.batchMs),
    options.now === undefined ? Layer.empty : Layer.succeed(Data.Now, options.now),
  ).pipe(Layer.provide(device))
}

/**
 * What the phone shows when a part of the app fails. Start again mounts the
 * app anew over the same server and files, so the chats are all still there.
 */
export const chatCrash = NativeCrash.screen({ hint: 'Your chats are saved. Start again to go back to them.' })

/** The whole app as one Layer: the mount, and everything it asks for. */
export const chatLayer = (options: ChatOptions): Layer.Layer<never> => {
  const { platform, device, server, disk, link, batchMs, menus, now, devTools, timeline, clock: givenClock, recorder: givenRecorder, ...mountOptions } = options
  registerNavigation()
  registerSearchBar()
  // One clock for the player and for the recorder of the screens' log, so their numbers line up.
  const clock = givenClock ?? makeClock()
  const recorder = givenRecorder ?? (timeline === true ? Timeline.makeRecorder(clock) : undefined)
  const logs = recorder === undefined ? (devTools ?? Layer.empty) : Timeline.recording(recorder, devTools ?? Layer.empty)
  return NativeHost.mount(App, { platform, hasTimeline: recorder !== undefined }, { ...mountOptions, crash: chatCrash }).pipe(
    Layer.provide(
      chatServices(device, {
        ...(server === undefined ? {} : { server }),
        ...(disk === undefined ? {} : { disk }),
        ...(link === undefined ? {} : { link }),
        ...(batchMs === undefined ? {} : { batchMs }),
        ...(menus === undefined ? {} : { menus }),
        ...(now === undefined ? {} : { now }),
        clock,
        ...(recorder === undefined ? {} : { recorder }),
      }),
    ),
    Layer.provide(device),
    Layer.provide(logs),
  )
}

/** Starts it. Returns a function that stops it. */
export const startChat = (options: ChatOptions): (() => void) => NativeHost.run(chatLayer(options))
