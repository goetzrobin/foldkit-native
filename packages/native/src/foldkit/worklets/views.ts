/**
 * Tying an element to code on the UI thread.
 *
 *   const x = shared(0)
 *   const slide = () => {
 *     'worklet'
 *     return { transform: [{ translateX: x.value }] }
 *   }
 *
 *   uiThread(
 *     { style: slide, inputs: [x] },
 *     view([style({ width: 60, height: 60 })], []),
 *   )
 *
 * From then on, whenever `x` changes on the UI thread, `slide` runs there
 * and its answer is put on the view. No Message, no view call, no commit
 * from JavaScript. A worklet can also follow a finger (`pan`) and send word
 * back to Foldkit (`channel` with `onUiMessage`).
 *
 * How a view is found. Reanimated's native code names a view by Fabric's
 * handle to it (a "shadow node"), which React normally digs out of a
 * component. The engine under this project has held that handle since it
 * made the view, so it is read from there. Native code follows the handle to
 * the view's "family", which stays the same however often the view is drawn
 * again, so the tie survives every later Foldkit draw.
 *
 * What a style worklet may answer, in this proof: numbers (opacity, width,
 * borderRadius) and `transform` lists. Reanimated's JavaScript, which is not
 * used here, is what turns color names into the numbers native code wants.
 *
 * Where the UI thread cannot be reached the element is left as the view
 * drew it and nothing throws.
 */
import { type Engine, type EngineNode, nativePlatform, registerViewName } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { OnCustomEvent, type VNode, element } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend.js'
import { type Handler, customEvent, handlersByNode, nodeOf } from '../../host/fabric/nodes.js'
import { type UiChannel, listenToChannel } from '../../host/worklets/channel.js'
import {
  gestureModule,
  gesturesCheck,
  reanimatedProxy,
  viewUpdatesCheck,
  workletsPackage,
} from '../../host/worklets/host.js'
import { type Shared, runOnUi, shared, workletCheck } from '../../host/worklets/run.js'
import { type PanEvent, type UiTarget, bindStyle, eventWorklet, unbindStyle } from '../../host/worklets/ui.js'

/** A style as React Native names it. See the top of this file for what is allowed. */
export type UiStyle = Readonly<Record<string, unknown>>

/** Lets a worklet find a view, for example to `measureView` it. */
export type UiRef = Shared<UiTarget | null>

/** Make one per element, once, outside the view. */
export const uiRef = (): UiRef => shared<UiTarget | null>(null)

export type UiConfig = Readonly<{
  /** A worklet that answers this element's style from shared values. */
  style?: () => UiStyle
  /** The shared values `style` reads. It runs again when one of them changes. */
  inputs?: ReadonlyArray<Shared<any>>
  /** Filled in on the UI thread once the element is on the phone. */
  ref?: UiRef
  /** A worklet called on the UI thread as a finger drags this element. */
  pan?: (event: PanEvent) => void
  /** When the pan starts and when it gives up. Without it, gesture-handler's defaults. */
  panConfig?: PanConfig
  /** The number this element's pan is known by, so other gestures can name it. */
  panTag?: GestureTag
  /** How the pan gets on with other gestures. */
  panRelations?: PanRelations
  /**
   * Names the element's own native gesture (a scroll view's scrolling) with
   * this number, so a pan elsewhere can name it in its `panRelations`.
   */
  nativeGesture?: GestureTag
  /** What a worklet sends on this channel reaches this element's `onUiMessage`. */
  channel?: UiChannel
}>

/** One number, or `[from, to]` in points. */
type Range = number | readonly [number, number]

/**
 * When a pan starts and when it gives up. Distances are in points from where
 * the finger went down.
 *
 *   { activeOffsetX: 12, failOffsetY: 10 }
 *
 * starts once the finger has gone 12 points to either side, and gives up if
 * it first goes 10 points up or down, which leaves a scroll view around the
 * element free to scroll.
 */
export type PanConfig = Readonly<{
  /** Start once the finger has moved this far sideways. */
  activeOffsetX?: Range
  /** Start once the finger has moved this far up or down. */
  activeOffsetY?: Range
  /** Give up once the finger has moved this far sideways first. */
  failOffsetX?: Range
  /** Give up once the finger has moved this far up or down first. */
  failOffsetY?: Range
  /** Start once the finger has moved this far in any direction. */
  minDist?: number
  /** Extra room around the element that still counts as on it. */
  hitSlop?: number
  /** `false` switches the gesture off without removing it. */
  enabled?: boolean
}>

