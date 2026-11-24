/**
 * The sheets demo: one main screen and seven bottom sheets.
 *
 * The main screen has a counter and a strip of colours that scrolls, to show
 * that the screen behind a sheet can stay usable. It also prints the last
 * thing the phone or the Model did, and where the Maps-style sheet rests.
 *
 *   Maps style   three heights. The screen behind stays bright and usable at
 *                the two lower ones. The main screen shows the height and has
 *                buttons that move the sheet.
 *   Fit          as tall as its content. Add and remove lines to see it follow.
 *   Composer     a text field and Send that stay above the keyboard.
 *   Long list    500 rows. At the list's top edge the drag moves the sheet.
 *   Ask first    refuses to close while there is text in it, and asks.
 *   Over         a sheet opened over a sheet.
 *   Screens      a sheet with a stack of screens and a title bar inside it.
 *   Footer       buttons that stay at the bottom edge of the sheet.
 *
 * Every sheet is the phone's own (see `src/navigation/sheets.ts`).
 *
 * "Show numbers" prints the sizes the app has for the open sheet's parts:
 * the window, the sheet's screen, its content, its scroll view and its
 * footer. Nobody who works on this can see the phone, so a screenshot of
 * those lines is how a wrong layout is found.
 */
import { Effect, type Layer, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { Keyboard } from '../../src/device/index.js'
import { glass, isLiquidGlassAvailable } from '../../src/glass/index.js'
import { scrollView, text, textInput, view as box } from '../../src/index.js'
import { dismissKeyboardOnDrag } from '../../src/keyboard/index.js'
import { list } from '../../src/list/index.js'
import {
  type BackSource,
  type Device,
  SheetPlace,
  backBlocked,
  canPop,
  hardwareBack,
  moveSheet,
  navigationBar,
  noBackSource,
  pop,
  popByPhone,
  presentAgain,
  prop,
  push,
  safeArea,
  sheet,
  sheetAt,
  sheetComposer,
  sheetContent,
  sheetFooter,
  sheetHandle,
  sheetKey,
  sheetMovedByPhone,
  sheetScrolls,
  stackOf,
  style,
} from '../../src/navigation.js'
import { formatSheetNumbers, readSheetNumbers, sheetProbe } from '../../src/navigation/sheets.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

/** The demo also listens for Android's Back button when given a source. */
export type SheetsDemoEnv = DemoEnv & Readonly<{ backSource?: BackSource }>

// MODEL

const Route = defineTaggedUnion({
  Home: {},
  Maps: {},
  Fit: {},
  Composer: {},
  LongList: {},
  AskFirst: {},
  Lower: {},
  Upper: {},
  Screens: {},
  Footer: {},
})
type Route = typeof Route.Type

/** The heights of the Maps-style sheet, and what the demo calls them. */
export const MAPS_DETENTS = [0.25, 0.5, 1] as const
const MAPS_NAMES = ['small', 'half', 'full'] as const

export const ROW_COUNT = 500

export const Model = Schema.Struct({
  /** The main screen and the sheets open over it, the last one on top. */
  routes: Schema.Array(Route),
  counter: Schema.Number,
  lastEvent: Schema.String,
  /** Where the Maps-style sheet rests. */
  maps: SheetPlace,
  /** How many lines the fitted sheet shows. */
  fitLines: Schema.Number,
  draft: Schema.String,
  /** The newest line is last. */
  lines: Schema.Array(Schema.String),
  /** How much of the window the keyboard covers. 0 while it is hidden. */
  keyboardCovers: Schema.Number,
  /** The text in the sheet that asks before closing. Not empty: unsaved. */
  note: Schema.String,
  isAsking: Schema.Boolean,
  /** Counts how often the asking sheet was presented, for Android. */
  askFirst: SheetPlace,
  /** The screens inside the sheet that holds a stack. */
  inner: Schema.Array(Schema.Number),
  saves: Schema.Number,
  pressedRow: Schema.Number,
  showsNumbers: Schema.Boolean,
  /** The sizes last read, one line per part. */
  numbers: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedCount: {},
  PressedOpen: { route: Route },
  PressedClose: {},
  ClosedByPhone: { count: Schema.Number },
  MovedMapsByPhone: { index: Schema.Number },
  PressedMoveMaps: { index: Schema.Number },
  PressedAddLine: {},
  PressedRemoveLine: {},
  ChangedDraft: { text: Schema.String },
  PressedSend: {},
  GotKeyboardMessage: { message: Keyboard.Message },
  ChangedNote: { text: Schema.String },
  TriedToCloseAskFirst: {},
  PressedKeepEditing: {},
  PressedDiscard: {},
  PressedPushInner: {},
  PressedPopInner: {},
  PoppedInnerByPhone: { count: Schema.Number },
  PressedSave: {},
  PressedRow: { index: Schema.Number },
  PressedHardwareBack: {},
  PressedToggleNumbers: {},
  PressedReadNumbers: {},
  ReadNumbers: { lines: Schema.Array(Schema.String) },
  PressedExit: {},
  CompletedExit: {},
})
export type Message = typeof Message.Type

// UPDATE

const topOf = (model: Model): Route['_tag'] => model.routes.at(-1)?._tag ?? 'Home'

const isUnsaved = (model: Model): boolean => model.note !== ''

const said = (model: Model, lastEvent: string): Model =>
  modifyFields(model, { lastEvent: () => lastEvent })

/** Takes `count` screens off the top and forgets what the closed ones held. */
const close = (model: Model, count: number, lastEvent: string): Model => {
  const routes = pop(model.routes, count)
  const isOpen = (tag: Route['_tag']): boolean => routes.some(route => route._tag === tag)
  return {
    ...model,
    routes,
    lastEvent,
    maps: isOpen('Maps') ? model.maps : sheetAt(0),
    note: isOpen('AskFirst') ? model.note : '',
    isAsking: isOpen('AskFirst') ? model.isAsking : false,
    inner: isOpen('Screens') ? model.inner : [1],
  }
}

/** One Command, as `update` returns them. */
type DemoCommand = NonNullable<Update.Return<Model, Message>['commands']>[number]

/** How long a sheet is given to arrive before its sizes are read by themselves. */
const SETTLE_MS = 700

const makeUpdate =
  (Exit: () => DemoCommand, ReadNumbers: (args: { afterMs: number }) => DemoCommand) =>
  (model: Model, message: Message) => {
    /** Reads the sizes again after a change, while they are shown. */
    const reading = (next: Model): Update.Return<Model, Message> =>
      next.showsNumbers ? { model: next, commands: [ReadNumbers({ afterMs: SETTLE_MS })] } : { model: next }
    return Message.match<Update.Return<Model, Message>>(message, {
      PressedCount: () => ({
        model: modifyFields(said(model, 'The counter button was pressed.'), {
          counter: counter => counter + 1,
        }),
      }),

      PressedOpen: ({ route }) =>
        reading(
          modifyFields(said(model, `The Model opened: ${route._tag}.`), {
            routes: routes => push(routes, route),
          }),
        ),
      PressedClose: () => ({
        model:
          topOf(model) === 'AskFirst' && isUnsaved(model)
            ? modifyFields(said(model, 'Close was pressed with unsaved text. Asked first.'), {
                isAsking: () => true,
              })
            : close(model, 1, 'The Model closed the sheet.'),
      }),
      ClosedByPhone: ({ count }) => ({
        model:
          topOf(model) === 'AskFirst' && isUnsaved(model)
            ? // Only Android gets here: its sheet cannot refuse a drag down.
              // The sheet is hidden by now, so it is presented again.
              modifyFields(said(model, 'The phone closed a sheet with unsaved text. It was shown again.'), {
                askFirst: presentAgain,
                isAsking: () => true,
              })
            : close(model, count, 'The phone closed the sheet (a drag down or a tap beside it).'),
      }),

      MovedMapsByPhone: ({ index }) =>
        reading(
          modifyFields(said(model, `The phone moved the sheet to ${MAPS_NAMES[index] ?? index}.`), {
            maps: maps => sheetMovedByPhone(maps, index),
          }),
        ),
      PressedMoveMaps: ({ index }) => ({
        model:
          topOf(model) !== 'Maps'
            ? said(model, 'Open the Maps-style sheet first. There is nothing to move.')
            : model.maps.detent === index
              ? said(model, `The sheet is at ${MAPS_NAMES[index] ?? index} already.`)
              : modifyFields(
                  said(model, `The Model moved the sheet to ${MAPS_NAMES[index] ?? index}.`),
                  { maps: maps => moveSheet(maps, index) },
                ),
      }),

      PressedAddLine: () => ({
        model: modifyFields(model, { fitLines: count => Math.min(12, count + 1) }),
      }),
      PressedRemoveLine: () => ({
        model: modifyFields(model, { fitLines: count => Math.max(1, count - 1) }),
      }),

      ChangedDraft: ({ text: draft }) => ({ model: modifyFields(model, { draft: () => draft }) }),
      PressedSend: () => {
        const line = model.draft.trim()
        if (line === '') return { model }
        return {
          model: modifyFields(said(model, `Sent: ${line}`), {
            lines: lines => [...lines, line],
            draft: () => '',
          }),
        }
      },
      GotKeyboardMessage: ({ message: keyboard }) => ({
        model: modifyFields(model, {
          keyboardCovers: covers =>
            Keyboard.Message.match(keyboard, {
              ShownKeyboard: shown => shown.covers,
              HidKeyboard: () => 0,
              CompletedDismissKeyboard: () => covers,
            }),
        }),
      }),

      ChangedNote: ({ text: note }) => ({ model: modifyFields(model, { note: () => note }) }),
      TriedToCloseAskFirst: () => ({
        model: modifyFields(said(model, 'The phone tried to close the sheet and was refused.'), {
          isAsking: () => true,
        }),
      }),
      PressedKeepEditing: () => ({
        model: modifyFields(said(model, 'Kept the sheet open.'), { isAsking: () => false }),
      }),
      // The Model may always close, blocked or not: the block is for the phone.
      PressedDiscard: () => ({ model: close(model, 1, 'Discarded the text and closed the sheet.') }),

      PressedPushInner: () => ({
        model: modifyFields(said(model, 'Pushed a screen inside the sheet.'), {
          inner: inner => push(inner, inner.length + 1),
        }),
      }),
      PressedPopInner: () => ({
        model: modifyFields(said(model, 'The Model went back inside the sheet.'), {
          inner: inner => pop(inner),
        }),
      }),
      PoppedInnerByPhone: ({ count }) => ({
        model: modifyFields(said(model, 'The phone went back inside the sheet.'), {
          inner: inner => popByPhone(inner, count),
        }),
      }),

      PressedSave: () => ({
        model: modifyFields(said(model, 'Save in the footer was pressed.'), {
          saves: saves => saves + 1,
        }),
      }),
      PressedRow: ({ index }) => ({
        model: modifyFields(said(model, `Row ${index + 1} was pressed.`), {
          pressedRow: () => index,
        }),
      }),

      PressedHardwareBack: () => ({
        model:
          topOf(model) === 'AskFirst' && isUnsaved(model)
            ? modifyFields(said(model, 'Back was pressed with unsaved text. Asked first.'), {
                isAsking: () => true,
              })
            : topOf(model) === 'Screens' && canPop(model.inner)
              ? modifyFields(said(model, 'Back went back inside the sheet.'), {
                  inner: inner => pop(inner),
                })
              : close(model, 1, 'Back closed the sheet.'),
      }),

      PressedToggleNumbers: () =>
        model.showsNumbers
          ? { model: modifyFields(model, { showsNumbers: () => false, numbers: () => [] }) }
          : {
              model: modifyFields(model, { showsNumbers: () => true }),
              commands: [ReadNumbers({ afterMs: 0 })],
            },
      PressedReadNumbers: () => ({ model, commands: [ReadNumbers({ afterMs: 0 })] }),
      ReadNumbers: ({ lines }) => ({ model: modifyFields(model, { numbers: () => lines }) }),

      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
    })
  }

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    routes: [Route.Home()],
    counter: 0,
    lastEvent: 'Nothing yet.',
    maps: sheetAt(0),
    fitLines: 2,
    draft: '',
    lines: ['Tap the field. It and Send should stay above the keyboard.'],
    keyboardCovers: 0,
    note: '',
    isAsking: false,
    askFirst: sheetAt(0),
    inner: [1],
    saves: 0,
    pressedRow: -1,
    showsNumbers: false,
    numbers: [],
  },
})

