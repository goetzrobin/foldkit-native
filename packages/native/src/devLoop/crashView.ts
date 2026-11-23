/**
 * What the phone shows when a Foldkit program crashes.
 *
 * Foldkit's own crash view is built from HTML elements (`div`, `h1`), which
 * do not exist on a phone. Foldkit lets a program supply its own through the
 * `crash` option. This one is built from native elements:
 *
 *   Runtime.makeElement({ Model, init, update, view, container, crash: nativeCrash() })
 *
 * A crashed program has stopped for good: Foldkit gives the crash view no
 * way to send a Message, so nothing on this screen can be pressed. The way
 * out is new code (save a file, the hot update starts the program again) or
 * a reload of the app.
 */
import { Option } from 'effect'
import type { Runtime } from 'foldkit'
import type { Html } from 'foldkit/html'

import { scrollView, text, view } from '../elements.js'
import { prop, style } from '../navigation.js'

export type NativeCrashOptions = Readonly<{
  /** The line under the error. Defaults to how to reload in Expo Go. */
  hint?: string
}>

const DEFAULT_HINT =
  'Fix the code and save to try again, or shake the phone and choose Reload.'

const PAPER = '#ffffff'
const INK = '#111111'
const MUTED = '#6b6b6b'
const DANGER = '#c62828'
const CODE_PAPER = '#f3f4f6'

/** The Message's `_tag`, when the crash happened while handling one. */
const messageName = (message: Option.Option<unknown>): string | undefined => {
  const value = Option.getOrUndefined(message) as { _tag?: unknown } | undefined
  return typeof value?._tag === 'string' ? value._tag : undefined
}

const label = (id: string, color: string, fontSize: number, words: string): Html =>
  text([prop('testID', id), style({ color, fontSize })], [words])

export const nativeCrashView = <Model, Message>(
  context: Runtime.CrashContext<Model, Message>,
  options: NativeCrashOptions = {},
): Html => {
  const during = messageName(context.message)
  return view(
    [
      prop('testID', 'crash-screen'),
      // This view replaces the whole program, so no screen or safe area is
      // around it. The fixed top padding keeps the title below the notch.
      style({
        flex: 1,
        backgroundColor: PAPER,
        paddingTop: 72,
        paddingHorizontal: 20,
        paddingBottom: 32,
        gap: 12,
      }),
    ],
    [
      text(
        [
          prop('testID', 'crash-title'),
          style({ color: DANGER, fontSize: 24, fontWeight: '700' }),
        ],
        ['The program crashed'],
      ),
      ...(during === undefined
        ? []
        : [label('crash-during', MUTED, 14, `While handling ${during}`)]),
      scrollView(
        [
          style({
            flexGrow: 0,
            flexShrink: 1,
            backgroundColor: CODE_PAPER,
            borderRadius: 10,
          }),
        ],
        [
          text(
            [
              prop('testID', 'crash-message'),
              prop('selectable', true),
              style({ color: INK, fontSize: 16, padding: 14 }),
            ],
            [context.error.message],
          ),
        ],
      ),
      label('crash-hint', MUTED, 15, options.hint ?? DEFAULT_HINT),
    ],
  )
}

/** The `crash` option for `Runtime.makeElement`. */
export const nativeCrash = <Model, Message>(
  options: NativeCrashOptions = {},
): Runtime.ElementCrashConfig<Model, Message> => ({
  view: context => nativeCrashView(context, options),
})
