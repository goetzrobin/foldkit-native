/**
 * The phone's own controls as Foldkit elements, each tied to the Model.
 *
 *   switchControl({ value: model.isOn, onChanged: isOn => Message.ChangedSwitch({ isOn }) })
 *   slider({ value: model.volume, min: 0, max: 1, onChanged: ... })
 *   segmentedControl({ options, value: model.size, onChanged: ... })
 *   stepper({ value: model.count, min: 0, max: 10, onChanged: ... })
 *   picker({ options, value: model.color, look: 'menu', onChanged: ... })
 *   datePicker({ value: model.day, onChanged: ... })
 *   timePicker({ value: model.time, onChanged: ... })
 *   progress({ value: model.volume })
 *
 * The Model is the source of truth. A control shows the `value` it is
 * given. When the user changes it, the control reports the new value, the
 * Message `onChanged` makes from it goes to `update`, and the next draw
 * hands the new value back. A report equal to the Model's value is dropped:
 * it is the control saying what it was just told, not the user.
 *
 * Where each control comes from, best first. `controlsStatus()` lists what
 * this build uses.
 *
 * - Expo UI: SwiftUI on iOS, Jetpack Compose on Android (see `expoUi.ts`).
 * - React Native's own native views, which every build has: the switch and
 *   the spinner.
 * - A plain version drawn with ordinary views and presses.
 *
 * Compose has no stepper and no wheel, so Android draws the plain stepper,
 * and a `wheel` picker is a menu there.
 *
 * Every control takes its settings, then attributes for its outer view
 * (`style` to place it among its neighbours).
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { registerViewName } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { OnCustomEvent, type VNode, element } from 'foldkit/renderTarget'

import { type NativeStyle, onPress, prop, style } from '../attributes.js'
import { type ModuleFactory, registerModule } from '../extend.js'
import { menuButton, menuRouteName } from '../menus/menu.js'
import { bagOf, nodeOf } from '../modules.js'
import {
  type Modifier,
  disabledModifier,
  expoUiHost,
  expoUiKind,
  expoUiName,
  expoUiTag,
  hasExpoUiView,
  modifiers,
  platformName,
  slot,
  ui,
  uiText,
} from './expoUi.js'

const el = element<any>()
const view = el('view')
const text = el('text')

type Outer = ReadonlyArray<unknown>

type Shared = Readonly<{
  isDisabled?: boolean
  /** For tests to find the control's outer view. */
  testID?: string
}>

const outer = (settings: Shared, attributes: Outer): Array<unknown> => [
  ...(settings.testID === undefined ? [] : [prop('testID', settings.testID)]),
  ...attributes,
]

/**
 * A native report as a Message, unless it only repeats what the Model
 * already holds.
 */
const reported = <Message, Value>(
  name: string,
  read: (detail: Record<string, unknown>) => Value | undefined,
  isSame: (reported: Value) => boolean,
  onChanged: (value: Value) => Message,
) =>
  OnCustomEvent<Message>({
    name,
    f: event => {
      const detail = event.detail
      if (typeof detail !== 'object' || detail === null) return Option.none()
      const value = read(detail as Record<string, unknown>)
      return value === undefined || isSame(value) ? Option.none() : Option.some(onChanged(value))
    },
  })

const numberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const LABELS_HIDDEN: Modifier = { $type: 'labelsHidden' }

const has = (...views: ReadonlyArray<Parameters<typeof hasExpoUiView>[0]>): boolean =>
  views.every(hasExpoUiView)

// PLAIN VERSIONS

const INK = '#111111'
const GREYED = '#9a9a9a'
const LINE = '#bdbdbd'
const FILL = '#2f6f4f'

const KEY: NativeStyle = {
  minWidth: 40,
  paddingVertical: 8,
  paddingHorizontal: 12,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: LINE,
  backgroundColor: '#ffffff',
  alignItems: 'center',
}

/** A small button of the plain controls. With no Message it is greyed out. */
const key = <Message>(id: string | undefined, label: string, message: Message | undefined): Html =>
  view(
    [
      ...(id === undefined ? [] : [prop('testID', id)]),
      prop('accessibilityRole', 'button'),
      style(KEY),
      ...(message === undefined ? [] : [onPress(message)]),
    ] as never,
    [text([style({ fontSize: 16, fontWeight: '600', color: message === undefined ? GREYED : INK })], [label])],
  )

