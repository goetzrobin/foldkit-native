/**
 * The demos the showcase app lists, in menu order. Each track adds its own
 * entry here when it is merged.
 */
import { Runtime } from 'foldkit'

import { makeNotes } from '../notes.js'
import type { Demo } from './shell.js'
import { makeDemo as makeStyling } from './styling.js'

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
  {
    id: 'styling',
    title: 'Styling',
    blurb: 'Tailwind classes. Switch the phone to dark mode: colors change, "View runs" stays at 1.',
    start: (container, env) => Runtime.embed(makeStyling(container, env)),
  },
]
