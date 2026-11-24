/**
 * The Menus and controls demo.
 *
 * At the top, a status block: one line per feature saying where it comes
 * from on this phone. "Expo UI (SwiftUI)" and "Expo UI (Jetpack Compose)"
 * are the phone's own menus and controls. Other lines name a fallback and
 * say why.
 *
 * What to try:
 *
 * - Press and hold the card: a menu opens. "Pinned" shows a check mark once
 *   chosen. "Move to" opens a second menu. "Delete" is red.
 * - Press "Sort": a menu opens under the button. The chosen order is checked.
 * - Press "More" in the title bar: the same kind of menu, from the bar.
 * - Press "Open an action sheet": the phone's list of choices slides up.
 * - The form below has every control. Each one's value in the Model is
 *   printed under the form. Change a control and its line changes.
 * - Press "Set from the Model": the program changes six values at once and
 *   every control must move to match.
 *
 * "Last event" always says the last thing the phone reported.
 */
import { Effect, type Layer, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type CalendarDate,
  type Choice,
  type ClockTime,
  type RouteLine,
  calendarDateText,
  clockTimeText,
  controlsStatus,
  datePicker,
  picker,
  progress,
  segmentedControl,
  slider,
  stepper,
  switchControl,
  timePicker,
} from '../../src/controls/index.js'
import {
  type Device,
  navigationBar,
  onPress,
  prop,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  text,
  view as box,
} from '../../src/index.js'
import {
  ActionSheet,
  type MenuItem,
  contextMenu,
  menuButton,
  menusStatus,
} from '../../src/menus/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

// MODEL

const Day = Schema.Struct({ year: Schema.Number, month: Schema.Number, day: Schema.Number })
const Time = Schema.Struct({ hour: Schema.Number, minute: Schema.Number })

export const Model = Schema.Struct({
  lastEvent: Schema.String,
  // The menus.
  isPinned: Schema.Boolean,
  sort: Schema.String,
  // The form.
  isOn: Schema.Boolean,
  volume: Schema.Number,
  size: Schema.String,
  count: Schema.Number,
  color: Schema.String,
  fruit: Schema.String,
  day: Day,
  time: Time,
  /** How many times "Set from the Model" was pressed. */
  setCount: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  SelectedCardAction: { key: Schema.String },
  SelectedSort: { key: Schema.String },
  SelectedBarAction: { key: Schema.String },
  PressedBarButton: {},
  PressedOpenSheet: {},
  GotSheetMessage: { message: ActionSheet.Message },
  ChangedSwitch: { isOn: Schema.Boolean },
  ChangedVolume: { value: Schema.Number },
  ChangedSize: { value: Schema.String },
  ChangedCount: { value: Schema.Number },
  ChangedColor: { value: Schema.String },
  ChangedFruit: { value: Schema.String },
  ChangedDay: { day: Day },
  ChangedTime: { time: Time },
  PressedSetFromModel: {},
})
export type Message = typeof Message.Type

// THE CHOICES

const SIZES: ReadonlyArray<Choice> = [
  { value: 's', label: 'Small' },
  { value: 'm', label: 'Medium' },
  { value: 'l', label: 'Large' },
]

const COLORS: ReadonlyArray<Choice> = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
]

const FRUITS: ReadonlyArray<Choice> = [
  { value: 'apple', label: 'Apple' },
  { value: 'pear', label: 'Pear' },
  { value: 'plum', label: 'Plum' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'fig', label: 'Fig' },
]

