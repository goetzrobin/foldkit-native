/**
 * The native route: react-native-enriched-markdown's `EnrichedMarkdown`
 * view, driven by name with plain props. No React, none of the package's
 * JavaScript.
 *
 * What the native view does by itself (read in the package's source, 1.2.0):
 *
 * - Parses the whole string with md4c on a background thread on every
 *   change of `markdown`, then keeps the blocks that did not change and
 *   redraws the rest (`ENRMSegmentReconciler` on iOS, `SegmentReconciler.kt`
 *   on Android).
 * - With `streamingAnimation` on, fades in only the new tail of the text,
 *   over 0.2 seconds (`ENRMTailFadeInAnimator.m`, `BLOCK_FADE_DURATION_MS`
 *   in `EnrichedMarkdown.kt`), and new table rows and blocks too. It skips
 *   the fade when the phone is set to reduce motion.
 * - Draws a half-finished table or code block as far as it has got
 *   (`streamingConfig`).
 * - Sizes itself to its content (its own shadow node measures it), so no
 *   size event is needed: the view grows as text arrives.
 * - Highlights code with tree-sitter and has a Copy button on each code
 *   block, which puts the code on the clipboard itself.
 * - Text can be selected (long press), with "Copy" and "Copy as Markdown".
 *
 * What this file adds, as `react-native-streamdown` does around the same
 * view (`useStreamdownMarkdown.ts`, `remendWorklet.ts`, 0.3.0):
 *
 * - Half-written syntax is finished by `remend` before the text is sent,
 *   with streamdown's settings.
 * - Text cannot be selected while it streams.
 * - At most one new `markdown` per frame. Tokens can come faster than the
 *   screen draws, and every change makes native code parse the whole reply
 *   again, so the newest text is held and sent once per frame. remend runs
 *   then too, once per frame, not once per token.
 *
 * And, as v0's app does, a reply that is already on screen when a chat is
 * opened does not fade in again: a view always starts with the fade off,
 * and turns it on after its first draw, only while the reply is streaming.
 */
import { type EngineNode, nativePlatform, registerViewName } from '@ng-native/fabric'
import type { VNode } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend.js'
import { onNextFrame } from '../../host/motion/clock.js'
import { nodeOf } from '../modules.js'
import { NATIVE_MARKDOWN_VIEW, remendOf } from '../../host/markdown/detect.js'
import {
  ACCESSIBILITY_LABELS,
  LINK_RECOGNITION,
  MD4C_FLAGS,
  SELECTION_MENU,
  STREAMING_CONFIG,
  nativeMarkdownStyle,
} from '../../host/markdown/nativeStyle.js'
import type { MarkdownTheme } from '../../host/markdown/theme.js'

/** The element name the engine knows the native view by. */
export const NATIVE_MARKDOWN_TAG = 'enriched-markdown'

/** remend's settings, as react-native-streamdown 0.3.0 sets them (`remendWorklet.ts`). */
export const REMEND_OPTIONS = {
  bold: true,
  italic: true,
  boldItalic: true,
  strikethrough: true,
  links: true,
  linkMode: 'text-only',
  images: true,
  inlineCode: true,
  katex: false,
  setextHeadings: true,
} as const

/** What the view says about one native Markdown view. Kept on the vnode. */
export type NativeMarkdownData = Readonly<{
  id: string
  text: string
  isStreaming: boolean
  isFadeOn: boolean
  /** Text selection once the reply is finished. Left out means on. */
  isSelectable?: boolean
  theme: MarkdownTheme
}>

const DATA = 'foldkitMarkdown'

/** Puts what the module reads on a vnode. */
export const withNativeData = (target: VNode | null, data: NativeMarkdownData): VNode | null => {
  if (target !== null) (target.data ??= {})[DATA] = data
  return target
}

const dataOf = (vnode: VNode): NativeMarkdownData | undefined =>
  (vnode.data as Record<string, unknown> | undefined)?.[DATA] as NativeMarkdownData | undefined

/**
 * What one reply cost, for the demo's "Show numbers" line and for anyone
 * tuning the stream. Kept outside the Model: it changes every frame.
 */
export type MarkdownNumbers = {
  /** Which renderer drew it last. */
  renderer: 'native' | 'foldkit'
  /** New texts the view was drawn with: one per token when each token is a Message. */
  textsGiven: number
  /** New `markdown` props sent to the native view. At most one a frame. */
  updatesSent: number
  /** Characters in the last update sent. The whole reply is sent each time. */
  lastUpdateChars: number
  /** All characters sent, added up. */
  charsSent: number
  /** Time spent in remend, added up, in milliseconds. */
  remendMs: number
  /** The longest single remend, in milliseconds. */
  remendMsMax: number
  /** How many times remend ran. */
  remendRuns: number
  /** Blocks the Foldkit fallback drew again on its last draw. */
  blocksRedrawn: number
}

