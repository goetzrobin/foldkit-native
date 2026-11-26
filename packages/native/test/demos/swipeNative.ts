/**
 * The native swipe actions demo.
 *
 * An inbox. Each row is this project's own native view: Swift on iOS,
 * Kotlin on Android (`modules/foldkit-swipe`). The line at the
 * top says whether this build of the app has that native code. Expo Go does
 * not: there the rows are plain views, nothing swipes, and the line says so.
 *
 * What to try in a build that has it:
 * - Drag a row to the left: Flag and Delete come out from under its edge.
 *   Let go past half way and it stays open.
 * - Drag a row all the way to the left: Delete grows to fill the row, the
 *   phone ticks, and letting go deletes the mail.
 * - Drag a row to the right: Read. Pressing it marks the mail read.
 * - Open one row, then start dragging another: the first closes.
 * - Press the grey "Press me" button inside a row: its count goes up. Start
 *   a swipe with the finger on that button: the count must not go up.
 * - Scroll the list up and down with a finger on a row: it scrolls.
 * - The switches change the look, turn the row right-to-left, and close
 *   whatever is open.
 *
 * "Last event" shows what the native view last told JavaScript.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  header,
  onPress,
  prop,
  safeArea,
  screen,
  scrollView,
  stack,
  style,
  text,
  title,
  view as box,
} from '../../src/index.js'
import {
  type SwipeMode,
  closeNativeSwipes,
  isNativeSwipeAvailable,
  nativeSwipeOptions,
  nativeSwipeRow,
  nativeSwipeStatus,
  swipeAction,
} from '../../src/swipeNative/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

/** Rows of this demo close each other. */
export const INBOX_GROUP = 'native-inbox'

// MODEL

const Mail = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  subject: Schema.String,
  isRead: Schema.Boolean,
  isFlagged: Schema.Boolean,
  /** How many times the button inside the row was pressed. */
  presses: Schema.Number,
})
type Mail = typeof Mail.Type

const ModeName = Schema.Literals(['tiles', 'strip', 'info'])

export const Model = Schema.Struct({
  mails: Schema.Array(Mail),
  mode: ModeName,
  isRightToLeft: Schema.Boolean,
  lastEvent: Schema.String,
})
export type Model = typeof Model.Type

const FIRST_MAILS: ReadonlyArray<Mail> = [
  ['Ada', 'Lunch on Thursday?'],
  ['Grace', 'The build is green again'],
  ['Linus', 'Patch for the scroll bug'],
  ['Margaret', 'Notes from the review'],
  ['Alan', 'A puzzle for the weekend'],
  ['Katherine', 'Numbers for the launch'],
  ['Tim', 'A link you will like'],
  ['Barbara', 'Slides for Monday'],
  ['Dennis', 'One small question'],
  ['Radia', 'Network map, second draft'],
].map(([from, subject], index) => ({
  id: `mail-${index + 1}`,
  from: from as string,
  subject: subject as string,
  isRead: false,
  isFlagged: false,
  presses: 0,
}))

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  OpenedRow: { id: Schema.String, side: Schema.Literals(['leading', 'trailing']) },
  ClosedRow: { id: Schema.String },
  TriggeredRead: { id: Schema.String, viaFullSwipe: Schema.Boolean },
  TriggeredFlag: { id: Schema.String, viaFullSwipe: Schema.Boolean },
  TriggeredDelete: { id: Schema.String, viaFullSwipe: Schema.Boolean },
  PressedRowButton: { id: Schema.String },
  PressedMode: { mode: ModeName },
  PressedToggleDirection: {},
  PressedCloseAll: {},
  CompletedCloseAll: {},
  PressedReset: {},
})
export type Message = typeof Message.Type

// UPDATE

const how = (viaFullSwipe: boolean): string => (viaFullSwipe ? 'by a full swipe' : 'by a press')