const SORTS: ReadonlyArray<Choice> = [
  { value: 'date', label: 'Date' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
]

const cardItems = (model: Model): ReadonlyArray<MenuItem> => [
  { key: 'copy', title: 'Copy', symbol: 'doc.on.doc' },
  { key: 'pin', title: 'Pinned', symbol: 'pin', isChecked: model.isPinned },
  { key: 'print', title: 'Print (off)', symbol: 'printer', isDisabled: true },
  {
    title: 'Move to',
    symbol: 'folder',
    submenu: [
      { key: 'move-inbox', title: 'Inbox' },
      { key: 'move-archive', title: 'Archive' },
    ],
  },
  { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
]

const sortItems = (model: Model): ReadonlyArray<MenuItem> => [
  {
    title: 'Sort by',
    section: SORTS.map(sort => ({
      key: sort.value,
      title: sort.label,
      isChecked: model.sort === sort.value,
    })),
  },
  { section: [{ key: 'reset', title: 'Reset', symbol: 'arrow.counterclockwise' }] },
]

const BAR_ITEMS: ReadonlyArray<MenuItem> = [
  { key: 'bar-share', title: 'Share', symbol: 'square.and.arrow.up' },
  { key: 'bar-rename', title: 'Rename', symbol: 'pencil' },
  { section: [{ key: 'bar-delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
]

const SHEET_ITEMS: ReadonlyArray<ActionSheet.ActionSheetItem> = [
  { key: 'camera', title: 'Take a photo' },
  { key: 'library', title: 'Choose from library' },
  { key: 'files', title: 'Browse files (off)', isDisabled: true },
  { key: 'remove', title: 'Remove photo', isDestructive: true },
]

/** What "Set from the Model" sets, by turns, so every press changes something. */
const PRESETS: ReadonlyArray<
  Pick<Model, 'isOn' | 'volume' | 'size' | 'count' | 'color' | 'fruit' | 'day' | 'time'>
> = [
  {
    isOn: true,
    volume: 0.8,
    size: 'l',
    count: 7,
    color: 'blue',
    fruit: 'fig',
    day: { year: 2027, month: 1, day: 31 },
    time: { hour: 18, minute: 45 },
  },
  {
    isOn: false,
    volume: 0.2,
    size: 's',
    count: 1,
    color: 'red',
    fruit: 'apple',
    day: { year: 2026, month: 7, day: 4 },
    time: { hour: 6, minute: 5 },
  },
]

// UPDATE

const fromSheet = (message: ActionSheet.Message) => Message.GotSheetMessage({ message })

const makeUpdate = (env: DemoEnv) => {
  // Leaving the demo is a side effect, so it runs as a Command.
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  const said = (model: Model, lastEvent: string, changes: Partial<Model> = {}): Model => ({
    ...model,
    ...changes,
    lastEvent,
  })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      SelectedCardAction: ({ key }) => ({
        model: said(
          model,
          `Card menu: ${key}`,
          key === 'pin' ? { isPinned: !model.isPinned } : {},
        ),
      }),
      SelectedSort: ({ key }) => ({
        model: said(model, `Sort menu: ${key}`, { sort: key === 'reset' ? 'date' : key }),
      }),
      SelectedBarAction: ({ key }) => ({ model: said(model, `Title bar menu: ${key}`) }),
      PressedBarButton: () => ({ model: said(model, 'Title bar button pressed, with no menu') }),
      PressedOpenSheet: () => ({
        model,
        commands: [
          Command.mapMessage(
            ActionSheet.Show({ title: 'Profile photo', items: SHEET_ITEMS }),
            fromSheet,
          ),
        ],
      }),
      GotSheetMessage: ({ message }) => ({
        model: said(
          model,
          ActionSheet.Message.match(message, {
            SelectedActionSheetItem: ({ key }) => `Action sheet: ${key}`,
            DismissedActionSheet: () => 'Action sheet: closed without a choice',
            FailedShowActionSheet: ({ reason }) => `Action sheet did not open: ${reason}`,
          }),
        ),
      }),
      ChangedSwitch: ({ isOn }) => ({ model: said(model, `Switch: ${isOn ? 'on' : 'off'}`, { isOn }) }),
      ChangedVolume: ({ value }) => ({
        model: said(model, `Slider: ${value.toFixed(2)}`, { volume: value }),
      }),
      ChangedSize: ({ value }) => ({ model: said(model, `Segmented control: ${value}`, { size: value }) }),
      ChangedCount: ({ value }) => ({ model: said(model, `Stepper: ${value}`, { count: value }) }),
      ChangedColor: ({ value }) => ({ model: said(model, `Picker (menu): ${value}`, { color: value }) }),
      ChangedFruit: ({ value }) => ({ model: said(model, `Picker (wheel): ${value}`, { fruit: value }) }),
      ChangedDay: ({ day }) => ({
        model: said(model, `Date picker: ${calendarDateText(day)}`, { day }),
      }),
      ChangedTime: ({ time }) => ({
        model: said(model, `Time picker: ${clockTimeText(time)}`, { time }),
      }),
      PressedSetFromModel: () => ({
        model: modifyFields(
          said(model, 'Set from the Model', PRESETS[model.setCount % PRESETS.length] ?? {}),
          { setCount: count => count + 1 },
        ),
      }),
    })
}

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    lastEvent: 'Nothing yet',
    isPinned: false,
    sort: 'date',
    isOn: false,
    volume: 0.5,
    size: 'm',
    count: 3,
    color: 'green',
    fruit: 'pear',
    day: { year: 2026, month: 11, day: 24 },
    time: { hour: 9, minute: 30 },
    setCount: 0,
  },
})

