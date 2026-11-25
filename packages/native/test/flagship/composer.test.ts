/**
 * Fold Chat's composer over the transcript, with the keyboard in its "inset"
 * way, on a simulated phone that plays the parts of a real iPhone the plain
 * fake leaves out (see `support/scrollPhone.ts`).
 *
 * What the phone test of 25 November 2026 found, and these tests hold:
 *
 * - The phone measures the composer before its safe area view has taken the
 *   home indicator's strip, so the composer's content seems to end at the
 *   bottom of the window. The strip arrives a moment later as the bar's own
 *   height, and nothing measured it again. The list was then told the
 *   composer covers 70 points, not 104, and the buttons under the last reply
 *   sat behind it; and the composer rose by the keyboard's whole height, not
 *   by the part above the strip, so it floated far above the keyboard.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 90000 })

import type { FakeFabricNode } from '@ng-native/testing/fake'

import { type ChatPhone, startChatPhone } from '../support/flagship.js'
import { makeNativeAnimated } from '../support/nativeAnimated.js'
import { byTestId, flatten, textOf } from '../support/phone.js'
import { type ScrollPhone, startScrollPhone } from '../support/scrollPhone.js'
import { DOCK_CONTENT_ID } from '../../src/foldkit/keyboard/dock.js'
import { configureKeyboardDock } from '../../src/keyboard/index.js'
import { listNumbers } from '../../src/list/index.js'

const RUNNING = 'How do I start running?'
/** An iPhone 17 Pro's window, as the owner's screenshots show it. */
const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
/** The composer's content: 8 above the pill, the pill, 8 under it. */
const COMPOSER = 70
const HOME_INDICATOR = 34
const KEYBOARD = 335
/** The transcript's height: from under the title bar to the bottom of the screen. */
const VIEWPORT = 758

let at: ChatPhone
let phone: ScrollPhone
let animated: ReturnType<typeof makeNativeAnimated>

afterEach(async () => {
  phone?.stop()
  await at.stop()
  configureKeyboardDock({ controller: 'detect', nativeAnimated: null })
})

const all = (): Array<FakeFabricNode> => flatten(at.phone.fabric.committed)
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
/** The view the phone moves with the keyboard: the composer and the strip under it. */
const bar = (): FakeFabricNode => parentOf(parentOf(dockContent()))
const controller = (): FakeFabricNode => {
  const found = all().find(node => node.viewName === 'KeyboardControllerView')
  if (found === undefined) throw new Error('No keyboard controller view')
  return found
}

const rowHeight = (row: FakeFabricNode): number | undefined => {
  const ids = flatten([row]).map(node => String(node.props['testID'] ?? ''))
  const id = ids.find(each => each.startsWith('row-'))
  if (id === undefined) return undefined
  if (/^row-c\d+$/.test(id)) return 64
  return 20 + 24 * Math.max(1, Math.ceil(textOf(row).length / 36))
}

/**
 * A new chat as the phone draws it. `measuredBottom` is where the phone
 * first says the composer's content ends, from the bottom of the window:
 * 0 on the owner's phone, whose safe area view had not yet padded the
 * composer when it was measured. The strip then arrives as the bar's height.
 */
const openChat = async (measuredBottom: number): Promise<void> => {
  animated = makeNativeAnimated()
  configureKeyboardDock({ controller: true, nativeAnimated: animated.native })
  at = await startChatPhone()
  const fabric = at.phone.fabric
  fabric.frames.set('View', WINDOW)
  fabric.frames.set(DOCK_CONTENT_ID, { x: 0, y: WINDOW.height - measuredBottom - COMPOSER, width: 402, height: COMPOSER })
  await at.tap('start-chat')
  await at.advance(100)
  phone = startScrollPhone(fabric, { listId: 'transcript', viewport: VIEWPORT, rowHeight, listTop: WINDOW.height - VIEWPORT })
  fabric.emit(dockContent(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER } })
  await at.advance(100)
  // The safe area view takes the home indicator's strip: the bar grows by it.
  fabric.emit(bar(), 'topLayout', { layout: { x: 0, y: 0, width: 402, height: COMPOSER + HOME_INDICATOR } })
  await at.advance(100)
}

const keyboardMoves = async (height: number): Promise<void> => {
  if (height > 0) at.device.keyboard.show(height)
  else at.device.keyboard.hide()
  await at.advance(50)
  at.phone.fabric.emit(controller(), 'topKeyboardMoveStart', { height })
  await at.advance(100)
  at.phone.fabric.emit(controller(), 'topKeyboardMoveEnd', { height })
  await at.advance(100)
}

describe('the composer covers what it really covers', () => {
  it.each([
    ['measured before the safe area is applied', 0],
    ['measured after', HOME_INDICATOR],
  ])('%s: the list makes room for the composer and the strip under it', async (_title, measuredBottom) => {
    await openChat(measuredBottom)
    await at.ask(RUNNING)
    await at.untilDone()
    const numbers = listNumbers('transcript')
    // From the bottom of the screen to the top of the composer's content.
    expect(numbers?.bar).toBe(COMPOSER + HOME_INDICATOR)
    expect(numbers?.inset).toBeGreaterThanOrEqual(COMPOSER + HOME_INDICATOR)
    // The last reply's buttons end above the composer: the end of the list is its top.
    expect(phone.furthest()).toBe(phone.phone.size + COMPOSER + HOME_INDICATOR - VIEWPORT)
  })

  it.each([
    ['measured before the safe area is applied', 0],
    ['measured after', HOME_INDICATOR],
  ])('%s: with the keyboard up the composer rests on it, and the list ends at its top', async (_title, measuredBottom) => {
    await openChat(measuredBottom)
    await at.ask(RUNNING)
    await at.untilDone()
    // The phone moves the composer up by the part of the keyboard above the strip,
    // so the bottom of its content meets the top of the keyboard: the pill is 8 above it.
    expect(animated.translateY(bar().reactTag, KEYBOARD)).toBe(-(KEYBOARD - HOME_INDICATOR))
    // Rising from the bottom, the keyboard first takes the strip; the composer waits for it.
    expect(animated.translateY(bar().reactTag, HOME_INDICATOR)).toBe(0)
    await keyboardMoves(KEYBOARD)
    // The keyboard and the composer on it, from the bottom of the screen.
    expect(listNumbers('transcript')?.inset).toBe(KEYBOARD + COMPOSER)
  })
})

