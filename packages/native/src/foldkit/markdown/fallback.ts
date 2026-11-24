/**
 * The Foldkit fallback: Markdown drawn with plain views, for a build that
 * lacks the native view (Expo Go). Deliberately small. It is there so a
 * screen does not crash or go blank, not to look good.
 *
 * It knows two kinds of block: fenced code, and everything else, which is a
 * paragraph. Headings are drawn bold. Inside a paragraph the commonest marks
 * (`**`, `*`, `` ` ``, `~~`, links) are taken out and the words kept. Code
 * blocks scroll sideways and have a Copy button.
 *
 * Blocks are keyed by their place in the reply, and a block whose source has
 * not changed since the last draw is given back as the very same vnode, so
 * Foldkit skips it. While a reply streams only the last block is redrawn.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { type NativeStyle, onPress, prop, style, testId } from '../attributes.js'
import { scrollView, text, view } from '../elements.js'
import { numbersFor } from './native.js'
import type { MarkdownTheme } from '../../host/markdown/theme.js'

type Block = Readonly<{ kind: 'code' | 'text'; source: string; body: string; language: string }>

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** Cuts the reply into blocks. An unclosed fence runs to the end, as it does while streaming. */
export const splitBlocks = (markdown: string): ReadonlyArray<Block> => {
  const lines = markdown.split('\n')
  const blocks: Array<Block> = []
  let paragraph: Array<string> = []
  const endParagraph = (): void => {
    if (paragraph.length > 0) {
      const source = paragraph.join('\n')
      blocks.push({ kind: 'text', source, body: source, language: '' })
    }
    paragraph = []
  }
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    const fence = FENCE.exec(line)
    if (fence !== null) {
      endParagraph()
      const marker = fence[1] ?? '```'
      const body: Array<string> = []
      const opened = at
      at++
      while (at < lines.length && !(lines[at] ?? '').trimStart().startsWith(marker)) {
        body.push(lines[at] ?? '')
        at++
      }
      blocks.push({
        kind: 'code',
        source: lines.slice(opened, at + 1).join('\n'),
        body: body.join('\n'),
        language: (fence[2] ?? '').trim(),
      })
      continue
    }
    if (line.trim() === '') endParagraph()
    else paragraph.push(line)
  }
  endParagraph()
  return blocks
}

/** The words of a line without the commonest Markdown marks. */
export const plainWords = (line: string): string =>
  line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S)/g, '$1$2')
    .replace(/(\S)[*_](\s|$)/g, '$1$2')

export type FallbackOptions<Message> = Readonly<{
  id: string
  text: string
  theme: MarkdownTheme
  onCopyCode?: (copy: CodeCopy) => Message
}>

/** A Copy press on a code block. */
export type CodeCopy = Readonly<{
  code: string
  language: string
  /**
   * `true` when the native view has already put the code on the clipboard
   * (its own Copy button does). `false` from the fallback: the program asks
   * for `Phone.Clipboard.CopyText` itself.
   */
  isOnClipboard: boolean
}>

type Drawn = { source: string; html: Html; scheme: string }
const drawnById = new Map<string, Array<Drawn>>()

/** Forget what was drawn for one id, or for all. For tests and closed chats. */
export const forgetFallback = (id?: string): void => {
  if (id === undefined) drawnById.clear()
  else drawnById.delete(id)
}

const paragraphOf = (block: Block, theme: MarkdownTheme, key: string): Html => {
  const lines = block.body.split('\n')
  const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(lines[0] ?? '')
  const look: NativeStyle = heading
    ? {
        fontSize: theme.sizes.h3,
        fontWeight: '700',
        color: theme.colors.heading,
        lineHeight: Math.round(theme.sizes.h3 * 1.3),
      }
    : { fontSize: theme.sizes.body, color: theme.colors.text, lineHeight: theme.sizes.bodyLineHeight }
  const words = heading ? [heading[2] ?? '', ...lines.slice(1)] : lines
  return text(
    [testId(key), style({ ...look, marginBottom: theme.spacing.block })],
    [words.map(plainWords).join('\n')],
  )
}

const codeOf = <Message>(
  block: Block,
  theme: MarkdownTheme,
  key: string,
  onCopyCode: ((copy: CodeCopy) => Message) | undefined,
): Html =>
  view(
    [
      testId(key),
      style({
        backgroundColor: theme.colors.codeBackground,
        borderColor: theme.colors.codeBorder,
        borderWidth: 1,
        borderRadius: theme.spacing.radius,
        marginBottom: theme.spacing.block,
        overflow: 'hidden',
      }),
    ],
    [
      view(
        [style({ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 })],
        [
          text([style({ fontSize: 12, color: theme.colors.muted })], [block.language]),
          ...(onCopyCode === undefined
            ? []
            : [
                text(
                  [
                    testId(`${key}-copy`),
                    onPress(onCopyCode({ code: block.body, language: block.language, isOnClipboard: false })),
                    style({ fontSize: 12, fontWeight: '600', color: theme.colors.muted }),
                  ],
                  ['Copy'],
                ),
              ]),
        ],
      ),
      scrollView(
        [prop('horizontal', true), prop('alwaysBounceVertical', false)],
        [
          text(
            [
              style({
                fontFamily: theme.fonts.mono === '' ? 'Menlo' : theme.fonts.mono,
                fontSize: theme.sizes.code,
                lineHeight: theme.sizes.codeLineHeight,
                color: theme.colors.codeText,
                padding: theme.spacing.codePadding,
                paddingTop: 6,
              }),
            ],
            [block.body],
          ),
        ],
      ),
    ],
  )

/** The fallback's drawing of a reply. */
export const fallbackMarkdown = <Message>(
  h: HtmlBuilder<Message>,
  options: FallbackOptions<Message>,
): Html => {
  const blocks = splitBlocks(options.text)
  const before = drawnById.get(options.id) ?? []
  const after: Array<Drawn> = []
  let redrawn = 0
  blocks.forEach((block, index) => {
    const old = before[index]
    if (old !== undefined && old.source === block.source && old.scheme === options.theme.scheme) {
      after.push(old)
      return
    }
    redrawn++
    const key = `${options.id}-block-${index}`
    const drawn = block.kind === 'code' ? codeOf(block, options.theme, key, options.onCopyCode) : paragraphOf(block, options.theme, key)
    after.push({ source: block.source, html: drawn, scheme: options.theme.scheme })
  })
  drawnById.set(options.id, after)
  numbersFor(options.id, 'foldkit').blocksRedrawn = redrawn
  return view(
    [h.Key(`${options.id}-foldkit`), testId(`${options.id}-markdown`)],
    after.map((drawn, index) => (drawn.html === null ? drawn.html : withKey(drawn.html, index))),
  )
}

/** Gives a cached block its key without making a new vnode each draw. */
const withKey = (html: NonNullable<Html>, index: number): Html => {
  if (html.key === undefined) html.key = `b${index}`
  return html
}
