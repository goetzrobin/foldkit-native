/**
 * A canvas: a box that code draws into by itself, frame by frame, with no
 * Foldkit Message and no view call per frame.
 *
 *   canvas(h, {
 *     id: 'arena',
 *     scene: myScene,            // what draws, see `Scene`
 *     props: { ... },            // what the scene is told on every view call
 *     renderer: 'auto',          // 'skia', 'views', or 'auto' (Skia if it is there)
 *     background: '#111111',
 *     on: { tapped: detail => Message.Tapped(detail) },
 *   }, [style({ height: 300 })])
 *
 * What ends up on the phone:
 *
 *   view (the canvas)            drawn by Foldkit. Takes the touches.
 *     skia-view                  made here in Skia mode: one view, redrawn each frame
 *   or
 *     view, view, view ...       made here in plain mode: one view per shape
 *
 * Foldkit never looks inside the canvas. A scene is started when the canvas
 * first reaches the phone, told when the view passes new props, and stopped
 * when the canvas goes away. In between it may ask for frames and draw as
 * often as it likes.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, type VNode, element } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend.js'
import { SKIA_TAG, registerSkia } from '../../host/skia/views.js'
import { type Handler, customEvent, handlersByNode, nodeOf } from '../modules.js'
import { onNextFrame } from '../../host/motion/clock.js'
import { type Painter, type Pen, type Size, makeSkiaPainter, makeViewPainter } from '../../host/skia/draw.js'
import { nowMs, skiaHost } from '../../host/skia/host.js'

export type Renderer = 'skia' | 'views'

/** What a scene is given to work with. */
export type CanvasSurface = Readonly<{
  /** How this canvas draws. It does not change while the scene runs. */
  renderer: Renderer
  /** The canvas's size in points. Both are 0 until the phone has said. */
  size: () => Size
  /** Draws one whole frame, replacing the one before, and sends it to the phone. */
  draw: (paint: (pen: Pen, size: Size) => void) => void
  /** Runs `run` at the next frame, with the time then. Ask again from `run` to keep going. */
  frame: (run: (nowMs: number) => void) => void
  /** The time now, in milliseconds, on the clock `frame` uses. */
  now: () => number
  /** Sends an event to the handler the view gave for `name` in `on`, if any. */
  emit: (name: string, detail: unknown) => void
}>

/** What a running scene answers to. All optional. */
export type SceneRun<Props> = Readonly<{
  /** The view ran again and passed these props. */
  update?: (props: Props) => void
  /** A finger went down on the canvas, at this point inside it. */
  tap?: (x: number, y: number) => void
  /** The phone reported the canvas's size, the first time or a new one. */
  resize?: (size: Size) => void
  /** The canvas is going away. No frame runs after this. */
  stop?: () => void
}>

/**
 * Something that draws on a canvas. Keep one scene object for the life of
 * the program: a canvas given a different scene object stops the old one and
 * starts the new one.
 */
export type Scene<Props> = Readonly<{
  start: (surface: CanvasSurface, props: Props) => SceneRun<Props>
}>

export type CanvasConfig<Props, Message> = Readonly<{
  /** Names this canvas. Also its `testID` unless the attributes give one. */
  id: string
  scene: Scene<Props>
  props: Props
  /** `'auto'` (the default) is Skia where the build has it and plain views where not. */
  renderer?: Renderer | 'auto'
  /** A color behind everything drawn. */
  background?: string
  /** A Message for each event the scene emits, by the event's name. */
  on?: Readonly<Record<string, (detail: any) => Message>>
}>

const CANVAS_DATA = 'foldkitCanvas'

type Spec = Readonly<{
  scene: Scene<unknown>
  props: unknown
  renderer: Renderer
}>

const el = element<any>()

export { registerSkia }

/** The renderer a canvas asked for `wanted` really gets in this build. */
export const rendererFor = (wanted: Renderer | 'auto' = 'auto'): Renderer =>
  wanted !== 'views' && skiaHost() !== null ? 'skia' : 'views'

