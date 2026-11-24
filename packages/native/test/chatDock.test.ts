/**
 * The two chat demos with each way of keeping the composer above the
 * keyboard:
 *
 * - "following" on a phone that moves the bar natively,
 * - "following" on a phone that cannot, where the bar eases to its place,
 * - "simple", the dock the chat demos started with.
 *
 * The list only hears of the keyboard by being told its new height. On a
 * real phone the layout does that, once the dock has padded something. Here
 * each test first checks that the dock asked for the padding, and then plays
 * the phone's part by telling the list it is that much shorter.
 *
 * The simulated phone cannot show where anything ends up on screen.
 */
import { registerPlatformComponents } from '@ng-native/fabric'
import { type FakeFabric, type FakeFabricNode, createFakeFabric } from '@ng-native/testing/fake'
import { Runtime } from 'foldkit'
import { afterEach, describe, expect, it } from 'vitest'

import { Keyboard } from '../src/device/index.js'
import { type NativeSurface, createNativeSurface, registerNavigation } from '../src/index.js'
import { DOCK_CONTENT_ID } from '../src/keyboard/dock.js'
import { configureKeyboardDock, forceKeyboardDockFallback, keyboardDockMode } from '../src/keyboard/index.js'
import { configureMotion, stopMotion } from '../src/motion/index.js'
import { makeDemo as makeAiChat } from './demos/aiChat.js'
import { makeDemo as makeChat } from './demos/chat.js'
import { makeNativeAnimated } from './support/nativeAnimated.js'
import { byTestId, flatten, hasTestId, press, settle, textOf } from './support/phone.js'

type Way = 'follow-native' | 'follow-fallback' | 'simple'
type DemoName = 'chat' | 'ai-chat'

/** An iPhone's window, and a bar whose content ends 34 points above its bottom. */
const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
const CONTENT = { x: 0, y: 784, width: 402, height: 56 }
const HOME_INDICATOR = 34
const KEYBOARD = 336
/** How much of the list's place the keyboard takes: its height less the strip it covers anyway. */
const COVERED = KEYBOARD - HOME_INDICATOR

const VIEWPORT = 600
const ROW = 90
/** How many messages each demo opens with. */
const ROWS: Record<DemoName, number> = { chat: 20, 'ai-chat': 8 }

let fabric: FakeFabric
let surface: NativeSurface
let handle: { dispose: () => void } | undefined
let animated: ReturnType<typeof makeNativeAnimated>
let keyboard: ReturnType<typeof Keyboard.makeTest>
let now = 0
let frames: Array<() => void> = []
let exits = 0

const frame = (ms: number): boolean => {
  now += ms
  const run = frames.shift()
  run?.()
  return run !== undefined
}
/** Lets every eased movement run to its end. */
const finishFrames = (): void => {
  for (let count = 0; count < 100 && frame(50); count++);
}

const all = (): Array<FakeFabricNode> => flatten(fabric.committed)
const named = (viewName: string): Array<FakeFabricNode> =>
  all().filter(node => node.viewName === viewName)
const parentOf = (child: FakeFabricNode): FakeFabricNode => {
  const parent = all().find(node => node.children.includes(child))
  if (parent === undefined) throw new Error('That view has no parent')
  return parent
}

/** The following dock's views, found from the bar's content outwards. */
const dockContent = (): FakeFabricNode => {
  const found = all().find(node => node.props['nativeID'] === DOCK_CONTENT_ID)
  if (found === undefined) throw new Error('No following dock on screen')
  return found
}
const hasFollowingDock = (): boolean =>
  all().some(node => node.props['nativeID'] === DOCK_CONTENT_ID)
const bar = (): FakeFabricNode => parentOf(parentOf(dockContent()))
const seat = (): FakeFabricNode => parentOf(bar())
/** The view the following dock moves and pads: around the box that holds the list. */
const lift = (): FakeFabricNode => parentOf(parentOf(byTestId(fabric, 'messages')))

/** The simple dock's views: the caller's, the keyboard padding, the safe area. */
const simpleParts = () => {
  const dock = byTestId(fabric, 'dock')
  const padding = dock.children[0]
  const safeArea = padding?.children[0]
  if (padding === undefined || safeArea === undefined) throw new Error('The dock is not built')
  return { dock, padding, safeArea }
}

