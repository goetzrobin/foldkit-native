/**
 * How Markdown looks: one theme object with fonts, sizes, colours and
 * spacing, in a light and a dark set.
 *
 *   markdownTheme('dark')                       the dark set as it is
 *   markdownTheme('light', { colors: { link: '#0a7d4f' } })   with changes
 *
 * Both renderers read the same theme. The native view takes a much larger
 * style object (every block of every kind, see `nativeStyle.ts`), which is
 * worked out from this one, so an app only ever thinks about this one.
 *
 * The look is plain on purpose: near-black text on white (or the reverse),
 * one link colour, grey code blocks, thin rules. No purple anywhere, the
 * code colours included.
 */

export type MarkdownColorScheme = 'light' | 'dark'

/** Colours for code inside a fenced block, by kind of word. */
export type SyntaxColors = Readonly<{
  keyword: string
  string: string
  number: string
  constant: string
  comment: string
  function: string
  type: string
  property: string
  tag: string
  attribute: string
}>

export type MarkdownColors = Readonly<{
  /** Body text. */
  text: string
  /** Headings. */
  heading: string
  /** Quiet text: quotes, list bullets, a code block's language label. */
  muted: string
  link: string
  /** Inline `code`. */
  inlineCodeText: string
  inlineCodeBackground: string
  inlineCodeBorder: string
  /** Fenced code blocks. */
  codeText: string
  codeBackground: string
  codeBorder: string
  quoteText: string
  quoteBar: string
  quoteBackground: string
  /** The line drawn for `---`. */
  rule: string
  tableText: string
  tableHeaderText: string
  tableHeaderBackground: string
  tableRowEven: string
  tableRowOdd: string
  tableBorder: string
  bullet: string
  checkboxChecked: string
  checkboxBorder: string
  checkmark: string
  /** Text of a ticked task. */
  checkedText: string
  strikethrough: string
  /** `==marked==` text, where the parser is told to read it. */
  highlight: string
  /** Text selection. */
  selection: string
  syntax: SyntaxColors
}>

export type MarkdownFonts = Readonly<{
  /** Body and headings. Empty: the phone's own font. */
  body: string
  /** Code. Empty: Menlo on iOS, monospace on Android. */
  mono: string
}>

export type MarkdownSizes = Readonly<{
  body: number
  bodyLineHeight: number
  h1: number
  h2: number
  h3: number
  h4: number
  h5: number
  h6: number
  code: number
  codeLineHeight: number
  table: number
  /** Weight of headings, as a font weight: '600', '700', 'bold'. */
  headingWeight: string
}>

export type MarkdownSpacing = Readonly<{
  /** Space under each block. */
  block: number
  /** Space above a heading. */
  headingTop: number
  /** How far list items are pushed in. */
  listIndent: number
  /** Space inside a code block. */
  codePadding: number
  /** Corner rounding of code blocks, tables and images. */
  radius: number
  /** Space inside a table cell, across and down. */
  cellAcross: number
  cellDown: number
}>

export type MarkdownTheme = Readonly<{
  scheme: MarkdownColorScheme
  colors: MarkdownColors
  fonts: MarkdownFonts
  sizes: MarkdownSizes
  spacing: MarkdownSpacing
}>

/** Changes to a theme. Each part may be given in part. */
export type MarkdownStyle = Readonly<{
  colors?: Partial<Omit<MarkdownColors, 'syntax'>> & Readonly<{ syntax?: Partial<SyntaxColors> }>
  fonts?: Partial<MarkdownFonts>
  sizes?: Partial<MarkdownSizes>
  spacing?: Partial<MarkdownSpacing>
}>

const FONTS: MarkdownFonts = { body: '', mono: '' }

const SIZES: MarkdownSizes = {
  body: 16,
  bodyLineHeight: 24,
  h1: 26,
  h2: 22,
  h3: 19,
  h4: 17,
  h5: 16,
  h6: 15,
  code: 13.5,
  codeLineHeight: 20,
  table: 14.5,
  headingWeight: '700',
}

const SPACING: MarkdownSpacing = {
  block: 14,
  headingTop: 8,
  listIndent: 22,
  codePadding: 14,
  radius: 10,
  cellAcross: 12,
  cellDown: 8,
}

