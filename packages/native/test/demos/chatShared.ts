/**
 * Parts the two chat demos share: colors, the composer (text field and Send
 * button), the round button that scrolls to the newest message, and the
 * strip of buttons and hints at the top.
 *
 * Nothing here holds state. Each demo keeps the draft, the keyboard height,
 * "is the list at its end" and which dock is in use in its own Model and
 * passes them in.
 *
 * There are three docks (see `src/chat/composerDock.ts`), and a button in
 * each demo goes round them, so all can be tried on one phone:
 *
 * - "inset": the list keeps its full height and the composer lies over its
 *   bottom edge and travels with the keyboard. The list makes room by
 *   scrolling. This is how react-native-keyboard-controller and Legend List
 *   do it, and what the demos open with.
 * - "following": the composer and the list travel with the keyboard where
 *   the phone can do that, and ease to their places where it cannot.
 * - "simple": the composer is padded by the keyboard's height and jumps.
 */
import { Option, Schema } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent } from 'foldkit/renderTarget'

import {
  type ComposerDockMode,
  type KeyboardLiftBehavior,
  chatInsetAvailable,
  chatInsetFallbackReason,
  composerDock,
} from '../../src/chat/index.js'
import { prop, style, text, textInput, view as box } from '../../src/index.js'
import { listNumbersLabel } from '../../src/list/index.js'
import {
  dismissKeyboardOnDrag,
  keyboardDockFallbackReason,
  keyboardDockMode,
} from '../../src/keyboard/index.js'

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

/**
 * The strip above the list: buttons, one line of state, what to try, and one
 * line on what the keyboard should do.
 */