const makeUpdate = (env: DemoEnv) => {
  // Leaving the demo is a side effect, so it runs as a Command.
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  // So is telling the native rows to close.
  const CloseAll = Command.define('CloseAll', {
    messages: [Message.CompletedCloseAll],
    execute: closeNativeSwipes(INBOX_GROUP).pipe(Effect.as(Message.CompletedCloseAll())),
  })

  const change = (model: Model, id: string, edit: (mail: Mail) => Mail, lastEvent: string): Model =>
    modifyFields(model, {
      mails: mails => mails.map(mail => (mail.id === id ? edit(mail) : mail)),
      lastEvent: () => lastEvent,
    })

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      OpenedRow: ({ id, side }) => ({
        model: modifyFields(model, { lastEvent: () => `${id} opened on the ${side} side` }),
      }),
      ClosedRow: ({ id }) => ({
        model: modifyFields(model, { lastEvent: () => `${id} closed` }),
      }),
      TriggeredRead: ({ id, viaFullSwipe }) => ({
        model: change(
          model,
          id,
          mail => ({ ...mail, isRead: !mail.isRead }),
          `Read on ${id}, ${how(viaFullSwipe)}`,
        ),
      }),
      TriggeredFlag: ({ id, viaFullSwipe }) => ({
        model: change(
          model,
          id,
          mail => ({ ...mail, isFlagged: !mail.isFlagged }),
          `Flag on ${id}, ${how(viaFullSwipe)}`,
        ),
      }),
      TriggeredDelete: ({ id, viaFullSwipe }) => ({
        model: modifyFields(model, {
          mails: mails => mails.filter(mail => mail.id !== id),
          lastEvent: () => `Delete on ${id}, ${how(viaFullSwipe)}`,
        }),
      }),
      PressedRowButton: ({ id }) => ({
        model: change(
          model,
          id,
          mail => ({ ...mail, presses: mail.presses + 1 }),
          `Button pressed inside ${id}`,
        ),
      }),
      PressedMode: ({ mode }) => ({ model: modifyFields(model, { mode: () => mode }) }),
      PressedToggleDirection: () => ({
        model: modifyFields(model, { isRightToLeft: isOn => !isOn }),
      }),
      PressedCloseAll: () => ({ model, commands: [CloseAll()] }),
      CompletedCloseAll: () => ({
        model: modifyFields(model, { lastEvent: () => 'Asked every open row to close' }),
      }),
      PressedReset: () => ({
        model: modifyFields(model, { mails: () => FIRST_MAILS, lastEvent: () => 'List reset' }),
      }),
    })
}

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: { mails: FIRST_MAILS, mode: 'tiles', isRightToLeft: false, lastEvent: 'none yet' },
})

// VIEW

const INK = '#111111'
const PAPER = '#ffffff'
const DESK = '#f1f1f1'
const MUTED = '#5c5c5c'
const LINE = '#e3e3e3'
const ACCENT = '#c2410c'
const QUIET = '#4a4a4a'
const BLUE = '#2563eb'
const AMBER = '#d97706'

const button = (id: string, label: string, color: string, message: Message): Html =>
  box(
    [
      prop('testID', id),
      onPress(message),
      style({
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 14, fontWeight: '600' })], [label])],
  )

const buttons = (children: ReadonlyArray<Html>): Html =>
  box([style({ flexDirection: 'row', gap: 8 })], children)

const MODES: ReadonlyArray<Readonly<{ mode: SwipeMode; label: string }>> = [
  { mode: 'tiles', label: 'Tiles' },
  { mode: 'strip', label: 'Strip' },
  { mode: 'info', label: 'Info' },
]

const panel = (model: Model): Html =>
  box(
    [
      style({
        padding: 12,
        gap: 8,
        backgroundColor: PAPER,
        borderBottomWidth: 1,
        borderBottomColor: LINE,
      }),
    ],
    [
      text(
        [prop('testID', 'swipe-status'), style({ color: ACCENT, fontSize: 15, fontWeight: '600' })],
        [nativeSwipeStatus()],
      ),
      text(
        [prop('testID', 'swipe-hint'), style({ color: MUTED, fontSize: 13 })],
        [
          isNativeSwipeAvailable()
            ? 'Drag a row left for Flag and Delete, right for Read. Drag all the way left to delete.'
            : 'The rows below are plain views here. They do not swipe in this build.',
        ],
      ),
      text(
        [prop('testID', 'swipe-last-event'), style({ color: INK, fontSize: 14 })],
        [`Last event: ${model.lastEvent}`],
      ),
      buttons(
        MODES.map(({ mode, label }) =>
          button(
            `mode-${mode}`,
            `Look: ${label}`,
            model.mode === mode ? ACCENT : QUIET,
            Message.PressedMode({ mode }),
          ),
        ),
      ),
      buttons([
        button(
          'toggle-direction',
          model.isRightToLeft ? 'Direction: right to left' : 'Direction: left to right',
          QUIET,
          Message.PressedToggleDirection(),
        ),
        button('close-all', 'Close open rows', QUIET, Message.PressedCloseAll()),
      ]),
      buttons([
        button('reset', 'Reset the list', QUIET, Message.PressedReset()),
        button('exit', 'Exit', INK, Message.PressedExit()),
      ]),
    ],
  )

