/**
 * Starts a place on the phone screen that a Foldkit program can draw into.
 *
 * It returns a `container`. Pass that to `Runtime.makeElement` exactly as a
 * web program passes a DOM element, then start the program with
 * `Runtime.embed` or `Runtime.run`.
 *
 * The engine, the full-screen view and the commits are the host layer's
 * (`src/host/fabric/surface.ts`). This file builds Foldkit's updater over
 * the engine's nodes and registers it as the container's render target.
 */
import type { Engine, FabricUIManager } from '@ng-native/fabric'
import {
  type RenderTarget,
  type VNode,
  init,
  onUnmountModule,
  registerRenderTarget,
} from 'foldkit/renderTarget'

import { type HostSurfaceOptions, createHostSurface } from '../host/fabric/surface.js'
import { makeModules } from './modules.js'
import { makeNodeApi } from './nodeApi.js'

export type NativeSurface = Readonly<{
  /** Give this to `Runtime.makeElement({ container })`. */
  container: HTMLElement
  engine: Engine
  /** Stops drawing and releases the engine. Dispose the program first. */
  dispose: () => void
}>

export type NativeSurfaceOptions = HostSurfaceOptions &
  Readonly<{
    /** Names the program for Foldkit's runtime. Defaults to `app`. */
    id?: string
  }>


export const createNativeSurface = (
  fabric: FabricUIManager,
  rootTag: number,
  options: NativeSurfaceOptions = {},
): NativeSurface => {
  const { id = 'app', ...hostOptions } = options
  let patch: ReturnType<typeof init> | undefined
  const surface = createHostSurface(fabric, rootTag, hostOptions, (engine, afterCommit) => {
    const api = makeNodeApi(engine)
    patch = init([...makeModules(engine, afterCommit), onUnmountModule], api)
  })
  const draw = patch as ReturnType<typeof init>

  const container = { id }

  const commitAfter = (vnode: VNode): VNode => {
    surface.commit()
    return vnode
  }

  const target: RenderTarget = {
    mount: (_container, vnode, onRootPatched) => {
      surface.scheduleNudges()
      // The updater replaces the node it is given, so it gets a placeholder
      // inside the host view to replace with the program's first tree.
      const placeholderVNode: VNode = {
        sel: '!',
        data: {},
        children: undefined,
        text: '',
        elm: surface.placeholder() as unknown as Element,
        key: undefined,
      }
      return commitAfter(draw(placeholderVNode, vnode, onRootPatched))
    },
    patch: (currentVNode, vnode, onRootPatched) =>
      commitAfter(draw(currentVNode, vnode, onRootPatched)),
    // Foldkit draws on the browser's next animation frame by default. On a
    // phone that clock can be paused while the app is still coming to the
    // front, which left the first screen blank. A microtask always runs.
    requestFrame: run => queueMicrotask(run),
    unmount: (_container, emptyVNode) => surface.release(emptyVNode.elm as never),
  }

  const unregister = registerRenderTarget(container, target)

  return {
    // Foldkit types its container as a DOM element. The registration above is
    // what makes this object stand in for one.
    container: container as unknown as HTMLElement,
    engine: surface.engine,
    dispose: () => surface.dispose(unregister),
  }
}
