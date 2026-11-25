/**
 * The transcript: the chat's rows in the adapter's own `list`, the empty
 * chat with its suggestions, the round button to the end (drawn on the
 * composer, see `scrollButtonView`), and the developer's numbers.
 *
 * The list is the adapter's own (src/list), not the Legend List port: it is
 * the one that knows the keyboard's "inset" way (the list keeps its full
 * height under the composer and the keyboard and scrolls to make room),
 * keeps blank space under the newest question so that question can sit near
 * the top while the reply streams in under it, and can show its own numbers.
 *
 * After Send, your question becomes the list's anchor (`anchorKey`): the
 * list scrolls it near the top by itself and leaves room under it. The reply
 * grows into that room. Once the reply is longer than the room, it runs off
 * the bottom and a round button offers the way to the end.
 *
 * Where the list is and whether it follows the end are the list's own,
 * outside this Model. The list reports reaching or leaving the end
 * (`ChangedAtEnd`) and starting or stopping to follow it
 * (`ChangedFollowing`), so a log of Messages says what the list did.
 */
import { Effect, Option, Schema } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { OnCustomEvent } from 'foldkit/renderTarget'
import { modifyFields } from 'foldkit/struct'

import { chatInsetAvailable } from '../../src/chat/index.js'
import { type NativeStyle, prop, pressedStyle, style } from '../../src/foldkit/attributes.js'
import { text, view as box } from '../../src/foldkit/elements.js'
import { dismissKeyboardOnDrag, keyboardDockMode } from '../../src/keyboard/index.js'
import { type ListNumbers, formatListNumbers, list, listRowCount, scrollListToEnd } from '../../src/list/index.js'
import { animated } from '../../src/motion/index.js'
import type { Context, Resources } from '../context.js'
import { holdNumbers } from '../longPress.js'
import type { ChatRow } from '../model.js'
import { PILL_BOTTOM } from './composer.js'
import { onTapAway } from '../tapAway.js'
import { MOTION, type Palette, RADIUS, SPACE, TYPE, paletteOf } from '../theme.js'
import { StyleHairline, arrowDown, roundButton, spinner } from '../ui.js'
import * as MessageRow from './messageRow.js'
import type * as ReplyStream from './replyStream.js'

export const TRANSCRIPT_ID = 'transcript'

/** A question taller than this shows only its last lines at the top, so the reply has room. */
const ANCHOR_MAX_SIZE = 3 * TYPE.message.lineHeight + 20
/** How far below the top of the list the question sits. */
const ANCHOR_OFFSET = SPACE.l
/**
 * How close to the composer's top the end of the list must be to count as
 * in view, in screen heights: about 8 points on a phone, less than a line.
 * The list's end is the composer's top, since its bottom inset is what the
 * composer and the keyboard cover.
 */
const AT_END_THRESHOLD = 0.01
/** The round button's size, and the gap between it and the composer's top. */
export const SCROLL_BUTTON_SIZE = 36
export const SCROLL_BUTTON_GAP = SPACE.s

/** Questions for an empty chat. Each picks a different kind of reply. */
export const SUGGESTIONS = [
  { id: 'running', label: 'Start running', text: 'How do I start running?' },
  { id: 'travel', label: 'Train or car?', text: 'Should I take the train or drive to the coast? Think it through.' },
  { id: 'weather', label: 'Weather in Lisbon', text: 'What is the weather in Lisbon tomorrow?' },
  { id: 'code', label: 'A debounce function', text: 'Write a debounce function in TypeScript.' },
] as const

// MODEL

export const Model = Schema.Struct({
  /** The question held near the top of the screen, by its row key. */
  anchorKey: Schema.Option(Schema.String),
  /** Whether the end of the list is on screen, as the list last said. */
  isAtEnd: Schema.Boolean,
  /** Whether the list follows the reply as it grows, as the list last said. Read by nothing. */
  isFollowing: Schema.Boolean,
  /**
   * What the keyboard is doing, as the list last said: moving to a height,
   * at rest, or dragged by a finger. The keyboard's own height is shared
   * (`keyboardHeight`); this is its phase. Read by nothing.
   */
  keyboard: Schema.Literals(['moving', 'resting', 'dragged']),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ anchorKey: Option.none(), isAtEnd: true, isFollowing: true, keyboard: 'resting' })