/** A gesture's number. See `gestureTag`. */
export type GestureTag = Readonly<{ handlerTag: number }>

export type PanRelations = Readonly<{
  /** Both may run at once. */
  simultaneousWith?: ReadonlyArray<GestureTag>
  /** This pan starts only after these have given up. */
  waitFor?: ReadonlyArray<GestureTag>
  /** These start only after this pan has given up. */
  blocks?: ReadonlyArray<GestureTag>
}>

const range = (out: Record<string, unknown>, name: string, value: Range | undefined): void => {
  if (value === undefined) return
  const [start, end] = typeof value === 'number' ? [-Math.abs(value), Math.abs(value)] : value
  // gesture-handler's native code reads the two ends under these names.
  out[`${name}Start`] = start
  out[`${name}End`] = end
}

/** A `PanConfig` in the names gesture-handler's native code reads. */
const nativePanConfig = (config: PanConfig | undefined): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  if (config === undefined) return out
  range(out, 'activeOffsetX', config.activeOffsetX)
  range(out, 'activeOffsetY', config.activeOffsetY)
  range(out, 'failOffsetX', config.failOffsetX)
  range(out, 'failOffsetY', config.failOffsetY)
  if (config.minDist !== undefined) out['minDist'] = config.minDist
  if (config.hitSlop !== undefined) out['hitSlop'] = config.hitSlop
  if (config.enabled !== undefined) out['enabled'] = config.enabled
  return out
}

const nativeRelations = (relations: PanRelations): Record<string, ReadonlyArray<number>> => ({
  simultaneousHandlers: (relations.simultaneousWith ?? []).map(each => each.handlerTag),
  waitFor: (relations.waitFor ?? []).map(each => each.handlerTag),
  blocksHandlers: (relations.blocks ?? []).map(each => each.handlerTag),
})

const UI_DATA = 'foldkitUi'
const ROOT_TAG = 'gesture-root'

const el = element<any>()

/** The handler name for a message name: `released` is kept as `uiReleased`. */
const handlerName = (name: string): string => 'ui' + name.charAt(0).toUpperCase() + name.slice(1)

/** See the top of this file. Keep `config`'s worklets the same functions from draw to draw. */
export const uiThread = (config: UiConfig, target: Html): Html => {
  if (target !== null) {
    const data = (target.data ??= {}) as Record<string, unknown>
    data[UI_DATA] = config
    // A view the phone folded into its parent has nothing to move or touch.
    const props = (data['props'] ??= {}) as Record<string, unknown>
    props['collapsable'] = false
  }
  return target
}

/**
 * An attribute: a Message for what a worklet sent with
 * `sendMessage(channel, name, detail)`. The element must also be wrapped in
 * `uiThread({ channel })`.
 */
export const onUiMessage = <Message>(name: string, toMessage: (detail: any) => Message) =>
  OnCustomEvent({
    name: handlerName(name),
    f: event => Option.some(toMessage((event as { detail: unknown }).detail)),
  })

type RootGlobal = { _RNGH_MODULE_ID?: number }

let isRootNamed = false

/**
 * A box that gestures are read inside. Android needs one around every
 * element with `pan`: gesture-handler's own view there catches touches
 * before the rest of the screen. On iOS, and where gestures are not
 * available, it is a plain view.
 */
export const gestureRoot = (attributes: ReadonlyArray<any>, children: ReadonlyArray<any>): Html => {
  let isAndroid = false
  try {
    isAndroid = String(nativePlatform()) === 'android'
  } catch {
    isAndroid = false
  }
  const moduleId = isAndroid && gesturesCheck().ok ? (globalThis as RootGlobal)._RNGH_MODULE_ID : undefined
  // Version 3 of gesture-handler's Android view finds its gestures by this
  // number and fails without it, so without it a plain view is drawn.
  if (moduleId === undefined) return el('view')(attributes as never, children as never)
  if (!isRootNamed) {
    isRootNamed = true
    registerViewName(ROOT_TAG, 'RNGestureHandlerRootView')
  }
  const box = el(ROOT_TAG)(attributes as never, children as never)
  if (box !== null) {
    const data = (box.data ??= {}) as Record<string, unknown>
    const props = (data['props'] ??= {}) as Record<string, unknown>
    props['moduleId'] = moduleId
    props['collapsable'] = false
  }
  return box
}

/** gesture-handler's code for "send the events to a Reanimated worklet". */
const ACTION_REANIMATED_WORKLET = 1
const PAN_EVENTS = ['onGestureHandlerEvent', 'onGestureHandlerStateChange'] as const

