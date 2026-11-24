/**
 * How another part of the adapter adds behaviour for its own elements without
 * editing the core files.
 *
 * A module factory is called once per surface. It returns hooks the updater
 * runs when an element is created, updated or destroyed. Register factories
 * at import time, before the first surface is created.
 */
import type { Engine } from '@ng-native/fabric'
import type { Module } from 'foldkit/renderTarget'

export type ModuleFactory = (
  engine: Engine,
  /** Queues work for after the current draw has reached the phone. */
  afterCommit: (job: () => void) => void,
) => Partial<Module>

const factories: Array<ModuleFactory> = []

export const registerModule = (factory: ModuleFactory): void => {
  if (!factories.includes(factory)) factories.push(factory)
}

export const registeredModules = (): ReadonlyArray<ModuleFactory> => factories