// MESSAGE

export const Message = defineMessageUnion({
  ChangedAtEnd: { isAtEnd: Schema.Boolean },
  ChangedFollowing: { isFollowing: Schema.Boolean },
  MovedKeyboard: { phase: Schema.Literals(['start', 'end', 'interactive']), height: Schema.UndefinedOr(Schema.Number) },
  PressedScrollToEnd: {},
  /** Android's scroll view cannot put the keyboard away by itself. */
  DraggedListWithKeyboardUp: {},
  /** A tap on the transcript that no button, link or hold took. */
  TappedTranscript: {},
  PressedSuggestion: { text: Schema.String },
  GotRowMessage: { rowKey: Schema.String, message: MessageRow.Message },
  CompletedSideEffect: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  /** A tap that nothing took: the keyboard goes away, if it is up. */
  Tapped: {},
  /** Android: a drag started with the keyboard up. */
  DraggedWithKeyboardUp: {},
  PressedSuggestion: { text: Schema.String },
  GotRowOutMessage: { message: MessageRow.OutMessage },
})
export type OutMessage = typeof OutMessage.Type

// UPDATE

const ScrollToEnd = Command.define('ChatScrollToEnd', {
  messages: [Message.CompletedSideEffect],
  execute: scrollListToEnd(TRANSCRIPT_ID, { animated: true }).pipe(Effect.as(Message.CompletedSideEffect())),
})

type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, Resources>

export const update = (model: Model, message: Message): Return =>
  Message.match<Return>(message, {
    ChangedAtEnd: ({ isAtEnd }) => ({ model: modifyFields(model, { isAtEnd: () => isAtEnd }) }),
    ChangedFollowing: ({ isFollowing }) => ({ model: modifyFields(model, { isFollowing: () => isFollowing }) }),
    MovedKeyboard: ({ phase }) => ({
      model: modifyFields(model, {
        keyboard: () => (phase === 'start' ? 'moving' : phase === 'end' ? 'resting' : 'dragged'),
      }),
    }),
    PressedScrollToEnd: () => ({ model, commands: [ScrollToEnd()] }),
    DraggedListWithKeyboardUp: () => ({ model, outMessage: OutMessage.DraggedWithKeyboardUp() }),
    TappedTranscript: () => ({ model, outMessage: OutMessage.Tapped() }),
    PressedSuggestion: ({ text }) => ({ model, outMessage: OutMessage.PressedSuggestion({ text }) }),
    GotRowMessage: ({ rowKey, message: rowMessage }) => {
      const row = MessageRow.update({}, rowMessage, rowKey)
      return row.outMessage === undefined
        ? { model }
        : row.outMessage._tag === 'Tapped'
          ? { model, outMessage: OutMessage.Tapped() }
          : { model, outMessage: OutMessage.GotRowOutMessage({ message: row.outMessage }) }
    },
    CompletedSideEffect: () => ({ model }),
  })

/** Holds this question near the top of the screen, or lets go. */
export const anchorAt = (model: Model, key: Option.Option<string>): Model =>
  modifyFields(model, { anchorKey: () => key })

// VIEW

export type ViewInputs = Context &
  Readonly<{
    rows: ReadonlyArray<ChatRow>
    /** The chat's rows are still on their way from the server. */
    isLoading: boolean
    reply: ReplyStream.Model
  }>

