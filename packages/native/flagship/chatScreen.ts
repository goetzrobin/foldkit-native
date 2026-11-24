/**
 * The chat screen: the transcript, the composer floating over it, and the
 * bar at the top.
 *
 * The transcript is the adapter's own `list` (src/list), not the Legend
 * List port: it is the one that knows the keyboard's "inset" way (the list
 * keeps its full height under the composer and the keyboard and scrolls to
 * make room), keeps blank space under the newest question so that question
 * can sit near the top while the reply streams in under it, and can show
 * its own numbers for a screenshot.
 *
 * After Send, your question becomes the list's anchor: the list scrolls it
 * near the top by itself and leaves room under it. The reply grows into
 * that room. Once the reply is longer than the room, it runs off the bottom
 * and a round button offers the way to the end.
 */
import { Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { OnCustomEvent } from 'foldkit/renderTarget'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import { type NativeStyle, prop, pressedStyle, style } from '../src/foldkit/attributes.js'
import { chatInsetAvailable, chatSafeArea, composerDock } from '../src/chat/index.js'
import { text, textInput, view } from '../src/foldkit/elements.js'
import { glass, glassOptions } from '../src/glass/index.js'
import { dismissKeyboardOnDrag, keyboardDockMode } from '../src/keyboard/index.js'
import { list, listNumbersLabel } from '../src/list/index.js'
import { markdown } from '../src/markdown/index.js'
import { animated } from '../src/motion/index.js'
import { type Device, onDismissed, screen } from '../src/foldkit/navigation/stack.js'
import { LiveTurnOps, MAX_RECONNECTS, type Part, type ReasoningPart, type ToolCallPart } from '../src/aiChat/index.js'
import { fieldName } from './focus.js'
import { onLongPress } from './longPress.js'
import { onTapAway } from './tapAway.js'
import { type ChatRow, Message, type Model, chatRows, clockOf, textOf, thoughtFor } from './model.js'
import { thinkingLabel } from './shimmer.js'
import { EASE_OUT_EXPO, ENTER_RISE, MOTION, type Palette, RADIUS, SPACE, TYPE, paletteOf } from './theme.js'
import {
  StyleHairline,
  arrowDown,
  arrowUp,
  copyIcon,
  cross,
  microphone,
  navBar,
  regenerateIcon,
  roundButton,
  shareIcon,
  spinner,
  stopSquare,
  textButton,
  tick,
} from './ui.js'

export const TRANSCRIPT_ID = 'transcript'
/** The composer's text field, by the name `focus.ts` knows it by. */
export const DRAFT_FIELD = 'draft'

/** A question taller than this shows only its last lines at the top, so the reply has room. */
const ANCHOR_MAX_SIZE = 3 * TYPE.message.lineHeight + 20
/** How far below the top of the list the question sits. */
const ANCHOR_OFFSET = SPACE.l

/** Questions for an empty chat. Each picks a different kind of reply. */
export const SUGGESTIONS = [
  { id: 'running', label: 'Start running', text: 'How do I start running?' },
  { id: 'travel', label: 'Train or car?', text: 'Should I take the train or drive to the coast? Think it through.' },
  { id: 'weather', label: 'Weather in Lisbon', text: 'What is the weather in Lisbon tomorrow?' },
  { id: 'code', label: 'A debounce function', text: 'Write a debounce function in TypeScript.' },
] as const

/** A voice note is kept as a fact: this text goes with it in place of a transcript. */
export const voiceNoteText = (seconds: number): string =>
  `(Voice note, ${clockOf(seconds)}. A transcript would go here: this demo has no speech to text.)`

const TOOL_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  get_weather: ['Checking the weather', 'Checked the weather'],
  search_notes: ['Searching your notes', 'Searched your notes'],
}

const toolWords = (part: ToolCallPart): string => {
  const words = TOOL_WORDS[part.name] ?? [`Using ${part.name}`, `Used ${part.name}`]
  return part.output === null ? words[0] : words[1]
}

