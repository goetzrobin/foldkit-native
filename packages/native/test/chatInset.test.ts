/**
 * The chat demos with the keyboard set to "inset", which they open with.
 *
 * The list keeps its full height. The composer lies over its bottom edge and
 * the phone moves it with the keyboard. The list's scroll view is given a
 * bottom inset, and is told where to scroll to once, as the keyboard starts
 * to move. The arithmetic is react-native-keyboard-controller's own, whose
 * test cases are in `kbcChatKeyboard.test.ts`. These tests check that the
 * list and the dock use it as that library's scroll view does.
 *
 * The pretend phone obeys every scroll command and reports nothing by
 * itself. Each test plays the phone's part: it lays the list and rows out,
 * reports the composer's height, and says where a scroll arrived. It cannot
 * show where anything ends up on screen.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { chatInsetAvailable } from '../src/chat/index.js'
import { Keyboard } from '../src/device/index.js'
import { type NativeSurface, createNativeSurface, registerNavigation } from '../src/index.js'
import { DOCK_CONTENT_ID } from '../src/host/keyboard/dock.js'
import { configureKeyboardDock, forceKeyboardDockFallback } from '../src/keyboard/index.js'
import { listNumbers } from '../src/list/index.js'
import { configureMotion, stopMotion } from '../src/motion/index.js'
import { LIST_ID as AI_LIST, makeDemo as makeAiChat } from './demos/aiChat.js'
import { makeDemo as makeChat } from './demos/chat.js'
import { makeNativeAnimated } from './support/nativeAnimated.js'
import { byTestId, flatten, hasTestId, press, settle, textOf } from './support/phone.js'

type DemoName = 'chat' | 'ai-chat'

/** An iPhone's window, and a composer whose content ends 34 points above its bottom. */
const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
const COMPOSER = 56
const HOME_INDICATOR = 34
const CONTENT = { x: 0, y: WINDOW.height - HOME_INDICATOR - COMPOSER, width: 402, height: COMPOSER }
/** The whole bar: the composer and the strip under it. */
const BAR = COMPOSER + HOME_INDICATOR
const KEYBOARD = 336
/** How far the keyboard rises above the bottom strip, which it covers anyway. */
const LIFT = KEYBOARD - HOME_INDICATOR

/** The list's height. It never changes in these tests. */
const VIEWPORT = 600
const ROW = 90
const ROWS: Record<DemoName, number> = { chat: 20, 'ai-chat': 8 }

let fabric: FakeFabric
let surface: NativeSurface
let handle: { dispose: () => void } | undefined
let animated: ReturnType<typeof makeNativeAnimated>
let keyboard: ReturnType<typeof Keyboard.makeTest>
let now = 0
let frames: Array<() => void> = []

/** Lets every eased movement run to its end. */
const finishFrames = (): void => {
  for (let count = 0; count < 100; count++) {
    now += 50
    const run = frames.shift()
    if (run === undefined) return
    run()
  }
}

const all = (): Array<FakeFabricNode> => flatten(fabric.committed)
const named = (viewName: string): Array<FakeFabricNode> =>
  all().filter(node => node.viewName === viewName)
const messages = (): FakeFabricNode => byTestId(fabric, 'messages')
const parentOf = (child: FakeFabricNode): FakeFabricNode => {
  const parent = all().find(node => node.children.includes(child))
  if (parent === undefined) throw new Error('That view has no parent')
  return parent
}
const dockContent = (): FakeFabricNode => {
  const found = all().find(node => node.props['nativeID'] === DOCK_CONTENT_ID)
  if (found === undefined) throw new Error('No dock on screen')
  return found
}
const bar = (): FakeFabricNode => parentOf(parentOf(dockContent()))