/** GitHub's light code colours, with orange-brown where GitHub has purple. */
const LIGHT_SYNTAX: SyntaxColors = {
  keyword: '#cf222e',
  string: '#0a3069',
  number: '#0550ae',
  constant: '#0550ae',
  comment: '#6e7781',
  function: '#953800',
  type: '#953800',
  property: '#0550ae',
  tag: '#116329',
  attribute: '#0550ae',
}

/** GitHub's dark code colours, with orange where GitHub has purple. */
const DARK_SYNTAX: SyntaxColors = {
  keyword: '#ff7b72',
  string: '#a5d6ff',
  number: '#79c0ff',
  constant: '#79c0ff',
  comment: '#8b949e',
  function: '#ffa657',
  type: '#ffa657',
  property: '#79c0ff',
  tag: '#7ee787',
  attribute: '#79c0ff',
}

const LIGHT: MarkdownColors = {
  text: '#1d1d1f',
  heading: '#111111',
  muted: '#6b6b70',
  link: '#0a62c9',
  inlineCodeText: '#1d1d1f',
  inlineCodeBackground: '#f0f0f2',
  inlineCodeBorder: '#e2e2e6',
  codeText: '#1d1d1f',
  codeBackground: '#f6f6f8',
  codeBorder: '#e5e5ea',
  quoteText: '#4a4a4f',
  quoteBar: '#d2d2d7',
  quoteBackground: '#ffffff',
  rule: '#e5e5ea',
  tableText: '#1d1d1f',
  tableHeaderText: '#111111',
  tableHeaderBackground: '#f4f4f6',
  tableRowEven: '#ffffff',
  tableRowOdd: '#fafafb',
  tableBorder: '#e2e2e6',
  bullet: '#8e8e93',
  checkboxChecked: '#c2410c',
  checkboxBorder: '#a1a1a6',
  checkmark: '#ffffff',
  checkedText: '#8e8e93',
  strikethrough: '#8e8e93',
  highlight: '#fff1b8',
  selection: '#f9731655',
  syntax: LIGHT_SYNTAX,
}

const DARK: MarkdownColors = {
  text: '#e8e8ed',
  heading: '#f5f5f7',
  muted: '#98989f',
  link: '#5eb0ff',
  inlineCodeText: '#f5f5f7',
  inlineCodeBackground: '#2a2a2e',
  inlineCodeBorder: '#3a3a3f',
  codeText: '#e8e8ed',
  codeBackground: '#161618',
  codeBorder: '#2c2c30',
  quoteText: '#b8b8be',
  quoteBar: '#48484d',
  quoteBackground: '#000000',
  rule: '#2c2c30',
  tableText: '#e8e8ed',
  tableHeaderText: '#f5f5f7',
  tableHeaderBackground: '#1f1f22',
  tableRowEven: '#000000',
  tableRowOdd: '#111113',
  tableBorder: '#333337',
  bullet: '#8e8e93',
  checkboxChecked: '#f97316',
  checkboxBorder: '#6e6e73',
  checkmark: '#000000',
  checkedText: '#8e8e93',
  strikethrough: '#8e8e93',
  highlight: '#5c4a00',
  selection: '#f9731666',
  syntax: DARK_SYNTAX,
}

const BASE: Readonly<Record<MarkdownColorScheme, MarkdownTheme>> = {
  light: { scheme: 'light', colors: LIGHT, fonts: FONTS, sizes: SIZES, spacing: SPACING },
  dark: { scheme: 'dark', colors: DARK, fonts: FONTS, sizes: SIZES, spacing: SPACING },
}

// A theme is asked for on every draw. The same request gives the same object
// back, so the native view is not sent a new style it already has.
const made = new Map<string, MarkdownTheme>()

/** The light or dark theme, with any changes laid over it. */
export const markdownTheme = (
  scheme: MarkdownColorScheme = 'light',
  changes: MarkdownStyle = {},
): MarkdownTheme => {
  const key = `${scheme}:${JSON.stringify(changes)}`
  const found = made.get(key)
  if (found !== undefined) return found
  const base = BASE[scheme]
  const theme: MarkdownTheme = {
    scheme,
    colors: {
      ...base.colors,
      ...changes.colors,
      syntax: { ...base.colors.syntax, ...changes.colors?.syntax },
    },
    fonts: { ...base.fonts, ...changes.fonts },
    sizes: { ...base.sizes, ...changes.sizes },
    spacing: { ...base.spacing, ...changes.spacing },
  }
  if (made.size > 32) made.clear()
  made.set(key, theme)
  return theme
}
