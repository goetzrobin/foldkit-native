/**
 * A pretend phone for the styling code: the parts of React Native it reads,
 * with switches a test can flip. `sources` goes where an app would pass
 * React Native's own modules.
 */
import type { DeviceSources, WindowSize } from '../../src/styling/index.js'

export type FakeDevice = Readonly<{
  sources: DeviceSources
  /** The person switches the phone between light and dark. */
  setColorScheme: (scheme: 'light' | 'dark') => void
  /** The person rotates the phone, or resizes the window. */
  setWindow: (size: WindowSize) => void
  /** The person changes the text size in Settings and comes back. */
  setFontScale: (scale: number) => void
  /** How many listeners are attached right now. */
  listenerCount: () => number
}>

type Listeners<Value> = Set<(value: Value) => void>

const listen = <Value>(listeners: Listeners<Value>, listener: (value: Value) => void) => {
  listeners.add(listener)
  return { remove: () => void listeners.delete(listener) }
}

export const makeFakeDevice = (
  start: Readonly<{
    platform?: 'ios' | 'android'
    colorScheme?: 'light' | 'dark'
    window?: WindowSize
  }> = {},
): FakeDevice => {
  let colorScheme = start.colorScheme ?? 'light'
  let window = start.window ?? { width: 390, height: 844 }
  let fontScale = 1
  const schemeListeners: Listeners<void> = new Set()
  const sizeListeners: Listeners<Readonly<{ window: WindowSize }>> = new Set()
  const stateListeners: Listeners<string> = new Set()

  return {
    sources: {
      Appearance: {
        getColorScheme: () => colorScheme,
        addChangeListener: listener => listen(schemeListeners, listener),
      },
      Dimensions: {
        get: () => window,
        addEventListener: (_type, listener) => listen(sizeListeners, listener),
      },
      PixelRatio: { get: () => 3, getFontScale: () => fontScale },
      Platform: { OS: start.platform ?? 'ios' },
      I18nManager: { isRTL: false },
      StyleSheet: { hairlineWidth: 1 / 3 },
      AppState: {
        addEventListener: (_type, listener) => listen(stateListeners, listener),
      },
    },
    setColorScheme: scheme => {
      colorScheme = scheme
      for (const listener of [...schemeListeners]) listener()
    },
    setWindow: size => {
      window = size
      for (const listener of [...sizeListeners]) listener({ window: size })
    },
    setFontScale: scale => {
      fontScale = scale
      for (const listener of [...stateListeners]) listener('active')
    },
    listenerCount: () => schemeListeners.size + sizeListeners.size + stateListeners.size,
  }
}