const start = async (
  demo: DemoName,
  options: Readonly<{ controller?: boolean; platform?: 'ios' | 'android' }> = {},
): Promise<void> => {
  const platform = options.platform ?? 'ios'
  registerNavigation()
  registerPlatformComponents(platform)
  animated = makeNativeAnimated()
  configureKeyboardDock({
    controller: options.controller ?? true,
    nativeAnimated: animated.native,
  })
  fabric = createFakeFabric()
  fabric.frames.set('View', WINDOW)
  fabric.frames.set(DOCK_CONTENT_ID, CONTENT)
  now = 1000
  frames = []
  surface = createNativeSurface(fabric, 1, { dev: false, now: () => now })
  configureMotion(surface, { requestFrame: run => frames.push(run) })
  keyboard = Keyboard.makeTest()
  const env = { device: { platform, osVersion: 26 }, exit: () => {} }
  handle = Runtime.embed(
    demo === 'chat'
      ? makeChat(surface.container, env, keyboard.layer, { replyDelayMs: 150, incomingDelayMs: 150 })
      : makeAiChat(surface.container, env, keyboard.layer, { thinkingMs: 100, wordMs: 4 }),
  )
  await settle()
}

afterEach(async () => {
  stopMotion(surface)
  handle?.dispose()
  handle = undefined
  await settle()
  surface.dispose()
  configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
  forceKeyboardDockFallback(false)
  registerPlatformComponents('ios')
})

const canvasOf = (): FakeFabricNode => {
  const canvas = messages().children.at(-1)?.children[0]
  if (canvas === undefined) throw new Error('The list has no canvas')
  return canvas
}

const layOutRows = async (heightOf: (wrapper: FakeFabricNode) => number = () => ROW) => {
  for (let round = 0; round < 3; round++) {
    for (const wrapper of canvasOf().children.slice(1)) {
      fabric.emit(wrapper, 'topLayout', {
        layout: { x: 0, y: 0, width: 320, height: heightOf(wrapper) },
      })
    }
    await settle()
  }
}

/** The phone says where the list is. Its height is always the same. */
const scrollTo = async (y: number): Promise<void> => {
  fabric.emit(messages(), 'topScroll', {
    contentOffset: { x: 0, y },
    layoutMeasurement: { width: 320, height: VIEWPORT },
    contentSize: { width: 320, height: Number(canvasOf().props['height']) },
  })
  await settle()
}

const scrolls = (): ReadonlyArray<ReadonlyArray<unknown>> =>
  fabric.commands.filter(command => command.name === 'scrollTo').map(command => command.args)

/** The phone does what it was last asked: it arrives there and says so. */
const arrive = async (): Promise<void> => {
  const last = scrolls().at(-1)
  if (last === undefined) throw new Error('The phone was not asked to scroll')
  await scrollTo(Number(last[1]))
  fabric.emit(messages(), 'topMomentumScrollEnd', {})
  await settle()
}

const status = (): string => textOf(byTestId(fabric, 'status'))
const inset = (): unknown => (messages().props['contentInset'] as { bottom?: number })?.bottom
const indicator = (): unknown =>
  (messages().props['scrollIndicatorInsets'] as { bottom?: number })?.bottom

/** Opens the list as a phone would: its height, its rows, the composer's height. */
const open = async (): Promise<void> => {
  fabric.emit(messages(), 'topLayout', { layout: { x: 0, y: 0, width: 320, height: VIEWPORT } })
  await settle()
  await layOutRows()
  fabric.emit(dockContent(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER } })
  await settle()
  await arrive()
}

const controller = (): FakeFabricNode => named('KeyboardControllerView')[0] as FakeFabricNode

/** The keyboard starts to move, as react-native-keyboard-controller's view reports it. */
const keyboardStarts = async (height: number): Promise<void> => {
  if (height > 0) keyboard.show(height)
  else keyboard.hide()
  await settle()
  fabric.emit(controller(), 'topKeyboardMoveStart', { height })
  await settle()
}
const keyboardEnds = async (height: number): Promise<void> => {
  fabric.emit(controller(), 'topKeyboardMoveEnd', { height })
  await settle()
}

