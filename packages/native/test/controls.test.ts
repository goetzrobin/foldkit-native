/**
 * The system controls on the simulated phone: drawn by SwiftUI, by Compose,
 * and by the fallbacks. For each: the native view and its props, the
 * phone's report becoming the Message, and the Model's value reaching the
 * control when the program sets it.
 *
 * The simulated phone cannot draw a switch. These tests check what the
 * phone was asked to draw and what is done with what it would report.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { Schema } from 'effect'
import { Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { afterEach, describe, expect, it } from 'vitest'

import {
  compose,
  expoUiHost,
  resetExpoUi,
  slider,
  swiftUi,
  switchControl,
} from '../src/controls/index.js'
import { prop, text, view as box } from '../src/index.js'
import { ActionSheet, configureSheets, contextMenu, menuButton } from '../src/menus/index.js'
import { makeDemo } from './demos/menus.js'
import { UI, expoWith, inside, one, prepare, send } from './support/expoUi.js'
import { type Phone, byTestId, flatten, hasTestId, press, settle, textOf } from './support/phone.js'

let running: { dispose: () => void } | undefined
let phone: Phone | undefined

const start = async (platform: 'ios' | 'android', hasExpoUi: boolean) => {
  phone = prepare(platform, hasExpoUi ? expoWith() : null)
  running = Runtime.embed(
    makeDemo(
      phone.surface.container,
      { device: { platform, osVersion: 27 }, exit: () => {} },
      ActionSheet.makeTest().layer,
    ),
  )
  await settle()
  return phone.fabric
}

const shown = (fabric: Phone['fabric'], id: string): string => textOf(byTestId(fabric, `value-${id}`))
const lastEvent = (fabric: Phone['fabric']): string => textOf(byTestId(fabric, 'last-event'))

afterEach(async () => {
  running?.dispose()
  running = undefined
  await settle()
  phone?.surface.dispose()
  phone = undefined
  resetExpoUi()
  configureSheets({ nativeModule: 'global' })
  registerPlatformComponents('ios')
})

describe('controls drawn by SwiftUI (iOS with Expo UI)', () => {
  it('draws the switch as a Toggle in a host as big as the switch, tied to the Model', async () => {
    const fabric = await start('ios', true)
    const host = byTestId(fabric, 'switch')
    expect(host.viewName).toBe(`${UI}HostView`)
    expect(host.props).toMatchObject({ matchContentsVertical: true, matchContentsHorizontal: true })
    const toggle = () => one(fabric, 'switch', `${UI}ToggleView`)
    expect(toggle().props).toMatchObject({ isOn: false, modifiers: [{ $type: 'labelsHidden' }] })
    await send(fabric, toggle(), 'topIsOnChange', { isOn: true })
    expect(shown(fabric, 'switch')).toBe('Switch: on')
    expect(toggle().props['isOn']).toBe(true)
  })

  it('drops a report that only repeats what the Model holds', async () => {
    const fabric = await start('ios', true)
    await send(fabric, one(fabric, 'stepper', `${UI}StepperView`), 'topValueChange', { value: 4 })
    expect(lastEvent(fabric)).toBe('Stepper: 4')
    await send(fabric, one(fabric, 'switch', `${UI}ToggleView`), 'topIsOnChange', { isOn: false })
    await send(fabric, one(fabric, 'slider', `${UI}SliderView`), 'topValueChanged', { value: 0.5, eventCount: 1 })
    await send(fabric, one(fabric, 'segments', `${UI}PickerView`), 'topSelectionChange', { selection: 'm' })
    expect(lastEvent(fabric)).toBe('Stepper: 4')
  })

  it('draws the slider across the row and answers with the count of the change it has seen', async () => {
    const fabric = await start('ios', true)
    expect(byTestId(fabric, 'slider').props).toMatchObject({
      matchContentsVertical: true,
      matchContentsHorizontal: false,
    })
    const native = () => one(fabric, 'slider', `${UI}SliderView`)
    expect(native().props).toMatchObject({ value: 0.5, min: 0, max: 1, mostRecentEventCount: 0 })
    await send(fabric, native(), 'topValueChanged', { value: 0.75, eventCount: 3 })
    expect(shown(fabric, 'slider')).toBe('Slider: 0.75')
    // The value goes back with the count, so the phone knows it is no stale answer.
    expect(native().props).toMatchObject({ value: 0.75, mostRecentEventCount: 3 })
    // The progress bar follows the same Model value.
    expect(one(fabric, 'progress', `${UI}ProgressView`).props).toMatchObject({
      value: 0.75,
      modifiers: [{ $type: 'progressViewStyle', style: 'linear' }],
    })
  })

  it('draws a spinner with no value', async () => {
    const fabric = await start('ios', true)
    const spinner = one(fabric, 'spinner', `${UI}ProgressView`)
    expect(spinner.props['value']).toBeUndefined()
    expect(spinner.props['modifiers']).toEqual([{ $type: 'progressViewStyle', style: 'circular' }])
  })

  it('draws segments, a menu and a wheel as one SwiftUI Picker in three styles', async () => {
    const fabric = await start('ios', true)
    const pickerIn = (id: string) => one(fabric, id, `${UI}PickerView`)
    const styleOf = (id: string) => (pickerIn(id).props['modifiers'] as Array<{ style?: string }>)[0]!.style
    expect([styleOf('segments'), styleOf('color'), styleOf('fruit')]).toEqual(['segmented', 'menu', 'wheel'])
    expect(pickerIn('segments').props).toMatchObject({ selection: 'm', label: '' })
    // The choices are text in a slot, each tagged with its value.
    const content = pickerIn('segments').children[0]!
    expect(content.props['name']).toBe('content')
    expect(content.children.map(child => [child.viewName, child.props['text'], child.props['modifiers']])).toEqual([
      [`${UI}TextView`, 'Small', [{ $type: 'tag', tag: 's' }]],
      [`${UI}TextView`, 'Medium', [{ $type: 'tag', tag: 'm' }]],
      [`${UI}TextView`, 'Large', [{ $type: 'tag', tag: 'l' }]],
    ])
    await send(fabric, pickerIn('segments'), 'topSelectionChange', { selection: 'l' })
    expect(shown(fabric, 'segments')).toBe('Segmented control: Large')
    expect(pickerIn('segments').props['selection']).toBe('l')
    await send(fabric, pickerIn('color'), 'topSelectionChange', { selection: 'blue' })
    expect(shown(fabric, 'color')).toBe('Picker (menu): Blue')
    await send(fabric, pickerIn('fruit'), 'topSelectionChange', { selection: 'plum' })
    expect(shown(fabric, 'fruit')).toBe('Picker (wheel): Plum')
    // A wheel takes the row's width. A menu is as wide as its button.
    expect(byTestId(fabric, 'fruit').props['matchContentsHorizontal']).toBe(false)
    expect(byTestId(fabric, 'color').props['matchContentsHorizontal']).toBe(true)
  })

  it('draws the stepper with its range', async () => {
    const fabric = await start('ios', true)
    const native = () => one(fabric, 'stepper', `${UI}StepperView`)
    expect(native().props).toMatchObject({ label: '', value: 3, min: 0, max: 10, step: 1 })
    await send(fabric, native(), 'topValueChange', { value: 4 })
    expect(shown(fabric, 'stepper')).toBe('Stepper: 4')
    expect(native().props['value']).toBe(4)
  })

  it('hands the date picker a day and reads a day back, whatever the hour', async () => {
    const fabric = await start('ios', true)
    const native = () => one(fabric, 'day', `${UI}DatePickerView`)
    expect(native().props).toMatchObject({
      selection: new Date(2026, 10, 24, 12).toISOString(),
      displayedComponents: ['date'],
    })
    expect(native().props['modifiers']).toEqual([
      { $type: 'datePickerStyle', style: 'compact' },
      { $type: 'labelsHidden' },
    ])
    await send(fabric, native(), 'topDateChange', { date: new Date(2026, 11, 25, 23, 30).getTime() })
    expect(shown(fabric, 'day')).toBe('Date: 2026-12-25')
    expect(native().props['selection']).toBe(new Date(2026, 11, 25, 12).toISOString())
    // The same day at another hour is no change.
    await send(fabric, one(fabric, 'stepper', `${UI}StepperView`), 'topValueChange', { value: 5 })
    await send(fabric, native(), 'topDateChange', { date: new Date(2026, 11, 25, 1).getTime() })
    expect(lastEvent(fabric)).toBe('Stepper: 5')
  })

  it('hands the time picker a time and reads a time back', async () => {
    const fabric = await start('ios', true)
    const native = () => one(fabric, 'time', `${UI}DatePickerView`)
    expect(native().props).toMatchObject({
      selection: new Date(2001, 0, 15, 9, 30).toISOString(),
      displayedComponents: ['hourAndMinute'],
    })
    await send(fabric, native(), 'topDateChange', { date: new Date(2030, 5, 5, 14, 7).getTime() })
    expect(shown(fabric, 'time')).toBe('Time: 14:07')
    expect(native().props['selection']).toBe(new Date(2001, 0, 15, 14, 7).toISOString())
  })

  it('moves every control when the program sets the Model', async () => {
    const fabric = await start('ios', true)
    await press(fabric, 'set-from-model')
    expect(one(fabric, 'switch', `${UI}ToggleView`).props['isOn']).toBe(true)
    expect(one(fabric, 'slider', `${UI}SliderView`).props['value']).toBe(0.8)
    expect(one(fabric, 'progress', `${UI}ProgressView`).props['value']).toBe(0.8)
    expect(one(fabric, 'segments', `${UI}PickerView`).props['selection']).toBe('l')
    expect(one(fabric, 'stepper', `${UI}StepperView`).props['value']).toBe(7)
    expect(one(fabric, 'color', `${UI}PickerView`).props['selection']).toBe('blue')
    expect(one(fabric, 'fruit', `${UI}PickerView`).props['selection']).toBe('fig')
    expect(one(fabric, 'day', `${UI}DatePickerView`).props['selection']).toBe(new Date(2027, 0, 31, 12).toISOString())
    expect(one(fabric, 'time', `${UI}DatePickerView`).props['selection']).toBe(
      new Date(2001, 0, 15, 18, 45).toISOString(),
    )
    expect(lastEvent(fabric)).toBe('Set from the Model')
    await press(fabric, 'set-from-model')
    expect(one(fabric, 'switch', `${UI}ToggleView`).props['isOn']).toBe(false)
    expect(one(fabric, 'stepper', `${UI}StepperView`).props['value']).toBe(1)
    expect(shown(fabric, 'day')).toBe('Date: 2026-07-04')
  })

  it('lists every control as SwiftUI in the status block', async () => {
    const fabric = await start('ios', true)
    const lines = byTestId(fabric, 'status').children.map(textOf)
    expect(lines.slice(4)).toEqual([
      'switch: Expo UI (SwiftUI)',
      'slider: Expo UI (SwiftUI)',
      'segmented control: Expo UI (SwiftUI)',
      'stepper: Expo UI (SwiftUI)',
      'picker (menu): Expo UI (SwiftUI)',
      'picker (wheel): Expo UI (SwiftUI)',
      'date picker: Expo UI (SwiftUI)',
      'time picker: Expo UI (SwiftUI)',
      'progress: Expo UI (SwiftUI)',
    ])
  })
})

describe('controls drawn by Compose (Android with Expo UI)', () => {
  it('draws the switch and reads Compose\'s own event', async () => {
    const fabric = await start('android', true)
    const native = () => one(fabric, 'switch', `${UI}SwitchView`)
    expect(native().props).toMatchObject({ value: false, enabled: true, nativeClickable: true })
    await send(fabric, native(), 'topCheckedChange', { value: true })
    expect(shown(fabric, 'switch')).toBe('Switch: on')
    expect(native().props['value']).toBe(true)
  })

  it('draws the slider with no count: Compose keeps a dragged thumb by itself', async () => {
    const fabric = await start('android', true)
    const native = () => one(fabric, 'slider', `${UI}SliderView`)
    expect(native().props).toMatchObject({ value: 0.5, min: 0, max: 1, steps: 0, enabled: true })
    expect(native().props['mostRecentEventCount']).toBeUndefined()
    await send(fabric, native(), 'topValueChange', { value: 0.25 })
    expect(shown(fabric, 'slider')).toBe('Slider: 0.25')
    expect(one(fabric, 'progress', `${UI}LinearProgressIndicatorView`).props['progress']).toBe(0.25)
    expect(one(fabric, 'spinner', `${UI}CircularProgressIndicatorView`).props['progress']).toBeUndefined()
  })

  it('draws segments as a row of Material segmented buttons', async () => {
    const fabric = await start('android', true)
    const row = one(fabric, 'segments', `${UI}SingleChoiceSegmentedButtonRowView`)
    const buttons = () => inside(fabric, 'segments', `${UI}SegmentedButtonView`)
    expect(row.children).toHaveLength(3)
    expect(buttons().map(button => button.props['selected'])).toEqual([false, true, false])
    expect(buttons()[0]!.children[0]!.props['slotName']).toBe('label')
    expect(inside(fabric, 'segments', `${UI}TextView`).map(node => node.props['text'])).toEqual([
      'Small',
      'Medium',
      'Large',
    ])
    await send(fabric, buttons()[2]!, 'topButtonPressed')
    expect(shown(fabric, 'segments')).toBe('Segmented control: Large')
    expect(buttons().map(button => button.props['selected'])).toEqual([false, false, true])
  })

  it('draws both pickers as a button that opens a Material menu', async () => {
    const fabric = await start('android', true)
    expect(textOf(byTestId(fabric, 'color').children[0]!)).toBe('Green ▾')
    await press(fabric, 'color')
    expect(one(fabric, 'color', `${UI}DropdownMenuView`).props['expanded']).toBe(true)
    expect(inside(fabric, 'color', `${UI}TextView`).map(node => node.props['text'])).toEqual([
      'Red',
      '✓ Green',
      'Blue',
    ])
    await send(fabric, inside(fabric, 'color', `${UI}DropdownMenuItemView`)[2]!, 'topItemPressed')
    expect(shown(fabric, 'color')).toBe('Picker (menu): Blue')
    expect(textOf(byTestId(fabric, 'color').children[0]!)).toBe('Blue ▾')
    expect(one(fabric, 'fruit', `${UI}DropdownMenuView`).props['expanded']).toBe(false)
  })

  it('draws a plain stepper, because Compose has none', async () => {
    const fabric = await start('android', true)
    expect(byTestId(fabric, 'stepper').viewName).toBe('View')
    await press(fabric, 'stepper-more')
    expect(shown(fabric, 'stepper')).toBe('Stepper: 4')
    expect(textOf(byTestId(fabric, 'status-stepper'))).toBe(
      'stepper: plain in-app version (Compose has no stepper)',
    )
  })

  it('counts calendar days in UTC, as Material does', async () => {
    const fabric = await start('android', true)
    const native = () => one(fabric, 'day', `${UI}DateTimePickerView`)
    expect(native().props).toMatchObject({
      initialDate: Date.UTC(2026, 10, 24),
      displayedComponents: 'date',
      variant: 'picker',
      showVariantToggle: false,
    })
    // What the calendar reports as it first appears is not a change.
    await send(fabric, native(), 'topDateSelected', { date: Date.UTC(2026, 10, 24) })
    expect(lastEvent(fabric)).toBe('Nothing yet')
    await send(fabric, native(), 'topDateSelected', { date: Date.UTC(2027, 1, 3) })
    expect(shown(fabric, 'day')).toBe('Date: 2027-02-03')
    expect(native().props['initialDate']).toBe(Date.UTC(2027, 1, 3))
  })

  it('reads the clock in the phone\'s own time', async () => {
    const fabric = await start('android', true)
    const native = () => one(fabric, 'time', `${UI}DateTimePickerView`)
    expect(native().props).toMatchObject({
      initialDate: new Date(2001, 0, 15, 9, 30).getTime(),
      displayedComponents: 'hourAndMinute',
      is24Hour: true,
    })
    await send(fabric, native(), 'topDateSelected', { date: new Date(2001, 0, 15, 21, 5).getTime() })
    expect(shown(fabric, 'time')).toBe('Time: 21:05')
  })

  it('moves every control when the program sets the Model', async () => {
    const fabric = await start('android', true)
    await press(fabric, 'set-from-model')
    expect(one(fabric, 'switch', `${UI}SwitchView`).props['value']).toBe(true)
    expect(one(fabric, 'slider', `${UI}SliderView`).props['value']).toBe(0.8)
    expect(inside(fabric, 'segments', `${UI}SegmentedButtonView`).map(b => b.props['selected'])).toEqual([
      false,
      false,
      true,
    ])
    expect(textOf(byTestId(fabric, 'color').children[0]!)).toBe('Blue ▾')
    expect(one(fabric, 'day', `${UI}DateTimePickerView`).props['initialDate']).toBe(Date.UTC(2027, 0, 31))
    expect(one(fabric, 'time', `${UI}DateTimePickerView`).props['initialDate']).toBe(
      new Date(2001, 0, 15, 18, 45).getTime(),
    )
  })
})

describe('controls without Expo UI', () => {
  it.each([
    ['ios', 'Switch', { value: false, disabled: false }],
    ['android', 'AndroidSwitch', { on: false, enabled: true }],
  ] as const)("uses React Native's own switch on %s", async (platform, viewName, props) => {
    const fabric = await start(platform, false)
    const native = () => byTestId(fabric, 'switch')
    expect(native().viewName).toBe(viewName)
    expect(native().props).toMatchObject(props)
    await send(fabric, native(), 'topChange', { value: true })
    expect(shown(fabric, 'switch')).toBe('Switch: on')
    expect(native().props[platform === 'ios' ? 'value' : 'on']).toBe(true)
    // The switch flipped itself and the Model agrees: nothing to correct.
    expect(fabric.commands.filter(command => /^set(Native)?Value$/.test(command.name))).toEqual([])
    expect(textOf(byTestId(fabric, 'status-switch'))).toBe("switch: React Native's own switch")
  })

  it('draws the other controls with plain views that still change the Model', async () => {
    const fabric = await start('ios', false)
    await press(fabric, 'slider-more')
    expect(shown(fabric, 'slider')).toBe('Slider: 0.60')
    await press(fabric, 'slider-less')
    await press(fabric, 'slider-less')
    expect(shown(fabric, 'slider')).toBe('Slider: 0.40')
    await press(fabric, 'segments-l')
    expect(shown(fabric, 'segments')).toBe('Segmented control: Large')
    await press(fabric, 'stepper-less')
    expect(shown(fabric, 'stepper')).toBe('Stepper: 2')
    await press(fabric, 'day-more')
    expect(shown(fabric, 'day')).toBe('Date: 2026-11-25')
    await press(fabric, 'time-hour-more')
    await press(fabric, 'time-less')
    expect(shown(fabric, 'time')).toBe('Time: 10:25')
    // A picker is a button that opens the in-app list.
    await press(fabric, 'color')
    await press(fabric, 'color-red')
    expect(shown(fabric, 'color')).toBe('Picker (menu): Red')
  })

  it('stops a plain stepper and a plain date at their ends', async () => {
    const fabric = await start('ios', false)
    for (let presses = 0; presses < 9; presses++) await press(fabric, 'stepper-more')
    expect(shown(fabric, 'stepper')).toBe('Stepper: 10')
    for (let presses = 0; presses < 7; presses++) await press(fabric, 'day-more')
    // Past the end of November: the month turns over.
    expect(shown(fabric, 'day')).toBe('Date: 2026-12-01')
  })

  it("draws progress as a plain bar, and the busy one as React Native's spinner", async () => {
    const fabric = await start('ios', false)
    const fill = flatten([byTestId(fabric, 'progress')]).find(node => node.props['width'] === '50%')
    expect(fill).toBeDefined()
    expect(byTestId(fabric, 'spinner').viewName).toBe('ActivityIndicatorView')
    expect(byTestId(fabric, 'spinner').props).toMatchObject({ animating: true, size: 'small' })
  })

  it("uses Android's own spinner too", async () => {
    const fabric = await start('android', false)
    expect(byTestId(fabric, 'spinner').viewName).toBe('AndroidProgressBar')
    expect(byTestId(fabric, 'spinner').props).toMatchObject({ styleAttr: 'Normal', indeterminate: true })
  })

  it('says which controls are stand-ins', async () => {
    const fabric = await start('ios', false)
    const lines = byTestId(fabric, 'status').children.map(textOf)
    expect(lines.slice(4)).toEqual([
      "switch: React Native's own switch",
      'slider: plain in-app version',
      'segmented control: plain in-app version',
      'stepper: plain in-app version',
      "picker (menu): a menu: a plain in-app list (no Expo UI: Expo's native modules are not in this build)",
      "picker (wheel): a menu: a plain in-app list (no Expo UI: Expo's native modules are not in this build)",
      'date picker: plain in-app version',
      'time picker: plain in-app version',
      "progress: plain bar, and React Native's own spinner",
    ])
  })
})

// A small program for what the demo does not show: a program that refuses a
// change, disabled controls, a preview, a trigger of the app's own, and any
// other Expo UI view.

const Model = Schema.Struct({ isOn: Schema.Boolean, refused: Schema.Number, chosen: Schema.String })
type Model = typeof Model.Type

const Message = defineMessageUnion({
  ChangedSwitch: { isOn: Schema.Boolean },
  ChangedSlider: { value: Schema.Number },
  Selected: { key: Schema.String },
})
type Message = typeof Message.Type

const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    // The program says no: the Model's value stays as it was.
    ChangedSwitch: () => ({ model: { ...model, refused: model.refused + 1 } }),
    ChangedSlider: () => ({ model }),
    Selected: ({ key }) => ({ model: { ...model, chosen: key } }),
  })

const view = (model: Model, _h: HtmlBuilder<Message>): Html =>
  box(
    [],
    [
      text([prop('testID', 'refused')], [`Refused ${model.refused}, chosen ${model.chosen}`]),
      switchControl<Message>({
        testID: 'stubborn',
        value: model.isOn,
        onChanged: isOn => Message.ChangedSwitch({ isOn }),
      }),
      switchControl<Message>({
        testID: 'off-limits',
        value: true,
        isDisabled: true,
        onChanged: isOn => Message.ChangedSwitch({ isOn }),
      }),
      slider<Message>({
        testID: 'stepped',
        value: 20,
        min: 0,
        max: 100,
        step: 10,
        isDisabled: true,
        onChanged: value => Message.ChangedSlider({ value }),
      }),
      contextMenu<Message>(
        {
          testID: 'with-preview',
          fit: 'content',
          items: [{ key: 'open', title: 'Open' }],
          onSelected: key => Message.Selected({ key }),
          preview: box([prop('testID', 'preview')], [text([], ['A bigger look'])]),
        },
        box([prop('testID', 'thumb')], [text([], ['Thumb'])]),
      ),
      menuButton<Message>({
        testID: 'own-trigger',
        items: [{ key: 'one', title: 'One' }],
        onSelected: key => Message.Selected({ key }),
        trigger: box([prop('testID', 'avatar')], [text([], ['JN'])]),
      }),
      expoUiHost({ match: 'both', colorScheme: 'dark' }, [prop('testID', 'door')], [
        swiftUi('GaugeView')([prop('value', 0.4)], []),
        compose('CheckboxView')([prop('value', true)], []),
      ]),
    ],
  )

const startSmall = async (platform: 'ios' | 'android', hasExpoUi: boolean) => {
  phone = prepare(platform, hasExpoUi ? expoWith() : null)
  running = Runtime.embed(
    Runtime.makeElement({
      Model,
      init: () => ({ model: { isOn: false, refused: 0, chosen: 'nothing' } }),
      update,
      view,
      container: phone.surface.container,
    }),
  )
  await settle()
  return phone.fabric
}

describe('a program that refuses a change', () => {
  it.each([
    ['ios', 'setValue'],
    ['android', 'setNativeValue'],
  ] as const)("puts React Native's switch back on %s, as its own wrapper does", async (platform, command) => {
    const fabric = await startSmall(platform, false)
    await send(fabric, byTestId(fabric, 'stubborn'), 'topChange', { value: true })
    expect(textOf(byTestId(fabric, 'refused'))).toBe('Refused 1, chosen nothing')
    expect(fabric.commands.filter(sent => sent.name === command).map(sent => sent.args)).toEqual([[false]])
  })

  it('leaves SwiftUI\'s toggle to the phone: it shows the prop, which never changed', async () => {
    const fabric = await startSmall('ios', true)
    const toggle = () => one(fabric, 'stubborn', `${UI}ToggleView`)
    await send(fabric, toggle(), 'topIsOnChange', { isOn: true })
    expect(textOf(byTestId(fabric, 'refused'))).toBe('Refused 1, chosen nothing')
    expect(toggle().props['isOn']).toBe(false)
  })
})

describe('disabled controls', () => {
  it('are disabled the way each phone reads it', async () => {
    const swift = await startSmall('ios', true)
    expect(one(swift, 'off-limits', `${UI}ToggleView`).props['modifiers']).toEqual([
      { $type: 'labelsHidden' },
      { $type: 'disabled', disabled: true },
    ])
    expect(one(swift, 'stepped', `${UI}SliderView`).props).toMatchObject({
      step: 10,
      modifiers: [{ $type: 'disabled', disabled: true }],
    })
    running?.dispose()
    const material = await startSmall('android', true)
    expect(one(material, 'off-limits', `${UI}SwitchView`).props['enabled']).toBe(false)
    // Compose counts the stops between the ends: 10, 20 ... 90.
    expect(one(material, 'stepped', `${UI}SliderView`).props).toMatchObject({ steps: 9, enabled: false })
    running?.dispose()
    const plain = await startSmall('ios', false)
    expect(byTestId(plain, 'off-limits').props).toMatchObject({ value: true, disabled: true })
    await press(plain, 'stepped-more')
    expect(textOf(byTestId(plain, 'refused'))).toBe('Refused 0, chosen nothing')
  })
})

describe('the rest of Expo UI', () => {
  it('shows a preview and a trigger of the app\'s own through SwiftUI', async () => {
    const fabric = await startSmall('ios', true)
    const menu = one(fabric, 'with-preview', `${UI}ContextMenu`)
    expect(menu.children.map(child => child.props['name'])).toEqual(['trigger', 'items', 'preview'])
    expect(byTestId(fabric, 'with-preview').props['matchContentsHorizontal']).toBe(true)
    expect(flatten([menu.children[2]!]).some(node => node.props['testID'] === 'preview')).toBe(true)
    // A menu with a view for its label is given no words.
    const own = one(fabric, 'own-trigger', `${UI}MenuView`)
    expect(own.props['label']).toBeUndefined()
    expect(own.children[0]!.props['name']).toBe('label')
    expect(flatten([own.children[0]!]).some(node => node.props['testID'] === 'avatar')).toBe(true)
    await send(fabric, own.children[1]!, 'topButtonPress')
    expect(textOf(byTestId(fabric, 'refused'))).toBe('Refused 0, chosen one')
  })

  it('presses a trigger of the app\'s own on the other routes', async () => {
    const fabric = await startSmall('android', true)
    expect(hasTestId(fabric, 'preview')).toBe(false)
    await press(fabric, 'avatar')
    expect(one(fabric, 'own-trigger', `${UI}DropdownMenuView`).props['expanded']).toBe(true)
  })

  it('opens any other view by its native name, on the phone that has it', async () => {
    const swift = await startSmall('ios', true)
    const door = byTestId(swift, 'door')
    expect(door.props).toMatchObject({ colorScheme: 'dark', matchContentsVertical: true })
    expect(door.children.map(child => child.viewName)).toEqual([`${UI}GaugeView`, 'View'])
    expect(door.children[0]!.props['value']).toBe(0.4)
    running?.dispose()
    const material = await startSmall('android', true)
    expect(byTestId(material, 'door').children.map(child => child.viewName)).toEqual([
      'View',
      `${UI}CheckboxView`,
    ])
  })
})