const isStreamingRow = (row: ChatRow): boolean => row.status === 'streaming'

// THE ROWS

const metaRow = (
  id: string,
  children: ReadonlyArray<Html>,
  attributes: ReadonlyArray<unknown> = [],
): Html =>
  view(
    [
      prop('testID', id),
      style({ flexDirection: 'row', alignItems: 'center', gap: SPACE.s, minHeight: TYPE.meta.lineHeight, opacity: 1 }),
      ...(attributes as ReadonlyArray<never>),
    ],
    children,
  )

const reasoningRow = <Message_>(
  h: HtmlBuilder<Message_>,
  palette: Palette,
  row: ChatRow,
  part: ReasoningPart,
  onOpen: Message_,
): Html => {
  const isThinking = part.seconds === 0 && isStreamingRow(row)
  return metaRow(
    `${row.key}-reasoning`,
    isThinking
      ? [thinkingLabel(h, palette)]
      : [
          text(
            [style({ ...TYPE.meta, color: palette.ink2 })],
            [part.seconds > 0 ? thoughtFor(part.seconds) : 'Thought for a moment'],
          ),
          text([style({ ...TYPE.meta, color: palette.ink3 })], ['›']),
        ],
    [
      h.OnClick(onOpen),
      pressedStyle({ opacity: 0.5 }),
      prop('accessibilityRole', 'button'),
      prop('accessibilityHint', 'Shows the reasoning'),
    ],
  )
}

const toolRow = (device: Device, palette: Palette, row: ChatRow, part: ToolCallPart): Html =>
  metaRow(`${row.key}-tool-${part.callId}`, [
    part.output === null ? spinner(device, palette.ink3, 16) : tick(palette.ink3),
    text([style({ ...TYPE.meta, color: palette.ink2 })], [toolWords(part)]),
  ])

const markdownStyle = (palette: Palette) => ({
  colors: {
    text: palette.ink,
    heading: palette.ink,
    muted: palette.ink2,
    link: palette.accent,
    bullet: palette.ink2,
    rule: palette.line,
    inlineCodeBackground: palette.surface,
    inlineCodeBorder: palette.line,
    codeBackground: palette.surface,
    codeBorder: palette.line,
    quoteBar: palette.line,
    quoteBackground: palette.bg,
    tableBorder: palette.line,
    tableHeaderBackground: palette.surface,
    tableRowEven: palette.bg,
    tableRowOdd: palette.bg,
    checkboxChecked: palette.ink,
    checkboxBorder: palette.ink3,
    selection: palette.accent,
  },
  spacing: { radius: RADIUS.chip },
})

const partView = (
  h: HtmlBuilder<Message>,
  device: Device,
  model: Model,
  palette: Palette,
  row: ChatRow,
  part: Part,
  index: number,
): Html => {
  switch (part._tag) {
    case 'Reasoning':
      return reasoningRow(h, palette, row, part, Message.PressedReasoning({ rowKey: row.key }))
    case 'ToolCall':
      return toolRow(device, palette, row, part)
    case 'Text':
      return markdown(h, {
        id: `${row.key}-${index}`,
        text: part.text,
        isStreaming: isStreamingRow(row),
        colorScheme: model.scheme,
        style: markdownStyle(palette),
        // A long press opens the row's own menu; Select text is in it.
        selectable: false,
        onLink: url => Message.PressedLink({ url }),
        onCopyCode: copy => Message.CopiedCode({ language: copy.language }),
      })
  }
}

