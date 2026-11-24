/**
 * The props react-native-enriched-markdown's native view needs, worked out
 * from our theme, with no React and none of the package's JavaScript.
 *
 * The package's own React component fills in a complete style object before
 * it reaches native code (`src/normalizeMarkdownStyle.ts` in the package,
 * 1.2.0). Native code holds no defaults of its own: a field left out arrives
 * as zero, an empty string or a clear colour. So every field of every block
 * is written here, in the shape of `MarkdownStyleInternal` in
 * `src/EnrichedMarkdownNativeComponent.ts`. When the package changes that
 * shape, this file is the one to change.
 *
 * Colours inside a prop are not seen by the engine's colour handling (it
 * goes by prop name), so each is passed through `paint`, which is the
 * engine's own `processColor` (`engine.color`). Native code wants the
 * number, as React Native's `processColor` makes it, not the string.
 */
import type { MarkdownTheme } from './theme.js'

type Paint = (color: string) => unknown

type Platform = 'ios' | 'android' | string

const systemFont = (platform: Platform): string => (platform === 'android' ? 'sans-serif' : 'System')
const monoFont = (platform: Platform): string => (platform === 'android' ? 'monospace' : 'Menlo')

/**
 * Android draws text a little taller than iOS at the same size. The package
 * adds two points to every line height there, and so does this.
 */
const lineHeight = (platform: Platform, ios: number): number =>
  platform === 'android' ? ios + 2 : ios

/** The native `markdownStyle` prop: every field of `MarkdownStyleInternal`. */
export const nativeMarkdownStyle = (
  theme: MarkdownTheme,
  platform: Platform,
  paint: Paint,
): Record<string, unknown> => {
  const { colors, sizes, spacing } = theme
  const body = theme.fonts.body === '' ? systemFont(platform) : theme.fonts.body
  const mono = theme.fonts.mono === '' ? monoFont(platform) : theme.fonts.mono
  const transparent = paint('transparent')

  const block = (fontSize: number, height: number, color: string, marginBottom = spacing.block) => ({
    fontSize,
    fontFamily: body,
    fontWeight: '',
    color: paint(color),
    marginTop: 0,
    marginBottom,
    lineHeight: lineHeight(platform, height),
  })

  const heading = (fontSize: number) => ({
    ...block(fontSize, Math.round(fontSize * 1.3), colors.heading, Math.round(spacing.block * 0.6)),
    fontWeight: sizes.headingWeight,
    marginTop: spacing.headingTop,
    textAlign: 'auto',
  })

  const admonition = (color: string) => ({ color: paint(color), backgroundColor: transparent })

  return {
    paragraph: { ...block(sizes.body, sizes.bodyLineHeight, colors.text), textAlign: 'auto' },
    h1: { ...heading(sizes.h1), marginTop: 0 },
    h2: heading(sizes.h2),
    h3: heading(sizes.h3),
    h4: heading(sizes.h4),
    h5: heading(sizes.h5),
    h6: { ...heading(sizes.h6), color: paint(colors.muted) },
    blockquote: {
      ...block(sizes.body, sizes.bodyLineHeight, colors.quoteText),
      borderColor: paint(colors.quoteBar),
      borderWidth: 3,
      gapWidth: 14,
      backgroundColor: paint(colors.quoteBackground),
      borderRadius: 0,
      padding: 0,
      // GitHub's alert colours (`> [!NOTE]`), from the package's defaults.
      admonitions: {
        note: admonition('#0969da'),
        tip: admonition('#1a7f37'),
        important: admonition(colors.link),
        warning: admonition('#9a6700'),
        caution: admonition('#cf222e'),
      },
    },
    list: {
      ...block(sizes.body, sizes.bodyLineHeight - 1, colors.text),
      bulletColor: paint(colors.bullet),
      bulletSize: 5,
      markerMinWidth: 0,
      markerColor: paint(colors.muted),
      markerFontWeight: '500',
      gapWidth: 10,
      marginLeft: spacing.listIndent,
      itemSpacing: 4,
    },
    codeBlock: {
      fontSize: sizes.code,
      fontFamily: mono,
      fontWeight: '',
      color: paint(colors.codeText),
      marginTop: 0,
      marginBottom: spacing.block,
      lineHeight: lineHeight(platform, sizes.codeLineHeight),
      backgroundColor: paint(colors.codeBackground),
      borderColor: paint(colors.codeBorder),
      borderRadius: spacing.radius,
      borderWidth: 1,
      padding: spacing.codePadding,
      // `operatorColor`, not `operator`: the package renames it because
      // `operator` is a reserved word in the C++ it generates.
      syntaxColors: {
        keyword: paint(colors.syntax.keyword),
        operatorColor: paint(colors.codeText),
        punctuation: paint(colors.codeText),
        string: paint(colors.syntax.string),
        number: paint(colors.syntax.number),
        constant: paint(colors.syntax.constant),
        comment: paint(colors.syntax.comment),
        function: paint(colors.syntax.function),
        type: paint(colors.syntax.type),
        variable: paint(colors.codeText),
        property: paint(colors.syntax.property),
        tag: paint(colors.syntax.tag),
        attribute: paint(colors.syntax.attribute),
        embedded: paint(colors.codeText),
      },
    },
    link: { fontFamily: '', color: paint(colors.link), underline: false, backgroundColor: transparent },
    linkVariants: [],
    strong: { fontFamily: '', fontWeight: 'bold' },
    em: { fontFamily: '', fontStyle: 'italic' },
    strikethrough: { color: paint(colors.strikethrough) },
    underline: { color: paint(colors.text) },
    code: {
      // Empty: the code's font is worked out by native code from the text around it.
      fontFamily: '',
      fontSize: 0,
      color: paint(colors.inlineCodeText),
      backgroundColor: paint(colors.inlineCodeBackground),
      borderColor: paint(colors.inlineCodeBorder),
    },
    image: {
      height: 200,
      maxHeight: 0,
      aspectRatio: 0,
      resizeMode: '',
      borderRadius: spacing.radius,
      marginTop: 0,
      marginBottom: spacing.block,
    },
    video: {
      marginTop: 0,
      marginBottom: spacing.block,
      borderRadius: spacing.radius,
      aspectRatio: 16 / 9,
      backgroundColor: paint('#000000'),
    },
    inlineImage: { size: 20 },
    thematicBreak: {
      color: paint(colors.rule),
      height: 1,
      marginTop: spacing.block + 6,
      marginBottom: spacing.block + 6,
    },
    table: {
      ...block(sizes.table, Math.round(sizes.table * 1.4), colors.tableText),
      headerFontFamily: '',
      headerBackgroundColor: paint(colors.tableHeaderBackground),
      headerTextColor: paint(colors.tableHeaderText),
      rowEvenBackgroundColor: paint(colors.tableRowEven),
      rowOddBackgroundColor: paint(colors.tableRowOdd),
      borderColor: paint(colors.tableBorder),
      borderWidth: 1,
      borderRadius: spacing.radius - 2,
      cellPaddingHorizontal: spacing.cellAcross,
      cellPaddingVertical: spacing.cellDown,
      // 0: a table wider than the screen scrolls sideways inside its own box.
      horizontalOverflow: 0,
      align: '',
    },
    taskList: {
      checkedColor: paint(colors.checkboxChecked),
      borderColor: paint(colors.checkboxBorder),
      checkboxSize: Math.round(sizes.body * 0.9),
      checkboxBorderRadius: 4,
      checkmarkColor: paint(colors.checkmark),
      checkedTextColor: paint(colors.checkedText),
      checkedStrikethrough: true,
    },
    math: {
      fontSize: sizes.body + 4,
      color: paint(colors.text),
      backgroundColor: paint(colors.codeBackground),
      padding: 12,
      marginTop: 0,
      marginBottom: spacing.block,
      textAlign: 'center',
    },
    inlineMath: { color: paint(colors.text) },
    spoiler: {
      color: paint(colors.muted),
      particles: { density: 8, speed: 20 },
      solid: { borderRadius: 4 },
    },
    superscript: { fontScale: platform === 'android' ? 0.65 : 0.75, baselineOffsetScale: 0.35 },
    subscript: { fontScale: platform === 'android' ? 0.65 : 0.75, baselineOffsetScale: 0.2 },
    highlight: { color: paint(colors.text), backgroundColor: paint(colors.highlight) },
  }
}

