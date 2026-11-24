/**
 * The demos the showcase app lists, in menu order. Each track adds its own
 * entry here when it is merged.
 *
 * Some demos need things only a real app can supply, such as the phone's
 * haptics or clipboard. The app passes those in, and tests pass fakes.
 */
import type { Layer } from 'effect'
import { Runtime } from 'foldkit'

import type { BackSource, Phone } from '../../src/index.js'
import { makeNotes } from '../notes.js'
import { makeDemo as makeAiChat } from './aiChat.js'
import { makeDemo as makeChat } from './chat.js'
import { makeDemo as makeDeviceDemo } from './device.js'
import { makeDemo as makeGlass } from './glass.js'
import { makeDemo as makeKeyboard } from './keyboard.js'
import { makeDemo as makeLegendChat } from './legendChat.js'
import { makeDemo as makeLists } from './lists.js'
import { makeDemo as makeMot } from './mot.js'
import { makeDemo as makeNavigation } from './navigation.js'
import { makeDemo as makeServerState } from './serverState.js'
import type { Demo } from './shell.js'
import { makeDemo as makeStyling } from './styling.js'

export type DemoResources = Readonly<{
  /** The phone features: `Phone.live({...})` in an app, `Phone.makeTest()` in a test. */
  device: Layer.Layer<Phone.Services>
  /** Android's hardware Back button: `backSourceFrom(BackHandler)` in an app. */
  backSource?: BackSource
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
    id: 'navigation',
    title: 'Navigation',
    blurb: 'Tabs, a deep stack, a modal and a sheet, title bar buttons, blocking Back.',
    start: (container, env) =>
      Runtime.embed(
        makeNavigation(container, {
          ...env,
          ...(resources.backSource === undefined ? {} : { backSource: resources.backSource }),
        }),
      ),
  },
  {
    id: 'lists',
    title: 'Lists and motion',
    blurb: '5,000 rows with about 40 drawn, pull to refresh, fades, and a card you can drag.',
    start: (container, env) => Runtime.embed(makeLists(container, env)),
  },
  {
    id: 'chat',
    title: 'Chat',
    blurb: 'Opens at the newest message and stays there. Scroll up and a new message leaves you be.',
    start: (container, env) => Runtime.embed(makeChat(container, env, resources.device)),
  },
  {
    id: 'ai-chat',
    title: 'AI chat',
    blurb: 'Your question goes to the top and the answer is written under it, word by word.',
    start: (container, env) => Runtime.embed(makeAiChat(container, env, resources.device)),
  },
  {
    id: 'legend-chat',
    title: 'AI chat on Legend List',
    blurb: "Legend List's own core with no React. Send: your message goes to the top, the reply streams under it.",
    start: (container, env) => Runtime.embed(makeLegendChat(container, env, resources.device)),
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
  {
    id: 'keyboard',
    title: 'Keyboard dock',
    blurb: 'A text field that rides on the keyboard. A label says if it follows natively or is the fallback.',
    start: (container, env) =>
      Runtime.embed(makeKeyboard(container, env, resources.device)),
  },
  {
    id: 'mot',
    title: 'Object tracking',
    blurb: 'A tracking game drawn every frame. Watch the orange dots, follow them, then tap them.',
    start: (container, env) => Runtime.embed(makeMot(container, env)),
  },
  {
    id: 'glass',
    title: 'Glass',
    blurb: 'Liquid Glass over scrolling colours. A line says if it is real glass or the fallback.',
    start: (container, env) => Runtime.embed(makeGlass(container, env)),
  },
  {
    id: 'server-state',
    title: 'Server state',
    blurb: 'A crew list from a pretend server. A panel says what was loaded, when, and why.',
    start: (container, env) =>
      Runtime.embed(makeServerState(container, env, resources.device)),
  },
]
