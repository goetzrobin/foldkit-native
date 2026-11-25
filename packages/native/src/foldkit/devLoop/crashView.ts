/**
 * What the phone shows when a Foldkit program crashes.
 *
 * Foldkit's own crash view is built from HTML elements (`div`, `p`, `pre`,
 * `button`), which do not exist on a phone: their words land outside any text
 * view, and the phone draws every line at the top of the screen, on top of
 * each other. Foldkit lets a program supply its own through the `crash`
 * option. This one is built from native elements:
 *
 *   Runtime.makeElement({ Model, init, update, view, container, crash: nativeCrash() })
 *
 * Top to bottom, in one column: the title, the Message being handled, then a
 * scroll view with the error's name, its message and the first lines of its
 * stack, each wrapping to the screen's width; then the buttons.
 *
 * A crashed program has stopped for good: Foldkit gives the crash view no
 * way to send a Message. Its buttons run plain functions the host passes in
 * (`onReload`, `onCopy`), outside the program: Reload starts a new program,
 * Copy puts the error on the clipboard. Without them, the way out is new code
 * (save a file, the hot update starts the program again) or a reload of the
 * app.
 */
import { Option } from 'effect'
import type { Runtime } from 'foldkit'
import type { Html } from 'foldkit/html'
import { OnCustomEvent } from 'foldkit/renderTarget'

import { scrollView, text, view } from '../elements.js'
import { prop, style } from '../../navigation.js'
import { PRESSED_STYLE } from '../../host/style.js'

export type NativeCrashOptions = Readonly<{
  /** The line under the error. Defaults to how to reload. */
  hint?: string
  /** Shows a Reload button that runs this, outside the stopped program. */
  onReload?: () => void
  /** Shows a Copy button that hands this the error as text: name, message and stack. */
  onCopy?: (text: string) => void
  /** How many lines of the stack to show. Default 12. */
  stackLines?: number
}>

const DEFAULT_HINT =
  'Fix the code and save to try again, or shake the phone and choose Reload.'
const BUTTONS_HINT = 'Copy the error to send it on, or Reload to start again.'

const PAPER = '#ffffff'
const INK = '#111111'
const MUTED = '#6b6b6b'
const DANGER = '#c62828'
const CODE_PAPER = '#f3f4f6'
const BUTTON = '#18181b'

/** The Message's `_tag`, when the crash happened while handling one. */
const messageName = (message: Option.Option<unknown>): string | undefined => {
  const value = Option.getOrUndefined(message) as { _tag?: unknown } | undefined
  return typeof value?._tag === 'string' ? value._tag : undefined
}

/** The stack's own lines, without the first one when it only repeats the name and message. */
export const stackLinesOf = (error: Error, count: number): ReadonlyArray<string> => {
  const lines = (error.stack ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
  const first = lines[0] ?? ''
  const rest = first.startsWith(error.name) || first === error.message ? lines.slice(1) : lines
  return rest.slice(0, count)
}

/** The error as text, for the clipboard: name, message and the whole stack. */
export const crashReport = (error: Error, during?: string): string =>
  [
    `${error.name}: ${error.message}`,
    ...(during === undefined ? [] : [`While handling ${during}`]),
    ...stackLinesOf(error, Number.POSITIVE_INFINITY),
  ].join('\n')

const label = (id: string, color: string, fontSize: number, words: string): Html =>
  text([prop('testID', id), style({ color, fontSize, lineHeight: Math.round(fontSize * 1.35) })], [words])

/**
 * A press that runs `run` itself. The crashed program dispatches nothing, so
 * the handler does the work and gives Foldkit no Message.
 */
const onPressRun = (run: () => void) =>
  OnCustomEvent<never>({
    name: 'click',
    f: () => {
      run()
      return Option.none()
    },
  })

const button = (id: string, words: string, run: () => void): Html =>
  view(
    [
      prop('testID', id),
      prop('accessibilityRole', 'button'),
      prop('accessibilityLabel', words),
      onPressRun(run),
      prop(PRESSED_STYLE, { opacity: 0.6 }),
      style({
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        borderRadius: 12,
        backgroundColor: BUTTON,
      }),
    ],
    [text([style({ color: PAPER, fontSize: 17, fontWeight: '600' })], [words])],
  )

export const nativeCrashView = <Model, Message>(
  context: Runtime.CrashContext<Model, Message>,
  options: NativeCrashOptions = {},
): Html => {
  const { error } = context
  const during = messageName(context.message)
  const stack = stackLinesOf(error, options.stackLines ?? 12)
  const { onReload, onCopy } = options
  const buttons = [
    ...(onReload === undefined ? [] : [button('crash-reload', 'Reload', onReload)]),
    ...(onCopy === undefined ? [] : [button('crash-copy', 'Copy', () => onCopy(crashReport(error, during)))]),
  ]
  const hasButtons = buttons.length > 0
  return view(
    [
      prop('testID', 'crash-screen'),
      // This view replaces the whole program, so no screen or safe area is
      // around it. The fixed top and bottom padding keep clear of the notch
      // and the home indicator. One column: nothing here is placed by hand.
      style({
        flex: 1,
        flexDirection: 'column',
        backgroundColor: PAPER,
        paddingTop: 72,
        paddingHorizontal: 20,
        paddingBottom: 40,
        gap: 12,
      }),
    ],
    [
      text(
        [prop('testID', 'crash-title'), style({ color: DANGER, fontSize: 24, lineHeight: 30, fontWeight: '700' })],
        ['The program crashed'],
      ),
      ...(during === undefined ? [] : [label('crash-during', MUTED, 14, `While handling ${during}`)]),
      // The details take the room that is left and scroll inside it, so a long
      // message or stack never pushes the buttons off the screen.
      scrollView(
        [
          prop('testID', 'crash-details'),
          style({ flex: 1, backgroundColor: CODE_PAPER, borderRadius: 10 }),
        ],
        [
          view(
            [style({ flexDirection: 'column', padding: 14, gap: 8 })],
            [
              text(
                [prop('testID', 'crash-name'), style({ color: DANGER, fontSize: 15, lineHeight: 20, fontWeight: '600' })],
                [error.name],
              ),
              text(
                [prop('testID', 'crash-message'), prop('selectable', true), style({ color: INK, fontSize: 16, lineHeight: 22 })],
                [error.message],
              ),
              ...(stack.length === 0
                ? []
                : [
                    text(
                      [prop('testID', 'crash-stack'), prop('selectable', true), style({ color: MUTED, fontSize: 12, lineHeight: 17 })],
                      [stack.join('\n')],
                    ),
                  ]),
            ],
          ),
        ],
      ),
      label('crash-hint', MUTED, 15, options.hint ?? (hasButtons ? BUTTONS_HINT : DEFAULT_HINT)),
      ...(hasButtons ? [view([prop('testID', 'crash-buttons'), style({ flexDirection: 'row', gap: 12 })], buttons)] : []),
    ],
  )
}

/** The `crash` option for `Runtime.makeElement`. */
export const nativeCrash = <Model, Message>(
  options: NativeCrashOptions = {},
): Runtime.ElementCrashConfig<Model, Message> => ({
  view: context => nativeCrashView(context, options),
})