/** Presses the "Lift" button until it shows this way. */
const chooseLift = async (lift: string): Promise<void> => {
  for (let presses = 0; presses < 4; presses++) {
    if (textOf(byTestId(fabric, 'lift')) === `Lift: ${lift}`) return
    await press(fabric, 'lift')
  }
  throw new Error(`No lift called ${lift}`)
}

const DEMOS: ReadonlyArray<readonly [string, DemoName]> = [
  ['the chat demo', 'chat'],
  ['the AI chat demo', 'ai-chat'],
]

describe.each(DEMOS)('%s, with the keyboard set to "inset"', (_title, demo) => {
  const rows = ROWS[demo] * ROW
  /** The end of the list with the composer over its bottom edge. */
  const END = rows + BAR - VIEWPORT

  it('opens in "inset", with the composer laid over a list that nothing moves or pads', async () => {
    await start(demo)
    expect(chatInsetAvailable()).toBe(true)
    expect(textOf(byTestId(fabric, 'dock-mode'))).toBe('Keyboard: inset')
    expect(textOf(byTestId(fabric, 'dock-note'))).toContain('The messages are not resized.')
    // The phone moves the bar, and only the bar.
    expect(animated.drivenViews()).toEqual([bar().reactTag])
    // By the keyboard's height less the strip under the composer, once that is measured.
    expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-LIFT)
    expect(named('KeyboardControllerView')).toHaveLength(1)
    // The composer is drawn after the list and pinned to the bottom, so it is on top of it.
    const inDock = flatten([byTestId(fabric, 'dock')]).map(node => node.props['testID'])
    expect(inDock).toContain('draft')
    expect(all().filter(node => node.props['paddingBottom'] !== undefined && node.props['paddingBottom'] !== 0)).toEqual([])
    expect(messages().props['keyboardDismissMode']).toBe('interactive')
  })

  it('makes room for the composer with the inset, and ends above it', async () => {
    await start(demo)
    await open()
    expect(inset()).toBe(BAR)
    expect(indicator()).toBe(BAR)
    // The rows are all the content. The room for the composer is not in it.
    expect(canvasOf().props['height']).toBe(rows)
    expect(scrolls().at(-1)).toEqual([0, END, false])
    expect(status()).toContain('At the end: yes.')
    expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-LIFT)
  })

  it('at its end, rises once as the keyboard starts and comes back once as it leaves', async () => {
    await start(demo)
    await open()
    const before = scrolls().length

    await keyboardStarts(KEYBOARD)
    // More room to scroll, at once. One glide. Nothing laid out again.
    expect(inset()).toBe(LIFT + BAR)
    expect(indicator()).toBe(LIFT + BAR)
    expect(scrolls().slice(before)).toEqual([[0, END + LIFT, true]])
    expect(canvasOf().props['height']).toBe(rows)
    await arrive()
    await keyboardEnds(KEYBOARD)
    expect(scrolls().length).toBe(before + 1)
    expect(status()).toContain('At the end: yes.')
    expect(hasTestId(fabric, 'scroll-to-end')).toBe(false)

    await keyboardStarts(0)
    expect(scrolls().slice(before + 1)).toEqual([[0, END, true]])
    // The room stays until the list is back inside the smaller range.
    expect(inset()).toBe(LIFT + BAR)
    await keyboardEnds(0)
    expect(inset()).toBe(LIFT + BAR)
    await arrive()
    expect(inset()).toBe(BAR)
    expect(indicator()).toBe(BAR)
    expect(scrolls().length).toBe(before + 2)
    expect(status()).toContain('At the end: yes.')
  })

  it('counts the inset when it says whether the list is at its end, and when it scrolls there', async () => {
    await start(demo)
    await open()
    // The last row is still half under the composer here.
    await scrollTo(END - BAR)
    expect(status()).toContain('At the end: no.')
    await press(fabric, 'scroll-to-end')
    expect(scrolls().at(-1)).toEqual([0, END, true])
    await arrive()
    expect(status()).toContain('At the end: yes.')

    await keyboardStarts(KEYBOARD)
    await arrive()
    await keyboardEnds(KEYBOARD)
    await scrollTo(END)
    expect(status()).toContain('At the end: no.')
    await press(fabric, 'scroll-to-end')
    expect(scrolls().at(-1)).toEqual([0, END + LIFT, true])
  })

  it('clamps a list left past its end when a finger drags the keyboard away', async () => {
    await start(demo)
    await open()
    await keyboardStarts(KEYBOARD)
    await arrive()
    await keyboardEnds(KEYBOARD)
    const before = scrolls().length

    fabric.emit(controller(), 'topKeyboardMoveInteractive', { height: 300 })
    fabric.emit(controller(), 'topKeyboardMoveInteractive', { height: 200 })
    await settle()
    await keyboardStarts(0)
    // The finger has the list. The keyboard leaving does not scroll it.
    expect(scrolls().length).toBe(before)
    await keyboardEnds(0)
    // Left beyond the end, it glides back, and only then is the room taken away.
    expect(scrolls().slice(before)).toEqual([[0, END, true]])
    expect(inset()).toBe(LIFT + BAR)
    await arrive()
    expect(inset()).toBe(BAR)
  })

  it('falls back to "following" on a phone without the native views, and says so', async () => {
    await start(demo, { controller: false })
    expect(chatInsetAvailable()).toBe(false)
    expect(textOf(byTestId(fabric, 'dock-mode'))).toBe('Keyboard: inset')
    expect(textOf(byTestId(fabric, 'dock-note'))).toBe(
      'Keyboard: "inset" is not possible here (react-native-keyboard-controller is not in ' +
        'this build), so the text field eases up to the keyboard.',
    )
    expect(named('KeyboardControllerView')).toHaveLength(0)
    expect(animated.drivenViews()).toEqual([])
    fabric.emit(messages(), 'topLayout', { layout: { x: 0, y: 0, width: 320, height: VIEWPORT } })
    await settle()
    await layOutRows()
    // No inset: the blank space and the end are worked out as they were before.
    expect(messages().props['contentInset']).toBeUndefined()
    expect(scrolls().at(-1)).toEqual([0, rows - VIEWPORT, false])
    keyboard.show(KEYBOARD)
    await settle()
    finishFrames()
    // The bar's seat takes the room, which makes the list shorter.
    const seat = parentOf(bar())
    expect(seat.props['paddingBottom']).toBe(LIFT)
  })

  it('falls back on Android, where the scroll view has no inset', async () => {
    await start(demo, { platform: 'android' })
    expect(chatInsetAvailable()).toBe(false)
    expect(textOf(byTestId(fabric, 'dock-note'))).toContain('native following is built for iOS only')
    expect(messages().props['contentInset']).toBeUndefined()
  })
})