const emptyChat = (h: HtmlBuilder<Message>, palette: Palette): Html =>
  box(
    [
      prop('testID', 'empty-chat'),
      prop('pointerEvents', 'box-none'),
      style({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 140, alignItems: 'center', justifyContent: 'center', gap: SPACE.l, paddingHorizontal: SPACE.xxl }),
    ],
    [
      text([style({ ...TYPE.headline, color: palette.ink })], ['Ask anything']),
      box(
        [style({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SPACE.s })],
        SUGGESTIONS.map(suggestion =>
          box(
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

/**
 * Where the composer and the round button are, for the developer's numbers:
 * from the numbers the list has (see `ListNumbers.composer`). The round
 * button sits on the composer's top edge, with its gap under it.
 */
export const composerLine = (numbers: ListNumbers | undefined): string => {
  const composer = numbers?.composer
  if (numbers === undefined || composer === undefined) return ''
  const top = composer.top === undefined ? '-' : String(Math.round(composer.top))
  const keyboard =
    composer.keyboard > 0 ? `pill ${Math.round(composer.gap + PILL_BOTTOM)} above the keyboard` : 'keyboard down'
  const isButtonShown = numbers.isAtEnd === false && !numbers.isFollowing
  const button =
    !isButtonShown ? 'round button hidden'
    : composer.top === undefined ? 'round button y -'
    : `round button y ${Math.round(composer.top - SCROLL_BUTTON_GAP - SCROLL_BUTTON_SIZE)}`
  return `\ncomposer covers ${Math.round(composer.covered)} from the bottom, top y ${top}, ${keyboard}; ${button}`
}

const numbersStrip = (palette: Palette): Html =>
  box(
    [
      prop('testID', 'numbers'),
      prop('pointerEvents', 'none'),
      style({ position: 'absolute', top: 0, left: 0, right: 0, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: 'rgba(13,13,14,0.86)' }),
    ],
    [
      listRowCount(
        TRANSCRIPT_ID,
        [style({ color: '#FFFFFF', fontSize: 11, lineHeight: 15 })],
        stats => formatListNumbers(stats.numbers) + composerLine(stats.numbers),
      ),
      text(
        [style({ color: '#FFFFFF', fontSize: 11, lineHeight: 15 })],
        [`keyboard mode ${chatInsetAvailable() ? 'inset' : `follow (${keyboardDockMode()})`}, theme ${palette === paletteOf('dark') ? 'dark' : 'light'}`],
      ),
      // Which route reads a hold, and how the last one went (see longPress.ts).
      holdNumbers([style({ color: '#FFFFFF', fontSize: 11, lineHeight: 15 })]),
    ],
  )

/** Whether the round button to the end is wanted: the end is out of view, and the list is not on its way there. */
export const wantsScrollButton = (model: Model, rowCount: number): boolean =>
  rowCount > 0 && !model.isAtEnd && !model.isFollowing

/** Small and see-through as it comes and goes. */
const BUTTON_AWAY: NativeStyle = { opacity: 0, transform: [{ scale: 0.8 }] }
const BUTTON_HERE: NativeStyle = { opacity: 1, transform: [{ scale: 1 }] }

export type ScrollButtonInputs = Readonly<{ shared: Context['shared']; rowCount: number }>

/**
 * The round button to the end. It rides on the composer's top edge (the chat
 * screen hands it to `composerDock` as `overBar`), so the phone moves it with
 * the composer and the keyboard, frame by frame, and nothing here places it.
 * It fades and grows in, and fades and shrinks out.
 */
const scrollButtonView_ = (model: Model, inputs: ScrollButtonInputs, h: HtmlBuilder<Message>): Html => {
  const palette = paletteOf(inputs.shared.scheme)
  const button = animated(
    {
      enter: { from: BUTTON_AWAY, duration: MOTION.scrollButton, easing: 'easeOut' },
      exit: { to: BUTTON_AWAY, duration: MOTION.scrollButton, easing: 'easeOut' },
    },
    box(
      [h.Key('scroll-to-end-motion'), prop('testID', 'scroll-to-end-motion'), style(BUTTON_HERE)],
      [
        roundButton(
          h,
          {
            id: 'scroll-to-end',
            label: 'Scroll to the newest message',
            fill: palette.bg,
            size: SCROLL_BUTTON_SIZE,
            border: palette.line,
            onPress: Message.PressedScrollToEnd(),
            extra: { shadowColor: '#000000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
          },
          arrowDown(palette.ink),
        ),
      ],
    ),
  )
  return box(
    [
      prop('testID', 'scroll-to-end-seat'),
      // Touches beside the button go to the messages under it.
      prop('pointerEvents', 'box-none'),
      // The gap is padding, inside this view, so the button's touch area beyond
      // its circle stays inside the views around it.
      style({ alignItems: 'center', paddingTop: SPACE.s, paddingBottom: SCROLL_BUTTON_GAP }),
    ],
    wantsScrollButton(model, inputs.rowCount) ? [button] : [],
  )
}

export const scrollButtonView = Submodel.defineView<Model, Message, ScrollButtonInputs>(scrollButtonView_)

export const view_ = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { device, shared, rows } = inputs
  const palette = paletteOf(shared.scheme)
  const anchorIndex = Option.flatMap(model.anchorKey, key => {
    const index = rows.findIndex(row => row.key === key)
    return index < 0 ? Option.none() : Option.some(index)
  })
  const isInset = chatInsetAvailable()
  return box(
    // One key for the chat's whole life on screen: a new chat gets its id
    // after the first Send, and the list must not be built again then.
    [h.Key('messages'), style({ flex: 1, backgroundColor: palette.bg })],
    [
      list(h, {
        id: TRANSCRIPT_ID,
        items: rows,
        key: row => row.key,
        row: (row, index) =>
          h.submodel({
            slotId: `row-${row.key}`,
            view: MessageRow.view,
            model: {},
            viewInputs: { row, index, scheme: shared.scheme, device, reply: inputs.reply },
            toParentMessage: (message: MessageRow.Message) => Message.GotRowMessage({ rowKey: row.key, message }),
          }),
        estimatedRowHeight: 120,
        initialScrollAtEnd: true,
        atEndThreshold: AT_END_THRESHOLD,
        // Stays at the end when the keyboard opens or closes. After Send the
        // reply is left to run off the screen under the question, as in other
        // AI apps. Once the user asks for the end (the round button, or
        // scrolling there by hand) the list follows the reply as it is
        // written, until a drag up. See `Following` in src/host/list/controller.ts.
        maintainScrollAtEnd: { onlyWhenResized: true, followOnReturn: true },
        ...(isInset ? { keyboardInset: { lift: 'whenAtEnd' as const } } : {}),
        ...Option.match(anchorIndex, {
          onNone: () => ({}),
          onSome: index => ({ anchoredEndSpace: { anchorIndex: index, anchorMaxSize: ANCHOR_MAX_SIZE, anchorOffset: ANCHOR_OFFSET } }),
        }),
        onAtEndChanged: isAtEnd => Message.ChangedAtEnd({ isAtEnd }),
        onFollowChanged: isFollowing => Message.ChangedFollowing({ isFollowing }),
        onKeyboardMoved: (phase, height) => Message.MovedKeyboard({ phase, height }),
        attributes: [
          prop('testID', 'transcript'),
          style({ flex: 1 }),
          prop('indicatorStyle', shared.scheme === 'dark' ? 'white' : 'black'),
          dismissKeyboardOnDrag(),
          // A tap that no row or button takes puts the keyboard away, as in
          // Messages. A drag is not a tap, and the keyboard still follows the
          // finger down. See `tapAway.ts`.
          ...onTapAway(Message.TappedTranscript()),
          // Android's scroll view cannot put the keyboard away by itself.
          OnCustomEvent<Message>({
            name: 'scrollBeginDrag',
            f: () =>
              shared.keyboardHeight > 0 && device.platform === 'android'
                ? Option.some(Message.DraggedListWithKeyboardUp())
                : Option.none(),
          }),
        ],
      }),
      ...(rows.length === 0 && !inputs.isLoading ? [emptyChat(h, palette)] : []),
      ...(inputs.isLoading ? [box([style({ position: 'absolute', top: '40%', alignSelf: 'center' })], [spinner(device, palette.ink3)])] : []),
      ...(shared.showsNumbers ? [numbersStrip(palette)] : []),
    ],
  )
}

export const view = Submodel.defineView<Model, Message, ViewInputs>(view_)