// VIEW

const INK = '#111111'
const PAPER = '#ffffff'
const PAGE = '#f4f4f2'
const MUTED = '#5c5c5c'
const LINE = '#e3e3e3'
const GOOD = '#1f6b45'
const WARN = '#9a5b00'

const heading = (label: string): Html =>
  text([style({ fontSize: 13, fontWeight: '700', color: MUTED, textTransform: 'uppercase' })], [label])

const hint = (label: string): Html => text([style({ fontSize: 13, color: MUTED })], [label])

const card = (children: ReadonlyArray<Html>): Html =>
  box(
    [
      style({
        padding: 14,
        gap: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: LINE,
        backgroundColor: PAPER,
      }),
    ],
    children,
  )

const button = (id: string, label: string, message: Message): Html =>
  box(
    [
      prop('testID', id),
      prop('accessibilityRole', 'button'),
      onPress(message),
      style({
        alignSelf: 'flex-start',
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: INK,
      }),
    ],
    [text([style({ color: PAPER, fontSize: 15, fontWeight: '600' })], [label])],
  )

const statusLine = (line: RouteLine): Html =>
  text(
    [
      prop('testID', `status-${line.feature.replace(/[^a-z]+/g, '-').replace(/-$/, '')}`),
      style({ fontSize: 13, color: line.isNative ? GOOD : WARN }),
    ],
    [`${line.feature}: ${line.route}`],
  )

const status = (): Html =>
  card([
    heading('What this phone uses'),
    box([prop('testID', 'status'), style({ gap: 3 })], [...menusStatus(), ...controlsStatus()].map(statusLine)),
    hint('Green: the phone\'s own. Amber: a fallback, with the reason.'),
  ])

/** One row of the form: a name on the left, the control on the right. */
const formRow = (label: string, control: Html): Html =>
  box(
    [
      style({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 44,
      }),
    ],
    [text([style({ fontSize: 16, color: INK })], [label]), control],
  )

/** A row whose control needs the whole width: the name sits above it. */
const formBlock = (label: string, control: Html): Html =>
  box([style({ gap: 8 })], [text([style({ fontSize: 16, color: INK })], [label]), control])

const value = (id: string, label: string, shown: string): Html =>
  text([prop('testID', id), style({ fontSize: 14, color: INK })], [`${label}: ${shown}`])

const labelOf = (choices: ReadonlyArray<Choice>, chosen: string): string =>
  choices.find(choice => choice.value === chosen)?.label ?? chosen

const menusCard = (model: Model): Html =>
  card([
    heading('Menus'),
    hint('Press and hold the grey card.'),
    contextMenu<Message>(
      {
        testID: 'card-menu',
        title: 'Card',
        items: cardItems(model),
        onSelected: key => Message.SelectedCardAction({ key }),
      },
      box(
        [
          prop('testID', 'card'),
          style({ padding: 16, borderRadius: 12, backgroundColor: '#e7e7e4', gap: 4 }),
        ],
        [
          text([style({ fontSize: 17, fontWeight: '600', color: INK })], ['Hold me for a menu']),
          text(
            [prop('testID', 'card-pinned'), style({ fontSize: 14, color: MUTED })],
            [model.isPinned ? 'Pinned' : 'Not pinned'],
          ),
        ],
      ),
    ),
    hint('Press Sort. The order in use has a check mark.'),
    box(
      [style({ flexDirection: 'row', alignItems: 'center', gap: 12 })],
      [
        menuButton<Message>({
          testID: 'sort-menu',
          label: 'Sort',
          symbol: 'arrow.up.arrow.down',
          title: 'Sort',
          items: sortItems(model),
          onSelected: key => Message.SelectedSort({ key }),
        }),
        text(
          [prop('testID', 'sort-value'), style({ fontSize: 14, color: MUTED })],
          [`Sorted by ${labelOf(SORTS, model.sort).toLowerCase()}`],
        ),
      ],
    ),
    hint('The title bar has a More button with a menu of its own.'),
    button('open-sheet', 'Open an action sheet', Message.PressedOpenSheet()),
  ])

