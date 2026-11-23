/**
 * Keeps the engine in step with the phone: light or dark, the window's size,
 * the text size.
 *
 * When the phone switches to dark mode nothing in the Foldkit Model changes,
 * so Foldkit has no reason to run the view again, and it does not. The engine
 * already knows every view's classes. Told the new conditions, it works out
 * the styles again and sends the changed ones to the phone by itself.
 *
 * Two kinds of class variant are served from here:
 *
 * - `dark:` matches a `dark` class on an ancestor (that is how ng-native's
 *   Tailwind preset defines it). The watcher keeps that class on the engine's
 *   root, in step with the phone.
 * - `ios:` and `android:` match a `platform-ios` or `platform-android` class
 *   on an ancestor. The watcher puts it on the root once.
 *
 * Media queries (`sm:`, `md:`, `portrait:`, `landscape:`) are answered from
 * the conditions themselves.
 *
 * Ported from `watchConditions` in ng-native's
 * `packages/device/src/conditions.ts`. Left out: the reduced-motion setting
 * and the keyboard, which belong to other tracks.
 */
import type { Conditions, TokenValue } from '@ng-native/fabric'

import {
  type DeviceSources,
  colorSchemeOf,
  currentConditions,
  hairlineAt,
} from './device.js'

/** Just enough of the engine to be told. `Engine` fits. */
export type StyledEngine<Node = unknown> = Readonly<{
  root: Node
  updateConditions: (conditions: Conditions) => void
  addClass: (node: Node, name: string) => void
  removeClass: (node: Node, name: string) => void
  /** Measures every text again, after the system text size changed. */
  remeasureText?: () => void
  /** Merges custom properties into the root's, such as `--hairline`. */
  updateTokens?: (tokens: Readonly<Record<string, TokenValue>>) => void
}>

export type WatchStylingOptions = Readonly<{
  /**
   * Keep a `dark` class on the root in step with the phone. On by default.
   * An app with its own theme switch turns this off and puts `dark` on a
   * view of its own.
   */
  darkClass?: boolean
  /** Put `platform-<os>` on the root, for `ios:` and `android:`. On by default. */
  platformClass?: boolean
}>

/**
 * Starts watching. Call it once, right after `createNativeSurface`, with the
 * surface's engine. Returns a function that stops watching.
 */
export const watchStyling = <Node>(
  engine: StyledEngine<Node>,
  sources: DeviceSources,
  options: WatchStylingOptions = {},
): (() => void) => {
  const { darkClass = true, platformClass = true } = options
  let conditions = currentConditions(sources)

  const push = (change: Partial<Conditions>): void => {
    conditions = { ...conditions, ...change }
    if (darkClass) {
      if (conditions.colorScheme === 'dark') engine.addClass(engine.root, 'dark')
      else engine.removeClass(engine.root, 'dark')
    }
    // The engine works the styles out again and commits by itself.
    engine.updateConditions(conditions)
  }

  // What must be on the root before the first draw. Light with no platform
  // class needs nothing: that is what the engine starts as.
  const platform = sources.Platform?.OS
  const hasPlatformClass = platformClass && platform !== undefined
  if (hasPlatformClass) engine.addClass(engine.root, `platform-${platform}`)
  if (hasPlatformClass || (darkClass && conditions.colorScheme === 'dark')) push({})

  // Every text on screen was measured at the old text size and keeps that
  // box until it is measured again.
  let fontScale = conditions.fontScale ?? 1
  const resize = (change: Partial<Conditions>, nextScale: number): void => {
    const isRescaled = nextScale !== fontScale
    fontScale = nextScale
    push({ ...change, fontScale: nextScale })
    if (isRescaled) engine.remeasureText?.()
  }

  // A rotation, a split-screen resize, or a move to a screen of another
  // density. The phone also reports a text size change this way.
  let pixelRatio = conditions.pixelRatio ?? 1
  const sizes = sources.Dimensions.addEventListener('change', ({ window }) => {
    const nextRatio = sources.PixelRatio.get()
    resize(
      { width: window.width, height: window.height, pixelRatio: nextRatio },
      sources.PixelRatio.getFontScale(),
    )
    if (nextRatio === pixelRatio) return
    pixelRatio = nextRatio
    engine.updateTokens?.({ '--hairline': { length: hairlineAt(nextRatio) } })
  })

  // Each scheme once: the phone also reports appearance changes that are not
  // the scheme, and can repeat one it already reported.
  let scheme = conditions.colorScheme
  const schemes = sources.Appearance.addChangeListener(() => {
    const next = colorSchemeOf(sources)
    if (next === scheme) return
    scheme = next
    push({ colorScheme: next })
  })

  const foreground = sources.AppState?.addEventListener('change', state => {
    if (state !== 'active') return
    const nextScale = sources.PixelRatio.getFontScale()
    if (nextScale !== fontScale) resize({}, nextScale)
  })

  return () => {
    sizes.remove()
    schemes.remove()
    foreground?.remove()
  }
}