describe('the chat demo, "inset": the messages always rise with the keyboard', () => {
  it('rises with the keyboard from the middle of the list too, and comes back', async () => {
    await start('chat')
    await open()
    await scrollTo(300)
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    expect(scrolls().slice(before)).toEqual([[0, 300 + LIFT, true]])
    await arrive()
    await keyboardEnds(KEYBOARD)
    await keyboardStarts(0)
    expect(scrolls().at(-1)).toEqual([0, 300, true])
  })

  it('lifts two messages that sit on top of the composer', async () => {
    await start('chat')
    await press(fabric, 'short-chat')
    fabric.emit(messages(), 'topLayout', { layout: { x: 0, y: 0, width: 320, height: VIEWPORT } })
    await settle()
    await layOutRows()
    fabric.emit(dockContent(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER } })
    await settle()
    // The rows' view is as tall as the list above the composer, rows at its bottom.
    expect(canvasOf().props['height']).toBe(VIEWPORT - BAR)
    expect(canvasOf().props['justifyContent']).toBe('flex-end')
    await keyboardStarts(KEYBOARD)
    expect(scrolls().at(-1)).toEqual([0, LIFT, true])
  })
})

describe('the AI chat demo, "inset": the ways of lifting', () => {
  const rows = ROWS['ai-chat'] * ROW
  const END = rows + BAR - VIEWPORT

  it('shows the way on a button that goes round all four', async () => {
    await start('ai-chat')
    const seen: Array<string> = []
    for (let presses = 0; presses < 4; presses++) {
      seen.push(textOf(byTestId(fabric, 'lift')))
      await press(fabric, 'lift')
    }
    expect(seen).toEqual(['Lift: whenAtEnd', 'Lift: persistent', 'Lift: always', 'Lift: never'])
    expect(textOf(byTestId(fabric, 'lift'))).toBe('Lift: whenAtEnd')
    expect(textOf(byTestId(fabric, 'dock-note'))).toContain('as ChatGPT')
  })

  it('"whenAtEnd": a reader higher up is left alone, and still gets the room', async () => {
    await start('ai-chat')
    await open()
    await scrollTo(0)
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    await keyboardEnds(KEYBOARD)
    expect(scrolls().length).toBe(before)
    expect(inset()).toBe(LIFT + BAR)
    await keyboardStarts(0)
    await keyboardEnds(0)
    expect(scrolls().length).toBe(before)
    expect(inset()).toBe(BAR)
  })

  it('"persistent": rises with the keyboard and stays up when it closes', async () => {
    await start('ai-chat')
    await open()
    await chooseLift('persistent')
    await scrollTo(0)
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    // The list is 210 points longer than the screen, and may now go 302 further.
    expect(scrolls().slice(before)).toEqual([[0, LIFT, true]])
    await arrive()
    await keyboardEnds(KEYBOARD)
    await keyboardStarts(0)
    await keyboardEnds(0)
    // Past the end without the keyboard, so it comes back as far as the end and no further.
    expect(scrolls().slice(before + 1)).toEqual([[0, END, true]])
  })

  it('"persistent": stays exactly where it is when that is still inside the list', async () => {
    await start('ai-chat')
    await open()
    await chooseLift('persistent')
    // 20 rows would be needed for this. Make the rows taller instead.
    await layOutRows(() => 200)
    await scrollTo(100)
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    expect(scrolls().slice(before)).toEqual([[0, 100 + LIFT, true]])
    await arrive()
    await keyboardEnds(KEYBOARD)
    await keyboardStarts(0)
    await keyboardEnds(0)
    expect(scrolls().length).toBe(before + 1)
  })

  it('"always": rises from anywhere and comes back', async () => {
    await start('ai-chat')
    await open()
    await chooseLift('always')
    await layOutRows(() => 200)
    await scrollTo(100)
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    await arrive()
    await keyboardEnds(KEYBOARD)
    await keyboardStarts(0)
    expect(scrolls().slice(before)).toEqual([
      [0, 100 + LIFT, true],
      [0, 100, true],
    ])
  })

  it('"never": the keyboard covers the messages, and the list only gets the room', async () => {
    await start('ai-chat')
    await open()
    await chooseLift('never')
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    await keyboardEnds(KEYBOARD)
    expect(scrolls().length).toBe(before)
    expect(inset()).toBe(LIFT + BAR)
  })
})

