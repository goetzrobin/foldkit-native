/**
 * The native host for Effect UI: draws a component tree as real iPhone and
 * Android views, through ng-native's engine. React draws nothing.
 *
 *   const Main = NativeHost.mount(App, {}, { fabric: getFabricUIManager(), rootTag })
 *   NativeHost.run(Main)
 *
 * Effect UI's renderer changes the screen through a `Renderer.Host`: create
 * an element, set a property, insert, remove, set the event handlers. This
 * file is that Host over engine nodes.
 *
 * How it maps:
 *
 * - An element is an engine node. A few tags are two nodes: a scroll view
 *   scrolls one content view, which the host makes and puts children in.
 * - Properties and handlers are kept per node and written by the node hooks
 *   in `packages/native/src/host/fabric/nodes.ts` (props, styles, events, the
 *   text field echo, screens), once per flush, just before the commit.
 * - `commit` is called by the renderer once per flush. It runs the hooks,
 *   sends ONE engine commit, then runs the work that waits for a commit.
 * - The renderer schedules a flush with a microtask. Nothing here waits for
 *   `requestAnimationFrame` or a timer to draw.
 * - Events: engine events and the press recogniser (`internal/touch.ts`)
 *   become finished events with plain payloads (`internal/events.ts`),
 *   dispatched to the element they happened on.
 */
import type * as Component from '@effect/ui/Component'
import * as Renderer from '@effect/ui/Renderer'
import type * as View from '@effect/ui/View'
import type { Engine, EngineNode, FabricUIManager } from '@ng-native/fabric'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Scheduler from 'effect/Scheduler'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'
import type * as Scope from 'effect/Scope'

import { SCROLL_CONTENT_PROPS, SCROLL_VIEW_PROPS } from '../../native/src/host/elements.js'
import { type Bag, type NodeData, type NodeHooks, makeNodeHooks } from '../../native/src/host/fabric/nodes.js'
import { registered } from '../../native/src/host/fabric/registry.js'
import { type HostSurface, type HostSurfaceOptions, createHostSurface } from '../../native/src/host/fabric/surface.js'
import { CHANGE_TEXT, type Source, isTouchEvent, nativeOf, sourcesOf } from './internal/events.js'
import { TOUCH, type TouchSpec, type TouchStats, makeTouchHooks } from './internal/touch.js'
import * as Native from './Native.js'

/** What the renderer holds for an element, a piece of text, or a kept child's shelf. */
export type NativeNode = EngineNode | Shelf

/**
 * Where the nodes of a kept child wait while no view shows them. Never on
 * screen: the engine does not know it.
 */
export class Shelf {
  readonly children: Array<EngineNode> = []
}

/** Vocabulary tags that are another tag to the engine. */
const ENGINE_TAGS: Readonly<Record<string, string>> = {
  pressable: 'view',
  scrollView: 'scroll-view',
  textInput: 'text-input',
  modalScreen: 'modal-screen',
  header: 'native-header',
  headerItem: 'native-header-item',
  safeArea: 'screen-safe-area',
  sheetContent: 'sheet-content',
}

const SCROLL_VIEW = 'scroll-view'
const TEXT_INPUT = 'text-input'
/** A scroll view's prop that styles its content view. */
const CONTENT_STYLE = 'contentStyle'
/**
 * A prop for the host layer, not for the phone. Its keys are added to what
 * the node hooks get for the element, next to `props` and `on`. A host
 * feature that finds its elements by a key (the list controller looks for
 * `foldkitList`) is switched on for an element this way:
 *
 *   h.scrollView.prop(NODE_DATA, { [LIST_DATA]: spec })
 */
export const NODE_DATA = 'nodeData'
/**
 * The same for a scroll view's content view, which the host makes itself.
 * It is read once, when the scroll view is first drawn: the hooks' `create`
 * runs for the content view right after the scroll view's own.
 */
export const CONTENT_NODE_DATA = 'contentNodeData'