const start = async (
  demo: DemoName,
  way: Way,
  platform: 'ios' | 'android' = 'ios',
): Promise<void> => {
  exits = 0
  now = 1000
  frames = []
  registerNavigation()
  registerPlatformComponents(platform)
  animated = makeNativeAnimated()
  configureKeyboardDock({
    // "follow-native" is a build with react-native-keyboard-controller in it.
    controller: way !== 'follow-fallback',
    nativeAnimated: animated.native,
  })
  fabric = createFakeFabric()
  fabric.frames.set('View', WINDOW)
  fabric.frames.set(DOCK_CONTENT_ID, CONTENT)
  surface = createNativeSurface(fabric, 1, { dev: false, now: () => now })
  configureMotion(surface, { requestFrame: run => frames.push(run) })
  keyboard = Keyboard.makeTest()
  const env = {
    device: { platform, osVersion: 26 },
    exit: () => {
      exits += 1
    },
  }
  handle = Runtime.embed(
    demo === 'chat'
      ? makeChat(surface.container, env, keyboard.layer, { replyDelayMs: 150, incomingDelayMs: 150 })
      : makeAiChat(surface.container, env, keyboard.layer, { thinkingMs: 100, wordMs: 4 }),
  )
  await settle()
  finishFrames()
  // The demos open in "inset". The button goes on to "following", then "simple".
  for (let presses = way === 'simple' ? 2 : 1; presses > 0; presses--) {
    await press(fabric, 'dock-mode')
    finishFrames()
  }
}

const stop = async (): Promise<void> => {
  stopMotion(surface)
  handle?.dispose()
  handle = undefined
  await settle()
}

afterEach(async () => {
  await stop()
  surface.dispose()
  configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
  forceKeyboardDockFallback(false)
  registerPlatformComponents('ios')
})

const canvasOf = (): FakeFabricNode => {
  const canvas = byTestId(fabric, 'messages').children.at(-1)?.children[0]
  if (canvas === undefined) throw new Error('The list has no canvas')
  return canvas
}

/** The phone says every row is 90 points tall, or as tall as `heightOf` says. */
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

const layOutList = async (height: number): Promise<void> => {
  fabric.emit(byTestId(fabric, 'messages'), 'topLayout', {
    layout: { x: 0, y: 0, width: 320, height },
  })
  await settle()
}

const scrollTo = async (y: number, viewport = VIEWPORT): Promise<void> => {
  fabric.emit(byTestId(fabric, 'messages'), 'topScroll', {
    contentOffset: { x: 0, y },
    layoutMeasurement: { width: 320, height: viewport },
    contentSize: { width: 320, height: Number(canvasOf().props['height']) },
  })
  await settle()
}

const scrolls = (): ReadonlyArray<ReadonlyArray<unknown>> =>
  fabric.commands.filter(command => command.name === 'scrollTo').map(command => command.args)

const status = (): string => textOf(byTestId(fabric, 'status'))

/** Opens the list as a phone would: its height, then its rows' heights. */
const open = async (): Promise<void> => {
  await layOutList(VIEWPORT)
  await layOutRows()
}

/** How much shorter the dock has asked the phone to make the list. */
const askedToShorten = (way: Way): number => {
  if (way === 'follow-native') return Number(lift().props['paddingBottom'] ?? 0)
  if (way === 'follow-fallback') return Number(seat().props['paddingBottom'] ?? 0)
  // The simple dock pads by the whole keyboard and gives up the safe area's
  // strip in exchange, which is the same on the phone.
  const { padding, safeArea } = simpleParts()
  const isStripPadded = (safeArea.props['edges'] as { bottom: boolean }).bottom
  const padded = Number(padding.props['paddingBottom'] ?? 0)
  return padded === 0 ? 0 : padded - (isStripPadded ? 0 : HOME_INDICATOR)
}

/**
 * The keyboard, as each kind of phone reports it. Every phone tells the
 * program through `Phone.Keyboard`. One that follows natively also reports
 * through react-native-keyboard-controller's view, and that is the report
 * the following dock acts on.
 */
const moveKeyboard = async (way: Way, height: number): Promise<void> => {
  if (height > 0) keyboard.show(height)
  else keyboard.hide()
  await settle()
  if (way === 'follow-native') {
    const controller = named('KeyboardControllerView')[0] as FakeFabricNode
    fabric.emit(controller, 'topKeyboardMoveStart', { height })
    await settle()
    fabric.emit(controller, 'topKeyboardMoveEnd', { height })
    await settle()
  }
  finishFrames()
}

/** The keyboard opens, and the phone lays the list out again, shorter. */
const openKeyboard = async (way: Way): Promise<void> => {
  await moveKeyboard(way, KEYBOARD)
  expect(askedToShorten(way)).toBe(COVERED)
  await layOutList(VIEWPORT - COVERED)
}