/** The views from the round button up to the window, the button first. */
const ancestorsOf = (node: FakeFabricNode): Array<FakeFabricNode> => {
  const path: Array<FakeFabricNode> = [node]
  for (;;) {
    const parent = all().find(each => each.children.includes(path.at(-1) as FakeFabricNode))
    if (parent === undefined) return path
    path.push(parent)
  }
}

/** The props of the round button and every view around it inside the bar, as plain data. */
const buttonPlace = (): string =>
  JSON.stringify(
    ancestorsOf(byTestId(at.phone.fabric, 'scroll-to-end'))
      .slice(0, ancestorsOf(byTestId(at.phone.fabric, 'scroll-to-end')).indexOf(bar()))
      .map(node => ({ ...node.props, opacity: undefined, transform: undefined })),
  )

/** The round button is on screen and not on its way out (a leaving view takes no touches). */
const isButtonShown = (): boolean =>
  all()
    .filter(node => node.props['testID'] === 'scroll-to-end')
    .some(node => ancestorsOf(node).every(each => each.props['pointerEvents'] !== 'none'))

/** The list scrolled by a finger so its end is `under` points below the composer's top. */
const endUnderComposer = async (under: number): Promise<void> => {
  phone.drag(phone.furthest() - under)
  await at.advance(200)
  // The button's fade, which runs on the phone's own clock.
  await new Promise(resolve => setTimeout(resolve, 250))
}

describe('the round button to the end', () => {
  it('appears once the reply runs under the composer, not once it runs under the keyboard', async () => {
    await openChat(HOME_INDICATOR)
    await at.ask(RUNNING)
    await at.untilDone()
    await endUnderComposer(0)
    expect(isButtonShown()).toBe(false)
    // One line of the reply is under the composer: the button offers the way down.
    await endUnderComposer(30)
    expect(listNumbers('transcript')?.isAtEnd).toBe(false)
    expect(isButtonShown()).toBe(true)
    // A few points are not a line: the end is still in view.
    await endUnderComposer(4)
    expect(isButtonShown()).toBe(false)
    // The same with the keyboard up: the composer's top is the end, not the keyboard's.
    await keyboardMoves(KEYBOARD)
    await endUnderComposer(0)
    expect(isButtonShown()).toBe(false)
    await endUnderComposer(30)
    expect(isButtonShown()).toBe(true)
  })

  it('rides on the composer: the phone moves it with the keyboard, and nothing places it again', async () => {
    await openChat(HOME_INDICATOR)
    await at.ask(RUNNING)
    await at.untilDone()
    await endUnderComposer(100)
    expect(isButtonShown()).toBe(true)
    // Inside the bar the phone moves frame by frame, and the bar is all it moves.
    expect(flatten([bar()]).some(node => node.props['testID'] === 'scroll-to-end')).toBe(true)
    expect(animated.drivenViews()).toEqual([bar().reactTag])
    const before = buttonPlace()
    await keyboardMoves(KEYBOARD)
    expect(buttonPlace()).toBe(before)
    // A draft of several lines makes the composer taller: the button stays on its top, by layout.
    await at.type('draft', 'one line\nand another\nand a third')
    await at.advance(100)
    expect(buttonPlace()).toBe(before)
    await keyboardMoves(0)
    expect(buttonPlace()).toBe(before)
  })

  it('fades and grows in, and fades and shrinks out, briefly', async () => {
    await openChat(HOME_INDICATOR)
    await at.ask(RUNNING)
    await at.untilDone()
    await endUnderComposer(0)
    phone.drag(phone.furthest() - 100)
    await at.advance(20, 20)
    const node = (): FakeFabricNode => byTestId(at.phone.fabric, 'scroll-to-end-motion')
    const scale = (): number =>
      ((node().props['transform'] as Array<{ scale?: number }> | undefined)?.[0]?.scale ?? 1)
    expect(Number(node().props['opacity'])).toBeLessThan(1)
    expect(scale()).toBeLessThan(1)
    await new Promise(resolve => setTimeout(resolve, 400))
    await at.advance(20, 20)
    expect(node().props['opacity']).toBe(1)
    expect(scale()).toBe(1)
    // Back at the end: it eases out, takes no touch meanwhile, and is gone.
    phone.drag(phone.furthest())
    await at.advance(20, 20)
    expect(at.has('scroll-to-end-motion')).toBe(true)
    expect(node().props['pointerEvents']).toBe('none')
    expect(scale()).toBeLessThan(1)
    await new Promise(resolve => setTimeout(resolve, 400))
    await at.advance(20, 20)
    expect(at.has('scroll-to-end-motion')).toBe(false)
  })
})
