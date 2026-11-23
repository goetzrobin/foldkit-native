/**
 * Starts a place on the phone screen that a Foldkit program can draw into.
 *
 * It returns a `container`. Pass that to `Runtime.makeElement` exactly as a
 * web program passes a DOM element, then start the program with
 * `Runtime.embed` or `Runtime.run`.
 */
import {
  Engine,
  type EngineNode,
  type EngineOptions,
  type FabricUIManager,
} from '@ng-native/fabric'
import {
  type RenderTarget,
  type VNode,
  init,
  onUnmountModule,
  registerRenderTarget,
} from 'foldkit/renderTarget'

import { makeModules } from './modules'
import { stopMotion } from './motion/clock'
import { makeNodeApi } from './nodeApi'

export type NativeSurface = Readonly<{
  /** Give this to `Runtime.makeElement({ container })`. */
  container: HTMLElement
  engine: Engine
  /** Stops drawing and releases the engine. Dispose the program first. */
  dispose: () => void
}>

export type NativeSurfaceOptions = EngineOptions &
  Readonly<{
    /** Names the program for Foldkit's runtime. Defaults to `app`. */
    id?: string
    /**
     * EXPERIMENT. On a first launch in Expo Go the first screen came up with
     * its content missing until the app was reloaded. With this on, the
     * surface commits again 0.1, 0.5 and 1.5 seconds after the first draw.
     * If the content then appears by itself, the first draw came too early.
     */
    recommitAfterFirstDraw?: boolean
  }>

const HOST_STYLE = { height: '100%' } as const

export const createNativeSurface = (
  fabric: FabricUIManager,
  rootTag: number,
  options: NativeSurfaceOptions = {},
): NativeSurface => {
  const { id = 'app', recommitAfterFirstDraw = false, ...engineOptions } = options
  const engine = new Engine(fabric, rootTag, engineOptions)
  const api = makeNodeApi(engine)
  // Work that needs the latest draw to have reached the phone first.
  const afterCommitJobs: Array<() => void> = []
  const patch = init(
    [...makeModules(engine, job => afterCommitJobs.push(job)), onUnmountModule],
    api,
  )

  // Work the engine does on its own clock, such as a style transition, asks
  // for a commit here. One per task is enough.
  let isCommitQueued = false
  engine.setOnDirty(() => {
    if (isCommitQueued) return
    isCommitQueued = true
    queueMicrotask(() => {
      isCommitQueued = false
      engine.commit()
    })
  })

  // A view that fills the screen, committed now, in the same turn the phone
  // started this surface. ng-native does the same. The program draws inside
  // it a frame later. Without it the first screen stayed blank on a real
  // iPhone until the app was sent to the background and brought back.
  const host = engine.createElement('view')
  engine.appendChild(engine.root, host)
  engine.setDefaultStyle(host, HOST_STYLE)
  engine.commit()

  const container = { id }

  const commitAfter = (vnode: VNode): VNode => {
    engine.commit()
    for (const job of afterCommitJobs.splice(0)) job()
    return vnode
  }

  const nudges: Array<ReturnType<typeof setTimeout>> = []
  const scheduleNudges = (): void => {
    if (!recommitAfterFirstDraw) return
    for (const [index, delay] of [100, 500, 1500].entries()) {
      nudges.push(
        setTimeout(() => {
          // A changed prop makes a real commit: one that changes nothing is skipped.
          engine.setProp(host, 'nativeID', `foldkit-host-${index}`)
          engine.commit()
        }, delay),
      )
    }
  }

  const target: RenderTarget = {
    mount: (_container, vnode, onRootPatched) => {
      scheduleNudges()
      // The updater replaces the node it is given, so it gets a placeholder
      // inside the host view to replace with the program's first tree.
      const placeholder = engine.createAnchor()
      engine.appendChild(host, placeholder)
      const placeholderVNode: VNode = {
        sel: '!',
        data: {},
        children: undefined,
        text: '',
        elm: placeholder as unknown as Element,
        key: undefined,
      }
      return commitAfter(patch(placeholderVNode, vnode, onRootPatched))
    },
    patch: (currentVNode, vnode, onRootPatched) =>
      commitAfter(patch(currentVNode, vnode, onRootPatched)),
    // Foldkit draws on the browser's next animation frame by default. On a
    // phone that clock can be paused while the app is still coming to the
    // front, which left the first screen blank. A microtask always runs.
    requestFrame: run => queueMicrotask(run),
    unmount: (_container, emptyVNode) => {
      const left = emptyVNode.elm as unknown as EngineNode | undefined
      if (left !== undefined) {
        engine.removeChild(host, left)
        engine.destroyNode(left)
      }
      engine.commit()
    },
  }

  const unregister = registerRenderTarget(container, target)

  return {
    // Foldkit types its container as a DOM element. The registration above is
    // what makes this object stand in for one.
    container: container as unknown as HTMLElement,
    engine,
    dispose: () => {
      for (const nudge of nudges) clearTimeout(nudge)
      // A queued animation frame must not commit on an engine that is gone.
      stopMotion({ engine })
      unregister()
      // Newer engines have a `dispose`. The published 0.25.0 does not.
      ;(engine as { dispose?: () => void }).dispose?.()
    },
  }
}