/** What is said under a reply that did not end well, and what can be done about it. */
const endOfReply = (h: HtmlBuilder<Message>, model: Model, palette: Palette, row: ChatRow): ReadonlyArray<Html> => {
  const live = Option.filter(model.live, each => each.messageId === row.key)
  const isLost = Option.exists(live, each => each.status === 'streaming' && each.connection === 'lost' && each.lostCount > MAX_RECONNECTS)
  if (isLost) {
    return [
      text([prop('testID', `${row.key}-lost`), style({ ...TYPE.caption, color: palette.ink3 })], ['The connection dropped.']),
      textButton(h, 'reconnect', 'Reconnect', palette.ink, Message.PressedReconnect()),
    ]
  }
  if (row.status === 'stopped') {
    return [text([prop('testID', `${row.key}-stopped`), style({ ...TYPE.caption, color: palette.ink3 })], ['Stopped'])]
  }
  if (row.status === 'failed') {
    return [
      text(
        [prop('testID', `${row.key}-failed`), style({ ...TYPE.caption, color: palette.danger })],
        [row.failure ?? 'The reply stopped early.'],
      ),
      ...(row.isLastReply ? [textButton(h, 'try-again', 'Try again', palette.ink, Message.PressedRegenerate())] : []),
    ]
  }
  return []
}

/** The small buttons under a finished reply. Regenerate only under the newest. */
const replyActions = (h: HtmlBuilder<Message>, palette: Palette, row: ChatRow): Html => {
  const action = (key: string, label: string, icon: Html) =>
    roundButton(
      h,
      { id: `${row.key}-${key}`, label, fill: 'transparent', size: 32, onPress: Message.PressedReplyAction({ rowKey: row.key, key }) },
      icon,
    )
  return view(
    [style({ flexDirection: 'row', gap: 2, marginLeft: -8 })],
    [
      action('copy', 'Copy', copyIcon(palette.ink3, palette.bg)),
      action('share', 'Share', shareIcon(palette.ink3)),
      ...(row.isLastReply ? [action('regenerate', 'Regenerate', regenerateIcon(palette.ink3))] : []),
    ],
  )
}

/** Fades in once your question has risen into place, as it does in Margelo's app. */
const THINKING_ENTER = { from: { opacity: 0 }, delay: 300, duration: 200, easing: 'easeOut' } as const

const replyRow = (h: HtmlBuilder<Message>, device: Device, model: Model, palette: Palette, row: ChatRow): Html => {
  const hasText = row.parts.some(part => part._tag === 'Text' && part.text !== '')
  // "Thinking" until the first word, except while a running tool or the
  // reasoning row already says what is going on.
  const last = row.parts[row.parts.length - 1]
  const isBusyElsewhere =
    (last?._tag === 'ToolCall' && last.output === null) || (last?._tag === 'Reasoning' && last.seconds === 0)
  const isWaiting = isStreamingRow(row) && !hasText && !isBusyElsewhere
  return view(
    [
      prop('testID', `row-${row.key}`),
      // Held while it streams too: the menu then offers Copy so far and Stop.
      ...(hasText || isStreamingRow(row)
        ? onLongPress<Message>(Message.LongPressedMessage({ rowKey: row.key }), Message.TappedTranscript())
        : []),
      style({ paddingHorizontal: SPACE.xl, paddingTop: SPACE.m, gap: SPACE.s, backgroundColor: palette.bg }),
    ],
    [
      ...(isWaiting
        ? [animated({ enter: THINKING_ENTER }, metaRow(`${row.key}-thinking`, [thinkingLabel(h, palette)], [h.Key('thinking')]))]
        : []),
      ...row.parts.map((part, index) => partView(h, device, model, palette, row, part, index)),
      ...endOfReply(h, model, palette, row),
      ...(hasText && (row.status === 'complete' || row.status === 'stopped') ? [replyActions(h, palette, row)] : []),
    ],
  )
}

const attachmentChip = (palette: Palette, name: string, trailing: ReadonlyArray<Html> = []): Html =>
  view(
    [
      style({
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.s,
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: RADIUS.chip,
        backgroundColor: palette.surface2,
      }),
    ],
    [microphone(palette.ink2), text([style({ ...TYPE.caption, color: palette.ink })], [name]), ...trailing],
  )

