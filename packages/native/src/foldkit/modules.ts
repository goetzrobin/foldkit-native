/**
 * Foldkit's updater runs modules: hooks called with virtual nodes as it
 * creates, patches and removes elements. The adapter's behaviours are node
 * hooks over engine nodes (`src/host/fabric/nodes.ts`). This file turns one
 * into the other, and lists the modules every surface runs: the core
 * behaviours first, then those other parts of the adapter registered (see
 * `extend.ts`), in the order they registered.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import type { Module, VNode } from 'foldkit/renderTarget'

import {
  type Bag,
  EMPTY_DATA,
  type NodeData,
  type NodeHooks,
  bagIn,
  makeNodeHooks,
} from '../host/fabric/nodes.js'
import { registeredModules } from './extend.js'

export { customEvent, handlersByNode } from '../host/fabric/nodes.js'
export type { Bag, Handler } from '../host/fabric/nodes.js'

/** The engine node a virtual node drew, if it is an element. */
export const nodeOf = (vnode: VNode): EngineNode | undefined => {
  const node = vnode.elm as unknown as EngineNode | undefined
  return node !== undefined && node.nodeKind === 'element' ? node : undefined
}

/** What the view put on an element besides its children. */
export const dataOf = (vnode: VNode): NodeData => (vnode.data as NodeData | undefined) ?? EMPTY_DATA

export const bagOf = (vnode: VNode, key: 'props' | 'attrs' | 'class' | 'style' | 'on'): Bag =>
  bagIn(dataOf(vnode), key)

/** Node hooks as a Foldkit module. Text and comment nodes are passed over. */
export const fromNodeHooks = (hooks: NodeHooks): Partial<Module> => {
  const { create, update, destroy, post } = hooks
  const module: Partial<Module> = {}
  if (create !== undefined) {
    module.create = (_empty, vnode) => {
      const node = nodeOf(vnode)
      if (node !== undefined) create(node, dataOf(vnode))
    }
  }
  if (update !== undefined) {
    module.update = (oldVnode, vnode) => {
      const node = nodeOf(vnode)
      if (node !== undefined) update(node, dataOf(oldVnode), dataOf(vnode))
    }
  }
  if (destroy !== undefined) {
    module.destroy = vnode => {
      const node = nodeOf(vnode)
      if (node !== undefined) destroy(node, dataOf(vnode))
    }
  }
  if (post !== undefined) module.post = () => post()
  return module
}

export const makeModules = (
  engine: Engine,
  afterCommit: (job: () => void) => void,
): Array<Partial<Module>> => [
  ...makeNodeHooks(engine, afterCommit).map(fromNodeHooks),
  ...registeredModules().map(factory => factory(engine, afterCommit)),
]
