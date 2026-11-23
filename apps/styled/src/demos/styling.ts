/**
 * The styling demo: one screen styled only with Tailwind classes.
 *
 * What it shows a person holding the phone:
 *
 * - Light and dark colors that follow the phone's setting.
 * - A counter of how many times the Foldkit view function has run. Switching
 *   the phone between light and dark, or rotating it, changes what is on
 *   screen while that number stays the same: the engine restyles the views
 *   by itself and Foldkit is not involved.
 * - `ios:` and `android:` variants, `portrait:` and `landscape:` variants,
 *   and a few spacing, flex, typography and border utilities.
 *
 * The host must create the surface with a stylesheet compiled from the
 * classes in this file, and start the watcher:
 *
 *   createNativeSurface(fabric, rootTag, stylingOptions(sheet, sources))
 *   watchStyling(surface.engine, sources)
 *
 * Tailwind finds class names by reading source text, so every class here is
 * written out in full. A name built from pieces (`'p-' + size`) would not be
 * found and would style nothing.
 */
import { Effect, Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import { define as defineCommand } from 'foldkit/command'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  header,
  safeArea,
  screen,
  scrollView,
  stack,
  text,
  title,
  view as box,
} from '../foldkit-native'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

/**
 * How many times the view function has run since the demo started. Kept
 * outside the Model on purpose: it counts the runs themselves, and the
 * number on screen is the one from the last run.
 */
let viewRuns = 0

/** For tests: the count without reading it off the screen. */
export const viewRunCount = (): number => viewRuns

export const Model = Schema.Struct({
  /** Times the person asked for the view to run again. */
  redraws: Schema.Number,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  PressedRedraw: {},
  PressedExit: {},
  CompletedExit: {},
})
export type Message = typeof Message.Type

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { redraws: 0 },
})

/** The pieces the screen is built from. They need the builder for `h.Class`. */
const pieces = (h: HtmlBuilder<Message>) => {
  const heading = (label: string): Html =>
    text([h.Class('text-lg font-semibold text-neutral-900 dark:text-neutral-50')], [label])

  const body = (label: string): Html =>
    text([h.Class('text-base text-neutral-700 dark:text-neutral-300')], [label])

  const small = (label: string): Html =>
    text([h.Class('text-xs text-neutral-600 dark:text-neutral-400')], [label])

  const card = (children: ReadonlyArray<Html>): Html =>
    box(
      [
        h.Class(
          'gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900',
        ),
      ],
      children,
    )

  /** A box that shows one utility, with its name inside. */
  const sample = (classes: string, label: string): Html =>
    box([h.Class(classes)], [small(label)])

  /** `active:` dims the button while a finger is on it, with no Message. */
  const button = (id: string, label: string, message: Message): Html =>
    box(
      [
        h.Attribute('testID', id),
        h.OnClick(message),
        h.Class('items-center rounded-lg bg-blue-600 px-4 py-3 active:opacity-60'),
      ],
      [text([h.Class('text-base font-semibold text-white')], [label])],
    )

  return { heading, body, small, card, sample, button }
}

const SAMPLE = 'bg-sky-100 dark:bg-sky-900'