/** What Info mode shows in place of actions: facts about the mail. */
const facts = (mail: Mail) => [
  swipeAction<Message>({ key: 'state', label: mail.isRead ? 'Read' : 'Not read yet' }),
  swipeAction<Message>({ key: 'flag', label: mail.isFlagged ? 'Flagged' : 'Not flagged' }),
]

const mailRow = (model: Model, mail: Mail, h: HtmlBuilder<Message>): Html => {
  const { id } = mail
  const isInfo = model.mode === 'info'
  return nativeSwipeRow(
    [
      h.Key(id),
      prop('testID', `row-${id}`),
      nativeSwipeOptions<Message>({
        // The first action is at the outer edge. A full swipe triggers it.
        trailing: isInfo
          ? facts(mail)
          : [
              swipeAction({
                key: 'delete',
                label: 'Delete',
                symbol: 'trash',
                role: 'destructive',
                onTriggered: ({ viaFullSwipe }) => Message.TriggeredDelete({ id, viaFullSwipe }),
              }),
              swipeAction({
                key: 'flag',
                label: mail.isFlagged ? 'Unflag' : 'Flag',
                symbol: mail.isFlagged ? 'flag.slash' : 'flag',
                tint: AMBER,
                onTriggered: ({ viaFullSwipe }) => Message.TriggeredFlag({ id, viaFullSwipe }),
              }),
            ],
        leading: isInfo
          ? []
          : [
              swipeAction({
                key: 'read',
                label: mail.isRead ? 'Unread' : 'Read',
                symbol: mail.isRead ? 'envelope.badge' : 'envelope.open',
                tint: BLUE,
                onTriggered: ({ viaFullSwipe }) => Message.TriggeredRead({ id, viaFullSwipe }),
              }),
            ],
        allowsFullSwipe: true,
        mode: model.mode,
        group: INBOX_GROUP,
        cornerRadius: model.mode === 'tiles' ? 12 : 0,
        layoutDirection: model.isRightToLeft ? 'rtl' : 'ltr',
        onOpened: side => Message.OpenedRow({ id, side }),
        onClosed: () => Message.ClosedRow({ id }),
      }),
      style({ marginBottom: model.mode === 'tiles' ? 8 : 1 }),
    ],
    [
      // The content needs a background, or the tiles behind show through.
      box(
        [
          style({
            flexDirection: model.isRightToLeft ? 'row-reverse' : 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
            backgroundColor: PAPER,
          }),
        ],
        [
          box(
            [
              style({
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: mail.isRead ? LINE : BLUE,
              }),
            ],
            [],
          ),
          box(
            [style({ flex: 1, gap: 2 })],
            [
              text(
                [
                  prop('testID', `from-${id}`),
                  style({ color: INK, fontSize: 16, fontWeight: mail.isRead ? '400' : '700' }),
                ],
                [mail.isFlagged ? `${mail.from} (flagged)` : mail.from],
              ),
              text([style({ color: MUTED, fontSize: 14 })], [mail.subject]),
            ],
          ),
          box(
            [
              prop('testID', `press-${id}`),
              onPress(Message.PressedRowButton({ id })),
              style({
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 8,
                backgroundColor: DESK,
              }),
            ],
            [
              text(
                [prop('testID', `presses-${id}`), style({ color: INK, fontSize: 13 })],
                [`Press me: ${mail.presses}`],
              ),
            ],
          ),
        ],
      ),
    ],
  )
}

const list = (model: Model, h: HtmlBuilder<Message>): Html =>
  scrollView(
    [prop('testID', 'swipe-list'), style({ flex: 1, backgroundColor: DESK })],
    [
      box(
        [style({ padding: model.mode === 'tiles' ? 12 : 0 })],
        model.mails.length === 0
          ? [
              text(
                [prop('testID', 'swipe-empty'), style({ color: MUTED, fontSize: 15, padding: 16 })],
                ['No mail left. Press "Reset the list".'],
              ),
            ]
          : model.mails.map(mail => mailRow(model, mail, h)),
      ),
    ],
  )

const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    stack(
      [h.Key('swipe-native-stack')],
      [
        screen(
          [h.Key('swipe-native'), prop('testID', 'screen-swipe-native')],
          [
            header([title('Swipe actions (native view)')], []),
            safeArea(device, { hasHeader: true }, [
              box([style({ flex: 1, backgroundColor: PAPER })], [panel(model), list(model, h)]),
            ]),
          ],
        ),
      ],
    )

export const makeDemo = (container: HTMLElement, env: DemoEnv) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env),
    view: makeView(env.device),
    container,
  })
