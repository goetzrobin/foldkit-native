/**
 * The playground: a menu, and one screen per question.
 *
 * The app owns the phone's screen stack. Its Model is the list of screens,
 * the last one on top. Adding one pushes it with the phone's animation, and
 * a swipe back is reported by the phone afterwards (`dismissed`), so the
 * Model drops the same screens and agrees with the phone again.
 *
 * Each demo is a child component drawn inside its screen. A child owns its
 * content and its state. The app owns the screens and their title bars.
 */
import { UiSchema } from '@effect/ui'
import { Schema } from 'effect'

import { Native } from '../src/index.js'
import { Counter } from './counter.js'
import { LongList } from './longList.js'
import * as Look from './look.js'
import { NoteDetail, Notes } from './notes.js'
import { PhoneScreen } from './phone.js'
import { ServerState } from './serverState.js'
import { Touch } from './touch.js'

const Demo = Schema.Literals(['Counter', 'Notes', 'LongList', 'Touch', 'Phone', 'ServerState'])
type Demo = typeof Demo.Type

const Screen = Schema.Union([
  Schema.TaggedStruct('Menu', { key: Schema.String }),
  Schema.TaggedStruct('Demo', { key: Schema.String, demo: Demo }),
  Schema.TaggedStruct('Note', { key: Schema.String, text: Schema.String }),
])
type Screen = typeof Screen.Type

export const AppMessage = UiSchema.TaggedEnum({
  PressedDemo: { demo: Demo },
  OpenedNote: { id: Schema.String, text: Schema.String },
  DismissedByPhone: { count: Schema.Number },
})

export const AppProps = Schema.Struct({
  /** `ios` or `android`. */
  platform: Schema.String,
  /** The on-screen readouts, which draw twice a second. Off in tests that count draws. */
  hasReadout: Schema.Boolean,
})

const AppModel = Schema.Struct({ screens: Schema.Array(Screen), nextKey: Schema.Number })

const DEMOS: ReadonlyArray<Readonly<{ demo: Demo; title: string; what: string }>> = [
  { demo: 'Counter', title: 'Counter', what: 'A number and three buttons.' },
  { demo: 'Notes', title: 'Notes', what: 'A text field, a list, and a second screen.' },
  { demo: 'LongList', title: 'Long list', what: '1,000 rows, with numbers for how it runs.' },
  { demo: 'Touch', title: 'Touch tests', what: 'Press, hold, a button in a row, and a list that moves by itself.' },
  { demo: 'Phone', title: 'Phone', what: 'Haptics, clipboard, keyboard, dark mode.' },
  { demo: 'ServerState', title: 'Server state', what: 'A list from a pretend server: load, add, delete, fail.' },
]

const titleOf = (screen: Screen): string =>
  screen._tag === 'Menu'
    ? 'Effect UI Native'
    : screen._tag === 'Note'
      ? 'Note'
      : (DEMOS.find(each => each.demo === screen.demo)?.title ?? screen.demo)

export const App = Native.component({
  name: 'App',
  props: AppProps,
  model: AppModel,
  message: AppMessage,
}).make({
  init: () => ({ screens: [{ _tag: 'Menu' as const, key: 's0' }], nextKey: 1 }),
  update: {
    PressedDemo: ($, { demo }) =>
      // One demo at a time: a second press while the first is opening does nothing.
      $.model.screens.length > 1
        ? $.model
        : $.evolve({
            screens: [...$.model.screens, { _tag: 'Demo' as const, key: `s${$.model.nextKey}`, demo }],
            nextKey: $.model.nextKey + 1,
          }),
    OpenedNote: ($, { text }) =>
      $.evolve({
        screens: [...$.model.screens, { _tag: 'Note' as const, key: `s${$.model.nextKey}`, text }],
        nextKey: $.model.nextKey + 1,
      }),
    // The phone closed screens by itself. The first screen always stays.
    DismissedByPhone: ($, { count }) =>
      $.evolve({ screens: $.model.screens.slice(0, Math.max(1, $.model.screens.length - Math.max(1, count))) }),
  },
  view: (h, model) => {
    const { platform, hasReadout } = h.props
    const edges = Native.safeAreaEdges(platform, { hasHeader: true })
    const contentOf = (screen: Screen) => {
      if (screen._tag === 'Menu') {
        return h.scrollView.testId('menu').style(Look.page).children(
          DEMOS.map(each =>
            h.pressable
              .key(each.demo)
              .testId(`menu-${each.demo}`)
              .style(Look.row)
              .pressedStyle(Look.rowPressed)
              .on('press', AppMessage.PressedDemo({ demo: each.demo }))
              .children(
                h.text.style({ ...Look.label, fontWeight: '600' }).children(each.title),
                h.text.style(Look.small).children(each.what),
              ),
          ),
        )
      }
      if (screen._tag === 'Note') return NoteDetail(h, { key: screen.key, props: { text: screen.text } })
      switch (screen.demo) {
        case 'Counter':
          return Counter(h, { key: screen.key })
        case 'Notes':
          return Notes(h, {
            key: screen.key,
            onEmit: { OpenedNote: ({ id, text }) => AppMessage.OpenedNote({ id, text }) },
          })
        case 'LongList':
          return LongList(h, { key: screen.key, props: { hasReadout } })
        case 'Touch':
          return Touch(h, { key: screen.key, props: { hasReadout } })
        case 'Phone':
          return PhoneScreen(h, { key: screen.key })
        case 'ServerState':
          return ServerState(h, { key: screen.key })
      }
    }
    return h.stack.testId('stack').children(
      model.screens.map(screen =>
        h.screen
          .key(screen.key)
          .testId(`screen-${screen.key}`)
          .style({ backgroundColor: Look.PAPER })
          .on('dismissed', ({ dismissCount }) => AppMessage.DismissedByPhone({ count: dismissCount ?? 1 }))
          .children(
            h.header.set({ title: titleOf(screen), backTitle: 'Back' }),
            h.safeArea.set({ edges }).children(contentOf(screen)),
          ),
      ),
    )
  },
})