const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    viewRuns += 1
    const { heading, body, small, card, sample, button } = pieces(h)

    return stack(
      [h.Attribute('testID', 'styling-stack')],
      [
        screen(
          [h.Key('styling'), h.Attribute('testID', 'screen-styling')],
          [
            header([title('Styling')], []),
            safeArea(device, { hasHeader: true }, [
              box(
                [
                  h.Attribute('testID', 'page'),
                  h.Class('flex-1 bg-white dark:bg-neutral-950'),
                ],
                [
                  scrollView(
                    [h.Class('flex-1')],
                    [
                      box(
                        [h.Class('gap-4 p-4')],
                        [
                          card([
                            heading('Dark mode without a redraw'),
                            body(
                              'Switch the phone between light and dark: Control Center on an iPhone, Quick Settings on Android. Every color on this screen should change at once.',
                            ),
                            box(
                              [
                                h.Attribute('testID', 'badge-light'),
                                h.Class('rounded-lg bg-amber-200 p-3 dark:hidden'),
                              ],
                              [
                                text(
                                  [h.Class('text-base font-semibold text-amber-950')],
                                  ['The phone is in LIGHT mode'],
                                ),
                              ],
                            ),
                            box(
                              [
                                h.Attribute('testID', 'badge-dark'),
                                h.Class('hidden rounded-lg bg-indigo-800 p-3 dark:flex'),
                              ],
                              [
                                text(
                                  [h.Class('text-base font-semibold text-indigo-50')],
                                  ['The phone is in DARK mode'],
                                ),
                              ],
                            ),
                            text(
                              [
                                h.Attribute('testID', 'view-runs'),
                                h.Class(
                                  'text-2xl font-bold text-neutral-900 dark:text-neutral-50',
                                ),
                              ],
                              [`View runs: ${viewRuns}`],
                            ),
                            body(
                              'That number counts how often the app rebuilt this screen. It must stay the same when you switch light and dark or rotate the phone. It goes up by one each time you press the button.',
                            ),
                            button('redraw', 'Run the view again', Message.PressedRedraw()),
                            small(`Button pressed ${model.redraws} times`),
                          ]),
                          card([
                            heading('iPhone or Android'),
                            box(
                              [
                                h.Attribute('testID', 'platform-box'),
                                h.Class('rounded-lg p-3 ios:bg-sky-600 android:bg-emerald-600'),
                              ],
                              [
                                text(
                                  [h.Class('text-base text-white android:hidden')],
                                  ['This is an iPhone, so this box is blue.'],
                                ),
                                text(
                                  [h.Class('text-base text-white ios:hidden')],
                                  ['This is an Android phone, so this box is green.'],
                                ),
                              ],
                            ),
                          ]),
                          card([
                            heading('Rotate the phone'),
                            box(
                              [
                                h.Attribute('testID', 'rotation-bar'),
                                h.Class('h-4 rounded-full portrait:bg-rose-500 landscape:bg-teal-500'),
                              ],
                              [],
                            ),
                            body(
                              'The bar is red when the phone is upright and teal when it is on its side. The view run number should not change.',
                            ),
                          ]),
                          card([
                            heading('Spacing'),
                            body('Each box has more padding than the one before.'),
                            box(
                              [h.Class('flex-row items-end gap-2')],
                              [
                                sample(`p-1 ${SAMPLE}`, 'p-1'),
                                sample(`p-2 ${SAMPLE}`, 'p-2'),
                                sample(`p-4 ${SAMPLE}`, 'p-4'),
                                sample(`p-6 ${SAMPLE}`, 'p-6'),
                              ],
                            ),
                          ]),
                          card([
                            heading('Flex'),
                            body('Three boxes spread across a row, then one that takes the room left over.'),
                            box(
                              [h.Class('flex-row items-center justify-between')],
                              [
                                sample(`p-2 ${SAMPLE}`, 'start'),
                                sample(`p-2 ${SAMPLE}`, 'middle'),
                                sample(`p-2 ${SAMPLE}`, 'end'),
                              ],
                            ),
                            box(
                              [h.Class('flex-row gap-2')],
                              [
                                sample(`w-16 p-2 ${SAMPLE}`, 'w-16'),
                                sample(`flex-1 p-2 ${SAMPLE}`, 'flex-1'),
                              ],
                            ),
                          ]),
                          card([
                            heading('Typography'),
                            text(
                              [h.Class('text-xs text-neutral-700 dark:text-neutral-300')],
                              ['Extra small text'],
                            ),
                            text(
                              [h.Class('text-2xl font-bold text-neutral-900 dark:text-neutral-50')],
                              ['Large bold text'],
                            ),
                            text(
                              [h.Class('text-base italic text-neutral-700 dark:text-neutral-300')],
                              ['Italic text'],
                            ),
                            text(
                              [
                                h.Class(
                                  'text-sm uppercase tracking-widest text-neutral-700 dark:text-neutral-300',
                                ),
                              ],
                              ['Capitals, spaced out'],
                            ),
                            text(
                              [h.Class('text-center text-base text-neutral-700 dark:text-neutral-300')],
                              ['Centered text'],
                            ),
                            text(
                              [h.Class('font-mono text-base text-neutral-700 dark:text-neutral-300')],
                              ['Typewriter text'],
                            ),
                          ]),
                          card([
                            heading('Borders'),
                            box(
                              [h.Class('flex-row items-center gap-2')],
                              [
                                sample('border border-neutral-500 p-2', 'thin'),
                                sample('border-4 border-blue-600 p-2', 'thick'),
                                sample('rounded-xl border-2 border-rose-500 p-2', 'rounded'),
                                sample('rounded-full border-2 border-emerald-600 px-3 py-2', 'pill'),
                              ],
                            ),
                            body('Below: the thinnest line this screen can draw.'),
                            box(
                              [h.Class('border-b-hairline border-neutral-500')],
                              [],
                            ),
                          ]),
                          button('exit', 'Exit', Message.PressedExit()),
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )
  }

export const makeDemo = (container: HTMLElement, env: DemoEnv) => {
  viewRuns = 0

  // Leaving the demo is a side effect, so it runs as a Command.
  const Exit = defineCommand('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })

  const update = (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedRedraw: () => ({
        model: modifyFields(model, { redraws: redraws => redraws + 1 }),
      }),
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
    })

  return Runtime.makeElement({
    Model,
    init,
    update,
    view: makeView(env.device),
    container,
  })
}
