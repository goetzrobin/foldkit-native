/**
 * After Send, the question goes to 16 points from the top of the list and
 * the reply grows into the blank space under it: randomised scenarios on a
 * simulated phone whose scroll view behaves as UIKit's does (see
 * `support/scrollPhone.ts`).
 *
 * Each scenario picks, from a seed: a short or a long history; whether the
 * reply before is finished or is stopped just before Send; the keyboard down,
 * up, or moving at Send (Send puts it away, sooner or later); the kind of
 * reply (plain, reasoning, a tool); a fast or a normal server; whether the
 * question row measures itself before or after the reply's first commit;
 * native Markdown measuring itself late, above the question or in the reply;
 * the list following its end at Send or scrolled up by a finger; glides that
 * arrive at once or take frames, and stopped glides that end late.
 *
 * In every scenario: the question ends 16 points from the list's top (within
 * half a point), stays there while the reply grows, and the blank space under
 * the reply shrinks by as much as the reply grows. Fold Chat has no Send on
 * the return key (the field takes new lines), so Send is the button.
 *
 * `PIN_SCENARIOS=200` runs more of them; `PIN_SEED=n` runs one.
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 180000 })

import { type ChatPhone, TIMING, startChatPhone } from '../support/flagship.js'
import { makeNativeAnimated } from '../support/nativeAnimated.js'
import { byTestId, flatten, textOf } from '../support/phone.js'
import { type ScrollPhone, startScrollPhone } from '../support/scrollPhone.js'
import { DOCK_CONTENT_ID } from '../../src/foldkit/keyboard/dock.js'
import { configureKeyboardDock } from '../../src/keyboard/index.js'
import { listNumbers } from '../../src/list/index.js'

const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
const COMPOSER = 70
const HOME_INDICATOR = 34
const KEYBOARD = 335
const VIEWPORT = 758
const LIST_TOP = WINDOW.height - VIEWPORT
const QUESTION = 64
const PIN = 16

const QUESTIONS = {
  plain: 'How do I start running?',
  reasoning: 'Should I take the train or drive to the coast? Think it through.',
  tool: 'What is the weather in Lisbon tomorrow?',
} as const
const HISTORY = ['How do I start running?', 'Write a debounce function in TypeScript.']

type Scenario = Readonly<{
  seed: number
  history: 'short' | 'long'
  previous: 'finished' | 'stopped just before'
  keyboard: 'down' | 'up' | 'moving at Send'
  /** With the keyboard up: how long after Send it starts to go down, in ms of clock; undefined keeps it up. */
  keyboardDownAfter: number | undefined
  reply: keyof typeof QUESTIONS
  isFast: boolean
  questionMeasuredLate: boolean
  lateMarkdown: 'none' | 'above the question' | 'in the reply'
  /** How much taller (or shorter) the late text view turns out, in points. */
  lateBy: number
  /** Early in the reply, or once the reply has run past the bottom of the list and the list is not at its end. */
  lateWhen: 'early' | 'after the reply runs off'
  isFollowing: boolean
  glideSteps: number
  lateEnds: boolean
}>

/** A small seeded random source (mulberry32), so a failing seed can be run again. */
const randomFrom = (seed: number) => {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <A,>(choices: ReadonlyArray<A>): A => choices[Math.floor(next() * choices.length)] as A
  return { next, pick }
}

export const scenarioOf = (seed: number): Scenario => {
  const { pick } = randomFrom(seed)
  const keyboard = pick(['down', 'up', 'moving at Send'] as const)
  return {
    seed,
    history: pick(['short', 'long'] as const),
    previous: pick(['finished', 'stopped just before'] as const),
    keyboard,
    keyboardDownAfter: keyboard === 'down' ? undefined : pick([undefined, 0, 150, 600]),
    reply: pick(['plain', 'reasoning', 'tool'] as const),
    isFast: pick([true, false]),
    questionMeasuredLate: pick([true, false]),
    lateMarkdown: pick(['none', 'above the question', 'in the reply'] as const),
    lateBy: pick([-1, 0.7, 1, 3, 17]),
    lateWhen: pick(['early', 'after the reply runs off'] as const),
    isFollowing: pick([true, false]),
    glideSteps: pick([0, 12]),
    lateEnds: pick([true, false]),
  }
}