/** Bindings are told apart by a number on the UI thread. */
let nextBindingId = 1
/** gesture-handler's own JavaScript numbers its gestures from 1. It is not loaded here. */
let nextHandlerTag = 880_000

/**
 * A number for a gesture, taken before the gesture exists, so that two
 * elements can name each other's gestures. Make it once, outside the view.
 */
export const gestureTag = (): GestureTag => ({ handlerTag: nextHandlerTag++ })

type Pan = Readonly<{ handlerTag: number; eventIds: ReadonlyArray<number> }>

/** What the pan was made with, as text, to see when it must be made again. */
const panSetup = (config: UiConfig): string =>
  JSON.stringify([config.panConfig ?? null, config.panTag ?? null, config.panRelations ?? null])

type Bound = {
  readonly id: number
  readonly node: EngineNode
  config: UiConfig
  /** The view's number when it was last tied, and what it was tied with. */
  tiedTag: number | null
  tiedStyle: UiConfig | null
  pan: Pan | null
  tiedPan: UiConfig['pan']
  tiedPanSetup: string
  /** The number of the native gesture made for `nativeGesture`, if one was. */
  native: number | null
  stopChannel: () => void
  channel: UiChannel | undefined
  isAlive: boolean
}

const tagOf = (engine: Engine, node: EngineNode): number | null =>
  (engine as { tagOf?: (node: EngineNode) => number | null }).tagOf?.(node) ??
  (node as { committed?: { tag?: number } | null }).committed?.tag ??
  null

const shadowNodeOf = (engine: Engine, node: EngineNode): unknown =>
  (engine as { shadowNodeOf?: (node: EngineNode) => unknown }).shadowNodeOf?.(node) ??
  (node as { committed?: { handle?: unknown } | null }).committed?.handle ??
  null

const sameStyle = (a: UiConfig | null, b: UiConfig): boolean =>
  a !== null &&
  a.style === b.style &&
  a.ref === b.ref &&
  (a.inputs?.length ?? 0) === (b.inputs?.length ?? 0) &&
  (a.inputs ?? []).every((input, index) => input === b.inputs?.[index])

