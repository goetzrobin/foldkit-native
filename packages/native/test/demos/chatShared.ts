/**
 * Parts the two chat demos share: colors, the composer (text field and Send
 * button), the round button that scrolls to the newest message, and the
 * strip of buttons and hints at the top.
 *
 * Nothing here holds state. Each demo keeps the draft, the keyboard height
 * and "is the list at its end" in its own Model and passes them in.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent } from 'foldkit/renderTarget'

import { composerDock } from '../../src/chat/index.js'
import { prop, style, text, textInput, view as box } from '../../src/index.js'

export const INK = '#111111'
export const MUTED = '#6b6b6b'
export const LINE = '#e3e3e3'
export const PAPER = '#ffffff'
export const ACCENT = '#e8590c'
export const SOFT = '#f1f1ee'

export const smallButton = <Message>(
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  message: Message,
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: INK,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 14, fontWeight: '600' })], [label])],
  )

/** The strip above the list: buttons, one line of state, and what to try. */
export const topStrip = (
  buttons: ReadonlyArray<Html>,
  status: string,
  hint: string,
): Html =>
  box(
    [style({ padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: LINE })],
    [
      box([style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })], buttons),
      text([prop('testID', 'status'), style({ color: ACCENT, fontSize: 14, fontWeight: '600' })], [
        status,
      ]),
      text([prop('testID', 'hint'), style({ color: MUTED, fontSize: 13 })], [hint]),
    ],
  )

/**
 * One message. `side` picks the look: the user's own messages are dark and
 * on the right, the other person's are pale and on the left.
 */
export const bubble = (
  id: string,
  side: 'mine' | 'theirs',
  children: ReadonlyArray<Html>,
): Html =>
  box(
    [style({ paddingHorizontal: 12, paddingVertical: 4 })],
    [
      box(
        [
          prop('testID', id),
          style({
            alignSelf: side === 'mine' ? 'flex-end' : 'flex-start',
            maxWidth: '86%',
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 18,
            gap: 4,
            backgroundColor: side === 'mine' ? INK : SOFT,
          }),
        ],
        children,
      ),
    ],
  )

export const bubbleText = (side: 'mine' | 'theirs', words: string): Html =>
  text([style({ color: side === 'mine' ? PAPER : INK, fontSize: 16, lineHeight: 22 })], [words])

export const bubbleNote = (side: 'mine' | 'theirs', words: string): Html =>
  text([style({ color: side === 'mine' ? '#c9c9c9' : MUTED, fontSize: 12 })], [words])

/**
 * A round button over the bottom right corner of the list. Give it only
 * while the list is away from its end. Its parent must be the box that
 * holds the list.
 */
export const scrollToEndButton = <Message>(h: HtmlBuilder<Message>, message: Message): Html =>
  box(
    [
      h.Attribute('testID', 'scroll-to-end'),
      prop('accessibilityLabel', 'Scroll to the newest message'),
      h.OnClick(message),
      style({
        position: 'absolute',
        right: 16,
        bottom: 16,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: INK,
        alignItems: 'center',
        justifyContent: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 22, fontWeight: '700' })], ['↓'])],
  )

export type Composer<Message> = Readonly<{
  draft: string
  placeholder: string
  keyboardHeight: number
  onChange: (text: string) => Message
  onSend: Message
}>

/** The text field and Send button, docked above the keyboard. */
export const composer = <Message>(h: HtmlBuilder<Message>, config: Composer<Message>): Html => {
  const canSend = config.draft.trim() !== ''
  return composerDock(h, {
    keyboardHeight: config.keyboardHeight,
    attributes: [
      h.Attribute('testID', 'dock'),
      style({ backgroundColor: PAPER, borderTopWidth: 1, borderTopColor: LINE }),
    ],
    children: [
      box(
        [style({ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 })],
        [
          textInput(
            [
              h.Attribute('testID', 'draft'),
              h.Attribute('value', config.draft),
              h.Placeholder(config.placeholder),
              prop('editable', true),
              prop('returnKeyType', 'send'),
              // The Return key sends and leaves the keyboard up.
              prop('submitBehavior', 'submit'),
              h.OnInput(config.onChange),
              OnCustomEvent<Message>({
                name: 'submitEditing',
                f: () => Option.some(config.onSend),
              }),
              style({
                flex: 1,
                height: 44,
                fontSize: 17,
                color: INK,
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderWidth: 1,
                borderColor: LINE,
                borderRadius: 22,
              }),
            ],
            [],
          ),
          box(
            [
              h.Attribute('testID', 'send'),
              h.OnClick(config.onSend),
              style({
                height: 44,
                paddingHorizontal: 18,
                borderRadius: 22,
                backgroundColor: canSend ? ACCENT : LINE,
                alignItems: 'center',
                justifyContent: 'center',
              }),
            ],
            [
              text([style({ color: canSend ? PAPER : MUTED, fontSize: 16, fontWeight: '700' })], [
                'Send',
              ]),
            ],
          ),
        ],
      ),
    ],
  })
}