/**
 * How the parser reads the text. GitHub's flavour (tables, task lists,
 * strikethrough) is a separate prop, `isGFM`. These are the package's
 * defaults (`defaultMd4cFlags` in `src/native/EnrichedMarkdownText.tsx`),
 * with strikethrough off because GitHub's flavour always reads it.
 */
export const MD4C_FLAGS = {
  underline: false,
  superscript: false,
  subscript: false,
  strikethrough: false,
  latexMath: true,
  highlight: false,
  hardSoftBreaks: false,
  preserveBlankLines: false,
  admonitions: true,
} as const

/**
 * While text streams in, a table and a code block grow row by row and line
 * by line (`progressive`), as the package's component does by default. The
 * other choice, `hidden`, holds each back until it is complete.
 */
export const STREAMING_CONFIG = {
  tableMode: 'progressive',
  codeBlockMode: 'progressive',
  mediaMode: 'progressive',
} as const

/** The long-press menu on selected text: the package's default labels. */
export const SELECTION_MENU = {
  copyAsMarkdown: true,
  copyImageUrl: true,
  copyLabel: 'Copy',
  copyAsMarkdownLabel: 'Copy as Markdown',
  copyImageUrlLabel: 'Copy Image URL',
  copyImageUrlsLabel: 'Copy {count} Image URLs',
  copyImageUrlPluralTemplates: [],
} as const

/** What VoiceOver and TalkBack say: the package's default words. */
export const ACCESSIBILITY_LABELS = {
  list: {
    bulletPoint: 'Bullet point',
    nestedBulletPoint: 'Nested bullet point',
    orderedItem: 'List item {n}',
    nestedOrderedItem: 'Nested list item {n}',
  },
  blockquote: { quote: 'Blockquote', nestedQuote: 'Nested blockquote' },
  table: { row: 'Row {n}: {content}' },
  math: { equation: 'Math: {speech}' },
  codeBlock: { wrap: 'Wrap lines', unwrap: 'Disable line wrap' },
  rotor: { headings: 'Headings', links: 'Links', images: 'Images' },
} as const

/**
 * Bare web addresses in the text are not turned into links: only real
 * Markdown links are. The package's own default (`toNativeTextLinkRegexConfig`).
 */
const NO_RECOGNITION = { pattern: '', caseInsensitive: false, dotAll: false, isDisabled: true, isDefault: false }
export const LINK_RECOGNITION = { text: NO_RECOGNITION, inlineCode: NO_RECOGNITION } as const