const questionRow = (h: HtmlBuilder<Message>, palette: Palette, row: ChatRow, isFirst: boolean): Html => {
  const bubble = view(
    [
      prop('testID', `row-${row.key}`),
      ...onLongPress<Message>(Message.LongPressedMessage({ rowKey: row.key }), Message.TappedTranscript()),
      style({
        maxWidth: '84%',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: RADIUS.bubble,
        backgroundColor: palette.surface,
        gap: SPACE.s,
      }),
    ],
    [
      ...row.attachments.map(each => attachmentChip(palette, each.name)),
      text([prop('selectable', false), style({ ...TYPE.message, color: palette.ink })], [textOf(row.parts)]),
    ],
  )
  const outer = view(
    [
      h.Key(`q-${row.key}`),
      style({
        paddingHorizontal: SPACE.xl,
        paddingTop: isFirst ? SPACE.l : SPACE.xxl,
        alignItems: 'flex-end',
        backgroundColor: palette.bg,
        opacity: 1,
        transform: [{ translateY: 0 }],
      }),
    ],
    [bubble],
  )
  // A message you just sent rises into place. Only while it is on its way:
  // a saved row scrolled back into view must not move again.
  return row.source === 'pending'
    ? animated(
        { enter: { from: { opacity: 0, transform: [{ translateY: ENTER_RISE }] }, duration: MOTION.messageEnter, easing: EASE_OUT_EXPO } },
        outer,
      )
    : outer
}

const rowView =
  (h: HtmlBuilder<Message>, device: Device, model: Model, palette: Palette) =>
  (row: ChatRow, index: number): Html =>
    row.role === 'user' ? questionRow(h, palette, row, index === 0) : replyRow(h, device, model, palette, row)

// THE EMPTY CHAT

const emptyChat = (h: HtmlBuilder<Message>, palette: Palette): Html =>
  view(
    [
      prop('testID', 'empty-chat'),
      prop('pointerEvents', 'box-none'),
      style({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 140, alignItems: 'center', justifyContent: 'center', gap: SPACE.l, paddingHorizontal: SPACE.xxl }),
    ],
    [
      text([style({ ...TYPE.headline, color: palette.ink })], ['Ask anything']),
      view(
        [style({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACE.s })],
        SUGGESTIONS.map(suggestion =>
          view(
            [
              h.Key(suggestion.id),
              prop('testID', `suggestion-${suggestion.id}`),
              prop('accessibilityRole', 'button'),
              h.OnClick(Message.PressedSuggestion({ text: suggestion.text })),
              pressedStyle({ backgroundColor: palette.surface2 }),
              style({
                paddingVertical: SPACE.s,
                paddingHorizontal: SPACE.m,
                borderRadius: RADIUS.chip,
                borderWidth: StyleHairline,
                borderColor: palette.line,
                backgroundColor: palette.surface,
              }),
            ],
            [text([style({ ...TYPE.rowPreview, color: palette.ink })], [suggestion.label])],
          ),
        ),
      ),
    ],
  )

// THE COMPOSER

/** Whether Send can be pressed now. */
export const canSend = (model: Model): boolean =>
  model.isOnline &&
  !LiveTurnOps.isStreaming(model.live) &&
  Option.isNone(model.recording) &&
  (model.draft.trim() !== '' || Option.isSome(model.attachment))

/** Roughly how tall the composer is, for placing the round button above it. */
const composerHeight = (model: Model): number => {
  const lines = Math.min(5, model.draft.split('\n').length + Math.floor(model.draft.length / 34))
  return 56 + (lines - 1) * TYPE.message.lineHeight + (Option.isSome(model.attachment) ? 40 : 0)
}

/** Send, Stop and the microphone take each other's place with a quick fade. */
const swapIn = (button: Html): Html =>
  animated({ enter: { from: { opacity: 0 }, duration: MOTION.sendStop, easing: 'easeOut' } }, button)

const sendOrStop = (h: HtmlBuilder<Message>, model: Model, palette: Palette): Html => swapIn(sendOrStopButton(h, model, palette))