// VIEW

const INK = '#111111'
const MUTED = '#6b6b6b'
const PAPER = '#ffffff'
const LINE = '#e3e3e3'
const ACCENT = '#0a66d8'
const QUIET = '#4a4a4a'
const DANGER = '#c62828'
const BAR = '#f4f4f4'
const BANDS = ['#f6c453', '#f08a5d', '#5bb5a2', '#4f8fc0', '#e8d5a4', '#d1495b', '#8fb339'] as const
const RADIUS = 20

const button = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  color: string,
  message: Message,
): Html =>
  box(
    [
      h.Attribute('testID', id),
      prop('accessibilityRole', 'button'),
      h.OnClick(message),
      style({
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 16, fontWeight: '600' })], [label])],
  )

const heading = (words: string): Html =>
  text([style({ color: INK, fontSize: 22, fontWeight: '700' })], [words])

const line = (id: string, words: string): Html =>
  text([prop('testID', id), style({ color: INK, fontSize: 16 })], [words])

/** What to try and what should happen, in small grey words. */
const hint = (words: string): Html => text([style({ color: MUTED, fontSize: 14 })], [words])

const mapsStatus = (model: Model): string =>
  model.routes.some(route => route._tag === 'Maps')
    ? `Maps-style sheet: resting at ${MAPS_NAMES[model.maps.detent] ?? model.maps.detent} ` +
      `(height ${model.maps.detent + 1} of ${MAPS_DETENTS.length}).`
    : 'Maps-style sheet: closed.'

