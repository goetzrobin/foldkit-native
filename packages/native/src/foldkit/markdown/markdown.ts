/**
 * `markdown`: an AI reply drawn as rich text while it streams in.
 *
 *   markdown(h, {
 *     id: reply.id,
 *     text: reply.text,                 // all of it so far, growing
 *     isStreaming: reply.isStreaming,
 *     colorScheme: model.scheme,        // from Phone.ColorScheme
 *     onLink: url => Message.PressedLink({ url }),
 *     onCopyCode: copy => Message.CopiedCode(copy),
 *   })
 *
 * Two renderers sit behind it:
 *
 * - `native` (the one to use): Software Mansion's react-native-enriched-
 *   markdown view, driven by name (`native.ts`). Needs the prebuilt app.
 * - `foldkit`: a small fallback drawn with plain views (`fallback.ts`), so
 *   a build without the native view (Expo Go) shows the words and does not
 *   crash.
 *
 * `renderer: 'auto'` (the default) takes the native one where it is in the
 * build. `markdownRenderer(...)` says which one a call would use, and why.
 *
 * Pass the whole text each time, not the newest piece. Finished text never
 * changes, so nothing already drawn moves.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent, element } from 'foldkit/renderTarget'

import { type NativeStyle, style as styleAttribute, testId } from '../attributes.js'
import { isNativeMarkdownAvailable, nativeMarkdownUnavailableReason, remendOf } from '../../host/markdown/detect.js'
import { type CodeCopy, fallbackMarkdown } from './fallback.js'
import { NATIVE_MARKDOWN_TAG, REMEND_OPTIONS, numbersFor, withNativeData } from './native.js'
import { type MarkdownColorScheme, type MarkdownStyle, markdownTheme } from '../../host/markdown/theme.js'

const el = element<any>()

export type MarkdownRenderer = 'auto' | 'foldkit' | 'native'

export type MarkdownOptions<Message> = Readonly<{
  /** Stable for the reply's life, such as its message id. Also the key of its view. */
  id: string
  /** Everything received so far. */
  text: string
  /** True while more text may come. */
  isStreaming: boolean
  /** Light or dark, as `Phone.ColorScheme` reports it. Light unless said. */
  colorScheme?: MarkdownColorScheme
  /** Changes to the theme. See `theme.ts`. */
  style?: MarkdownStyle
  /** A link was tapped. Open it with `Phone.Linking.OpenUrl`, or not. */
  onLink?: (url: string) => Message
  /** A code block's Copy button was pressed. See `CodeCopy.isOnClipboard`. */
  onCopyCode?: (copy: CodeCopy) => Message
  /** New words fade in while streaming. On unless said. Native renderer only. */
  fade?: boolean
  /**
   * Whether a long press selects text once the reply is finished. On unless
   * said. Off for a reply whose long press opens a menu of the app's own.
   * Native renderer only: the fallback never selects.
   */
  selectable?: boolean
  /** `auto` unless said. */
  renderer?: MarkdownRenderer
  /** Layout of the box around the reply: margins, width. */
  layout?: NativeStyle
}>

export type RendererChoice = Readonly<{
  renderer: 'native' | 'foldkit'
  /** Why the Foldkit fallback is used. Empty for the native renderer. */
  reason: string
}>

/** Which renderer a `markdown` with this setting draws with, and why. Never throws. */
export const markdownRenderer = (asked: MarkdownRenderer = 'auto'): RendererChoice => {
  if (asked === 'foldkit') return { renderer: 'foldkit', reason: 'chosen' }
  if (isNativeMarkdownAvailable()) return { renderer: 'native', reason: '' }
  return { renderer: 'foldkit', reason: nativeMarkdownUnavailableReason() }
}

/** One line for a screen: which renderer draws, and why when it is the fallback. */
export const markdownStatus = (asked: MarkdownRenderer = 'auto'): string => {
  const choice = markdownRenderer(asked)
  if (choice.renderer === 'native') return 'Renderer: native (react-native-enriched-markdown)'
  return choice.reason === 'chosen'
    ? 'Renderer: Foldkit fallback (chosen)'
    : `Renderer: Foldkit fallback, because ${choice.reason}`
}

/** Whether the app handed over remend, for a status line. */
export const isRemendConfigured = (): boolean => remendOf() !== null

type LinkPress = Readonly<{ url?: unknown }>
type CopyPress = Readonly<{ code?: unknown; language?: unknown }>

/** The reply, drawn by whichever renderer `renderer` picks. */
export const markdown = <Message>(h: HtmlBuilder<Message>, options: MarkdownOptions<Message>): Html => {
  const theme = markdownTheme(options.colorScheme ?? 'light', options.style)
  const choice = markdownRenderer(options.renderer)
  const layout = options.layout === undefined ? [] : [styleAttribute(options.layout)]

  if (choice.renderer === 'foldkit') {
    numbersFor(options.id, 'foldkit').textsGiven += 1
    const remend = remendOf()
    // The fallback reads only fences, so remend matters little here. It is
    // still run, so a half-written link does not show its brackets.
    const shown =
      options.isStreaming && remend !== null && options.text !== ''
        ? safeRemend(remend, options.text)
        : options.text
    const drawn = fallbackMarkdown(h, {
      id: options.id,
      text: shown,
      theme,
      ...(options.onCopyCode === undefined ? {} : { onCopyCode: options.onCopyCode }),
    })
    return layout.length === 0 ? drawn : el('view')([h.Key(`${options.id}-box`), ...layout] as never, [drawn] as never)
  }

  const onLink = options.onLink
  const onCopyCode = options.onCopyCode
  const events = [
    ...(onLink === undefined
      ? []
      : [
          OnCustomEvent<Message>({
            name: 'linkPress',
            f: event => {
              const url = ((event as { detail?: LinkPress }).detail ?? {}).url
              return typeof url === 'string' ? Option.some(onLink(url)) : Option.none()
            },
          }),
        ]),
    ...(onCopyCode === undefined
      ? []
      : [
          OnCustomEvent<Message>({
            name: 'copyPress',
            f: event => {
              const detail = (event as { detail?: CopyPress }).detail ?? {}
              return Option.some(
                onCopyCode({
                  code: typeof detail.code === 'string' ? detail.code : '',
                  language: typeof detail.language === 'string' ? detail.language : '',
                  isOnClipboard: true,
                }),
              )
            },
          }),
        ]),
  ]
  return withNativeData(
    el(NATIVE_MARKDOWN_TAG)(
      [h.Key(`${options.id}-native`), testId(`${options.id}-markdown`), ...layout, ...events] as never,
      [],
    ),
    {
      id: options.id,
      text: options.text,
      isStreaming: options.isStreaming,
      isFadeOn: options.fade ?? true,
      isSelectable: options.selectable ?? true,
      theme,
    },
  )
}

const safeRemend = (remend: (text: string, options?: Record<string, unknown>) => string, text: string): string => {
  try {
    return remend(text, REMEND_OPTIONS)
  } catch {
    return text
  }
}
