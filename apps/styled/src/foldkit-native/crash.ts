/**
 * What a program shows when it crashes.
 *
 * Foldkit's built-in crash screen is made of web elements. This one is made
 * of native views. Pass it to `Runtime.makeElement({ crash: nativeCrash() })`.
 *
 * A crash screen cannot have buttons: the program that would handle a press
 * has stopped. To let the user leave, pass `report` and act outside the
 * program, as the showcase shell does.
 */
import type { Html } from 'foldkit/html'

import { style } from './attributes'
import { text, view } from './elements'

type CrashContext = Readonly<{ error: Error }>

export const crashView = (context: CrashContext): Html =>
  view(
    [style({ flex: 1, padding: 24, paddingTop: 80, gap: 12, backgroundColor: '#ffffff' })],
    [
      text([style({ fontSize: 22, fontWeight: '700', color: '#c62828' })], ['This screen crashed']),
      text([style({ fontSize: 15, color: '#111111' })], [context.error.message]),
    ],
  )

export const nativeCrash = (report?: (error: Error) => void) => ({
  view: (context: CrashContext): Html => crashView(context),
  report: (context: CrashContext): void => report?.(context.error),
})