/**
 * The sizes last read, with a button to read them again. `id` keeps the
 * button's name apart from the same block on another screen.
 */
const numbersBlock = (model: Model, h: HtmlBuilder<Message>, id: string): ReadonlyArray<Html> =>
  model.showsNumbers
    ? [
        box(
          [prop('testID', `${id}-numbers`), style({ paddingHorizontal: 16, paddingBottom: 8, gap: 4 })],
          [
            box(
              [
                h.Attribute('testID', `${id}-read-numbers`),
                prop('accessibilityRole', 'button'),
                h.OnClick(Message.PressedReadNumbers()),
                style({
                  alignSelf: 'flex-start',
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: QUIET,
                }),
              ],
              [text([style({ color: PAPER, fontSize: 13, fontWeight: '600' })], ['Read numbers again'])],
            ),
            ...(model.numbers.length === 0 ? ['Not read yet.'] : model.numbers).map(words =>
              text([style({ color: INK, fontSize: 12 })], [words]),
            ),
            hint(
              'Sizes are width x height at left,top. Scroll a list a little first: its "native ' +
                'viewport" is the size the phone really gave it.',
            ),
          ],
        ),
      ]
    : []

/** The part of the main screen that does not scroll. It stays above a low sheet. */
const panel = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [style({ padding: 12, gap: 8, backgroundColor: PAPER, borderBottomWidth: 1, borderBottomColor: LINE })],
    [
      box(
        [style({ flexDirection: 'row', gap: 8, alignItems: 'center' })],
        [
          button(h, 'count', 'Add one', ACCENT, Message.PressedCount()),
          line('counter', `Counter: ${model.counter}`),
          box([style({ flex: 1 })], []),
          button(h, 'exit', 'Exit', DANGER, Message.PressedExit()),
        ],
      ),
      line('maps-status', mapsStatus(model)),
      box(
        [style({ flexDirection: 'row', gap: 8 })],
        MAPS_NAMES.map((name, index) =>
          button(h, `move-${name}`, `Move to ${name}`, QUIET, Message.PressedMoveMaps({ index })),
        ),
      ),
      hint(
        'The three buttons move the Maps-style sheet while it is open. The phone cannot ' +
          'slide an open sheet to another height, so the sheet leaves and comes back at the new one.',
      ),
      line('last-event', `Last event: ${model.lastEvent}`),
      box(
        [style({ flexDirection: 'row' })],
        [
          button(
            h,
            'toggle-numbers',
            `Show numbers: ${model.showsNumbers ? 'ON' : 'OFF'}`,
            QUIET,
            Message.PressedToggleNumbers(),
          ),
        ],
      ),
    ],
  )