const formCard = (model: Model): Html =>
  card([
    heading('Controls'),
    formRow(
      'Switch',
      switchControl<Message>({
        testID: 'switch',
        value: model.isOn,
        onChanged: isOn => Message.ChangedSwitch({ isOn }),
      }),
    ),
    formBlock(
      'Slider',
      slider<Message>({
        testID: 'slider',
        value: model.volume,
        min: 0,
        max: 1,
        onChanged: next => Message.ChangedVolume({ value: next }),
      }),
    ),
    formBlock('Progress (follows the slider)', progress({ testID: 'progress', value: model.volume })),
    formRow('Progress (busy)', progress({ testID: 'spinner', look: 'spinner' })),
    formBlock(
      'Segmented control',
      segmentedControl<Message>({
        testID: 'segments',
        options: SIZES,
        value: model.size,
        onChanged: next => Message.ChangedSize({ value: next }),
      }),
    ),
    formRow(
      `Stepper (${model.count})`,
      stepper<Message>({
        testID: 'stepper',
        value: model.count,
        min: 0,
        max: 10,
        onChanged: next => Message.ChangedCount({ value: next }),
      }),
    ),
    formRow(
      'Picker (menu)',
      picker<Message>({
        testID: 'color',
        options: COLORS,
        value: model.color,
        look: 'menu',
        onChanged: next => Message.ChangedColor({ value: next }),
      }),
    ),
    formBlock(
      'Picker (wheel)',
      picker<Message>({
        testID: 'fruit',
        options: FRUITS,
        value: model.fruit,
        look: 'wheel',
        onChanged: next => Message.ChangedFruit({ value: next }),
      }),
    ),
    formRow(
      'Date',
      datePicker<Message>({
        testID: 'day',
        value: model.day,
        onChanged: (day: CalendarDate) => Message.ChangedDay({ day }),
      }),
    ),
    formRow(
      'Time',
      timePicker<Message>({
        testID: 'time',
        value: model.time,
        onChanged: (time: ClockTime) => Message.ChangedTime({ time }),
      }),
    ),
  ])

const modelCard = (model: Model): Html =>
  card([
    heading('In the Model now'),
    value('value-switch', 'Switch', model.isOn ? 'on' : 'off'),
    value('value-slider', 'Slider', model.volume.toFixed(2)),
    value('value-segments', 'Segmented control', labelOf(SIZES, model.size)),
    value('value-stepper', 'Stepper', String(model.count)),
    value('value-color', 'Picker (menu)', labelOf(COLORS, model.color)),
    value('value-fruit', 'Picker (wheel)', labelOf(FRUITS, model.fruit)),
    value('value-day', 'Date', calendarDateText(model.day)),
    value('value-time', 'Time', clockTimeText(model.time)),
    button('set-from-model', 'Set from the Model', Message.PressedSetFromModel()),
    hint('Every control above must move to the new values, with nobody touching it.'),
  ])

export const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Attribute('testID', 'stack')],
      [
        screen(
          [h.Key('menus'), h.Attribute('testID', 'screen-menus')],
          [
            navigationBar(h, device, {
              title: 'Menus and controls',
              rightButton: {
                label: 'More',
                symbol: 'ellipsis.circle',
                testID: 'bar-menu',
                onPress: Message.PressedBarButton(),
                color: INK,
                menu: {
                  title: 'This screen',
                  items: BAR_ITEMS,
                  onSelected: key => Message.SelectedBarAction({ key }),
                },
              },
            }),
            safeArea(device, { hasHeader: true }, [
              scrollView(
                [h.Attribute('testID', 'scroll'), style({ flex: 1, backgroundColor: PAGE })],
                [
                  box(
                    [style({ padding: 16, gap: 14, paddingBottom: 40 })],
                    [
                      button('exit', 'Exit', Message.PressedExit()),
                      status(),
                      card([
                        heading('Last event'),
                        text(
                          [prop('testID', 'last-event'), style({ fontSize: 16, color: INK })],
                          [model.lastEvent],
                        ),
                      ]),
                      menusCard(model),
                      formCard(model),
                      modelCard(model),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )

// PROGRAM

/**
 * `resources` holds the action sheet: `ActionSheet.live()` in an app (the
 * default), `ActionSheet.makeTest().layer` in a test.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<ActionSheet.ActionSheet> = ActionSheet.live(),
) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env),
    view: makeView(env.device),
    resources,
    container,
  })