export const topStrip = (
  buttons: ReadonlyArray<Html>,
  status: string,
  hint: string,
  keyboardNote: string,
): Html =>
  box(
    [style({ padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: LINE })],
    [
      box([style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })], buttons),
      text([prop('testID', 'status'), style({ color: ACCENT, fontSize: 14, fontWeight: '600' })], [
        status,
      ]),
      text([prop('testID', 'hint'), style({ color: MUTED, fontSize: 13 })], [hint]),
      text([prop('testID', 'dock-note'), style({ color: MUTED, fontSize: 13 })], [keyboardNote]),
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
export const scrollToEndButton = <Message>(
  h: HtmlBuilder<Message>,
  message: Message,
  /** How far above the bottom of the list's box. */
  bottom = 16,
): Html =>
  box(
    [
      h.Attribute('testID', 'scroll-to-end'),
      prop('accessibilityLabel', 'Scroll to the newest message'),
      h.OnClick(message),
      style({
        position: 'absolute',
        right: 16,
        bottom,
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

/** Which dock a demo uses. Kept in its Model. */
export const DockMode = Schema.Literals(['inset', 'follow', 'simple'])
export type DockMode = ComposerDockMode

const DOCK_MODES: ReadonlyArray<DockMode> = ['inset', 'follow', 'simple']

/** The mode the button goes to next: inset, following, simple, and round again. */
export const nextDockMode = (mode: DockMode): DockMode =>
  DOCK_MODES[(DOCK_MODES.indexOf(mode) + 1) % DOCK_MODES.length] ?? 'inset'

/** Whether the list lies under the composer: "inset", on a phone that can do it. */
export const isInset = (mode: DockMode): boolean => mode === 'inset' && chatInsetAvailable()

const DOCK_MODE_LABEL: Record<DockMode, string> = {
  inset: 'Keyboard: inset',
  follow: 'Keyboard: following',
  simple: 'Keyboard: simple',
}

/**
 * How far the round button must stand above the bottom of the list's box.
 * In "inset" the list runs under the composer and the keyboard, so the
 * button is raised by a composer's height, and by the keyboard while it is
 * up. The numbers are this demo's own composer and an iPhone's bottom strip.
 */
export const roundButtonBottom = (mode: DockMode, keyboardHeight: number): number => {
  if (!isInset(mode)) return 16
  const composer = 65
  const strip = 34
  return 16 + composer + (keyboardHeight > 0 ? keyboardHeight : strip)
}

/** What the messages do as the keyboard opens. Kept in a demo's Model. */
export const Lift = Schema.Literals(['always', 'whenAtEnd', 'persistent', 'never'])
export type Lift = KeyboardLiftBehavior

const LIFTS: ReadonlyArray<Lift> = ['whenAtEnd', 'persistent', 'always', 'never']

export const nextLift = (lift: Lift): Lift =>
  LIFTS[(LIFTS.indexOf(lift) + 1) % LIFTS.length] ?? 'whenAtEnd'

/** The button that says what the messages do as the keyboard opens, and goes to the next way. */
export const liftButton = <Message>(h: HtmlBuilder<Message>, lift: Lift, message: Message): Html =>
  smallButton(h, 'lift', `Lift: ${lift}`, message)

/** One sentence on a way of lifting, for the strip at the top. */
export const liftNote = (lift: Lift): string =>
  ({
    always: 'Lift "always": the messages rise with the keyboard and come back down with it.',
    whenAtEnd:
      'Lift "whenAtEnd" (as ChatGPT): the messages rise with the keyboard only when the ' +
      'newest one is in view.',
    persistent:
      'Lift "persistent" (as Claude): the messages rise with the keyboard and stay up when ' +
      'it closes.',
    never: 'Lift "never": the messages stay and the keyboard covers them.',
  })[lift]

/** The button that says which dock is in use and switches to the other. */
export const dockModeButton = <Message>(
  h: HtmlBuilder<Message>,
  mode: DockMode,
  message: Message,
): Html =>
  smallButton(h, 'dock-mode', DOCK_MODE_LABEL[mode], message)

/** One sentence on what the text field should do in this mode, on this phone. */
export const dockModeNote = (mode: DockMode): string => {
  if (mode === 'simple') return 'Keyboard: the text field jumps to its place above the keyboard.'
  if (mode === 'inset') {
    return chatInsetAvailable()
      ? 'Keyboard: the text field travels up with the keyboard. The messages are not resized.'
      : `Keyboard: "inset" is not possible here (${chatInsetFallbackReason()}), so the text ` +
          'field eases up to the keyboard.'
  }
  return keyboardDockMode() === 'native'
    ? 'Keyboard: the text field and the messages should travel up with the keyboard.'
    : `Keyboard: the text field eases up to the keyboard (${keyboardDockFallbackReason()}).`
}

/**
 * A strip of the list's own numbers over the top of the list, for a
 * screenshot when something is not where it should be. The adapter rewrites
 * it when the list draws or comes to rest. Put it in the box that holds the
 * list, after the list.
 */
export const numbersOverlay = (listId: string): Html =>
  box(
    [
      prop('testID', 'numbers'),
      prop('pointerEvents', 'none'),
      style({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingVertical: 4,
        paddingHorizontal: 8,
        backgroundColor: 'rgba(17,17,17,0.85)',
      }),
    ],
    [listNumbersLabel(listId, [style({ color: PAPER, fontSize: 11, lineHeight: 15 })])],
  )

/** The button that shows or hides the numbers. */
export const numbersButton = <Message>(
  h: HtmlBuilder<Message>,
  isShown: boolean,
  message: Message,
): Html => smallButton(h, 'numbers-button', isShown ? 'Hide numbers' : 'Show numbers', message)

export type Composer<Message> = Readonly<{
  draft: string
  placeholder: string
  /** How much of the app's window the keyboard covers. From `ShownKeyboard`. */
  keyboardHeight: number
  dockMode: DockMode
  /** The id of the list in `messages`, for "inset". */
  listId: string
  /** The list of messages, in a box with `flex: 1`. */
  messages: Html
  onChange: (text: string) => Message
  onSend: Message
}>

/**
 * The list of messages with the text field and Send button under it, docked
 * above the keyboard. Spread the result into the screen's column.
 *
 * In "simple" mode these are the two views this demo has always drawn: the
 * list, then the dock. In "following" and "inset" the dock is given the
 * list, to move it or to lie over it.
 */
export const messagesAndComposer = <Message>(
  h: HtmlBuilder<Message>,
  config: Composer<Message>,
): ReadonlyArray<Html> => {
  const canSend = config.draft.trim() !== ''
  const isFollowing = config.dockMode !== 'simple'
  const dock = composerDock(h, {
    keyboardHeight: config.keyboardHeight,
    mode: config.dockMode,
    ...(isFollowing
      ? {
          above: [config.messages],
          listId: config.listId,
          backgroundColor: PAPER,
          attributes: [
            h.Attribute('testID', 'dock'),
            style({ borderTopWidth: 1, borderTopColor: LINE }),
          ],
        }
      : {
          attributes: [
            h.Attribute('testID', 'dock'),
            style({ backgroundColor: PAPER, borderTopWidth: 1, borderTopColor: LINE }),
          ],
        }),
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
  return isFollowing ? [dock] : [config.messages, dock]
}

/**
 * Attributes for the list: a drag on it puts the keyboard away.
 *
 * iOS does this by itself with `keyboardDismissMode`. Android's scroll view
 * has no such thing (React Native does it in JavaScript), so the start of a
 * drag is also sent as a Message, only while the keyboard is up. That is one
 * Message per drag, not one per scroll event.
 *
 * The exception is the "following" dock on a phone that moves it natively.
 * There the keyboard follows the finger down, and may come back up if the
 * finger lets go early, so the program must not put it away itself.
 */
export const dismissOnDrag = <Message>(
  dockMode: DockMode,
  isKeyboardUp: boolean,
  message: Message,
): ReadonlyArray<unknown> => {
  const isDraggedByFinger = dockMode !== 'simple' && keyboardDockMode() === 'native'
  return [
    dockMode !== 'simple' ? dismissKeyboardOnDrag() : prop('keyboardDismissMode', 'on-drag'),
    OnCustomEvent<Message>({
      name: 'scrollBeginDrag',
      f: () => (isKeyboardUp && !isDraggedByFinger ? Option.some(message) : Option.none()),
    }),
  ]
}