const numbers = new Map<string, MarkdownNumbers>()

const emptyNumbers = (renderer: 'native' | 'foldkit'): MarkdownNumbers => ({
  renderer,
  textsGiven: 0,
  updatesSent: 0,
  lastUpdateChars: 0,
  charsSent: 0,
  remendMs: 0,
  remendMsMax: 0,
  remendRuns: 0,
  blocksRedrawn: 0,
})

/** The running numbers for one `markdown` id, or zeros. A copy: it does not change later. */
export const markdownNumbers = (id: string): MarkdownNumbers => ({
  ...(numbers.get(id) ?? emptyNumbers('native')),
})

/** Starts one id's numbers again, or every id's. */
export const resetMarkdownNumbers = (id?: string): void => {
  if (id === undefined) numbers.clear()
  else numbers.delete(id)
}

/** The live numbers for an id, made when first asked for. For this folder only. */
export const numbersFor = (id: string, renderer: 'native' | 'foldkit'): MarkdownNumbers => {
  let found = numbers.get(id)
  if (found === undefined) numbers.set(id, (found = emptyNumbers(renderer)))
  found.renderer = renderer
  return found
}

const now = (): number => {
  const clock = (globalThis as { performance?: { now?: () => number } }).performance
  return typeof clock?.now === 'function' ? clock.now() : Date.now()
}

/**
 * remend points an image whose address has not fully arrived at a made-up
 * address, so it is not drawn with half an address. The native view would
 * try to load that address and draw a broken picture, so such an image is
 * left out until its address is complete.
 */
const INCOMPLETE_IMAGE = /!\[[^\]]*\]\(streamdown:incomplete-image\)/g

/** The text to send: finished by remend while it streams, as it is once it is done. */
const prepare = (text: string, isStreaming: boolean, count: MarkdownNumbers): string => {
  const remend = remendOf()
  if (!isStreaming || remend === null || text === '') return text
  const started = now()
  let ready = text
  try {
    ready = remend(text, REMEND_OPTIONS).replace(INCOMPLETE_IMAGE, '')
  } catch {
    // A remend failure must not lose the reply: the text goes as it is.
    ready = text
  }
  const took = now() - started
  count.remendMs += took
  count.remendRuns += 1
  if (took > count.remendMsMax) count.remendMsMax = took
  return ready
}

const platformName = (): string => {
  try {
    return String(nativePlatform())
  } catch {
    return 'ios'
  }
}

type ViewState = {
  isAlive: boolean
  /** The newest text the view was drawn with. */
  given: string
  /** The text last sent to native code. Nothing yet: the first text always goes. */
  sent: string | undefined
  isStreaming: boolean
  isFadeOn: boolean
  isSelectable: boolean
  isFrameAsked: boolean
  theme: MarkdownTheme | undefined
  id: string
}

/** Props the native view reads once. Their meaning is in `nativeStyle.ts`. */
const FIXED_PROPS: ReadonlyArray<readonly [string, unknown]> = [
  ['isGFM', true],
  ['md4cFlags', MD4C_FLAGS],
  ['streamingConfig', STREAMING_CONFIG],
  ['selectionMenuConfig', SELECTION_MENU],
  ['accessibilityLabels', ACCESSIBILITY_LABELS],
  ['linkRecognition', LINK_RECOGNITION],
  ['allowFontScaling', true],
  ['allowTrailingMargin', false],
  // Long press on a link shows iOS's own preview of the page.
  ['enableLinkPreview', true],
  // Long press on a code block or table offers to copy it.
  ['enableBlockContextMenu', true],
  // A reply's task list is a record, not a form: ticking it does nothing.
  ['enableTaskListItemToggle', false],
  ['enableCodeBlockWrapToggle', true],
  ['enableImagePress', false],
  ['enableTextPress', false],
  ['enableCodeBlockPress', false],
  ['writingDirection', 'first-strong'],
  ['spoilerOverlay', 'particles'],
  ['textBreakStrategy', 'highQuality'],
  ['lineBreakStrategyIOS', 'none'],
]