type Entry = {
  /** Properties as the view last gave them. */
  props: Bag
  attrs: Bag
  /** What the node hooks listen with. A new object only when the names change. */
  on: Bag
  touch: TouchSpec | undefined
  handlers: Readonly<Record<string, View.Handler<unknown, any>>>
  dispatch: Renderer.Dispatch | undefined
  /** What the hooks were last run with, or undefined before the first run. */
  applied: NodeData | undefined
  isDirty: boolean
  /** A scroll view's content view. */
  content: EngineNode | undefined
  contentStyle: unknown
  /** See `NODE_DATA` and `CONTENT_NODE_DATA`. */
  extra: Bag | undefined
  contentExtra: Bag | undefined
  /** The last scroll Message's time, and one held back for the end of the frame. */
  scrolledAt: number
  heldScroll: ReturnType<typeof setTimeout> | undefined
}

/** Numbers a test or an on-screen readout can show. */
export type HostStats = TouchStats & {
  /** Engine commits the renderer asked for (one per flush). */
  commits: number
  /** Elements made and taken away since the start. */
  created: number
  destroyed: number
  /** Elements alive now. */
  live: number
  /** Native listeners the host holds now. Back to 0 after unmount. */
  listeners: number
  /** Finished events handed to the renderer. */
  dispatched: number
  /**
   * JavaScript time per event, from the event arriving to its draw being
   * committed (or to its Message being handled, when nothing was drawn).
   */
  steps: number
  /** Events that drew something. */
  drawnSteps: number
  lastStepMs: number
  maxStepMs: number
  totalStepMs: number
}

export type MakeHostOptions = Readonly<{
  /** Scroll Messages are at most one per this many milliseconds. Default 16, a frame. */
  scrollThrottleMs?: number
  /** How long a finger rests before a long press. Default 500. */
  longPressMs?: number
}>

export type NativeHostHandle = Readonly<{
  /** Hands a finished event to the renderer, timed. The press recogniser calls it. */
  fire: (node: EngineNode, name: string, payload: unknown) => boolean
  host: Renderer.Host<NativeNode>
  service: Context.Service.Shape<typeof Native.Host>
  stats: HostStats
  /** The full-screen view the tree is mounted in. */
  container: EngineNode
  /** Takes away what is left and stops every listener. Close the mount's Scope first. */
  dispose: () => void
}>

