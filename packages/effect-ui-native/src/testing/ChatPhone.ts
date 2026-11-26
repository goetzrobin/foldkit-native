/**
 * The parts of a real iPhone a chat screen needs and the plain simulated
 * phone leaves out, for one chat on screen:
 *
 * - A scroll view that keeps its own position, puts itself back inside its
 *   range, glides, marks the scrolls no finger made
 *   (`responderIgnoreScroll`), and rows the phone lays out and measures.
 *   This is `packages/native/test/support/scrollPhone.ts`, the same file
 *   Fold Chat's tests use.
 * - A keyboard that tells react-native-keyboard-controller's native view
 *   where it is going and where it stopped, and a stand-in for React
 *   Native's animation module that says how far the phone would move the
 *   bar for a keyboard height.
 * - The composer's bar as the phone measures it: its content first, and the
 *   home indicator's strip a moment later.
 *
 *   const phone = yield* ChatPhone.start(app, { listId: 'transcript', rowHeight })
 *   yield* phone.keyboardMoves(335)
 *   expect(phone.barLift(335)).toBe(301)
 */
import type { FakeFabricNode } from '@ng-native/testing/fake'
import * as Effect from 'effect/Effect'

import { makeNativeAnimated } from '../../../native/test/support/nativeAnimated.js'
import { type ScrollPhone, type ScrollPhoneOptions, startScrollPhone } from '../../../native/test/support/scrollPhone.js'
import * as KeyboardBar from '../KeyboardBar.js'
import { type MountedApp, flatten } from './NativeTest.js'

export { makeNativeAnimated, startScrollPhone }
export type { ScrollPhone }

/** An iPhone 17 Pro, in points. */
export const WINDOW = { x: 0, y: 0, width: 402, height: 874 }
/** The home indicator's strip at the bottom of the screen. */
export const HOME_INDICATOR = 34
export const KEYBOARD = 335
/** The list: from under the title bar to the bottom of the screen. */
export const VIEWPORT = 758
export const LIST_TOP = WINDOW.height - VIEWPORT

/**
 * Says the build has react-native-keyboard-controller and the animation
 * module, so the bar is moved by the phone. Call before the app is mounted,
 * and `reset` after the test.
 */
export const usePhoneKeyboard = (): ReturnType<typeof makeNativeAnimated> => {
  const animated = makeNativeAnimated()
  KeyboardBar.configure({ controller: true, nativeAnimated: animated.native })
  return animated
}

export const reset = (): void => KeyboardBar.configure({ controller: 'detect', nativeAnimated: null })

export type StartOptions = Omit<ScrollPhoneOptions, 'viewport' | 'listTop'> &
  Readonly<{
    /** From `usePhoneKeyboard`. */
    animated: ReturnType<typeof makeNativeAnimated>
    /** How tall the composer's own content is. */
    composer: number
    /**
     * Where the phone first says the composer's content ends, from the bottom
     * of the window. 0 is a phone that measured before its safe area view had
     * padded the bar. Default: the home indicator's strip.
     */
    measuredBottom?: number
    viewport?: number
    /** Called with the scroll view's part as soon as it runs, before the bar is measured. */
    onScroll?: (scroll: ScrollPhone) => void
  }>

/** Starts the phone's part for the chat now on screen. */
export const start = <Model, Msg>(app: MountedApp<Model, Msg>, options: StartOptions) =>
  Effect.gen(function* () {
    const fabric = app.fabric
    const { animated, composer, measuredBottom = HOME_INDICATOR, viewport = VIEWPORT, onScroll, ...scrollOptions } = options
    const all = (): Array<FakeFabricNode> => flatten(fabric.committed)
    const parentOf = (child: FakeFabricNode): FakeFabricNode => {
      const parent = all().find(node => node.children.includes(child))
      if (parent === undefined) throw new Error('That view has no parent')
      return parent
    }
    const barContent = (): FakeFabricNode => {
      const found = all().find(node => node.props['nativeID'] === KeyboardBar.CONTENT_ID)
      if (found === undefined) throw new Error('No keyboard bar on screen')
      return found
    }
    /** The view the phone moves with the keyboard: the composer and the strip under it. */
    const bar = (): FakeFabricNode => parentOf(parentOf(barContent()))
    const controller = (): FakeFabricNode => {
      const found = all().find(node => node.viewName === 'KeyboardControllerView')
      if (found === undefined) throw new Error('No keyboard controller view: the phone does not move the bar')
      return found
    }

    fabric.frames.set('View', WINDOW)
    fabric.frames.set(KeyboardBar.CONTENT_ID, {
      x: 0,
      y: WINDOW.height - measuredBottom - composer,
      width: WINDOW.width,
      height: composer,
    })
    const scroll = startScrollPhone(fabric, { ...scrollOptions, viewport, listTop: WINDOW.height - viewport })
    onScroll?.(scroll)
    fabric.emit(barContent(), 'topLayout', { layout: { x: 0, y: 0, width: WINDOW.width, height: composer } })
    yield* app.wait(20)
    // The safe area view takes the home indicator's strip: the bar grows by it.
    fabric.emit(bar(), 'topLayout', { layout: { x: 0, y: 0, width: WINDOW.width, height: composer + HOME_INDICATOR } })
    yield* app.wait(20)

    const keyboardStarts = (height: number): void => fabric.emit(controller(), 'topKeyboardMoveStart', { height })
    const keyboardEnds = (height: number): void => fabric.emit(controller(), 'topKeyboardMoveEnd', { height })

    return {
      scroll,
      bar,
      barContent,
      controller,
      keyboardStarts,
      keyboardEnds,
      /** The keyboard goes to `height` and stops there. */
      keyboardMoves: (height: number) =>
        Effect.gen(function* () {
          keyboardStarts(height)
          yield* app.wait(60)
          keyboardEnds(height)
          yield* app.wait(60)
        }),
      /** How far up the phone moves the bar with the keyboard at `height`. */
      barLift: (height: number): number => -(animated.translateY(bar().reactTag, height) ?? 0) || 0,
      /** Whether `node` is inside the view the phone moves. */
      ridesOnBar: (node: FakeFabricNode): boolean => flatten([bar()]).includes(node),
      stop: (): void => scroll.stop(),
    }
  })

export type ChatPhone = Effect.Success<ReturnType<typeof start>>