const nativeMarkdownModule: ModuleFactory = (engine, afterCommit) => {
  const states = new WeakMap<EngineNode, ViewState>()
  // One style object per theme and engine, so an unchanged theme is not sent again.
  const styles = new WeakMap<MarkdownTheme, Record<string, unknown>>()

  const styleFor = (theme: MarkdownTheme): Record<string, unknown> => {
    let made = styles.get(theme)
    if (made === undefined) {
      made = nativeMarkdownStyle(theme, platformName(), color => engine.color(color))
      styles.set(theme, made)
    }
    return made
  }

  const applyTheme = (node: EngineNode, state: ViewState, theme: MarkdownTheme): void => {
    if (state.theme === theme) return
    state.theme = theme
    engine.setProp(node, 'markdownStyle', styleFor(theme))
    // A prop whose name ends in `Color` is put through processColor by the
    // engine itself, so this one goes as a string.
    engine.setProp(node, 'selectionColor', theme.colors.selection)
  }

  /** Sends the newest text, if it differs from what native code has. */
  const send = (node: EngineNode, state: ViewState): boolean => {
    const count = numbersFor(state.id, 'native')
    const ready = prepare(state.given, state.isStreaming, count)
    if (ready === state.sent) return false
    state.sent = ready
    engine.setProp(node, 'markdown', ready)
    count.updatesSent += 1
    count.lastUpdateChars = ready.length
    count.charsSent += ready.length
    return true
  }

  const askFrame = (node: EngineNode, state: ViewState): void => {
    if (state.isFrameAsked) return
    state.isFrameAsked = true
    onNextFrame(engine, () => {
      state.isFrameAsked = false
      if (!state.isAlive) return
      if (send(node, state)) engine.commit()
    })
  }

  return {
    create: (_empty, vnode) => {
      const node = nodeOf(vnode)
      const data = dataOf(vnode)
      if (node === undefined || data === undefined) return
      const state: ViewState = {
        isAlive: true,
        given: data.text,
        sent: undefined,
        isStreaming: data.isStreaming,
        isFadeOn: data.isFadeOn,
        isSelectable: data.isSelectable ?? true,
        isFrameAsked: false,
        theme: undefined,
        id: data.id,
      }
      states.set(node, state)
      numbersFor(data.id, 'native').textsGiven += 1
      for (const [key, value] of FIXED_PROPS) engine.setProp(node, key, value)
      applyTheme(node, state, data.theme)
      engine.setProp(node, 'selectable', state.isSelectable && !data.isStreaming)
      // Off for the first draw, so text already there never fades in.
      engine.setProp(node, 'streamingAnimation', false)
      send(node, state)
      afterCommit(() => {
        if (!state.isAlive || !state.isStreaming || !state.isFadeOn) return
        engine.setProp(node, 'streamingAnimation', true)
        engine.commit()
      })
    },
    update: (_old, vnode) => {
      const node = nodeOf(vnode)
      const data = dataOf(vnode)
      const state = node === undefined ? undefined : states.get(node)
      if (node === undefined || data === undefined || state === undefined) return
      applyTheme(node, state, data.theme)
      if (data.isFadeOn !== state.isFadeOn) {
        state.isFadeOn = data.isFadeOn
        // Turned on only while streaming. Turning it off stops fades already running.
        engine.setProp(node, 'streamingAnimation', data.isFadeOn && data.isStreaming)
      }
      const wasStreaming = state.isStreaming
      const wasSelectable = state.isSelectable
      state.isStreaming = data.isStreaming
      state.isSelectable = data.isSelectable ?? true
      if (data.text !== state.given) {
        state.given = data.text
        numbersFor(state.id, 'native').textsGiven += 1
      }
      if (wasStreaming !== data.isStreaming || wasSelectable !== state.isSelectable) {
        engine.setProp(node, 'selectable', state.isSelectable && !data.isStreaming)
      }
      if (wasStreaming !== data.isStreaming) {
        if (data.isStreaming && data.isFadeOn) engine.setProp(node, 'streamingAnimation', true)
        // The fade stays on after the end, so the last words finish fading.
      }
      // While streaming, at most one new text a frame. Once done, at once and whole.
      if (data.isStreaming) askFrame(node, state)
      else send(node, state)
    },
    destroy: vnode => {
      const node = nodeOf(vnode)
      const state = node === undefined ? undefined : states.get(node)
      if (state !== undefined) state.isAlive = false
    },
  }
}

// Both at import time: a module only reaches surfaces made after it is
// registered, and the app makes its surface at startup. The view's name is
// the same on both platforms and needs nothing from Expo, so it is given here
// too. Where the build lacks the view, `markdown` never draws this element.
registerViewName(NATIVE_MARKDOWN_TAG, { ios: NATIVE_MARKDOWN_VIEW, android: NATIVE_MARKDOWN_VIEW })
registerModule(nativeMarkdownModule)