const part = (settings: Shared, name: string): string | undefined =>
  settings.testID === undefined ? undefined : `${settings.testID}-${name}`

const ROW: NativeStyle = { flexDirection: 'row', alignItems: 'center', gap: 8 }

const bar = (fraction: number): Html =>
  view(
    [style({ flex: 1, height: 6, borderRadius: 3, backgroundColor: '#e3e3e3', overflow: 'hidden' })],
    [
      view(
        [
          style({
            width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`,
            height: 6,
            backgroundColor: FILL,
          }),
        ],
        [],
      ),
    ],
  )

// SWITCH

export type SwitchSettings<Message> = Shared &
  Readonly<{ value: boolean; onChanged: (isOn: boolean) => Message }>

/** React Native's own switch: `Switch` on iOS, `AndroidSwitch` on Android. */
const RN_SWITCH_TAG = 'fk-rn-switch'
registerViewName(RN_SWITCH_TAG, { ios: 'Switch', android: 'AndroidSwitch' })

const booleanOf = (name: string) => (detail: Record<string, unknown>) =>
  typeof detail[name] === 'boolean' ? (detail[name] as boolean) : undefined

/** An on/off switch. */
export const switchControl = <Message>(
  settings: SwitchSettings<Message>,
  attributes: Outer = [],
): Html => {
  const isSame = (isOn: boolean) => isOn === settings.value
  if (has('host', 'toggle')) {
    const control =
      expoUiKind() === 'swiftui'
        ? ui('toggle')(
            [
              prop('isOn', settings.value),
              modifiers([LABELS_HIDDEN, disabledModifier(settings.isDisabled)]),
              reported('isOnChange', booleanOf('isOn'), isSame, settings.onChanged),
            ] as never,
            [],
          )
        : ui('toggle')(
            [
              prop('value', settings.value),
              prop('enabled', settings.isDisabled !== true),
              prop('nativeClickable', true),
              reported('checkedChange', booleanOf('value'), isSame, settings.onChanged),
            ] as never,
            [],
          )
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [control])
  }
  const isAndroid = platformName() === 'android'
  return el(RN_SWITCH_TAG)(
    [
      // The two phones name the same things differently.
      prop(isAndroid ? 'on' : 'value', settings.value),
      prop(isAndroid ? 'enabled' : 'disabled', isAndroid !== (settings.isDisabled === true)),
      prop('accessibilityRole', 'switch'),
      // As React Native styles its own, so it does not stretch across a column.
      style({ alignSelf: 'flex-start' }),
      reported('change', booleanOf('value'), isSame, settings.onChanged),
      ...outer(settings, attributes),
    ] as never,
    [],
  )
}

// SLIDER

export type SliderSettings<Message> = Shared &
  Readonly<{
    value: number
    /** 0 unless said. */
    min?: number
    /** 1 unless said. */
    max?: number
    /** The thumb stops only at multiples of this, counted from `min`. */
    step?: number
    onChanged: (value: number) => Message
  }>

/** A value picked by dragging a thumb along a track. */
export const slider = <Message>(settings: SliderSettings<Message>, attributes: Outer = []): Html => {
  const min = settings.min ?? 0
  const max = settings.max ?? 1
  const isSame = (value: number) => value === settings.value
  if (has('host', 'slider')) {
    const control =
      expoUiKind() === 'swiftui'
        ? ui('slider')(
            [
              prop('value', settings.value),
              prop('min', min),
              prop('max', max),
              ...(settings.step === undefined ? [] : [prop('step', settings.step)]),
              modifiers([disabledModifier(settings.isDisabled)]),
              // SwiftUI's event has the d, and carries a count: see the module below.
              reported('valueChanged', detail => numberOf(detail['value']), isSame, settings.onChanged),
            ] as never,
            [],
          )
        : ui('slider')(
            [
              prop('value', settings.value),
              prop('min', min),
              prop('max', max),
              // Compose counts the stops between the two ends.
              prop(
                'steps',
                settings.step === undefined || settings.step <= 0
                  ? 0
                  : Math.max(0, Math.round((max - min) / settings.step) - 1),
              ),
              prop('enabled', settings.isDisabled !== true),
              reported('valueChange', detail => numberOf(detail['value']), isSame, settings.onChanged),
            ] as never,
            [],
          )
    return expoUiHost({ match: 'vertical' }, outer(settings, attributes), [control])
  }
  const step = settings.step ?? (max - min) / 10
  const moved = (by: number): Message | undefined => {
    const next = Math.min(max, Math.max(min, Number((settings.value + by).toFixed(6))))
    return settings.isDisabled === true || next === settings.value ? undefined : settings.onChanged(next)
  }
  return view(
    [style(ROW), ...outer(settings, attributes)] as never,
    [
      key(part(settings, 'less'), '−', moved(-step)),
      bar(max === min ? 0 : (settings.value - min) / (max - min)),
      key(part(settings, 'more'), '+', moved(step)),
    ],
  )
}

// CHOICES: SEGMENTED CONTROL AND PICKER

export type Choice = Readonly<{ value: string; label: string }>

type ChoiceSettings<Message> = Shared &
  Readonly<{
    options: ReadonlyArray<Choice>
    /** The `value` of the chosen option. */
    value: string
    onChanged: (value: string) => Message
  }>

const textOf = (name: string) => (detail: Record<string, unknown>) =>
  typeof detail[name] === 'string' ? (detail[name] as string) : undefined

/** SwiftUI's `Picker`, which draws all three: segments, a menu, a wheel. */
const swiftPicker = <Message>(
  settings: ChoiceSettings<Message>,
  look: 'segmented' | 'menu' | 'wheel',
): Html =>
  ui('picker')(
    [
      prop('selection', settings.value),
      // The native view draws nothing without a label. It is not shown.
      prop('label', ''),
      modifiers([
        { $type: 'pickerStyle', style: look },
        LABELS_HIDDEN,
        disabledModifier(settings.isDisabled),
      ]),
      reported(
        'selectionChange',
        textOf('selection'),
        value => value === settings.value,
        settings.onChanged,
      ),
    ] as never,
    [
      slot(
        'content',
        settings.options.map(option =>
          uiText(option.label, [modifiers([{ $type: 'tag', tag: option.value }])]),
        ),
      ),
    ],
  )

export type SegmentedSettings<Message> = ChoiceSettings<Message>

/** A row of segments, one of them chosen. For two to five short choices. */
export const segmentedControl = <Message>(
  settings: SegmentedSettings<Message>,
  attributes: Outer = [],
): Html => {
  const kind = expoUiKind()
  if (kind === 'swiftui' && has('host', 'picker', 'slot', 'text')) {
    return expoUiHost({ match: 'vertical' }, outer(settings, attributes), [
      swiftPicker(settings, 'segmented'),
    ])
  }
  if (kind === 'compose' && has('host', 'segmented-row', 'segmented-button', 'slot', 'text')) {
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui('segmented-row')(
        [],
        settings.options.map(option =>
          ui('segmented-button')(
            [
              prop('selected', option.value === settings.value),
              prop('enabled', settings.isDisabled !== true),
              OnCustomEvent<Message>({
                name: 'buttonPressed',
                f: () =>
                  option.value === settings.value
                    ? Option.none()
                    : Option.some(settings.onChanged(option.value)),
              }),
            ] as never,
            [slot('label', [uiText(option.label)])],
          ),
        ),
      ),
    ])
  }
  return view(
    [
      style({ flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: LINE, overflow: 'hidden' }),
      ...outer(settings, attributes),
    ] as never,
    settings.options.map(option => {
      const isChosen = option.value === settings.value
      return view(
        [
          ...(settings.testID === undefined ? [] : [prop('testID', `${settings.testID}-${option.value}`)]),
          prop('accessibilityRole', 'button'),
          style({
            flex: 1,
            paddingVertical: 8,
            alignItems: 'center',
            backgroundColor: isChosen ? INK : '#ffffff',
          }),
          ...(isChosen || settings.isDisabled === true ? [] : [onPress(settings.onChanged(option.value))]),
        ] as never,
        [text([style({ fontSize: 15, fontWeight: '600', color: isChosen ? '#ffffff' : INK })], [option.label])],
      )
    }),
  )
}

export type PickerSettings<Message> = ChoiceSettings<Message> &
  Readonly<{
    /**
     * `menu` (the default): a button that says the choice and opens a menu.
     * `wheel`: iOS's spinning wheel. Android has no wheel and shows a menu.
     */
    look?: 'menu' | 'wheel'
  }>

/** One choice out of a list too long for segments. */
export const picker = <Message>(settings: PickerSettings<Message>, attributes: Outer = []): Html => {
  const look = settings.look ?? 'menu'
  if (expoUiKind() === 'swiftui' && has('host', 'picker', 'slot', 'text')) {
    return expoUiHost({ match: look === 'wheel' ? 'vertical' : 'both' }, outer(settings, attributes), [
      swiftPicker(settings, look),
    ])
  }
  const chosen = settings.options.find(option => option.value === settings.value)
  return menuButton(
    {
      label: chosen?.label ?? 'Choose',
      items: settings.options.map(option => ({
        key: option.value,
        title: option.label,
        isChecked: option.value === settings.value,
      })),
      onSelected: settings.onChanged,
      ...(settings.isDisabled === undefined ? {} : { isDisabled: settings.isDisabled }),
      ...(settings.testID === undefined ? {} : { testID: settings.testID }),
    },
    attributes,
  )
}

// STEPPER

export type StepperSettings<Message> = Shared &
  Readonly<{
    /** A whole number. */
    value: number
    /** 0 unless said. */
    min?: number
    /** 100 unless said. */
    max?: number
    /** 1 unless said. */
    step?: number
    onChanged: (value: number) => Message
  }>

/** A minus and a plus button that change a whole number. It does not show the number. */
export const stepper = <Message>(settings: StepperSettings<Message>, attributes: Outer = []): Html => {
  const min = settings.min ?? 0
  const max = settings.max ?? 100
  const step = settings.step ?? 1
  if (expoUiKind() === 'swiftui' && has('host', 'stepper')) {
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui('stepper')(
        [
          // The native view needs a label. It is not shown.
          prop('label', ''),
          prop('value', settings.value),
          prop('min', min),
          prop('max', max),
          prop('step', step),
          modifiers([LABELS_HIDDEN, disabledModifier(settings.isDisabled)]),
          reported(
            'valueChange',
            detail => numberOf(detail['value']),
            value => value === settings.value,
            settings.onChanged,
          ),
        ] as never,
        [],
      ),
    ])
  }
  const moved = (by: number): Message | undefined => {
    const next = Math.min(max, Math.max(min, settings.value + by))
    return settings.isDisabled === true || next === settings.value ? undefined : settings.onChanged(next)
  }
  return view(
    [style({ ...ROW, alignSelf: 'flex-start' }), ...outer(settings, attributes)] as never,
    [key(part(settings, 'less'), '−', moved(-step)), key(part(settings, 'more'), '+', moved(step))],
  )
}

// DATE AND TIME

/** A day on the calendar, with no time and no time zone. `month` is 1 to 12. */
export type CalendarDate = Readonly<{ year: number; month: number; day: number }>

/** A time on the clock, in 24 hours. */
export type ClockTime = Readonly<{ hour: number; minute: number }>

const two = (value: number): string => String(value).padStart(2, '0')

/** `2026-11-24`. */
export const calendarDateText = (date: CalendarDate): string =>
  `${String(date.year).padStart(4, '0')}-${two(date.month)}-${two(date.day)}`

/** `09:30`. */
export const clockTimeText = (time: ClockTime): string => `${two(time.hour)}:${two(time.minute)}`

const sameDay = (a: CalendarDate, b: CalendarDate): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day

const sameTime = (a: ClockTime, b: ClockTime): boolean => a.hour === b.hour && a.minute === b.minute

/** Noon on that day, here: far from midnight, so no time zone turns it into another day. */
const localNoon = (date: CalendarDate): Date => new Date(date.year, date.month - 1, date.day, 12)

const localDay = (date: Date): CalendarDate => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
})

/** Material's calendar counts days in UTC, whatever the phone's time zone. */
const utcMidnight = (date: CalendarDate): number => Date.UTC(date.year, date.month - 1, date.day)

const utcDay = (milliseconds: number): CalendarDate => {
  const date = new Date(milliseconds)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

/** Any ordinary day will do to carry a time: this one has no clock change anywhere. */
const onPlainDay = (time: ClockTime): Date => new Date(2001, 0, 15, time.hour, time.minute)

const DATE_ONLY = ['date'] as const
const TIME_ONLY = ['hourAndMinute'] as const

const moment = (detail: Record<string, unknown>): number | undefined => {
  const date = detail['date']
  if (typeof date === 'number') return numberOf(date)
  if (typeof date === 'string') return numberOf(new Date(date).getTime())
  return undefined
}

export type DatePickerSettings<Message> = Shared &
  Readonly<{
    value: CalendarDate
    onChanged: (date: CalendarDate) => Message
    /** The first and the last day that can be chosen. */
    min?: CalendarDate
    max?: CalendarDate
    /**
     * iOS: `compact` (the default) is a small button that opens a calendar,
     * `wheel` is spinning wheels, `calendar` is a month drawn in place.
     * Android always draws the month in place.
     */
    look?: 'compact' | 'wheel' | 'calendar'
  }>

const SWIFT_DATE_LOOK = { compact: 'compact', wheel: 'wheel', calendar: 'graphical' } as const

const moveDay = (date: CalendarDate, by: number): CalendarDate => {
  const moved = localNoon(date)
  moved.setDate(moved.getDate() + by)
  return localDay(moved)
}

const dayNumber = (date: CalendarDate): number => utcMidnight(date)

/** A day picked from a calendar. */
export const datePicker = <Message>(
  settings: DatePickerSettings<Message>,
  attributes: Outer = [],
): Html => {
  const kind = expoUiKind()
  const isSame = (date: CalendarDate) => sameDay(date, settings.value)
  if (kind === 'swiftui' && has('host', 'date-picker')) {
    const look = settings.look ?? 'compact'
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui('date-picker')(
        [
          // As Expo UI's own JavaScript sends a date: ISO text.
          prop('selection', localNoon(settings.value).toISOString()),
          prop('displayedComponents', DATE_ONLY),
          ...(settings.min === undefined && settings.max === undefined
            ? []
            : [
                prop('range', {
                  ...(settings.min === undefined ? {} : { start: localNoon(settings.min).toISOString() }),
                  ...(settings.max === undefined ? {} : { end: localNoon(settings.max).toISOString() }),
                }),
              ]),
          modifiers([
            { $type: 'datePickerStyle', style: SWIFT_DATE_LOOK[look] },
            LABELS_HIDDEN,
            disabledModifier(settings.isDisabled),
          ]),
          reported(
            'dateChange',
            detail => {
              const at = moment(detail)
              return at === undefined ? undefined : localDay(new Date(at))
            },
            isSame,
            settings.onChanged,
          ),
        ] as never,
        [],
      ),
    ])
  }
  if (kind === 'compose' && has('host', 'date-picker')) {
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui('date-picker')(
        [
          // Compose calls it "initial", and takes a new one as the new day.
          prop('initialDate', utcMidnight(settings.value)),
          prop('displayedComponents', 'date'),
          prop('variant', 'picker'),
          prop('showVariantToggle', false),
          prop('showTitle', false),
          prop('showHeadline', false),
          ...(settings.min === undefined && settings.max === undefined
            ? []
            : [
                prop('selectableDates', {
                  ...(settings.min === undefined ? {} : { start: utcMidnight(settings.min) }),
                  ...(settings.max === undefined ? {} : { end: utcMidnight(settings.max) }),
                }),
              ]),
          reported(
            'dateSelected',
            detail => {
              const at = moment(detail)
              return at === undefined ? undefined : utcDay(at)
            },
            isSame,
            settings.onChanged,
          ),
        ] as never,
        [],
      ),
    ])
  }
  const moved = (by: number): Message | undefined => {
    const next = moveDay(settings.value, by)
    const isAllowed =
      (settings.min === undefined || dayNumber(next) >= dayNumber(settings.min)) &&
      (settings.max === undefined || dayNumber(next) <= dayNumber(settings.max))
    return settings.isDisabled === true || !isAllowed ? undefined : settings.onChanged(next)
  }
  return view(
    [style({ ...ROW, alignSelf: 'flex-start' }), ...outer(settings, attributes)] as never,
    [
      key(part(settings, 'less'), '−', moved(-1)),
      text([style({ fontSize: 16, color: INK })], [calendarDateText(settings.value)]),
      key(part(settings, 'more'), '+', moved(1)),
    ],
  )
}

export type TimePickerSettings<Message> = Shared &
  Readonly<{ value: ClockTime; onChanged: (time: ClockTime) => Message }>

const moveMinutes = (time: ClockTime, by: number): ClockTime => {
  const minutes = (((time.hour * 60 + time.minute + by) % 1440) + 1440) % 1440
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 }
}

/** A time picked from a clock. */
export const timePicker = <Message>(
  settings: TimePickerSettings<Message>,
  attributes: Outer = [],
): Html => {
  const kind = expoUiKind()
  const time = reported<Message, ClockTime>(
    kind === 'compose' ? 'dateSelected' : 'dateChange',
    detail => {
      const at = moment(detail)
      if (at === undefined) return undefined
      const date = new Date(at)
      return { hour: date.getHours(), minute: date.getMinutes() }
    },
    value => sameTime(value, settings.value),
    settings.onChanged,
  )
  if (kind === 'swiftui' && has('host', 'date-picker')) {
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui('date-picker')(
        [
          prop('selection', onPlainDay(settings.value).toISOString()),
          prop('displayedComponents', TIME_ONLY),
          modifiers([LABELS_HIDDEN, disabledModifier(settings.isDisabled)]),
          time,
        ] as never,
        [],
      ),
    ])
  }
  if (kind === 'compose' && has('host', 'date-picker')) {
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui('date-picker')(
        [
          prop('initialDate', onPlainDay(settings.value).getTime()),
          prop('displayedComponents', 'hourAndMinute'),
          prop('is24Hour', true),
          time,
        ] as never,
        [],
      ),
    ])
  }
  const moved = (by: number): Message | undefined =>
    settings.isDisabled === true ? undefined : settings.onChanged(moveMinutes(settings.value, by))
  return view(
    [style({ ...ROW, alignSelf: 'flex-start' }), ...outer(settings, attributes)] as never,
    [
      key(part(settings, 'hour-less'), '− 1 h', moved(-60)),
      key(part(settings, 'less'), '− 5 min', moved(-5)),
      text([style({ fontSize: 16, color: INK })], [clockTimeText(settings.value)]),
      key(part(settings, 'more'), '+ 5 min', moved(5)),
      key(part(settings, 'hour-more'), '+ 1 h', moved(60)),
    ],
  )
}

// PROGRESS

export type ProgressSettings = Readonly<{
  /** From 0 to 1. Left out: something is going on and nobody knows how long. */
  value?: number
  /** `bar` unless said. */
  look?: 'bar' | 'spinner'
  testID?: string
}>

/** How far along something is, or that it is going on. Shows only: it reports nothing. */
export const progress = (settings: ProgressSettings, attributes: Outer = []): Html => {
  const kind = expoUiKind()
  const look = settings.look ?? 'bar'
  const value = settings.value === undefined ? [] : [prop('value', settings.value)]
  if (kind === 'swiftui' && has('host', 'progress')) {
    return expoUiHost({ match: look === 'bar' ? 'vertical' : 'both' }, outer(settings, attributes), [
      ui('progress')(
        [
          ...value,
          modifiers([{ $type: 'progressViewStyle', style: look === 'bar' ? 'linear' : 'circular' }]),
        ] as never,
        [],
      ),
    ])
  }
  if (kind === 'compose' && has('host', look === 'bar' ? 'progress' : 'circular-progress')) {
    return expoUiHost({ match: 'both' }, outer(settings, attributes), [
      ui(look === 'bar' ? 'progress' : 'circular-progress')(
        (settings.value === undefined ? [] : [prop('progress', settings.value)]) as never,
        [],
      ),
    ])
  }
  if (settings.value === undefined) {
    // React Native's own spinner, which every build has.
    return el('activity-indicator')(
      [
        prop('animating', true),
        prop('hidesWhenStopped', true),
        prop('size', 'small'),
        ...(platformName() === 'android' ? [prop('styleAttr', 'Normal'), prop('indeterminate', true)] : []),
        style({ width: 20, height: 20, alignSelf: 'flex-start' }),
        ...outer(settings, attributes),
      ] as never,
      [],
    )
  }
  return view([style({ flexDirection: 'row' }), ...outer(settings, attributes)] as never, [
    bar(settings.value),
  ])
}

// KEEPING A CONTROL AND THE MODEL IN STEP

type SwitchState = { lastNative: boolean | null; stop: () => void }

/**
 * Two controls answer a change before the Model has heard of it, and need
 * the same care a text field does (see `textInputModule`).
 *
 * SwiftUI's slider numbers each change it reports. It ignores a value from
 * the Model that answers an older change than its newest, so a thumb under
 * a finger is not pulled back. This module tells it the newest number seen.
 *
 * React Native's switch flips by itself when touched. If the Model then
 * holds another value (the program refused the change), the switch is told
 * so with a command, as React Native's own `Switch` does.
 */
const controlsModule: ModuleFactory = (engine: Engine, afterCommit) => {
  const sliderStops = new WeakMap<EngineNode, () => void>()
  const switches = new WeakMap<EngineNode, SwitchState>()
  const SLIDER_TAG = expoUiTag('slider')

  const switchValue = (vnode: VNode): boolean => {
    const props = bagOf(vnode, 'props')
    return (props['value'] ?? props['on']) === true
  }

  const create = (_empty: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    // Only SwiftUI's slider counts. Compose's has the same element name.
    if (node.tag === SLIDER_TAG && expoUiKind() === 'swiftui') {
      engine.setProp(node, 'mostRecentEventCount', 0)
      sliderStops.set(
        node,
        engine.setEventListener(node, 'topValueChanged', event => {
          const count = (event as { nativeEvent?: { eventCount?: unknown } })?.nativeEvent?.eventCount
          if (typeof count === 'number') engine.setProp(node, 'mostRecentEventCount', count)
        }),
      )
    }
    if (node.tag === RN_SWITCH_TAG) {
      const state: SwitchState = { lastNative: null, stop: () => {} }
      state.stop = engine.setEventListener(node, 'topChange', event => {
        const value = (event as { nativeEvent?: { value?: unknown } })?.nativeEvent?.value
        if (typeof value === 'boolean') state.lastNative = value
      })
      switches.set(node, state)
    }
  }

  const update = (_old: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    const state = node === undefined ? undefined : switches.get(node)
    if (node === undefined || state === undefined) return
    const desired = switchValue(vnode)
    if (state.lastNative === null || state.lastNative === desired) return
    state.lastNative = desired
    const command = platformName() === 'android' ? 'setNativeValue' : 'setValue'
    afterCommit(() => engine.dispatchCommand(node, command, [desired]))
  }

  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined) return
    sliderStops.get(node)?.()
    sliderStops.delete(node)
    switches.get(node)?.stop()
    switches.delete(node)
  }

  return { create, update, destroy }
}

registerModule(controlsModule)

// WHAT THIS BUILD USES

export type RouteLine = Readonly<{
  feature: string
  /** Where it comes from, in words. */
  route: string
  /** Whether the phone's own control is drawn, and not a plain stand-in. */
  isNative: boolean
}>

const PLAIN = 'plain in-app version'

/** Each control with where it comes from in this build. Never throws. */
export const controlsStatus = (): ReadonlyArray<RouteLine> => {
  const kind = expoUiKind()
  const isSwift = kind === 'swiftui'
  const isCompose = kind === 'compose'
  const name = expoUiName()
  const line = (feature: string, route: string | false, fallback = PLAIN): RouteLine =>
    route === false
      ? { feature, route: fallback, isNative: !fallback.includes('plain') }
      : { feature, route, isNative: true }
  const viaMenu = `a menu: ${menuRouteName()}`
  return [
    line('switch', has('host', 'toggle') && name, "React Native's own switch"),
    line('slider', has('host', 'slider') && name),
    line(
      'segmented control',
      ((isSwift && has('host', 'picker', 'slot', 'text')) ||
        (isCompose && has('host', 'segmented-row', 'segmented-button', 'slot', 'text'))) &&
        name,
    ),
    line(
      'stepper',
      isSwift && has('host', 'stepper') && name,
      isCompose ? `${PLAIN} (Compose has no stepper)` : PLAIN,
    ),
    line('picker (menu)', isSwift && has('host', 'picker', 'slot', 'text') && name, viaMenu),
    line(
      'picker (wheel)',
      isSwift && has('host', 'picker', 'slot', 'text') && name,
      isCompose ? `${viaMenu} (Compose has no wheel)` : viaMenu,
    ),
    line('date picker', has('host', 'date-picker') && name),
    line('time picker', has('host', 'date-picker') && name),
    line(
      'progress',
      ((isSwift && has('host', 'progress')) || (isCompose && has('host', 'progress', 'circular-progress'))) &&
        name,
      "plain bar, and React Native's own spinner",
    ),
  ]
}
