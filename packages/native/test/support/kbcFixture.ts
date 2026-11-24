/**
 * What react-native-keyboard-controller's own test cases need around them
 * (see scripts/port-kbc-specs.mjs). The library's tests render React hooks
 * with jest mocks. Ours make the plain object in
 * `src/chat/vendor/kbc/chatKeyboard.ts` and hand the cases the same names.
 */
import { vi } from 'vitest'

import {
  type Box,
  type ChatKeyboard,
  type ChatKeyboardEvent,
  createChatKeyboard,
} from '../../src/chat/vendor/kbc/chatKeyboard.js'
import type { KeyboardLiftBehavior } from '../../src/chat/vendor/kbc/types.js'

export type SharedValue<T> = Box<T>
export const sv = <T>(value: T): Box<T> => ({ value })

export const KEYBOARD = 300
export const mockOffset = { value: 0 }
export const mockLayout = { value: { width: 390, height: 800 } }
export const mockSize = { value: { width: 390, height: 2000 } }
export const mockScrollTo = vi.fn()

type Handlers = {
  onStart: (e: ChatKeyboardEvent) => void
  onMove: (e: ChatKeyboardEvent) => void
  onInteractive: (e: ChatKeyboardEvent) => void
  onEnd: (e: ChatKeyboardEvent) => void
}

/** The handlers of the keyboard made by the last `render`. */
export const handlers: Handlers = {
  onStart: () => {},
  onMove: () => {},
  onInteractive: () => {},
  onEnd: () => {},
}

export const setupBeforeEach = (): void => {
  mockOffset.value = 0
  mockLayout.value = { width: 390, height: 800 }
  mockSize.value = { width: 390, height: 2000 }
  mockScrollTo.mockClear()
}

type RenderOptions = {
  inverted: boolean
  keyboardLiftBehavior: KeyboardLiftBehavior
  freeze?: boolean | Box<boolean>
  offset?: number
  blankSpace?: Box<number>
  extraContentPadding?: Box<number>
  initialContentOffsetY?: number
}

export const render = (options: RenderOptions): { result: { current: ChatKeyboard } } => {
  const freeze = options.freeze ?? false
  const keyboard = createChatKeyboard({
    inverted: options.inverted,
    keyboardLiftBehavior: options.keyboardLiftBehavior,
    freeze: typeof freeze === 'boolean' ? sv(freeze) : freeze,
    offset: options.offset ?? 0,
    blankSpace: options.blankSpace ?? sv(0),
    extraContentPadding: options.extraContentPadding ?? sv(0),
    ...(options.initialContentOffsetY === undefined
      ? {}
      : { initialContentOffsetY: options.initialContentOffsetY }),
    scroll: mockOffset,
    layout: mockLayout,
    size: mockSize,
  })
  Object.assign(handlers, keyboard.handlers)
  return { result: { current: keyboard } }
}

// ---- The composer changing height (useExtraContentPadding) -------------

type EcpOptions = {
  extraContentPadding: Box<number>
  keyboardPadding: Box<number>
  blankSpace?: Box<number>
  scroll: Box<number>
  layout: Box<{ width: number; height: number }>
  size: Box<{ width: number; height: number }>
  contentOffsetY?: Box<number>
  inverted: boolean
  keyboardLiftBehavior: KeyboardLiftBehavior
  freeze: boolean | Box<boolean>
}

let isLegacy = false

/** Runs the reaction the last `createEcpRender()` render set up. */
export let reactionEffect: (current: number, previous: number | null) => void = () => {}

export const flushRAF = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

export const setupEcpBeforeEach = (): void => {
  isLegacy = false
  mockScrollTo.mockClear()
}

/** The library scrolls with a command on the old architecture, and sets the offset on the new. */
export const withLegacyArch = (run: () => void): void => {
  isLegacy = true
  run()
}

export const createEcpRender =
  () =>
  (options: EcpOptions): void => {
    const freeze = options.freeze
    const keyboard = createChatKeyboard({
      inverted: options.inverted,
      keyboardLiftBehavior: options.keyboardLiftBehavior,
      freeze: typeof freeze === 'boolean' ? sv(freeze) : freeze,
      offset: 0,
      blankSpace: options.blankSpace ?? sv(0),
      extraContentPadding: options.extraContentPadding,
      scroll: options.scroll,
      layout: options.layout,
      size: options.size,
    })
    const usesOffset = options.contentOffsetY !== undefined && !isLegacy
    reactionEffect = (current, previous) => {
      keyboard.padding.value = options.keyboardPadding.value
      const target = keyboard.onExtraContentPadding(current, previous)
      if (target === undefined) return
      if (usesOffset && options.contentOffsetY !== undefined) options.contentOffsetY.value = target
      else mockScrollTo(1, 0, target, false)
    }
  }