const closeKeyboard = async (way: Way): Promise<void> => {
  await moveKeyboard(way, 0)
  expect(askedToShorten(way)).toBe(0)
  await layOutList(VIEWPORT)
}

const WAYS: ReadonlyArray<readonly [string, Way]> = [
  ['"following", on a phone that moves the bar natively', 'follow-native'],
  ['"following", on a phone that cannot', 'follow-fallback'],
  ['"simple"', 'simple'],
]
const DEMOS: ReadonlyArray<readonly [string, DemoName]> = [
  ['the chat demo', 'chat'],
  ['the AI chat demo', 'ai-chat'],
]

describe.each(DEMOS)('%s', (_demoTitle, demo) => {
  const endOf = (viewport: number): number => ROWS[demo] * ROW - viewport

  describe.each(WAYS)('with the keyboard set to %s', (_wayTitle, way) => {
    it('draws the list, the field, the Send button and the right dock', async () => {
      await start(demo, way)
      expect(hasTestId(fabric, 'messages')).toBe(true)
      expect(hasTestId(fabric, 'draft')).toBe(true)
      expect(hasTestId(fabric, 'send')).toBe(true)
      expect(hasTestId(fabric, `message-${ROWS[demo] - 1}`)).toBe(true)
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        way === 'simple' ? 'Keyboard: simple' : 'Keyboard: following',
      )
      expect(hasFollowingDock()).toBe(way !== 'simple')
      expect(named('KeyboardControllerView')).toHaveLength(way === 'follow-native' ? 1 : 0)
      expect(named('KeyboardGestureArea')).toHaveLength(way === 'follow-native' ? 1 : 0)
      // The phone is asked to move the bar and the list, or nothing at all.
      expect(animated.drivenViews().length).toBe(way === 'follow-native' ? 2 : 0)
      // The field and the button are inside the dock in every mode.
      const inDock = flatten([byTestId(fabric, 'dock')]).map(node => node.props['testID'])
      expect(inDock).toContain('draft')
      expect(inDock).toContain('send')
    })

    it('says on screen what the text field should do', async () => {
      await start(demo, way)
      expect(textOf(byTestId(fabric, 'dock-note'))).toBe(
        {
          'follow-native':
            'Keyboard: the text field and the messages should travel up with the keyboard.',
          'follow-fallback':
            'Keyboard: the text field eases up to the keyboard ' +
            '(react-native-keyboard-controller is not in this build).',
          simple: 'Keyboard: the text field jumps to its place above the keyboard.',
        }[way],
      )
    })

    it('opens at the last message', async () => {
      await start(demo, way)
      await open()
      expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT), false])
      expect(canvasOf().props['opacity']).toBe(1)
      expect(status()).toContain('At the end: yes.')
    })

    it('still ends at the last message once the keyboard is up, and again once it is down', async () => {
      await start(demo, way)
      await open()
      await scrollTo(endOf(VIEWPORT))

      await openKeyboard(way)
      expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT - COVERED), false])
      await scrollTo(endOf(VIEWPORT - COVERED), VIEWPORT - COVERED)
      expect(status()).toContain('At the end: yes.')
      expect(hasTestId(fabric, 'scroll-to-end')).toBe(false)

      await closeKeyboard(way)
      expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT), false])
      expect(status()).toContain('At the end: yes.')
    })

    it('leaves a user who scrolled up where they are when the keyboard opens', async () => {
      await start(demo, way)
      await open()
      await scrollTo(endOf(VIEWPORT))
      await scrollTo(0)
      expect(status()).toContain('At the end: no.')
      await layOutRows()
      const before = scrolls().length
      await openKeyboard(way)
      expect(scrolls().length).toBe(before)
      expect(status()).toContain('At the end: no.')
    })

    it('pads one view for the keyboard, never two', async () => {
      await start(demo, way)
      await moveKeyboard(way, KEYBOARD)
      if (way === 'simple') {
        expect(simpleParts().padding.props['paddingBottom']).toBe(KEYBOARD)
        expect((simpleParts().safeArea.props['edges'] as { bottom: boolean }).bottom).toBe(false)
        return
      }
      const [liftPad, seatPad] = [
        Number(lift().props['paddingBottom'] ?? 0),
        Number(seat().props['paddingBottom'] ?? 0),
      ]
      // Natively the list's wrapper is padded and the phone moves the bar.
      // Otherwise the bar's seat is padded and takes the room from the list.
      expect([liftPad, seatPad]).toEqual(way === 'follow-native' ? [COVERED, 0] : [0, COVERED])
      if (way === 'follow-native') {
        expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-COVERED)
        // Padded and moved back by as much: unmoved with the keyboard up.
        expect(animated.translateY(lift().reactTag, KEYBOARD)).toBe(0)
        expect(parentOf(lift()).props['overflow']).toBe('hidden')
      }
    })

    it('lets a drag on the list put the keyboard away in the way this dock needs', async () => {
      await start(demo, way)
      expect(byTestId(fabric, 'messages').props['keyboardDismissMode']).toBe(
        way === 'follow-native' ? 'interactive' : 'on-drag',
      )
      // With the keyboard down a drag is only a drag.
      const before = keyboard.dismissCount()
      fabric.emit(byTestId(fabric, 'messages'), 'topScrollBeginDrag', {})
      await settle()
      expect(keyboard.dismissCount()).toBe(before)
      keyboard.show(KEYBOARD)
      await settle()
      fabric.emit(byTestId(fabric, 'messages'), 'topScrollBeginDrag', {})
      await settle()
      // Natively the keyboard follows the finger, so the program keeps out of it.
      expect(keyboard.dismissCount()).toBe(before + (way === 'follow-native' ? 0 : 1))
    })

    it('sends a message with the keyboard up and shows it', async () => {
      await start(demo, way)
      await open()
      await scrollTo(endOf(VIEWPORT))
      await openKeyboard(way)
      fabric.emit(byTestId(fabric, 'draft'), 'topChange', { text: 'Hello there', eventCount: 1 })
      await settle()
      await press(fabric, 'send')
      expect(textOf(byTestId(fabric, `message-${ROWS[demo]}`))).toContain('Hello there')
      expect(byTestId(fabric, 'draft').props['text']).toBe('')
      expect(status()).toContain('At the end: yes.')
    })

    it('goes to the next dock and round again with the button, keeping the messages', async () => {
      await start(demo, way)
      await open()
      // Scrolled up, so that the round button is showing.
      await scrollTo(endOf(VIEWPORT))
      await scrollTo(0)
      expect(hasTestId(fabric, 'scroll-to-end')).toBe(true)
      fabric.emit(byTestId(fabric, 'draft'), 'topChange', { text: 'Half typed', eventCount: 1 })
      await settle()

      const wasFollowing = way !== 'simple'
      const dismissed = keyboard.dismissCount()
      await press(fabric, 'dock-mode')
      finishFrames()
      // After "following" comes "simple", and after "simple" comes "inset".
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        wasFollowing ? 'Keyboard: simple' : 'Keyboard: inset',
      )
      expect(hasFollowingDock()).toBe(!wasFollowing)
      // The keyboard is put away, because the field is made again.
      expect(keyboard.dismissCount()).toBe(dismissed + 1)
      // Nothing the user had is lost.
      expect(hasTestId(fabric, `message-${ROWS[demo] - 1}`)).toBe(true)
      expect(byTestId(fabric, 'draft').props['text']).toBe('Half typed')
      // The list was made again and opens at its end.
      expect(status()).toContain('At the end: yes.')
      expect(hasTestId(fabric, 'scroll-to-end')).toBe(false)
      if (wasFollowing) {
        await open()
        expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT), false])
        expect(canvasOf().props['opacity']).toBe(1)
        // The simple dock does its own job when the keyboard comes.
        await scrollTo(endOf(VIEWPORT))
        await openKeyboard('simple')
        expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT - COVERED), false])
        await closeKeyboard('simple')
      }

      // Two more presses come round to where it started.
      await press(fabric, 'dock-mode')
      finishFrames()
      await press(fabric, 'dock-mode')
      finishFrames()
      expect(textOf(byTestId(fabric, 'dock-mode'))).toBe(
        wasFollowing ? 'Keyboard: following' : 'Keyboard: simple',
      )
      expect(hasFollowingDock()).toBe(wasFollowing)
      expect(animated.drivenViews().length).toBe(way === 'follow-native' ? 2 : 0)
      expect(named('KeyboardControllerView')).toHaveLength(way === 'follow-native' ? 1 : 0)
      expect(byTestId(fabric, 'draft').props['text']).toBe('Half typed')
      await open()
      await scrollTo(endOf(VIEWPORT))
      await openKeyboard(way)
      expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT - COVERED), false])
    })

    it('lets go of everything when the program stops', async () => {
      await start(demo, way)
      await open()
      await openKeyboard(way)
      expect(keyboard.listenerCount()).toBe(1)
      await stop()
      expect(animated.drivenViews()).toEqual([])
      expect(animated.events()).toEqual([])
      expect(keyboard.listenerCount()).toBe(0)
      // Only the surface's own empty view is left.
      expect(flatten(fabric.committed).map(node => node.children.length)).toEqual([0])
      // A keyboard that moves afterwards reaches nothing and breaks nothing.
      keyboard.show(KEYBOARD)
      await settle()
      expect(frames).toHaveLength(0)
    })

    it('leaves through the Exit button', async () => {
      await start(demo, way)
      await press(fabric, 'exit')
      expect(exits).toBe(1)
    })
  })

  it('goes to "following" with one press of the button', async () => {
    await start(demo, 'follow-fallback')
    expect(textOf(byTestId(fabric, 'dock-mode'))).toBe('Keyboard: following')
  })

  it('eases on Android even with the native views in the build, and still ends at the last message', async () => {
    await start(demo, 'follow-native', 'android')
    expect(keyboardDockMode()).toBe('fallback')
    expect(named('KeyboardControllerView')).toHaveLength(0)
    expect(textOf(byTestId(fabric, 'dock-note'))).toBe(
      'Keyboard: the text field eases up to the keyboard (native following is built for iOS only).',
    )
    expect(byTestId(fabric, 'messages').props['keyboardDismissMode']).toBe('on-drag')
    await open()
    await scrollTo(endOf(VIEWPORT))
    await openKeyboard('follow-fallback')
    expect(scrolls().at(-1)).toEqual([0, endOf(VIEWPORT - COVERED), false])
  })
})