/** See the top of this file. */
export const canvas = <Props, Message>(
  _h: HtmlBuilder<Message>,
  config: CanvasConfig<Props, Message>,
  attributes: ReadonlyArray<any> = [],
): Html => {
  const handlers = Object.entries(config.on ?? {}).map(([name, toMessage]) =>
    OnCustomEvent({
      name,
      f: event => Option.some(toMessage((event as { detail: unknown }).detail)),
    }),
  )
  const box = el('view')([...attributes, ...handlers] as never, [])
  if (box !== null) {
    const data = (box.data ??= {}) as Record<string, unknown>
    const props = (data['props'] ??= {}) as Record<string, unknown>
    // Laid over the caller's own style, which a second `style(...)` would replace.
    props['style'] = {
      ...(props['style'] as object | undefined),
      overflow: 'hidden',
      ...(config.background === undefined ? {} : { backgroundColor: config.background }),
    }
    // Kept as a real view: it is measured, and it takes the touches.
    props['collapsable'] = false
    // The canvas itself is what a finger lands on, never a shape inside it,
    // so a touch's place is always counted from the canvas's corner.
    props['pointerEvents'] = 'box-only'
    props['testID'] ??= config.id
    data[CANVAS_DATA] = {
      scene: config.scene as Scene<unknown>,
      props: config.props,
      renderer: rendererFor(config.renderer),
    } satisfies Spec
  }
  return box
}

type Running = {
  spec: Spec
  readonly node: EngineNode
  size: Size
  painter: Painter
  /** The Skia view, in Skia mode. */
  skiaNode: EngineNode | undefined
  run: SceneRun<unknown>
  /** Turned off when the scene is stopped, so nothing it left behind still draws. */
  live: { on: boolean }
  isAlive: boolean
  stops: Array<() => void>
}

type LayoutEvent = { nativeEvent?: { layout?: { width?: number; height?: number } } }
type TouchEvent = { nativeEvent?: { locationX?: number; locationY?: number } }

/** Skia views are told apart by a number. The package starts its own at 1000. */
let nextNativeId = 500_000

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const