const sendOrStopButton = (h: HtmlBuilder<Message>, model: Model, palette: Palette): Html => {
  const isStreaming = LiveTurnOps.isStreaming(model.live)
  if (isStreaming) {
    return roundButton(h, { id: 'stop', label: 'Stop the reply', fill: palette.ink, onPress: Message.PressedStop() }, stopSquare(palette.bg))
  }
  const isEmpty = model.draft.trim() === '' && Option.isNone(model.attachment)
  if (isEmpty && Option.isNone(model.recording)) {
    return roundButton(
      h,
      { id: 'mic', label: 'Record a voice note', fill: 'transparent', onPress: model.isOnline ? Message.PressedMic() : undefined },
      microphone(palette.ink2),
    )
  }
  const isOn = canSend(model)
  return roundButton(
    h,
    { id: 'send', label: 'Send', fill: isOn ? palette.accent : palette.surface2, onPress: isOn ? Message.PressedSend() : undefined },
    arrowUp(isOn ? palette.onAccent : palette.ink3),
  )
}

const recordingBar = (h: HtmlBuilder<Message>, palette: Palette, seconds: number, isNearLimit: boolean): Html =>
  view(
    [prop('testID', 'recording'), style({ flexDirection: 'row', alignItems: 'center', gap: SPACE.m, minHeight: 40, paddingLeft: SPACE.s })],
    [
      roundButton(h, { id: 'cancel-recording', label: 'Throw the recording away', fill: palette.surface2, size: 28, onPress: Message.PressedCancelRecording() }, cross(palette.ink2)),
      view([style({ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger })], []),
      text(
        [prop('testID', 'recording-time'), style({ ...TYPE.meta, color: isNearLimit ? palette.danger : palette.ink, flex: 1 })],
        [`Recording ${clockOf(seconds)}`],
      ),
      roundButton(h, { id: 'finish-recording', label: 'Done recording', fill: palette.ink, onPress: Message.PressedFinishRecording() }, tick(palette.bg)),
    ],
  )

const composer = (h: HtmlBuilder<Message>, device: Device, model: Model, palette: Palette): Html => {
  const field = textInput(
    [
      h.Key('draft'),
      prop('testID', 'draft'),
      fieldName(DRAFT_FIELD),
      h.Attribute('value', model.draft),
      h.Placeholder(model.isOnline ? 'Ask anything' : 'Offline'),
      prop('placeholderTextColor', palette.ink3),
      prop('selectionColor', palette.accent),
      prop('cursorColor', palette.accent),
      prop('multiline', true),
      prop('editable', true),
      // No `autoFocus`: a new chat focuses this field by a Command once its
      // push has finished, so the keyboard comes up once. See `focus.ts`.
      prop('keyboardAppearance', model.scheme),
      h.OnInput(words => Message.ChangedDraft({ text: words })),
      style({
        flex: 1,
        minHeight: 40,
        maxHeight: 5 * TYPE.message.lineHeight + 18,
        paddingTop: device.platform === 'ios' ? 10 : 8,
        paddingBottom: device.platform === 'ios' ? 10 : 8,
        paddingHorizontal: SPACE.m,
        ...TYPE.message,
        color: palette.ink,
      }),
    ],
    [],
  )
  const notice = Option.match(model.notice, {
    onNone: () => [],
    onSome: each => [
      text(
        [prop('testID', 'notice'), style({ ...TYPE.caption, color: each.tone === 'error' ? palette.danger : palette.ink2, marginHorizontal: SPACE.xl, marginBottom: 6 })],
        [each.text],
      ),
    ],
  })
  const attachment = Option.match(model.attachment, {
    onNone: () => [],
    onSome: each => [
      view(
        [style({ paddingHorizontal: 6, paddingTop: 4 })],
        [
          attachmentChip(palette, each.name, [
            roundButton(h, { id: 'remove-attachment', label: 'Remove the voice note', fill: 'transparent', size: 20, onPress: Message.PressedRemoveAttachment() }, cross(palette.ink3)),
          ]),
        ],
      ),
    ],
  })
  const pill = glass(
    [
      glassOptions({ isInteractive: false, fallbackStyle: { backgroundColor: palette.glassFallback, borderWidth: StyleHairline, borderColor: palette.line } }),
      prop('testID', 'composer'),
      style({ marginHorizontal: SPACE.m, marginBottom: SPACE.s, borderRadius: 26, padding: 6, gap: 4 }),
    ],
    [
      ...attachment,
      Option.match(model.recording, {
        onSome: each => recordingBar(h, palette, each.seconds, each.isNearLimit),
        onNone: () => view([style({ flexDirection: 'row', alignItems: 'flex-end', gap: 6 })], [field, view([style({ paddingBottom: 4, paddingRight: 2 })], [sendOrStop(h, model, palette)])]),
      }),
    ],
  )
  return view([style({ paddingTop: SPACE.s })], [...notice, pill])
}