const OPENERS: ReadonlyArray<readonly [string, string, Route, string]> = [
  [
    'open-maps',
    'Maps-style sheet (three heights)',
    Route.Maps(),
    'At the two lower heights this screen stays bright. Press "Add one" and scroll the colours while the sheet is open.',
  ],
  ['open-fit', 'Sheet that fits its content', Route.Fit(), 'It is as tall as what is in it.'],
  [
    'open-composer',
    'Sheet with a text field',
    Route.Composer(),
    'The field and Send must stay above the keyboard.',
  ],
  [
    'open-list',
    'Sheet with a 500-row list',
    Route.LongList(),
    'Scroll the list. At its top edge, the drag should move the sheet.',
  ],
  [
    'open-ask',
    'Sheet that asks before closing',
    Route.AskFirst(),
    'Type something, then try to drag it away.',
  ],
  ['open-lower', 'Sheet over a sheet', Route.Lower(), 'The first sheet has a button for the second.'],
  [
    'open-screens',
    'Sheet with screens inside',
    Route.Screens(),
    'A title bar and a pushed screen, inside the sheet.',
  ],
  ['open-footer', 'Sheet with a footer', Route.Footer(), 'Two buttons stay at its bottom edge.'],
]

const home = (model: Model, h: HtmlBuilder<Message>, device: Device): ReadonlyArray<Html> => [
  navigationBar(h, device, { title: 'Sheets' }),
  safeArea(device, { hasHeader: true }, [
    box(
      [style({ flex: 1, backgroundColor: PAPER })],
      [
        panel(model, h),
        scrollView(
          [prop('testID', 'background'), style({ flex: 1 })],
          [
            box(
              [style({ padding: 12, gap: 8 })],
              OPENERS.flatMap(([id, label, route, words]) => [
                button(h, id, label, ACCENT, Message.PressedOpen({ route })),
                hint(words),
              ]),
            ),
            ...Array.from({ length: 21 }, (_unused, index) =>
              box(
                [
                  style({
                    height: 90,
                    backgroundColor: BANDS[index % BANDS.length] ?? PAPER,
                    justifyContent: 'center',
                    paddingHorizontal: 16,
                  }),
                ],
                [text([style({ color: INK, fontSize: 16 })], [`Colour band ${index + 1}`])],
              ),
            ),
          ],
        ),
      ],
    ),
  ]),
]

