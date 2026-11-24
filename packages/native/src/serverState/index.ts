/**
 * Server state for Foldkit programs: data that lives on a server and is
 * only borrowed by the phone.
 *
 * The pieces, each in its own file beside this one:
 *
 *   sync.ts        topics a write announces so that reads load again
 *   bridge.ts      a Subscription to read an atom, a Command to write
 *   optimistic.ts  show a change before the server has answered
 *
 * Start with `docs/SERVER_STATE.md`. It explains the idea in plain words.
 */
export { Sync, makeSync } from './sync.js'
export type { SyncBus, SyncService } from './sync.js'
export {
  ServerState,
  focusEntry,
  focusSignal,
  makeServerState,
  runWrite,
  watchAtom,
} from './bridge.js'
export type {
  ServerStateHandle,
  ServerStateOptions,
  ServerStateService,
  WatchAtomConfig,
  WriteConfig,
  WriteFailure,
} from './bridge.js'
export * as Optimistic from './optimistic.js'
