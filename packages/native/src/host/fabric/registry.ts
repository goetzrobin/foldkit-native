/**
 * Behaviour that other parts of the adapter add to every surface, in the
 * order they were registered.
 *
 * A factory is called once per surface and returns hooks the view updater
 * runs as elements are made, drawn again and taken away. Host features
 * register node hooks here at import time, before the first surface is
 * created. A view library's binding registers its own modules into the same
 * list (`registerViewModule`), so everything runs in the order it was
 * registered, whichever layer it came from.
 */
import type { Engine } from '@ng-native/fabric'

import type { NodeHooks } from './nodes.js'

export type AfterCommit = (job: () => void) => void

export type NodeHooksFactory = (engine: Engine, afterCommit: AfterCommit) => NodeHooks

export type Registered =
  | Readonly<{ kind: 'hooks'; factory: NodeHooksFactory }>
  /** A view library's own module factory. The host does not look inside. */
  | Readonly<{ kind: 'view'; factory: unknown }>

const entries: Array<Registered> = []

const register = (entry: Registered): void => {
  if (!entries.some(each => each.factory === entry.factory)) entries.push(entry)
}

export const registerNodeHooks = (factory: NodeHooksFactory): void =>
  register({ kind: 'hooks', factory })

export const registerViewModule = (factory: unknown): void => register({ kind: 'view', factory })

export const registered = (): ReadonlyArray<Registered> => entries