/**
 * A sheet's title with a Close button beside it, and the numbers under it
 * while they are shown. Always a real view: see `sheetContent`.
 */
const titleRow = (model: Model, h: HtmlBuilder<Message>, id: string, words: string): Html =>
  box(
    [prop('collapsable', false)],
    [
      box(
        [
          style({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 8,
          }),
        ],
        [
          text(
            [prop('testID', `${id}-title`), style({ color: INK, fontSize: 20, fontWeight: '700' })],
            [words],
          ),
          button(h, `${id}-close`, 'Close', QUIET, Message.PressedClose()),
        ],
      ),
      ...numbersBlock(model, h, id),
    ],
  )

/** A sheet's content view, marked so that its size can be read. */
const content = (
  options: Parameters<typeof sheetContent>[0],
  children: ReadonlyArray<Html>,
): Html =>
  sheetContent(
    { ...options, attributes: [...(options.attributes ?? []), sheetProbe('content')] },
    children,
  )

const FILL = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const

const mapsSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => {
  // Real glass where the phone has it. The sheet is then clear, and the
  // glass panel is its background.
  const hasGlass = device.platform === 'ios' && isLiquidGlassAvailable()
  return {
    isModal: true,
    attributes: [
      h.Attribute('testID', 'maps'),
      ...sheet<Message>({
        device,
        detents: MAPS_DETENTS,
        initialDetent: model.maps.openedAt,
        undimmedUpTo: 1,
        hasGrabber: true,
        cornerRadius: RADIUS,
        background: hasGlass ? 'clear' : PAPER,
        onDetentChanged: index => Message.MovedMapsByPhone({ index }),
      }),
    ],
    children: [
      content({ attributes: [prop('testID', 'maps-content')] }, [
        ...(hasGlass ? [glass([style(FILL)], [])] : []),
        sheetHandle(device),
        titleRow(model, h, 'maps', 'Places'),
        box(
          [style({ paddingHorizontal: 16, gap: 8 })],
          [
            line('maps-detent', `The Model says: resting at ${MAPS_NAMES[model.maps.detent] ?? '?'}.`),
            hint(
              'Drag this sheet between its three heights. The line above and the main screen ' +
                'must follow. At small and half, the main screen behind stays bright and its ' +
                'buttons work. At full, it is dimmed.',
            ),
            line(
              'maps-glass',
              hasGlass
                ? 'Background: a glass panel behind a clear sheet.'
                : 'Background: plain white (no Liquid Glass on this phone).',
            ),
          ],
        ),
      ]),
    ],
  }
}

const fitSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', 'fit'),
    ...sheet<Message>({ device, detents: 'fit', cornerRadius: RADIUS, background: PAPER }),
  ],
  children: [
    content({ fit: true, attributes: [prop('testID', 'fit-content')] }, [
      titleRow(model, h, 'fit', 'Fits its content'),
      box(
        [style({ paddingHorizontal: 16, paddingBottom: 32, gap: 8 })],
        [
          hint('The sheet should end just under the last button. Add lines and it should grow.'),
          ...Array.from({ length: model.fitLines }, (_unused, index) =>
            line(`fit-line-${index + 1}`, `Line ${index + 1}`),
          ),
          button(h, 'fit-add', 'Add a line', ACCENT, Message.PressedAddLine()),
          button(h, 'fit-remove', 'Remove a line', QUIET, Message.PressedRemoveLine()),
        ],
      ),
    ]),
  ],
})

const composerBar = (model: Model, h: HtmlBuilder<Message>): Html =>
  box(
    [sheetProbe('bar'), style({ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 })],
    [
      textInput(
        [
          h.Attribute('testID', 'draft'),
          h.Attribute('value', model.draft),
          h.Placeholder('Write a line'),
          prop('editable', true),
          h.OnInput(draft => Message.ChangedDraft({ text: draft })),
          style({
            flex: 1,
            height: 40,
            fontSize: 16,
            color: INK,
            paddingHorizontal: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: LINE,
            backgroundColor: PAPER,
          }),
        ],
        [],
      ),
      button(h, 'send', 'Send', ACCENT, Message.PressedSend()),
    ],
  )

const composerSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', 'composer'),
    ...sheet<Message>({
      device,
      detents: [0.6, 1],
      hasGrabber: true,
      cornerRadius: RADIUS,
      background: PAPER,
    }),
  ],
  children: sheetComposer(h, device, {
    keyboardHeight: model.keyboardCovers,
    backgroundColor: BAR,
    attributes: [prop('testID', 'composer-content'), sheetProbe('content')],
    above: [
      box(
        [style({ flex: 1 })],
        [
          sheetHandle(device),
          titleRow(model, h, 'composer', 'Write something'),
          scrollView(
            [
              prop('testID', 'lines'),
              sheetProbe('scroll'),
              ...sheetScrolls(),
              dismissKeyboardOnDrag(),
              style({ flex: 1 }),
            ],
            model.lines.map((words, index) =>
              box(
                [style({ paddingVertical: 10, paddingHorizontal: 16 })],
                [line(`line-${index + 1}`, words)],
              ),
            ),
          ),
        ],
      ),
    ],
    bar: [composerBar(model, h)],
  }),
})

const ROWS: ReadonlyArray<number> = Array.from({ length: ROW_COUNT }, (_unused, index) => index)

const listSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', 'long-list'),
    ...sheet<Message>({
      device,
      detents: [0.5, 1],
      hasGrabber: true,
      cornerRadius: RADIUS,
      background: PAPER,
    }),
  ],
  children: [
    // A title row and then the list: iOS sizes the list to the rest of the sheet.
    content({ attributes: [prop('testID', 'list-content')] }, [
      box(
        [prop('collapsable', false)],
        [
          sheetHandle(device),
          titleRow(model, h, 'list', `${ROW_COUNT} rows`),
          box(
            [style({ paddingHorizontal: 16, paddingBottom: 8 })],
            [
              line(
                'pressed-row',
                model.pressedRow < 0 ? 'No row pressed yet.' : `Pressed row ${model.pressedRow + 1}.`,
              ),
            ],
          ),
        ],
      ),
      list<number, Message>(h, {
        id: 'sheet-rows',
        items: ROWS,
        key: index => index,
        estimatedRowHeight: 48,
        rowHeight: 48,
        row: index =>
          box(
            [
              h.OnClick(Message.PressedRow({ index })),
              style({
                height: 48,
                justifyContent: 'center',
                paddingHorizontal: 16,
                borderBottomWidth: 1,
                borderBottomColor: LINE,
              }),
            ],
            [text([style({ color: INK, fontSize: 16 })], [`Row ${index + 1}`])],
          ),
        attributes: [
          prop('testID', 'sheet-rows'),
          sheetProbe('scroll'),
          ...sheetScrolls(),
          style({ flex: 1 }),
        ],
      }),
    ]),
  ],
})

const askFirstSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', 'ask-first'),
    ...sheet<Message>({ device, detents: [0.6], hasGrabber: true, cornerRadius: RADIUS, background: PAPER }),
    ...backBlocked(isUnsaved(model), () => Message.TriedToCloseAskFirst()),
  ],
  children: [
    content({}, [
      sheetHandle(device),
      titleRow(model, h, 'ask', 'Asks before closing'),
      box(
        [style({ paddingHorizontal: 16, gap: 8 })],
        [
          hint(
            'Type something. Then drag the sheet down, tap beside it, or press Close. ' +
              'While there is text, the sheet must stay and ask. With no text it closes.',
          ),
          textInput(
            [
              h.Attribute('testID', 'note'),
              h.Attribute('value', model.note),
              h.Placeholder('Unsaved text'),
              prop('editable', true),
              h.OnInput(note => Message.ChangedNote({ text: note })),
              style({
                height: 44,
                fontSize: 16,
                color: INK,
                paddingHorizontal: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: LINE,
              }),
            ],
            [],
          ),
          line('ask-state', isUnsaved(model) ? 'Unsaved text: closing is blocked.' : 'No text: closing is allowed.'),
          ...(model.isAsking
            ? [
                line('ask-question', 'Throw away what you typed?'),
                button(h, 'discard', 'Discard and close', DANGER, Message.PressedDiscard()),
                button(h, 'keep', 'Keep editing', QUIET, Message.PressedKeepEditing()),
              ]
            : []),
        ],
      ),
    ]),
  ],
})

const plainSheet = (
  model: Model,
  h: HtmlBuilder<Message>,
  device: Device,
  id: string,
  name: string,
  detent: number,
  children: ReadonlyArray<Html>,
) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', id),
    ...sheet<Message>({ device, detents: [detent], hasGrabber: true, cornerRadius: RADIUS, background: PAPER }),
  ],
  children: [
    content({}, [
      sheetHandle(device),
      titleRow(model, h, id, name),
      box([style({ paddingHorizontal: 16, gap: 8 })], children),
    ]),
  ],
})

const screensSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', 'screens'),
    ...sheet<Message>({ device, detents: [0.7, 1], hasGrabber: true, cornerRadius: RADIUS, background: PAPER }),
  ],
  children: [
    // A stack of its own inside the sheet, with its own title bar.
    stackOf<number, Message>(h, model.inner, {
      attributes: [h.Attribute('testID', 'inner')],
      key: id => `inner-${id}`,
      onPoppedByPhone: count => Message.PoppedInnerByPhone({ count }),
      screen: (id, place) => ({
        attributes: [h.Attribute('testID', `inner-${id}`)],
        children: [
          navigationBar(h, device, {
            title: place.isRoot ? 'Inside the sheet' : `Pushed screen ${id}`,
            backTitle: 'Back',
            // The bar is inside a sheet, not under the clock.
            ...(device.platform === 'android' ? { attributes: [prop('consumeTopInset', false)] } : {}),
          }),
          safeArea(device, { hasHeader: true }, [
            box(
              [style({ flex: 1, backgroundColor: PAPER, padding: 16, gap: 8 })],
              [
                line(place.isTop ? 'inner-depth' : `inner-depth-${id}`, `Screen ${place.index + 1} of ${model.inner.length} inside the sheet.`),
                ...(place.isTop ? numbersBlock(model, h, 'screens') : []),
                hint(
                  'The title bar above belongs to the sheet. Push a screen: it should slide in ' +
                    'inside the sheet, with a back button.',
                ),
                ...(place.isTop
                  ? [
                      button(h, 'inner-push', 'Push a screen', ACCENT, Message.PressedPushInner()),
                      ...(place.isRoot
                        ? []
                        : [button(h, 'inner-pop', 'Go back (from the Model)', QUIET, Message.PressedPopInner())]),
                      button(h, 'screens-close', 'Close the sheet', QUIET, Message.PressedClose()),
                    ]
                  : []),
              ],
            ),
          ]),
        ],
      }),
    }),
  ],
})

