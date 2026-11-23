/**
 * The demos the showcase app lists, in menu order. Each track adds its own
 * entry here when it is merged.
 *
 * Some demos need things only a real app can supply, such as the phone's
 * haptics or clipboard. The app passes those in, and tests pass fakes.
 */
import type { Layer } from 'effect'
import { Runtime } from 'foldkit'

import type { Phone } from '../../src/index.js'
import { makeNotes } from '../notes.js'
import { makeDemo as makeDeviceDemo } from './device.js'
import type { Demo } from './shell.js'
import { makeDemo as makeStyling } from './styling.js'

export type DemoResources = Readonly<{
  /** The phone features: `Phone.live({...})` in an app, `Phone.makeTest()` in a test. */
  device: Layer.Layer<Phone.Services>
}>

export const makeDemos = (resources: DemoResources): ReadonlyArray<Demo> => [
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
  {
    id: 'device',
    title: 'Phone features',
    blurb: 'Haptics, clipboard, saved text, share sheet, alerts, keyboard, network, rotation.',
    start: (container, env) =>
      Runtime.embed(makeDeviceDemo(container, env, resources.device)),
  },
]
