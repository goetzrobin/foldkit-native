/**
 * The demos the showcase app lists, in menu order. Each track adds its own
 * entry here when it is merged.
 */
import { Runtime } from 'foldkit'

import { makeNotes } from '../notes'
import type { Demo } from './shell'

export const demos: ReadonlyArray<Demo> = [
  {
    id: 'notes',
    title: 'Notes',
    blurb: 'Type, add, open a note, swipe back. The Phase 1 app.',
    start: (container, env) =>
      Runtime.embed(
        makeNotes(container, env.device, { exit: env.exit, crashed: env.crashed }),
      ),
  },
]
