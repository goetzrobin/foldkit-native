/**
 * How another part of the adapter adds behaviour for its own elements without
 * editing the core files.
 *
 * A module factory is called once per surface. It returns hooks the updater
 * runs when an element is created, updated or destroyed. Register factories
 * at import time, before the first surface is created.
 *
 * Foldkit modules join the host layer's list (`src/host/fabric/registry.ts`),
 * where Foldkit-free features register node hooks, so all of them run in the
 * order they registered.
 */
import type { Engine } from '@ng-native/fabric'
import type { Module } from 'foldkit/renderTarget'

import { registerViewModule, registered } from '../host/fabric/registry.js'
import { fromNodeHooks } from './modules.js'

export type ModuleFactory = (
  engine: Engine,
  /** Queues work for after the current draw has reached the phone. */
  afterCommit: (job: () => void) => void,
) => Partial<Module>

export const registerModule = (factory: ModuleFactory): void => registerViewModule(factory)

/** Every registered behaviour as a Foldkit module factory, in order. */
export const registeredModules = (): ReadonlyArray<ModuleFactory> =>
  registered().map(entry =>
    entry.kind === 'hooks'
      ? (engine, afterCommit) => fromNodeHooks(entry.factory(engine, afterCommit))
      : (entry.factory as ModuleFactory),
  )