let at: ChatPhone | undefined
let phone: ScrollPhone | undefined

afterEach(async () => {
  phone?.stop()
  await at?.stop()
  at = undefined
  phone = undefined
  configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
})

const all = (): Array<FakeFabricNode> => flatten((at as ChatPhone).phone.fabric.committed)
const parentOf = (child: FakeFabricNode): FakeFabricNode => {
  const parent = all().find(node => node.children.includes(child))
  if (parent === undefined) throw new Error('That view has no parent')
  return parent
}
const dockContent = (): FakeFabricNode => {
  const found = all().find(node => node.props['nativeID'] === DOCK_CONTENT_ID)
  if (found === undefined) throw new Error('No composer dock: the inset way is off')
  return found
}
const controller = (): FakeFabricNode => {
  const found = all().find(node => node.viewName === 'KeyboardControllerView')
  if (found === undefined) throw new Error('No keyboard controller view')
  return found
}

const rowIdOf = (row: FakeFabricNode): string | undefined =>
  flatten([row])
    .map(node => String(node.props['testID'] ?? ''))
    .find(each => each.startsWith('row-'))

const run = async (scenario: Scenario): Promise<void> => {
  const random = randomFrom(scenario.seed * 7919 + 1)
  /** Late growth of a row's text view, by the row's testID: native Markdown measuring itself again. */
  const late = new Map<string, number>()
  const rowHeight = (row: FakeFabricNode): number | undefined => {
    const id = rowIdOf(row)
    if (id === undefined) return undefined
    if (/^row-c\d+$/.test(id)) return QUESTION
    return 20 + 24 * Math.max(1, Math.ceil(textOf(row).length / 36)) + (late.get(id) ?? 0)
  }
  let lateQuestionKey: string | undefined
  let lateReplyId: string | undefined
  const measureDelay = (row: FakeFabricNode): number | undefined => {
    const id = rowIdOf(row)
    if (id !== undefined && id === lateQuestionKey) return 40
    if (id !== undefined && id === lateReplyId) return 25
    return undefined
  }

  configureKeyboardDock({ controller: true, nativeAnimated: makeNativeAnimated().native })
  const timing = scenario.isFast
    ? { ...TIMING, firstTokenMs: 20, latencyMs: 10, tokensPerSecond: 400, toolMs: 100 }
    : { ...TIMING, tokensPerSecond: 200 }
  const chat = await startChatPhone({ timing })
  at = chat
  const fabric = chat.phone.fabric
  fabric.frames.set('View', WINDOW)
  fabric.frames.set(DOCK_CONTENT_ID, { x: 0, y: WINDOW.height - HOME_INDICATOR - COMPOSER, width: 402, height: COMPOSER })
  await chat.tap('start-chat')
  await chat.advance(100)
  const scroll = startScrollPhone(fabric, {
    listId: 'transcript',
    viewport: VIEWPORT,
    rowHeight,
    measureDelay,
    listTop: LIST_TOP,
    glideSteps: scenario.glideSteps,
    lateEnds: scenario.lateEnds,
  })
  phone = scroll
  fabric.emit(dockContent(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER } })
  await chat.advance(100)
  fabric.emit(parentOf(parentOf(dockContent())), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER + HOME_INDICATOR } })
  await chat.advance(100)

  const keyboardStarts = (height: number): void => {
    if (height > 0) chat.device.keyboard.show(height)
    else chat.device.keyboard.hide()
    fabric.emit(controller(), 'topKeyboardMoveStart', { height })
  }
  const keyboardEnds = (height: number): void => {
    fabric.emit(controller(), 'topKeyboardMoveEnd', { height })
  }

  // The history.
  const count = scenario.history === 'short' ? 1 : 4
  for (let at = 0; at < count; at++) {
    await chat.ask(HISTORY[at % HISTORY.length] as string)
    await chat.untilDone()
  }
  // The reply before: finished, or still being written and stopped just before Send.
  if (scenario.previous === 'stopped just before') {
    await chat.ask(HISTORY[0] as string)
    await chat.until(() => /Starting to run/.test(chat.transcriptRows().at(-1) ?? ''))
    await chat.tap('stop')
    await chat.until(() => !chat.has('stop'), 3000)
  } else {
    await chat.advance(300)
  }
  const previousReplyId = `row-${chat.transcriptRows().at(-1)?.split(':')[0] ?? ''}`

  // Following the end, or scrolled up by a finger.
  if (!scenario.isFollowing && scroll.furthest() > 200) {
    scroll.drag(scroll.phone.offset - 150 - random.next() * 200)
    await new Promise(resolve => setTimeout(resolve, 120))
    await chat.advance(100)
  }

  // The keyboard.
  if (scenario.keyboard === 'up') {
    keyboardStarts(KEYBOARD)
    await chat.advance(100)
    keyboardEnds(KEYBOARD)
    await chat.advance(100)
  }
  if (scenario.keyboard === 'moving at Send') keyboardStarts(KEYBOARD)

  // Send.
  const before = new Set(chat.transcriptRows().map(row => row.split(':')[0]))
  await chat.type('draft', QUESTIONS[scenario.reply])
  const nextKey = `c${[...before].filter(key => /^c\d+$/.test(key ?? '')).length + 1}`
  if (scenario.questionMeasuredLate) lateQuestionKey = `row-${nextKey}`
  await chat.tap('send')
  const question = chat.transcriptRows().map(row => row.split(':')[0]).filter(key => /^c\d+$/.test(key ?? '') && !before.has(key)).at(-1)
  expect(question, 'the question is on screen at once').toBeDefined()
  const questionId = `row-${question}`
  if (scenario.keyboard === 'moving at Send') {
    await chat.advance(100)
    keyboardEnds(KEYBOARD)
  }
  // Send puts the keyboard away, sooner or later.
  if (scenario.keyboard !== 'down' && scenario.keyboardDownAfter !== undefined) {
    await chat.advance(scenario.keyboardDownAfter)
    keyboardStarts(0)
    await chat.advance(150)
    keyboardEnds(0)
  }

  // The reply's row.
  await chat.until(() => chat.transcriptRows().some(row => /^m\d+:/.test(row) && !before.has(row.split(':')[0])), 5000)
  const replyKey = chat.transcriptRows().map(row => row.split(':')[0]).filter(key => /^m\d+$/.test(key ?? '') && !before.has(key)).at(-1)
  const replyId = `row-${replyKey}`
  if (scenario.lateMarkdown === 'in the reply') lateReplyId = replyId

  const where = (): number => scroll.topOf(questionId) - LIST_TOP
  /** The question is held: 16 from the top, to the half point. */
  const expectPinned = (when: string): void => {
    expect(
      Math.abs(where() - PIN),
      `question at ${where()} ${when}; list ${JSON.stringify({ ...listNumbers('transcript'), phone: scroll.phone, scrolls: scroll.scrolls().slice(-6), rows: chat.transcriptRows().map(row => row.slice(0, 40)) })}`,
    ).toBeLessThanOrEqual(0.5)
  }

  await chat.advance(500)
  // A glide takes real frames on the simulated phone: let the one under way arrive.
  await new Promise(resolve => setTimeout(resolve, 400))
  await chat.advance(50)
  expectPinned('once the reply has started')

  // While the reply grows: the question stays, and the blank space takes the growth.
  let lateDone = false
  const samples: Array<{ top: number; blank: number; reply: number | undefined; isAtRest: boolean }> = []
  const isAtRest = (): boolean => listNumbers('transcript')?.lastScroll?.arrived !== false
  for (let step = 0; step < 400 && chat.has('stop'); step++) {
    await chat.advance(50)
    const isLateDue =
      scenario.lateWhen === 'early' ? step === 6 : listNumbers('transcript')?.isAtEnd === false && step > 6
    if (!lateDone && isLateDue && scenario.lateMarkdown !== 'none') {
      lateDone = true
      const id = scenario.lateMarkdown === 'above the question' ? previousReplyId : replyId
      late.set(id, scenario.lateBy)
      scroll.remeasure()
      await chat.advance(50)
    }
    samples.push({ top: where(), blank: listNumbers('transcript')?.blankSpace ?? -1, reply: scroll.heightOf(replyId), isAtRest: isAtRest() })
  }
  await chat.untilDone()
  if (!lateDone && scenario.lateMarkdown !== 'none') {
    const id = scenario.lateMarkdown === 'above the question' ? previousReplyId : replyId
    late.set(id, scenario.lateBy)
    scroll.remeasure()
  }
  await chat.advance(600)
  await new Promise(resolve => setTimeout(resolve, 400))
  await chat.advance(50)
  samples.push({ top: where(), blank: listNumbers('transcript')?.blankSpace ?? -1, reply: scroll.heightOf(replyId), isAtRest: isAtRest() })

  // A glide the list sent (a correction while the question rises) may be on
  // its way in a sample; everywhere the list is at rest, the question is in place.
  const worst = Math.max(...samples.filter(each => each.isAtRest).map(each => Math.abs(each.top - PIN)))
  expect(worst, `the question moved while the reply grew: ${JSON.stringify(samples.map(each => each.top))}`).toBeLessThanOrEqual(0.5)
  // The blank space is what the screen has left under the question and the reply.
  for (const each of samples) {
    if (each.reply === undefined) continue
    const wanted = Math.max(0, VIEWPORT - PIN - QUESTION - each.reply)
    expect(Math.abs(each.blank - wanted), `blank ${each.blank}, wanted ${wanted}`).toBeLessThanOrEqual(0.5)
  }
  // And it shrinks as the reply grows.
  for (let at = 1; at < samples.length; at++) {
    const [was, now] = [samples[at - 1], samples[at]] as const
    if (was?.reply === undefined || now?.reply === undefined || now.reply < was.reply) continue
    expect(now.blank, 'the blank space grew while the reply grew').toBeLessThanOrEqual(was.blank + 0.5)
  }
  expectPinned("after the reply")
  const drift = listNumbers('transcript')?.anchor?.drift
  expect(Math.abs(drift ?? 0), `drift ${drift}`).toBeLessThanOrEqual(0.5)
}

const only = process.env['PIN_SEED']
const seeds = only !== undefined ? [Number(only)] : Array.from({ length: Number(process.env['PIN_SCENARIOS'] ?? 10) }, (_, at) => at + 1)

describe('after Send, the question goes to the top and the reply flows in under it', () => {
  // The second screenshot of the third phone test: the keyboard up, the
  // question in place, and "drift -1.0". The reply above the question laid
  // itself out again a point shorter after the question was put in place;
  // the list kept the row at the top of the screen still, so the question
  // moved up by that point.
  it('a reply above the question that measures itself again a point shorter leaves the question where it is', async () => {
    await run({
      seed: 1000,
      history: 'long',
      previous: 'finished',
      keyboard: 'up',
      keyboardDownAfter: undefined,
      reply: 'plain',
      isFast: false,
      questionMeasuredLate: false,
      lateMarkdown: 'above the question',
      lateBy: -1,
      lateWhen: 'after the reply runs off',
      isFollowing: true,
      glideSteps: 12,
      lateEnds: false,
    })
  })

  it.each(seeds.map(seed => [seed, JSON.stringify(scenarioOf(seed))] as const))('seed %i: %s', async seed => {
    await run(scenarioOf(seed))
  })
})