// THE SCREEN

const numbersStrip = (palette: Palette): Html =>
  view(
    [
      prop('testID', 'numbers'),
      prop('pointerEvents', 'none'),
      style({ position: 'absolute', top: 0, left: 0, right: 0, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(13,13,14,0.86)' }),
    ],
    [
      listNumbersLabel(TRANSCRIPT_ID, [style({ color: '#FFFFFF', fontSize: 11, lineHeight: 15 })]),
      text(
        [style({ color: '#FFFFFF', fontSize: 11, lineHeight: 15 })],
        [`keyboard mode ${chatInsetAvailable() ? 'inset' : `follow (${keyboardDockMode()})`}, theme ${palette === paletteOf('dark') ? 'dark' : 'light'}`],
      ),
    ],
  )

const scrollButton = (h: HtmlBuilder<Message>, model: Model, palette: Palette): Html => {
  const covered = chatInsetAvailable() ? composerHeight(model) + (model.keyboardCovers > 0 ? model.keyboardCovers : 34) : 0
  const place: NativeStyle = { position: 'absolute', alignSelf: 'center', bottom: covered + SPACE.m, left: '50%', marginLeft: -18 }
  return animated(
    {
      enter: { from: { opacity: 0 }, duration: MOTION.scrollButton, easing: 'easeOut' },
      exit: { to: { opacity: 0 }, duration: MOTION.scrollButton, easing: 'easeOut' },
    },
    roundButton(
    h,
    { id: 'scroll-to-end', label: 'Scroll to the newest message', fill: palette.bg, size: 36, border: palette.line, onPress: Message.PressedScrollToEnd(), extra: { ...place, shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } } },
    arrowDown(palette.ink),
    ),
  )
}

/** The title in the bar, held down to show the developer's numbers. */
const barTitle = (palette: Palette, title: string): Html =>
  view(
    [prop('testID', 'chat-title'), ...onLongPress(Message.PressedNumbers()), style({ maxWidth: 220, paddingVertical: 6, paddingHorizontal: 8 })],
    [text([prop('numberOfLines', 1), style({ fontSize: 17, lineHeight: 22, fontWeight: '600', color: palette.ink })], [title])],
  )

export const chatTitle = (model: Model): string =>
  Option.match(AsyncResult.value(model.conversation), {
    onNone: () => 'New chat',
    onSome: each => (Option.contains(model.openId, each.id) ? each.title : 'New chat'),
  })

export const CHAT_MENU = [
  { key: 'rename', title: 'Rename', symbol: 'pencil' },
  { key: 'settings', title: 'Settings', symbol: 'gearshape' },
  { section: [{ key: 'delete', title: 'Delete', symbol: 'trash', isDestructive: true }] },
] as const

export const chatScreen = (h: HtmlBuilder<Message>, device: Device, model: Model): Html => {
  const palette = paletteOf(model.scheme)
  const rows = chatRows(model)
  const anchorIndex = Option.flatMap(model.anchorKey, key => {
    const index = rows.findIndex(row => row.key === key)
    return index < 0 ? Option.none() : Option.some(index)
  })
  const isLoading = Option.isSome(model.openId) && AsyncResult.isInitial(model.conversation) && rows.length === 0
  const isInset = chatInsetAvailable()

  const transcript = view(
    // One key for the chat's whole life on screen: a new chat gets its id
    // after the first Send, and the list must not be built again then.
    [h.Key('messages'), style({ flex: 1, backgroundColor: palette.bg })],
    [
      list(h, {
        id: TRANSCRIPT_ID,
        items: rows,
        key: row => row.key,
        row: rowView(h, device, model, palette),
        estimatedRowHeight: 120,
        initialScrollAtEnd: true,
        // Stays at the end when the keyboard opens or closes. After Send the
        // reply is left to run off the screen under the question, as in other
        // AI apps. Once the user asks for the end (the round button, or
        // scrolling there by hand) the list follows the reply as it is
        // written, until a drag up. See `Following` in src/list/module.ts.
        maintainScrollAtEnd: { onlyWhenResized: true, followOnReturn: true },
        ...(isInset ? { keyboardInset: { lift: 'whenAtEnd' as const } } : {}),
        ...Option.match(anchorIndex, {
          onNone: () => ({}),
          onSome: index => ({ anchoredEndSpace: { anchorIndex: index, anchorMaxSize: ANCHOR_MAX_SIZE, anchorOffset: ANCHOR_OFFSET } }),
        }),
        onAtEndChanged: isAtEnd => Message.ChangedAtEnd({ isAtEnd }),
        attributes: [
          prop('testID', 'transcript'),
          style({ flex: 1 }),
          prop('indicatorStyle', model.scheme === 'dark' ? 'white' : 'black'),
          dismissKeyboardOnDrag(),
          // A tap that no row or button takes puts the keyboard away, as in
          // Messages. A drag is not a tap, and the keyboard still follows the
          // finger down. See `tapAway.ts`.
          ...onTapAway(Message.TappedTranscript()),
          // Android's scroll view cannot put the keyboard away by itself.
          OnCustomEvent<Message>({
            name: 'scrollBeginDrag',
            f: () =>
              model.keyboardHeight > 0 && device.platform === 'android'
                ? Option.some(Message.DraggedListWithKeyboardUp())
                : Option.none(),
          }),
        ],
      }),
      ...(rows.length === 0 && !isLoading ? [emptyChat(h, palette)] : []),
      ...(isLoading ? [view([style({ position: 'absolute', top: '40%', alignSelf: 'center' })], [spinner(device, palette.ink3)])] : []),
      ...(model.isAtEnd || rows.length === 0 ? [] : [scrollButton(h, model, palette)]),
      ...(model.showsNumbers ? [numbersStrip(palette)] : []),
    ],
  )

  const offline = model.isOnline
    ? []
    : [
        view(
          [prop('testID', 'offline'), style({ paddingVertical: 6, paddingHorizontal: SPACE.xl, backgroundColor: palette.surface })],
          [text([style({ ...TYPE.caption, color: palette.ink2 })], ['You are offline. Sending is off until you are back.'])],
        ),
      ]

  return screen(
    [
      h.Key('chat'),
      prop('testID', 'screen-chat'),
      onDismissed(() => Message.PoppedChat()),
      // The push has finished. A new chat raises its keyboard then.
      OnCustomEvent<Message>({ name: 'appear', f: () => Option.some(Message.AppearedChat()) }),
      style({ backgroundColor: palette.bg }),
    ],
    [
      navBar(h, device, palette, {
        title: chatTitle(model),
        testID: 'bar-chat',
        center: barTitle(palette, chatTitle(model)),
        right: {
          id: 'chat-menu',
          symbol: 'ellipsis',
          label: 'More',
          menu: { items: CHAT_MENU, onSelected: key => Message.SelectedChatMenu({ key }) },
        },
      }),
      chatSafeArea(device, { hasHeader: true }, [
        view(
          [style({ flex: 1, backgroundColor: palette.bg })],
          [
            ...offline,
            composerDock(h, {
              mode: 'inset',
              listId: TRANSCRIPT_ID,
              keyboardHeight: model.keyboardCovers,
              above: [transcript],
              children: [composer(h, device, model, palette)],
            }),
          ],
        ),
      ]),
    ],
  )
}