const footerSheet = (model: Model, h: HtmlBuilder<Message>, device: Device) => ({
  isModal: true,
  attributes: [
    h.Attribute('testID', 'footer'),
    ...sheet<Message>({ device, detents: [0.5, 1], hasGrabber: true, cornerRadius: RADIUS, background: PAPER }),
  ],
  children: [
    content({ keepsOwnLayout: true, attributes: [prop('testID', 'footer-content')] }, [
      sheetHandle(device),
      titleRow(model, h, 'footer', 'With a footer'),
      scrollView(
        [prop('testID', 'footer-scroll'), sheetProbe('scroll'), ...sheetScrolls(), style({ flex: 1 })],
        [
          box(
            [style({ paddingHorizontal: 16, gap: 8, paddingBottom: 16 })],
            [
              hint(
                'Drag the sheet between half and full. The two buttons below must stay at ' +
                  'the bottom edge of the part you can see.',
              ),
              ...Array.from({ length: 24 }, (_unused, index) =>
                text([style({ color: INK, fontSize: 16 })], [`Some text, line ${index + 1}.`]),
              ),
            ],
          ),
        ],
      ),
    ]),
    sheetFooter(
      device,
      [
        prop('testID', 'footer-bar'),
        sheetProbe('footer'),
        style({ backgroundColor: BAR, borderTopWidth: 1, borderTopColor: LINE }),
      ],
      [
        box(
          [style({ flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' })],
          [
            button(h, 'footer-cancel', 'Cancel', QUIET, Message.PressedClose()),
            button(h, 'footer-save', 'Save', ACCENT, Message.PressedSave()),
            line('saves', `Saved ${model.saves} times`),
          ],
        ),
      ],
    ),
  ],
})

const keyOf = (model: Model, route: Route): string =>
  Route.match(route, {
    Home: () => 'home',
    // Presented again when the Model moves it: see `moveSheet`.
    Maps: () => sheetKey('maps', model.maps),
    Fit: () => 'fit',
    Composer: () => 'composer',
    LongList: () => 'long-list',
    AskFirst: () => sheetKey('ask-first', model.askFirst),
    Lower: () => 'lower',
    Upper: () => 'upper',
    Screens: () => 'screens',
    Footer: () => 'footer',
  })

type SheetView = Readonly<{
  isModal?: boolean
  attributes: ReadonlyArray<any>
  children: ReadonlyArray<Html>
}>

/** Marks a sheet's screen so that its size can be read. */
const marked = (isMarked: boolean, view: SheetView): SheetView =>
  isMarked ? { ...view, attributes: [...view.attributes, sheetProbe('screen')] } : view

export const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stackOf<Route, Message>(h, model.routes, {
      attributes: [h.Attribute('testID', 'sheets'), sheetProbe('window')],
      key: route => keyOf(model, route),
      onPoppedByPhone: count => Message.ClosedByPhone({ count }),
      screen: (route, place) =>
        // The sheet on top is the one whose sizes are read.
        marked(place.isTop && !place.isRoot, Route.match(route, {
          Home: () => ({
            attributes: [h.Attribute('testID', 'home')],
            children: home(model, h, device),
          }),
          Maps: () => mapsSheet(model, h, device),
          Fit: () => fitSheet(model, h, device),
          Composer: () => composerSheet(model, h, device),
          LongList: () => listSheet(model, h, device),
          AskFirst: () => askFirstSheet(model, h, device),
          Lower: () =>
            plainSheet(model, h, device, 'lower', 'The first sheet', 0.7, [
              hint('Open a second sheet over this one. Closing the second must leave this one open.'),
              button(h, 'open-upper', 'Open a sheet over this one', ACCENT, Message.PressedOpen({ route: Route.Upper() })),
            ]),
          Upper: () =>
            plainSheet(model, h, device, 'upper', 'The second sheet', 0.4, [
              hint('This sheet lies over the first one. Close it by its button or by a drag down.'),
            ]),
          Screens: () => screensSheet(model, h, device),
          Footer: () => footerSheet(model, h, device),
        })),
    })

// PROGRAM

/**
 * `resources` is the Layer with the phone's keyboard in it: `Phone.live({...})`
 * in an app, `Keyboard.makeTest().layer` in a test.
 */
export const makeDemo = (
  container: HTMLElement,
  env: SheetsDemoEnv,
  resources: Layer.Layer<Keyboard.Keyboard>,
) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  const ReadNumbers = Command.define('ReadNumbers', {
    args: { afterMs: Schema.Number },
    messages: [Message.ReadNumbers],
    execute: ({ afterMs }) =>
      Effect.sleep(afterMs).pipe(
        Effect.map(() => Message.ReadNumbers({ lines: [...formatSheetNumbers(readSheetNumbers())] })),
      ),
  })
  const subscriptions = Subscription.make<Model, Message, Keyboard.Keyboard>()(() => ({
    keyboard: Keyboard.changesEntry(message => Message.GotKeyboardMessage({ message })),
    back: hardwareBack<Model, Message>(env.backSource ?? noBackSource, {
      canGoBack: model => canPop(model.routes),
      toMessage: () => Message.PressedHardwareBack(),
    }),
  }))
  return Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(Exit, ReadNumbers),
    view: makeView(env.device),
    subscriptions,
    resources,
    container,
  })
}