const uiModule: ModuleFactory = (engine, afterCommit) => {
  const bound = new Map<EngineNode, Bound>()

  const untieStyle = (state: Bound): void => {
    const tied = state.tiedStyle
    if (tied === null) return
    state.tiedStyle = null
    if (tied.style !== undefined) runOnUi(unbindStyle, state.id, tied.inputs ?? [], tied.ref ?? null)
  }

  const untiePan = (state: Bound): void => {
    const pan = state.pan
    state.pan = null
    state.tiedPan = undefined
    if (pan === null) return
    try {
      const proxy = reanimatedProxy()
      for (const id of pan.eventIds) proxy?.unregisterEventHandler(id)
      const module = gestureModule()
      module?.dropGestureHandler(pan.handlerTag)
      module?.flushOperations()
    } catch {
      // The view is going away either way.
    }
  }

  const tieStyle = (state: Bound, target: UiTarget): void => {
    const config = state.config
    if (config.style === undefined && config.ref === undefined) return
    if (!viewUpdatesCheck().ok) return
    const answer = runOnUi(
      bindStyle,
      state.id,
      target,
      config.style ?? null,
      (config.inputs ?? []) as never,
      (config.ref ?? null) as never,
    )
    if (answer.ok) state.tiedStyle = config
  }

  const tiePan = (state: Bound, tag: number): void => {
    const handler = state.config.pan
    if (handler === undefined || !gesturesCheck().ok || !workletCheck(handler).ok) return
    const [module, proxy, pkg] = [gestureModule(), reanimatedProxy(), workletsPackage()]
    if (module === null || proxy === null || pkg === null) return
    try {
      const worklet = pkg.createSerializable(eventWorklet(handler))
      const eventIds = PAN_EVENTS.map(name => proxy.registerEventHandler(worklet, name, tag))
      const handlerTag = state.config.panTag?.handlerTag ?? nextHandlerTag++
      module.createGestureHandler(
        'PanGestureHandler',
        handlerTag,
        nativePanConfig(state.config.panConfig),
      )
      const relations = state.config.panRelations
      if (relations !== undefined) module.configureRelations?.(handlerTag, nativeRelations(relations))
      module.attachGestureHandler(handlerTag, tag, ACTION_REANIMATED_WORKLET)
      module.flushOperations()
      state.pan = { handlerTag, eventIds }
      state.tiedPan = handler
      state.tiedPanSetup = panSetup(state.config)
    } catch {
      // Left without a gesture. The demo's status line says gestures are off.
    }
  }

  const untieNative = (state: Bound): void => {
    const handlerTag = state.native
    state.native = null
    if (handlerTag === null) return
    try {
      const module = gestureModule()
      module?.dropGestureHandler(handlerTag)
      module?.flushOperations()
    } catch {
      // The view is going away either way.
    }
  }

  /** Gives the element's own native gesture a number other gestures can name. */
  const tieNative = (state: Bound, tag: number): void => {
    const wanted = state.config.nativeGesture
    if (wanted === undefined || !gesturesCheck().ok) return
    const module = gestureModule()
    if (module === null) return
    try {
      module.createGestureHandler('NativeViewGestureHandler', wanted.handlerTag, {})
      module.attachGestureHandler(wanted.handlerTag, tag, ACTION_REANIMATED_WORKLET)
      module.flushOperations()
      state.native = wanted.handlerTag
    } catch {
      // Left as it was: the element still scrolls, only nothing can name it.
    }
  }

  /** Ties what is not tied yet, and ties again what the view or the phone changed. */
  const sync = (state: Bound): void => {
    if (!state.isAlive) return
    const tag = tagOf(engine, state.node)
    const shadowNode = shadowNodeOf(engine, state.node)
    if (tag === null || shadowNode === null) return
    const isNewView = tag !== state.tiedTag
    if (isNewView || !sameStyle(state.tiedStyle, state.config)) {
      untieStyle(state)
      tieStyle(state, { tag, node: shadowNode })
    }
    const isPanChanged =
      state.tiedPan !== state.config.pan ||
      (state.pan !== null && state.tiedPanSetup !== panSetup(state.config))
    if (isNewView || isPanChanged) {
      untiePan(state)
      tiePan(state, tag)
    }
    if (isNewView || (state.config.nativeGesture?.handlerTag ?? null) !== state.native) {
      untieNative(state)
      tieNative(state, tag)
    }
    state.tiedTag = tag
  }

  const listen = (state: Bound): void => {
    if (state.channel === state.config.channel) return
    state.stopChannel()
    state.channel = state.config.channel
    state.stopChannel =
      state.channel === undefined
        ? () => {}
        : listenToChannel(state.channel, (name, detail) => {
            if (!state.isAlive) return
            const handler = handlersByNode.get(state.node)?.[handlerName(name)] as Handler | undefined
            handler?.(customEvent(handlerName(name), detail))
          })
  }

  const release = (state: Bound): void => {
    if (!state.isAlive) return
    state.isAlive = false
    bound.delete(state.node)
    state.stopChannel()
    untieStyle(state)
    untiePan(state)
    untieNative(state)
    try {
      // Lets Reanimated's native code forget what it last put on this view.
      const shadowNode = shadowNodeOf(engine, state.node)
      if (shadowNode !== null) reanimatedProxy()?.markNodeAsRemovable?.(shadowNode)
    } catch {
      // Only tidying.
    }
  }

  const create = (_empty: VNode, vnode: VNode): void => {
    const config = vnode.data?.[UI_DATA] as UiConfig | undefined
    const node = nodeOf(vnode)
    if (config === undefined || node === undefined) return
    const state: Bound = {
      id: nextBindingId++,
      node,
      config,
      tiedTag: null,
      tiedStyle: null,
      pan: null,
      tiedPan: undefined,
      tiedPanSetup: '',
      native: null,
      stopChannel: () => {},
      channel: undefined,
      isAlive: true,
    }
    bound.set(node, state)
    listen(state)
  }

  const update = (empty: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    const state = bound.get(node)
    const config = vnode.data?.[UI_DATA] as UiConfig | undefined
    if (state === undefined) {
      if (config !== undefined) create(empty, vnode)
      return
    }
    if (config === undefined) {
      // The updater reused this view for something else.
      release(state)
      return
    }
    state.config = config
    listen(state)
  }

  return {
    create,
    update,
    destroy: vnode => {
      const node = nodeOf(vnode)
      const state = node === undefined ? undefined : bound.get(node)
      if (state !== undefined) release(state)
    },
    // A view has no number and no handle until a draw has reached the phone.
    post: () => {
      if (bound.size === 0) return
      afterCommit(() => {
        for (const state of [...bound.values()]) sync(state)
      })
    },
  }
}

registerModule(uiModule)