describe('the AI chat demo, "inset": a question at the top of the screen', () => {
  const heightOf =
    (answerHeight: number) =>
    (wrapper: FakeFabricNode): number => {
      const ids = flatten([wrapper]).map(node => node.props['testID'])
      if (ids.includes('message-8')) return 60
      if (ids.includes('message-9')) return answerHeight
      return ROW
    }
  const QUESTION_START = 8 * ROW
  const ANCHOR_GAP = 16
  /** Where the list is when the question is 16 points from the top. */
  const PINNED = QUESTION_START - ANCHOR_GAP
  /** The room under a 60 point question and a 50 point answer. */
  const BLANK = VIEWPORT - ANCHOR_GAP - 60 - 50

  const waitForAnswer = async (): Promise<void> => {
    const deadline = Date.now() + 12000
    while (!status().startsWith('No answer') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await settle()
  }

  /** Asks the sample question and waits for the whole answer. */
  const ask = async (answerHeight = 50): Promise<void> => {
    await open()
    await press(fabric, 'sample')
    await layOutRows(heightOf(50))
    expect(scrolls().at(-1)).toEqual([0, PINNED, true])
    await arrive()
    await waitForAnswer()
    await layOutRows(heightOf(answerHeight))
  }

  it('keeps the blank space in the inset, not in the content', async () => {
    await start('ai-chat')
    await ask()
    expect(canvasOf().props['height']).toBe(QUESTION_START + 60 + 50)
    expect(inset()).toBe(BLANK)
    // The scroll bar stops at the composer. The blank space is not in its way.
    expect(indicator()).toBe(BAR)
    expect(status()).toContain('At the end: yes.')
    expect(listNumbers(AI_LIST)).toMatchObject({
      viewport: VIEWPORT,
      rows: QUESTION_START + 110,
      blankSpace: BLANK,
      inset: BLANK,
      bar: BAR,
      offset: PINNED,
      furthest: PINNED,
    })
  }, 30000)

  it('does not move the question when the keyboard opens, closes or is dragged', async () => {
    await start('ai-chat')
    await ask()
    const before = scrolls().length
    const sameAsBefore = (): void => {
      expect(scrolls().length).toBe(before)
      expect(inset()).toBe(BLANK)
      expect(canvasOf().props['height']).toBe(QUESTION_START + 110)
      expect(listNumbers(AI_LIST)?.offset).toBe(PINNED)
    }
    // The blank space (474) is larger than the keyboard and composer (392): it takes them in.
    await keyboardStarts(KEYBOARD)
    sameAsBefore()
    expect(indicator()).toBe(LIFT + BAR)
    await keyboardEnds(KEYBOARD)
    sameAsBefore()
    await keyboardStarts(0)
    await keyboardEnds(0)
    sameAsBefore()
    await keyboardStarts(KEYBOARD)
    await keyboardEnds(KEYBOARD)
    fabric.emit(controller(), 'topKeyboardMoveInteractive', { height: 200 })
    await keyboardStarts(0)
    await keyboardEnds(0)
    sameAsBefore()
    expect(status()).toContain('At the end: yes.')
  }, 30000)

  it('does not move the question in any of the four ways of lifting', async () => {
    await start('ai-chat')
    await ask()
    for (const lift of ['persistent', 'always', 'never', 'whenAtEnd']) {
      await chooseLift(lift)
      const before = scrolls().length
      await keyboardStarts(KEYBOARD)
      await keyboardEnds(KEYBOARD)
      await keyboardStarts(0)
      await keyboardEnds(0)
      expect([lift, scrolls().length]).toEqual([lift, before])
      expect(inset()).toBe(BLANK)
    }
  }, 30000)

  it('rises only by what the blank space cannot take in, once the answer has grown', async () => {
    await start('ai-chat')
    await ask(250)
    const blank = VIEWPORT - ANCHOR_GAP - 60 - 250
    expect(inset()).toBe(blank)
    expect(listNumbers(AI_LIST)?.offset).toBe(PINNED)
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    // 392 are needed and 274 are blank already: the list rises by the other 118.
    expect(inset()).toBe(LIFT + BAR)
    expect(scrolls().slice(before)).toEqual([[0, PINNED + LIFT + BAR - blank, true]])
    await arrive()
    await keyboardEnds(KEYBOARD)
    await keyboardStarts(0)
    expect(scrolls().at(-1)).toEqual([0, PINNED, true])
    await arrive()
    await keyboardEnds(0)
    expect(inset()).toBe(blank)
  }, 30000)

  it('keeps the question still while the answer grows: what the rows gain the inset loses', async () => {
    await start('ai-chat')
    await ask()
    const before = scrolls().length
    for (const answer of [120, 300, 500]) {
      await layOutRows(heightOf(answer))
      expect(canvasOf().props['height']).toBe(QUESTION_START + 60 + answer)
      expect(inset()).toBe(Math.max(BAR, VIEWPORT - ANCHOR_GAP - 60 - answer))
      expect(scrolls().length).toBe(before)
    }
    // Taller than the room: it runs on under the composer, and the round button appears.
    await layOutRows(heightOf(1200))
    expect(inset()).toBe(BAR)
    expect(scrolls().length).toBe(before)
    expect(status()).toContain('At the end: no.')
    expect(hasTestId(fabric, 'scroll-to-end')).toBe(true)
  }, 30000)

  it('sends a question typed with the keyboard up to the top, and leaves it there as the keyboard goes', async () => {
    await start('ai-chat')
    await open()
    await keyboardStarts(KEYBOARD)
    await arrive()
    await keyboardEnds(KEYBOARD)
    fabric.emit(byTestId(fabric, 'draft'), 'topChange', { text: 'Why?', eventCount: 1 })
    await settle()
    await press(fabric, 'send')
    // Sending puts the keyboard away. The phone reports it going down.
    await keyboardStarts(0)
    await layOutRows(heightOf(50))
    expect(scrolls().at(-1)).toEqual([0, PINNED, true])
    await arrive()
    await keyboardEnds(0)
    await waitForAnswer()
    await layOutRows(heightOf(50))
    expect(inset()).toBe(BLANK)
    expect(listNumbers(AI_LIST)?.offset).toBe(PINNED)
    // Opening the keyboard again and closing it does not take the question down.
    const before = scrolls().length
    await keyboardStarts(KEYBOARD)
    await keyboardEnds(KEYBOARD)
    await keyboardStarts(0)
    await keyboardEnds(0)
    expect(scrolls().length).toBe(before)
  }, 30000)

  it('does not start a glide over while it is on its way, and finishes one the phone never reports', async () => {
    await start('ai-chat')
    await open()
    await press(fabric, 'sample')
    await layOutRows(heightOf(50))
    const sent = scrolls().length
    expect(scrolls().at(-1)).toEqual([0, PINNED, true])
    // Halfway there, the rows are measured again and the keyboard moves.
    await scrollTo(PINNED - 200)
    await layOutRows(heightOf(50))
    await keyboardStarts(KEYBOARD)
    await keyboardEnds(KEYBOARD)
    // No second glide: that would start the first one over.
    expect(scrolls().slice(sent).filter(args => args[2] === true)).toEqual([])
    // The phone never says it arrived. The list is put there without a glide, once.
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(scrolls().slice(sent)).toEqual([[0, PINNED, false]])
    await scrollTo(PINNED)
    expect(listNumbers(AI_LIST)?.lastScroll).toMatchObject({ target: PINNED, arrived: true, sends: 2 })
  }, 30000)

  it('lays the list\'s own numbers over it when asked', async () => {
    await start('ai-chat')
    await open()
    expect(hasTestId(fabric, 'numbers')).toBe(false)
    await press(fabric, 'numbers-button')
    expect(textOf(byTestId(fabric, 'numbers-button'))).toBe('Hide numbers')
    const shown = (): string => textOf(byTestId(fabric, 'numbers'))
    const END = 8 * ROW + BAR - VIEWPORT
    expect(shown()).toBe(
      `list 600 rows 720 blank 0 inset ${BAR} keyboard 0 bar ${BAR}\n` +
        `at ${END} of ${END}, asked: ${END} at once, sent 1x, arrived, at end: yes`,
    )
    // A scroll that comes to rest brings them up to date with no Message.
    await scrollTo(40)
    fabric.emit(messages(), 'topScrollEndDrag', {})
    await settle()
    expect(shown()).toContain(`at 40 of ${END}`)
    expect(shown()).toContain('at end: no')
    await press(fabric, 'numbers-button')
    expect(hasTestId(fabric, 'numbers')).toBe(false)
  })
})