const isShallowEqual = (before: unknown, after: unknown): boolean => {
  if (before === after) return true
  if (typeof before !== 'object' || typeof after !== 'object' || before === null || after === null) return false
  const names = Object.keys(after)
  return (
    names.length === Object.keys(before).length &&
    names.every(name => (before as Bag)[name] === (after as Bag)[name])
  )
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Builds the Host over a surface. `prepare` of `createHostSurface` is where
 * the engine first exists, so the hooks are made there (see `makeSurface`).
 */
export const makeHost = (
  surface: Pick<HostSurface, 'engine' | 'afterCommit' | 'commit' | 'placeholder'>,
  hooks: ReadonlyArray<NodeHooks>,
  stats: HostStats,
  entries: Map<EngineNode, Entry>,
  options: MakeHostOptions = {},
): NativeHostHandle => {
  const engine = surface.engine
  const throttleMs = options.scrollThrottleMs ?? 16
  const shelfOf = new WeakMap<EngineNode, Shelf>()
  const dirty: Array<EngineNode> = []
  const detached = new Set<EngineNode>()
  /** Content views, back to their scroll view. */
  const ownerOfContent = new WeakMap<EngineNode, EngineNode>()

  // The full-screen view. The surface only hands out a placeholder inside it.
  const anchor = surface.placeholder()
  const container = engine.parentNode(anchor) as EngineNode
  engine.removeChild(container, anchor)
  engine.destroyNode(anchor)

  const markDirty = (node: EngineNode, entry: Entry): void => {
    if (entry.isDirty) return
    entry.isDirty = true
    dirty.push(node)
  }

  /** The event being timed: when it arrived, until its draw is committed. */
  let step: { startedAt: number } | undefined
  const endStep = (ms: number, isDrawn: boolean): void => {
    step = undefined
    stats.steps++
    if (isDrawn) stats.drawnSteps++
    stats.lastStepMs = ms
    stats.totalStepMs += ms
    if (ms > stats.maxStepMs) stats.maxStepMs = ms
  }

  const fire = (node: EngineNode, name: string, payload: unknown): boolean => {
    const entry = entries.get(node)
    const handler = entry?.handlers[name]
    if (entry === undefined || entry.dispatch === undefined || handler === undefined) return false
    stats.dispatched++
    const startedAt = now()
    const mine = (step ??= { startedAt })
    const isHandled = entry.dispatch(name, handler, payload)
    const handledMs = now() - startedAt
    // The renderer draws in a microtask queued before this one. If the step is
    // still open then, the Message changed nothing on screen.
    queueMicrotask(() => {
      if (step === mine) endStep(handledMs, false)
    })
    return isHandled
  }

  /** Scroll Messages: the first at once, then at most one per frame, the last never lost. */
  const fireScroll = (node: EngineNode, entry: Entry, payload: unknown): void => {
    if (entry.heldScroll !== undefined) clearTimeout(entry.heldScroll)
    entry.heldScroll = undefined
    const waited = now() - entry.scrolledAt
    if (waited >= throttleMs) {
      entry.scrolledAt = now()
      fire(node, 'scroll', payload)
      return
    }
    entry.heldScroll = setTimeout(() => {
      entry.heldScroll = undefined
      if (!entries.has(node)) return
      entry.scrolledAt = now()
      fire(node, 'scroll', payload)
    }, throttleMs - waited)
  }

  /**
   * After the phone reports typed text, the Model may refuse it and stay as
   * it was. Then nothing is drawn again and the field would keep what was
   * typed. So the field is checked once more after the flush the Message
   * caused: the echo hook sends the Model's text back if the two differ.
   */
  const recheckField = (node: EngineNode): void => {
    queueMicrotask(() => {
      const entry = entries.get(node)
      if (entry === undefined) return
      markDirty(node, entry)
      flushHooks()
      surface.commit()
    })
  }

  /** The `on` bag for the node hooks: one listener per native event, reading the newest handlers. */
  const listenersFor = (node: EngineNode, names: ReadonlyArray<string>): Bag => {
    const bySource = new Map<string, Array<readonly [string, Source]>>()
    const on: Bag = {}
    for (const name of names) {
      if (isTouchEvent(name)) continue
      if (name === CHANGE_TEXT && node.tag === TEXT_INPUT) {
        // The echo hook calls this with the typed text (see `textInputHooks`).
        on['input'] = (event: { target?: { value?: unknown } }) => {
          const text = typeof event?.target?.value === 'string' ? event.target.value : ''
          fire(node, CHANGE_TEXT, { text })
          recheckField(node)
        }
        continue
      }
      for (const source of sourcesOf(name)) {
        const list = bySource.get(source.on) ?? []
        list.push([name, source])
        bySource.set(source.on, list)
      }
    }
    for (const [key, list] of bySource) {
      on[key] = (event: unknown) => {
        const native = nativeOf(event)
        const entry = entries.get(node)
        if (entry === undefined) return
        for (const [name, source] of list) {
          if (source.accepts !== undefined && !source.accepts(native)) continue
          const payload = source.payload(native)
          if (name === 'scroll') fireScroll(node, entry, payload)
          else fire(node, name, payload)
        }
      }
    }
    return on
  }

  const dataOf = (entry: Entry): NodeData => ({
    props: { ...entry.props },
    attrs: { ...entry.attrs },
    on: entry.on,
    ...(entry.touch === undefined ? {} : { [TOUCH]: entry.touch }),
    ...entry.extra,
  })

  const flushHooks = (): void => {
    if (dirty.length === 0) return
    const nodes = dirty.splice(0)
    for (const node of nodes) {
      const entry = entries.get(node)
      if (entry === undefined) continue
      entry.isDirty = false
      const data = dataOf(entry)
      const before = entry.applied
      entry.applied = data
      if (before === undefined) {
        for (const each of hooks) each.create?.(node, data)
        // The content view has no element of its own, so it is announced here.
        if (entry.content !== undefined && entry.contentExtra !== undefined) {
          for (const each of hooks) each.create?.(entry.content, entry.contentExtra)
        }
      } else for (const each of hooks) each.update?.(node, before, data)
    }
    for (const each of hooks) each.post?.()
  }

  const countListeners = (entry: Entry): number => Object.keys(entry.on).length

  const destroy = (node: EngineNode): void => {
    for (const child of [...node.childList]) destroy(child as EngineNode)
    const entry = entries.get(node)
    if (entry !== undefined) {
      if (entry.heldScroll !== undefined) clearTimeout(entry.heldScroll)
      stats.listeners -= countListeners(entry)
      if (entry.applied !== undefined) for (const each of hooks) each.destroy?.(node, entry.applied)
      entries.delete(node)
      stats.destroyed++
      stats.live--
    }
    engine.destroyNode(node)
  }

  const leaveShelf = (node: EngineNode): void => {
    const shelf = shelfOf.get(node)
    if (shelf === undefined) return
    const index = shelf.children.indexOf(node)
    if (index >= 0) shelf.children.splice(index, 1)
    shelfOf.delete(node)
  }

  /** Where children of `parent` really go. */
  const insideOf = (parent: EngineNode): EngineNode => entries.get(parent)?.content ?? parent

  const host: Renderer.Host<NativeNode> = {
    createElement(tag) {
      const node = engine.createElement(ENGINE_TAGS[tag] ?? tag)
      const entry: Entry = {
        props: {},
        attrs: {},
        on: {},
        touch: undefined,
        handlers: {},
        dispatch: undefined,
        applied: undefined,
        isDirty: false,
        content: undefined,
        contentStyle: undefined,
        extra: undefined,
        contentExtra: undefined,
        scrolledAt: -Infinity,
        heldScroll: undefined,
      }
      if (node.tag === SCROLL_VIEW) {
        // The native scroll view scrolls one content view, as React Native's own does.
        const content = engine.createElement('view')
        for (const name in SCROLL_CONTENT_PROPS) engine.setProp(content, name, SCROLL_CONTENT_PROPS[name])
        engine.appendChild(node, content)
        entry.content = content
        ownerOfContent.set(content, node)
        Object.assign(entry.props, SCROLL_VIEW_PROPS)
      }
      entries.set(node, entry)
      stats.created++
      stats.live++
      markDirty(node, entry)
      return node
    },

    createText: text => engine.createText(text),

    setText(node, text) {
      if (!(node instanceof Shelf)) engine.setText(node, text)
    },

    setAttr(node, name, value) {
      if (node instanceof Shelf) return
      const entry = entries.get(node)
      if (entry === undefined) return
      if (value === undefined) delete entry.attrs[name]
      else entry.attrs[name] = value
      markDirty(node, entry)
    },

    setProp(node, name, value) {
      if (node instanceof Shelf) return
      const entry = entries.get(node)
      if (entry === undefined) return
      if (name === CONTENT_STYLE && entry.content !== undefined) {
        if (!isShallowEqual(entry.contentStyle, value)) {
          entry.contentStyle = value
          engine.setProp(entry.content, 'style', value)
        }
        return
      }
      if (name === NODE_DATA) {
        if (isShallowEqual(entry.extra, value)) return
        entry.extra = value as Bag | undefined
        markDirty(node, entry)
        return
      }
      if (name === CONTENT_NODE_DATA) {
        entry.contentExtra = value as Bag | undefined
        return
      }
      // A view builds a new style object on every draw. Equal contents are no change.
      if (name !== 'value' && isShallowEqual(entry.props[name], value)) return
      if (value === undefined) delete entry.props[name]
      else entry.props[name] = value
      markDirty(node, entry)
    },

    insertBefore(parent, node, ref) {
      if (node instanceof Shelf) return
      detached.delete(node)
      leaveShelf(node)
      if (parent instanceof Shelf) {
        engine.removeChild(null, node)
        shelfOf.set(node, parent)
        const index = ref === undefined || ref instanceof Shelf ? -1 : parent.children.indexOf(ref)
        if (index < 0) parent.children.push(node)
        else parent.children.splice(index, 0, node)
        return
      }
      const inside = insideOf(parent)
      if (ref === undefined || ref instanceof Shelf) engine.appendChild(inside, node)
      else engine.insertBefore(inside, node, ref)
    },

    remove(node) {
      if (node instanceof Shelf) return
      if (shelfOf.has(node)) leaveShelf(node)
      else engine.removeChild(null, node)
      // It may be put back in this same flush (a kept child). Destroyed at the commit if not.
      detached.add(node)
    },

    parentOf(node) {
      if (node instanceof Shelf) return undefined
      const shelf = shelfOf.get(node)
      if (shelf !== undefined) return shelf
      const parent = engine.parentNode(node)
      if (parent === null) return undefined
      return ownerOfContent.get(parent) ?? parent
    },

    nextOf(node) {
      if (node instanceof Shelf) return undefined
      const shelf = shelfOf.get(node)
      if (shelf !== undefined) return shelf.children[shelf.children.indexOf(node) + 1]
      return engine.nextSibling(node) ?? undefined
    },

    setEvents(node, handlers, dispatch) {
      if (node instanceof Shelf) return
      const entry = entries.get(node)
      if (entry === undefined) return
      entry.handlers = handlers
      entry.dispatch = dispatch
      const names = Object.keys(handlers)
      const touch: TouchSpec | undefined =
        'press' in handlers || 'longPress' in handlers || 'pressIn' in handlers || 'pressOut' in handlers
          ? {
              press: 'press' in handlers,
              longPress: 'longPress' in handlers,
              pressIn: 'pressIn' in handlers,
              pressOut: 'pressOut' in handlers,
            }
          : undefined
      const isSameTouch =
        touch?.press === entry.touch?.press &&
        touch?.longPress === entry.touch?.longPress &&
        touch?.pressIn === entry.touch?.pressIn &&
        touch?.pressOut === entry.touch?.pressOut
      const key = names.join(' ')
      if (key === namesOf.get(node) && isSameTouch) return
      stats.listeners -= countListeners(entry)
      entry.on = listenersFor(node, names)
      stats.listeners += countListeners(entry)
      entry.touch = touch
      namesOf.set(node, key)
      markDirty(node, entry)
    },

    elements: [Native.name],
    controlled: CONTROLLED,
    runsMounts: true,

    createContainer: () => new Shelf(),

    commit() {
      for (const node of detached) {
        if (shelfOf.has(node) || engine.parentNode(node) !== null) continue
        destroy(node)
      }
      detached.clear()
      flushHooks()
      if (held > 0) {
        isCommitOwed = true
        return
      }
      stats.commits++
      surface.commit()
      if (step !== undefined) endStep(now() - step.startedAt, true)
    },
  }

  // EXPERIMENT (way B): several trees on one host each end their flush with a
  // commit. Whoever makes them draw together can hold the commits back.
  let held = 0
  let isCommitOwed = false

  const service: Context.Service.Shape<typeof Native.Host> = {
    engine,
    // The job runs after the next draw. If none is on its way, one is made.
    afterCommit: job => {
      surface.afterCommit(job)
      queueMicrotask(() => surface.commit())
    },
    measure: node =>
      Effect.callback<Native.Rect | undefined>(resume => {
        let isDone = false
        const done = (rect: Native.Rect | undefined): void => {
          if (isDone) return
          isDone = true
          resume(Effect.succeed(rect))
        }
        // A view that was never committed, or a phone that does not answer, is "not measured".
        if (engine.tagOf(node) === null) return done(undefined)
        engine.measure(node, (frame: Native.Rect) => done(frame))
        const timer = setTimeout(() => done(undefined), 250)
        return Effect.sync(() => clearTimeout(timer))
      }),
    // A field that has the caret already is left alone: asking again made the keyboard go and come back.
    focus: node => {
      if ((engine as { focused?: unknown }).focused !== node) engine.focus(node)
    },
    blur: () => (engine as { blurFocused?: () => void }).blurFocused?.(),
    scrollTo: (node, to) =>
      engine.dispatchCommand(node, 'scrollTo', [to.x ?? 0, to.y ?? 0, to.animated ?? false]),
    scrollToEnd: (node, animated = false) => engine.dispatchCommand(node, 'scrollToEnd', [animated]),
    tagOf: node => engine.tagOf(node),
    stats,
    mountRoot: (component, props, node) =>
      Effect.provideContext(
        Renderer.mount(component as any, props as any, node, { head: false }) as Effect.Effect<
          Renderer.Root<unknown, unknown>,
          never,
          Scope.Scope | Renderer.Renderer | Native.Host
        >,
        Context.make(Renderer.Renderer, { host }).pipe(Context.add(Native.Host, service)),
      ),
    holdCommits: () => {
      held++
      let isReleased = false
      return () => {
        if (isReleased) return
        isReleased = true
        held--
        if (held > 0 || !isCommitOwed) return
        isCommitOwed = false
        stats.commits++
        surface.commit()
        if (step !== undefined) endStep(now() - step.startedAt, true)
      }
    },
  }

  const dispose = (): void => {
    for (const child of [...container.childList]) {
      engine.removeChild(container, child as EngineNode)
      destroy(child as EngineNode)
    }
    for (const node of detached) destroy(node)
    detached.clear()
    dirty.length = 0
    // The phone is told the screen is empty now.
    surface.commit()
  }

  return { fire, host, service, stats, container, dispose }
}

/** The names `setEvents` last wired for a node, to skip a draw that changes none. */
const namesOf = new WeakMap<EngineNode, string>()

/** Re-applied after every draw: the user may have changed them on the phone. */
const CONTROLLED: ReadonlySet<string> = new Set(['value'])

export type SurfaceOptions = HostSurfaceOptions & MakeHostOptions

/** A started engine with the Host on it. `NativeHost.mount` makes one for you. */
export type NativeSurface = NativeHostHandle &
  Readonly<{
    engine: Engine
    /** Stops drawing and releases the engine. */
    close: () => void
  }>

const newStats = (): HostStats => ({
  commits: 0,
  created: 0,
  destroyed: 0,
  live: 0,
  listeners: 0,
  dispatched: 0,
  steps: 0,
  drawnSteps: 0,
  lastStepMs: 0,
  maxStepMs: 0,
  totalStepMs: 0,
  keptThroughScroll: 0,
  cancelled: 0,
  wired: 0,
})

/**
 * Starts ng-native's engine on the screen the phone gave and builds the Host
 * on it. The first full-screen view is committed at once, in the same turn.
 */
export const makeSurface = (
  fabric: FabricUIManager,
  rootTag: number,
  options: SurfaceOptions = {},
): NativeSurface => {
  const { scrollThrottleMs, longPressMs, ...hostOptions } = options
  const stats = newStats()
  const entries = new Map<EngineNode, Entry>()
  let hooks: Array<NodeHooks> = []
  let handle: NativeHostHandle | undefined
  const surface = createHostSurface(fabric, rootTag, hostOptions, (engine, afterCommit) => {
    hooks = [
      // Props, styles, events, the text field echo, screens.
      ...makeNodeHooks(engine, afterCommit),
      makeTouchHooks(engine, {
        fire: (node, name, payload) => void handle?.fire(node, name, payload),
        propsOf: node => entries.get(node)?.props ?? {},
        stats,
        ...(longPressMs === undefined ? {} : { longPressMs }),
      }),
      // What other host features registered at import (modal screens, the app window).
      ...registered().flatMap(each => (each.kind === 'hooks' ? [each.factory(engine, afterCommit)] : [])),
    ]
  })
  handle = makeHost(surface, hooks, stats, entries, {
    ...(scrollThrottleMs === undefined ? {} : { scrollThrottleMs }),
  })
  const made = handle
  return {
    ...made,
    engine: surface.engine,
    close: () => {
      made.dispose()
      surface.dispose()
    },
  }
}

const contextOf = (surface: NativeSurface): Context.Context<Renderer.Renderer | Native.Host> =>
  Context.make(Renderer.Renderer, { host: surface.host }).pipe(Context.add(Native.Host, surface.service))

/** Provides `Renderer.Renderer` and `Native.Host` for a surface that already exists. */
export const layerFromSurface = (surface: NativeSurface): Layer.Layer<Renderer.Renderer | Native.Host> =>
  Layer.succeedContext(contextOf(surface))

/** Passes when a root component draws native elements, and otherwise names what it needs. */
export type NativeRoot<V> = [Renderer.HostOf<V>] extends [Native.Host]
  ? unknown
  : { readonly "NativeHost.mount shows native elements. This root's vocabulary needs": Renderer.HostOf<V> }

export interface MountOptions<V extends View.Elements, RF = never> extends SurfaceOptions {
  /** `getFabricUIManager()` from `@ng-native/fabric`. */
  readonly fabric: FabricUIManager
  /** The number React Native passes to the app's runnable. */
  readonly rootTag: number
  readonly fallback?:
    | ((failure: AsyncResult.Failure<never, unknown>, h: View.WithTags<never, {}, V>) => View.Content<never, RF>)
    | undefined
  readonly query?: Renderer.QueryOptions | undefined
  /** Called with the surface once the first screen is drawn, for a readout or a test. */
  readonly onSurface?: ((surface: NativeSurface) => void) | undefined
}

/** Mounts a component tree on the phone for the life of the current Scope. */
export const mountEffect = <Name extends string, Props, Model, Msg, Events, R, V extends View.Elements, RF = never, RP = never>(
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & NativeRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options: MountOptions<V, RF>,
): Effect.Effect<Renderer.Root<Model, Msg>, never, Exclude<R | RF | RP, Native.Host> | Scope.Scope> =>
  Effect.gen(function* () {
    const { fabric, rootTag, fallback, query, onSurface, ...surfaceOptions } = options
    const surface = yield* Effect.acquireRelease(
      Effect.sync(() => makeSurface(fabric, rootTag, surfaceOptions)),
      made => Effect.sync(() => made.close()),
    )
    const root = yield* Effect.provideContext(
      Renderer.mount(component as any, props as any, surface.container, { fallback, query, head: false } as any),
      contextOf(surface),
    )
    onSurface?.(surface)
    return root
  }) as any

/**
 * A Layer that starts the engine and mounts `component` for as long as the
 * Layer is alive. Like `BrowserHost.mount`.
 */
export const mount = <Name extends string, Props, Model, Msg, Events, R, V extends View.Elements, RF = never, RP = never>(
  component: Component.Members<Name, Props, Model, Msg, Events, R, V, any> & NativeRoot<V>,
  props: Props | Effect.Effect<Props, never, RP>,
  options: MountOptions<V, RF>,
): Layer.Layer<never, never, Exclude<R | RF | RP, Native.Host>> =>
  Layer.effectDiscard(mountEffect(component, props, options)) as any

const microtask = (run: () => void): (() => void) => {
  let isCancelled = false
  queueMicrotask(() => {
    if (!isCancelled) run()
  })
  return () => {
    isCancelled = true
  }
}

/**
 * A Scheduler for the phone. Effect's own starts every fiber with a timer.
 * On a first launch the phone's timers may not have started, and the first
 * screen stayed blank (see `docs/BRIEF.md`). This one runs its first rounds
 * of fiber work as microtasks, which always run, and then goes over to
 * timers so long fiber work cannot hold up touches and scrolling.
 */
export const scheduler = (microtaskRounds = 200): Scheduler.Scheduler => {
  let rounds = 0
  const timers = new Scheduler.MixedScheduler('async')
  return new Scheduler.MixedScheduler('async', run =>
    rounds++ < microtaskRounds ? microtask(run) : timers.setImmediate(run),
  )
}

/**
 * Starts the app: launches `main` (the Layer from `mount`, with whatever else
 * the app provides) on the phone's Scheduler. Returns a function that stops it.
 */
export const run = (main: Layer.Layer<never, never, never>): (() => void) => {
  const fiber = Effect.runFork(Layer.launch(main), { scheduler: scheduler() })
  return () => {
    Effect.runFork(Fiber.interrupt(fiber))
  }
}
