/**
 * Streaming Markdown for AI replies.
 *
 *   configureMarkdown({ remend })     once at startup (the app imports remend)
 *   markdown(h, { id, text, isStreaming, ... })   the reply, in a view
 *   markdownStatus()                  which renderer draws, and why
 *   markdownNumbers(id)               what a reply cost: updates, characters, remend time
 *
 * `markdown.ts` is the entry, `native.ts` the native view, `fallback.ts` the
 * plain one, `theme.ts` the look. docs/MARKDOWN.md explains it in plain words.
 */
export { markdown, markdownRenderer, markdownStatus, isRemendConfigured } from './markdown.js'
export type { MarkdownOptions, MarkdownRenderer, RendererChoice } from './markdown.js'
export {
  NATIVE_MARKDOWN_VIEW,
  NEEDS_PREBUILT,
  configureMarkdown,
  isNativeMarkdownAvailable,
  nativeMarkdownUnavailableReason,
  resetMarkdownSetup,
} from '../../host/markdown/detect.js'
export type { MarkdownSetup, Remend, RemendOptions } from '../../host/markdown/detect.js'
export {
  NATIVE_MARKDOWN_TAG,
  REMEND_OPTIONS,
  markdownNumbers,
  resetMarkdownNumbers,
} from './native.js'
export type { MarkdownNumbers } from './native.js'
export { forgetFallback } from './fallback.js'
export type { CodeCopy } from './fallback.js'
export { markdownTheme } from '../../host/markdown/theme.js'
export type {
  MarkdownColorScheme,
  MarkdownColors,
  MarkdownFonts,
  MarkdownSizes,
  MarkdownSpacing,
  MarkdownStyle,
  MarkdownTheme,
  SyntaxColors,
} from '../../host/markdown/theme.js'
