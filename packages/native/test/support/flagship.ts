/**
 * A simulated phone with Fold Chat on it, for the tests in test/flagship.
 *
 * Everything real runs: the program, the pretend server, the in-process
 * cable with its NDJSON, the client. The phone's features are fakes a test
 * can read and drive (`device`), the action sheet answers with whatever
 * `sheet.answerWith` says, and Effect's `TestClock` decides when each token
 * of a reply is due.
 */
import { Clock, Effect, Exit, Layer, Scope } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { Runtime } from 'foldkit'

import { type AiServer, NO_CHAOS, type Timing, makeAiServer, memoryDisk } from '../../src/aiChat/index.js'
import * as Device from '../../src/device/index.js'
import { registerNavigation } from '../../src/index.js'
import { ActionSheet } from '../../src/menus/index.js'
import { registerSearchBar } from '../../src/navigation/searchBar.js'
import { makeChatApp } from '../../flagship/app.js'
import { appearanceTest } from '../../flagship/appearance.js'
import { type Phone, byTestId, flatten, hasTestId, press, startPhone, textOf } from './phone.js'

export const TIMING: Timing = {
  firstTokenMs: 300,
  tokensPerSecond: 100,
  jitter: 0,
  pauseChance: 0,
  pauseMs: 0,
  toolMs: 500,
  latencyMs: 100,
}

/** Tuesday 24 November 2026, half past two in the afternoon, local time. */
export const NOW = new Date(2026, 10, 24, 14, 30).getTime()

/** A short real wait, for Foldkit and the fibers to run what is due. */
export const breathe = (ms = 4) => new Promise(resolve => setTimeout(resolve, ms))

export type ChatPhone = Awaited<ReturnType<typeof startChatPhone>>

export const startChatPhone = async (
  options: Readonly<{
    platform?: 'ios' | 'android'
    disk?: ReturnType<typeof memoryDisk>
    timing?: Timing
    device?: ReturnType<typeof Device.makeTest>
    now?: number
  }> = {},
) => {
  registerNavigation()
  registerSearchBar()
  const platform = options.platform ?? 'ios'
  const phone: Phone = startPhone(platform)
  const device = options.device ?? Device.makeTest()
  const sheet = ActionSheet.makeTest()
  const appearance = appearanceTest({ onSet: scheme => device.colorScheme.set(scheme) })
  const disk = options.disk ?? memoryDisk()
  const clockScope = Effect.runSync(Scope.make())
  const clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(clockScope)))
  const server: AiServer = makeAiServer({ disk: disk.disk, timing: options.timing ?? TIMING, chaos: NO_CHAOS })
  const app = makeChatApp(
    phone.surface.container,
    { device: { platform, osVersion: platform === 'ios' ? 26 : 35 } },
    Layer.mergeAll(device.layer, sheet.layer, appearance.layer),
    { server, extra: Layer.succeed(Clock.Clock, clock), now: () => options.now ?? NOW },
  )
  const handle = Runtime.embed(app.program)

  /** Moves the test clock on in small steps, letting the program run between them. */
  const advance = async (ms: number, step = 50): Promise<void> => {
    for (let passed = 0; passed < ms; passed += step) {
      await Effect.runPromise(clock.adjust(Math.min(step, ms - passed)))
      await breathe()
    }
    await breathe(30)
  }

  const has = (id: string): boolean => hasTestId(phone.fabric, id)
  /** What a text field holds, as the phone was last told. */
  const fieldText = (id: string): string => String(byTestId(phone.fabric, id).props['text'] ?? '')
  const shown = (id: string): string => textOf(byTestId(phone.fabric, id))
  const tap = async (id: string): Promise<void> => {
    await press(phone.fabric, id)
    await breathe(20)
  }
  const type = async (id: string, value: string): Promise<void> => {
    phone.fabric.emit(byTestId(phone.fabric, id), 'topChange', { text: value, eventCount: 1 })
    await breathe(40)
  }
  /** The screens on the stack, bottom first, by testID. */
  const screens = (): ReadonlyArray<string> =>
    byTestId(phone.fabric, 'app-stack').children.map(child => String(child.props['testID'] ?? child.viewName))
  /** Every row of the transcript now drawn, as `key: words`. */
  const transcriptRows = (): ReadonlyArray<string> =>
    has('transcript')
      ? flatten([byTestId(phone.fabric, 'transcript')])
          .filter(node => /^row-/.test(String(node.props['testID'] ?? '')))
          .map(node => `${String(node.props['testID']).slice(4)}: ${textOf(node)}`)
      : []
  /** Runs time in small steps until `isTrue` holds, for `limitMs` of clock time at most. */
  const until = async (isTrue: () => boolean, limitMs = 10000): Promise<void> => {
    for (let passed = 0; passed < limitMs && !isTrue(); passed += 50) await advance(50, 50)
  }
  /** Runs time until no reply is being written. */
  const untilDone = async (limitMs = 30000): Promise<void> => {
    await advance(800)
    for (let passed = 0; passed < limitMs; passed += 500) {
      if (!has('stop')) break
      await advance(500)
    }
    await advance(400)
  }
  const stop = async (): Promise<void> => {
    handle.dispose()
    await breathe(50)
    await Effect.runPromise(Scope.close(clockScope, Exit.void))
  }
  /**
   * Presses one of the bar's own buttons. On iOS the bar draws them itself and
   * reports a press by the button's id; on Android they are views.
   */
  const pressBar = async (bar: 'bar-chats' | 'bar-chat', id: string): Promise<void> => {
    if (platform === 'android') {
      await tap(`bar-${id}`)
      return
    }
    phone.fabric.emit(byTestId(phone.fabric, bar), 'topPressHeaderBarButtonItem', { buttonId: id })
    await breathe(30)
  }
  /** Sends a question from the composer of the open chat. */
  const ask = async (question: string): Promise<void> => {
    await type('draft', question)
    await tap('send')
  }

  await advance(300)
  return { phone, device, sheet, appearance, disk, server, app, advance, has, fieldText, shown, tap, type, screens, transcriptRows, until, untilDone, stop, ask, pressBar }
}