describe('the AI chat demo, with a question at the top of the screen', () => {
  /** The question is 60 points tall and the answer 50, until told otherwise. */
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

  /** Asks the sample question and waits for the whole answer. */
  const ask = async (): Promise<void> => {
    await open()
    await scrollTo(8 * ROW - VIEWPORT)
    await press(fabric, 'sample')
    await layOutRows(heightOf(50))
    expect(scrolls().at(-1)).toEqual([0, QUESTION_START - ANCHOR_GAP, true])
    await scrollTo(QUESTION_START - ANCHOR_GAP)
    const deadline = Date.now() + 12000
    while (!status().startsWith('No answer') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await settle()
    await layOutRows(heightOf(50))
  }

  describe.each(WAYS)('with the keyboard set to %s', (_wayTitle, way) => {
    it('sizes the blank space from the shorter list, so the question stays at the top', async () => {
      await start('ai-chat', way)
      await ask()
      // The list is exactly long enough to put the question 16 points from the top.
      expect(canvasOf().props['height']).toBe(QUESTION_START - ANCHOR_GAP + VIEWPORT)
      const before = scrolls().length

      await openKeyboard(way)
      const shorter = VIEWPORT - COVERED
      expect(canvasOf().props['height']).toBe(QUESTION_START - ANCHOR_GAP + shorter)
      // Shorter list, less blank space, same end: the phone is not asked to scroll.
      expect(scrolls().length).toBe(before)
      expect(status()).toContain('At the end: yes.')

      await closeKeyboard(way)
      expect(canvasOf().props['height']).toBe(QUESTION_START - ANCHOR_GAP + VIEWPORT)
      expect(scrolls().length).toBe(before)
    }, 30000)

    it('sends a question typed with the keyboard up to the top of the full screen', async () => {
      await start('ai-chat', way)
      await open()
      await scrollTo(8 * ROW - VIEWPORT)
      await openKeyboard(way)
      await scrollTo(8 * ROW - (VIEWPORT - COVERED), VIEWPORT - COVERED)
      fabric.emit(byTestId(fabric, 'draft'), 'topChange', { text: 'Why?', eventCount: 1 })
      await settle()
      const dismissed = keyboard.dismissCount()
      await press(fabric, 'send')
      // Sending puts the keyboard away. The phone then reports it going down.
      expect(keyboard.dismissCount()).toBe(dismissed + 1)
      await closeKeyboard(way)
      await layOutRows(heightOf(50))
      expect(scrolls().at(-1)).toEqual([0, QUESTION_START - ANCHOR_GAP, true])
      expect(canvasOf().props['height']).toBe(QUESTION_START - ANCHOR_GAP + VIEWPORT)
    }, 30000)

    it('does not chase an answer that outgrows the screen', async () => {
      await start('ai-chat', way)
      await ask()
      const before = scrolls().length
      await layOutRows(heightOf(1200))
      expect(status()).toContain('At the end: no.')
      expect(scrolls().length).toBe(before)
      expect(hasTestId(fabric, 'scroll-to-end')).toBe(true)
    }, 30000)
  })
})
