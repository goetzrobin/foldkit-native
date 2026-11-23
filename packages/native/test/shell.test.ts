import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { nativeCrash, onPress, pressable, registerNavigation, testId, text, view as box } from '../src/index.js'
import { type Demo, type DemoEnv, startShowcase } from './demos/shell.js'
import { type Phone, allText, hasTestId, press, settle, startPhone } from './support/phone.js'

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({
  PressedExit: {},
  PressedBreak: {},
  CompletedExit: {},
})
type Message = typeof Message.Type

/** A demo with two buttons: one leaves, one crashes the program. */
const makeTiny = (container: HTMLElement, env: DemoEnv) => {
  const Exit = Command.define('Exit', {
    args: {},
    messages: [Message.CompletedExit],
    execute: () => Effect.sync(env.exit).pipe(Effect.as(Message.CompletedExit())),
  })
  const update = (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit({})] }),
      PressedBreak: () => {
        throw new Error('broken on purpose')
      },
      CompletedExit: () => ({ model }),
    })
  const init: Runtime.ElementInit<Model, Message> = () => ({ model: {} })
  const view = (): Html =>
    box(
      [testId('tiny')],
      [
        pressable([testId('exit'), onPress(Message.PressedExit())], [text([], ['Exit'])]),
        pressable([testId('break'), onPress(Message.PressedBreak())], [text([], ['Break'])]),
      ],
    )
  return Runtime.makeElement({ Model, init, update, view, container, crash: nativeCrash(env.crashed) })
}

const demos: ReadonlyArray<Demo> = [
  { id: 'tiny', title: 'Tiny', blurb: 'Two buttons', start: (container, env) => Runtime.embed(makeTiny(container, env)) },
  { id: 'other', title: 'Other', blurb: 'The same again', start: (container, env) => Runtime.embed(makeTiny(container, env)) },
]

describe('the showcase shell on the simulated phone', () => {
  let phone: Phone
  let showcase: { dispose: () => void }

  beforeEach(async () => {
    registerNavigation()
    phone = startPhone()
    showcase = startShowcase(phone.surface.container, { platform: 'ios', osVersion: 27 }, demos)
    await settle()
  })

  afterEach(async () => {
    showcase.dispose()
    await settle()
    phone.surface.dispose()
  })

  it('starts on the menu with a row per demo', () => {
    expect(hasTestId(phone.fabric, 'screen-menu')).toBe(true)
    expect(allText(phone.fabric)).toEqual(expect.arrayContaining(['Tiny', 'Two buttons', 'Other']))
  })

  it('opens a demo in place of the menu', async () => {
    await press(phone.fabric, 'open-tiny')
    expect(hasTestId(phone.fabric, 'tiny')).toBe(true)
    expect(hasTestId(phone.fabric, 'screen-menu')).toBe(false)
  })

  it('comes back to the menu when the demo exits', async () => {
    await press(phone.fabric, 'open-tiny')
    await press(phone.fabric, 'exit')
    expect(hasTestId(phone.fabric, 'screen-menu')).toBe(true)
    expect(hasTestId(phone.fabric, 'tiny')).toBe(false)
    expect(hasTestId(phone.fabric, 'last-error')).toBe(false)
  })

  it('comes back to the menu and says why when a demo crashes', async () => {
    await press(phone.fabric, 'open-tiny')
    await press(phone.fabric, 'break')
    expect(hasTestId(phone.fabric, 'screen-menu')).toBe(true)
    expect(allText(phone.fabric)).toContain('Tiny: broken on purpose')
  })

  it('can open another demo after a crash', async () => {
    await press(phone.fabric, 'open-tiny')
    await press(phone.fabric, 'break')
    await press(phone.fabric, 'open-other')
    expect(hasTestId(phone.fabric, 'tiny')).toBe(true)
  })
})