const canvasModule: ModuleFactory = (engine: Engine, afterCommit) => {
  const running = new Map<EngineNode, Running>()
  /** Whether Foldkit is drawing right now: between its `pre` and `post`. */
  let isInDraw = false

  const isOnScreen = (node: EngineNode): boolean => {
    let at: EngineNode | null = node
    while (at !== null && at !== engine.root) at = engine.parentNode(at)
    return at === engine.root
  }

  const makePainter = (state: Pick<Running, 'node' | 'skiaNode'>, renderer: Renderer): Painter => {
    const host = renderer === 'skia' ? skiaHost() : null
    if (host === null) return makeViewPainter(engine, state.node)
    registerSkia()
    const nativeId = nextNativeId++
    const skiaNode = engine.createElement(SKIA_TAG)
    engine.setProp(skiaNode, 'nativeID', String(nativeId))
    engine.setProp(skiaNode, 'collapsable', false)
    engine.setProp(skiaNode, 'pointerEvents', 'none')
    engine.setProp(skiaNode, 'style', FILL)
    engine.appendChild(state.node, skiaNode)
    state.skiaNode = skiaNode
    return makeSkiaPainter(host, nativeId)
  }

  const surfaceOf = (state: Running): CanvasSurface => {
    // A scene that has been stopped or replaced must not draw, ask for
    // frames or send events.
    const live = { on: true }
    state.live = live
    return {
      renderer: state.spec.renderer,
      size: () => state.size,
      draw: paint => {
        if (!live.on) return
        state.painter.draw(state.size, paint)
        // Plain views are moved by a commit. A Skia picture needs none.
        // While Foldkit is in the middle of a draw the commit is left to
        // Foldkit, which makes one when the draw is whole.
        if (!isInDraw && engine.pending) engine.commit()
      },
      frame: run =>
        onNextFrame(engine, () => {
          if (!live.on) return
          // A canvas that left the screen without being told (the whole
          // program was thrown away) stops here.
          if (!isOnScreen(state.node)) {
            destroyState(state)
            return
          }
          run(nowMs())
        }),
      now: nowMs,
      emit: (name, detail) => {
        if (!live.on) return
        const handler = handlersByNode.get(state.node)?.[name] as Handler | undefined
        handler?.(customEvent(name, detail))
      },
    }
  }

  const resized = (state: Running, width: unknown, height: unknown): void => {
    if (typeof width !== 'number' || typeof height !== 'number') return
    if (width <= 0 || height <= 0) return
    if (width === state.size.width && height === state.size.height) return
    state.size = { width, height }
    state.run.resize?.(state.size)
  }

  const begin = (state: Running): void => {
    state.painter = makePainter(state, state.spec.renderer)
    state.run = state.spec.scene.start(surfaceOf(state), state.spec.props)
  }

  const end = (state: Running): void => {
    state.live.on = false
    state.run.stop?.()
    state.run = {}
    state.painter.stop()
    if (state.skiaNode !== undefined) {
      engine.removeChild(state.node, state.skiaNode)
      engine.destroyNode(state.skiaNode)
      state.skiaNode = undefined
    }
  }

  const create = (_empty: VNode, vnode: VNode): void => {
    const spec = vnode.data?.[CANVAS_DATA] as Spec | undefined
    const node = nodeOf(vnode)
    if (spec === undefined || node === undefined) return
    const state: Running = {
      spec,
      node,
      size: { width: 0, height: 0 },
      painter: { draw: () => {}, stop: () => {} },
      skiaNode: undefined,
      run: {},
      live: { on: false },
      isAlive: true,
      stops: [],
    }
    running.set(node, state)
    state.stops.push(
      engine.setEventListener(node, 'topLayout', event => {
        const layout = (event as LayoutEvent | undefined)?.nativeEvent?.layout
        resized(state, layout?.width, layout?.height)
      }),
      engine.setResponder(node, {
        onStartShouldSetResponder: () => true,
        onResponderGrant: event => {
          const touch = (event as TouchEvent).nativeEvent
          if (!state.isAlive) return
          if (typeof touch?.locationX !== 'number' || typeof touch.locationY !== 'number') return
          state.run.tap?.(touch.locationX, touch.locationY)
        },
      }),
    )
    begin(state)
    // In case the phone does not report the size by itself: ask once the
    // canvas is on it.
    afterCommit(() => {
      if (!state.isAlive) return
      engine.measure(node, frame => {
        if (state.isAlive) resized(state, frame.width, frame.height)
      })
    })
  }

  const update = (_old: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    const state = node === undefined ? undefined : running.get(node)
    if (state === undefined) return
    const spec = vnode.data?.[CANVAS_DATA] as Spec | undefined
    if (spec === undefined) {
      // The updater reused this view for something that is not a canvas.
      destroyState(state)
      return
    }
    const before = state.spec
    if (spec.scene !== before.scene || spec.renderer !== before.renderer) {
      end(state)
      state.spec = spec
      begin(state)
      return
    }
    state.spec = spec
    state.run.update?.(spec.props)
  }

  const destroyState = (state: Running): void => {
    if (!state.isAlive) return
    end(state)
    state.isAlive = false
    running.delete(state.node)
    for (const stop of state.stops.splice(0)) stop()
  }

  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    const state = node === undefined ? undefined : running.get(node)
    if (state !== undefined) destroyState(state)
  }

  return {
    pre: () => {
      isInDraw = true
    },
    create,
    update,
    destroy,
    post: () => {
      isInDraw = false
    },
  }
}

registerModule(canvasModule)
