/**
 * The showcase menu: one row per demo. Pressing a row opens that demo.
 * If the last demo crashed, the error shows at the top.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'

import {
  type Device,
  header,
  onPress,
  pressable,
  pressedStyle,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  testId,
  text,
  title,
  view as box,
} from '../../src/index.js'

export type MenuEntry = Readonly<{
  id: string
  title: string
  /** One line: what to try and what should happen. */
  blurb: string
}>

export type MenuEnv = Readonly<{
  device: Device
  entries: ReadonlyArray<MenuEntry>
  open: (id: string) => void
  /** Why the last demo closed by itself, if it crashed. */
  lastError?: string
}>

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedEntry: { id: Schema.String },
  CompletedOpenDemo: {},
})
type Message = typeof Message.Type

export const makeMenu = (container: HTMLElement, env: MenuEnv) => {
  const OpenDemo = Command.define('OpenDemo', {
    args: { id: Schema.String },
    messages: [Message.CompletedOpenDemo],
    execute: ({ id }) =>
      Effect.sync(() => env.open(id)).pipe(Effect.as(Message.CompletedOpenDemo())),
  })

  const update = (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedEntry: ({ id }) => ({ model, commands: [OpenDemo({ id })] }),
      CompletedOpenDemo: () => ({ model }),
    })

  const init: Runtime.ElementInit<Model, Message> = () => ({ model: {} })

  const entryRow = (entry: MenuEntry): Html =>
    pressable(
      [
        testId(`open-${entry.id}`),
        onPress(Message.PressedEntry({ id: entry.id })),
        pressedStyle({ backgroundColor: '#f0f0f0' }),
        style({
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#e3e3e3',
          gap: 4,
        }),
      ],
      [
        text([style({ fontSize: 17, fontWeight: '600', color: '#111111' })], [entry.title]),
        text([style({ fontSize: 14, color: '#6b6b6b' })], [entry.blurb]),
      ],
    )

  const errorBanner = (message: string): Html =>
    box(
      [testId('last-error'), style({ padding: 16, backgroundColor: '#fdecea', gap: 4 })],
      [
        text([style({ fontSize: 15, fontWeight: '700', color: '#c62828' })], ['The last demo crashed']),
        text([style({ fontSize: 14, color: '#111111' })], [message]),
      ],
    )

  const view = (): Html =>
    stack(
      [],
      [
        screen(
          [testId('screen-menu')],
          [
            header([title('Foldkit Native')], []),
            safeArea(env.device, { hasHeader: true }, [
              scrollView(
                [testId('menu'), style({ flex: 1, backgroundColor: '#ffffff' })],
                [
                  ...(env.lastError === undefined ? [] : [errorBanner(env.lastError)]),
                  ...env.entries.map(entryRow),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

  return Runtime.makeElement({ Model, init, update, view, container })
}
