/**
 * The Swipe actions demo: drag a row sideways and actions appear behind it.
 *
 * What is on the screen:
 *
 * 1. Controls. Which driver moves the rows, with every driver this build
 *    knows and why one cannot run. The style of the inbox. Right to left.
 *    Full swipe. A line with the last thing a row told the program, and a
 *    count of taps on the small buttons inside the rows.
 * 2. An inbox. Drag a mail left for Flag and Delete, right for Read or
 *    Unread. With full swipe on, a long drag left deletes, and an Undo line
 *    brings the mail back.
 * 3. Tasks, in the classic strip style, with three actions.
 * 4. Chat bubbles in the info style: drag left to see when each was sent.
 *    Nothing is triggered and the bubble springs back.
 *
 * Every row has a small "Tap" button. A tap on it counts. A sideways drag
 * that starts on it swipes the row and does not count.
 */
import { Effect, type Layer, Option, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  Phone,
  header,
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
  type SwipeStyle,
  closeAllSwipes,
  info,
  resolveSwipeDriver,
  strip,
  swipeAction,
  swipeActions,
  swipeDrivers,
  swipeInfo,
  swipeRow,
  tiles,
} from '../../src/swipe/index.js'
import { gestureRoot } from '../../src/worklets/index.js'

const { Haptics } = Phone

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

export type SwipeDemoOptions = Readonly<{
  /** Whether the app reads right to left: React Native's `I18nManager.isRTL`. */
  rightToLeft?: boolean
  /** Whether the user asked the phone for less motion. */
  reduceMotion?: boolean
}>

const PAPER = '#F4F1EA'
const INK = '#1C1F23'
const MUTED = '#6B7280'
const LINE_COLOR = '#DDD8CC'
const PANEL = '#14171A'
const ROW = '#262B31'
const ROW_TEXT = '#F2F3F5'
const ROW_MUTED = '#A3ABB5'
const ACCENT = '#D9822B'
const BAD = '#B3261E'

// MODEL

const Mail = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  subject: Schema.String,
  isRead: Schema.Boolean,
  isFlagged: Schema.Boolean,
})
type Mail = typeof Mail.Type

const Task = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  isPinned: Schema.Boolean,
})
type Task = typeof Task.Type

const DriverLine = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  ok: Schema.Boolean,
  reason: Schema.String,
})

const StyleName = Schema.Literals(['tiles', 'strip', 'info'])
type StyleName = typeof StyleName.Type

export const Model = Schema.Struct({
  /** The driver asked for: `auto`, or a driver's name. */
  wantedDriver: Schema.String,
  /** Every driver this build knows, and whether it can run. */
  drivers: Schema.Array(DriverLine),
  /** The driver the rows really use, and why. */
  activeDriver: Schema.String,
  activeWhy: Schema.String,
  styleName: StyleName,
  isRightToLeft: Schema.Boolean,
  allowsFullSwipe: Schema.Boolean,
  mails: Schema.Array(Mail),
  /** The mail a swipe deleted last, and where it was, for Undo. */
  deleted: Schema.Option(Schema.Struct({ mail: Mail, index: Schema.Number })),
  tasks: Schema.Array(Task),
  lastEvent: Schema.String,
  events: Schema.Number,
  taps: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  CheckedDrivers: {
    drivers: Schema.Array(DriverLine),
    activeDriver: Schema.String,
    activeWhy: Schema.String,
  },
  PressedDriver: { name: Schema.String },
  PressedStyle: { name: StyleName },
  PressedRightToLeft: {},
  PressedFullSwipe: {},
  TriggeredMailAction: { id: Schema.String, key: Schema.String },
  TriggeredTaskAction: { id: Schema.String, key: Schema.String },
  OpenedRow: { id: Schema.String, side: Schema.String },
  ClosedRow: { id: Schema.String },
  CrossedFullSwipeLine: { id: Schema.String, isArmed: Schema.Boolean },
  PressedInsideRow: { id: Schema.String },
  PressedUndo: {},
  PressedCloseAll: {},
  CompletedCloseAll: {},
  GotHapticsMessage: { message: Haptics.Message },
})
export type Message = typeof Message.Type

const MAILS: ReadonlyArray<Mail> = [
  { id: 'mail-1', from: 'Ada', subject: 'Notes from Tuesday', isRead: false, isFlagged: false },
  { id: 'mail-2', from: 'Grace', subject: 'The compiler is ready', isRead: false, isFlagged: true },
  { id: 'mail-3', from: 'Alan', subject: 'Lunch on Friday?', isRead: true, isFlagged: false },
  { id: 'mail-4', from: 'Edsger', subject: 'A shorter path', isRead: true, isFlagged: false },
]

const TASKS: ReadonlyArray<Task> = [
  { id: 'task-1', title: 'Water the plants', isPinned: false },
  { id: 'task-2', title: 'Book the train', isPinned: true },
  { id: 'task-3', title: 'Call the plumber', isPinned: false },
]

const BUBBLES = [
  { id: 'bubble-1', words: 'Are you nearly here?', time: '09:41', isMine: false },
  { id: 'bubble-2', words: 'Two stops away.', time: '09:42', isMine: true },
  { id: 'bubble-3', words: 'I have a table by the window.', time: '09:44', isMine: false },
] as const

const STYLES: Readonly<Record<StyleName, SwipeStyle>> = { tiles, strip, info }

// COMMANDS

const makeCommands = (env: DemoEnv) => {
  // Leaving the demo is a side effect, so it runs as a Command.
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  /**
   * Asks which drivers can run. Waits a moment first so the first draw is
   * on the phone: the UI thread's pieces cannot start before there is a
   * screen.
   */
  const CheckDrivers = Command.define('CheckDrivers', {
    args: { wanted: Schema.String },
    messages: [Message.CheckedDrivers],
    execute: ({ wanted }) =>
      Effect.sleep(50).pipe(
        Effect.map(() => {
          const active = resolveSwipeDriver(wanted)
          return Message.CheckedDrivers({
            drivers: swipeDrivers().map(driver => ({ ...driver })),
            activeDriver: active.name,
            activeWhy: active.why,
          })
        }),
      ),
  })
  const CloseAll = Command.define('CloseAll', {
    messages: [Message.CompletedCloseAll],
    execute: closeAllSwipes().pipe(Effect.as(Message.CompletedCloseAll())),
  })
  return { Exit, CheckDrivers, CloseAll }
}

// UPDATE

const said = (model: Model, words: string): Model =>
  modifyFields(model, {
    events: events => events + 1,
    lastEvent: () => words,
  })

const makeUpdate = (commands: ReturnType<typeof makeCommands>) => {
  const { Exit, CheckDrivers, CloseAll } = commands
  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message, Phone.Haptics.Haptics>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      CheckedDrivers: ({ drivers, activeDriver, activeWhy }) => ({
        model: modifyFields(model, {
          drivers: () => drivers,
          activeDriver: () => activeDriver,
          activeWhy: () => activeWhy,
        }),
      }),
      PressedDriver: ({ name }) => ({
        model: modifyFields(model, { wantedDriver: () => name }),
        commands: [CheckDrivers({ wanted: name })],
      }),
      PressedStyle: ({ name }) => ({ model: modifyFields(model, { styleName: () => name }) }),
      PressedRightToLeft: () => ({
        model: modifyFields(model, { isRightToLeft: isOn => !isOn }),
        commands: [CloseAll()],
      }),
      PressedFullSwipe: () => ({
        model: modifyFields(model, { allowsFullSwipe: isOn => !isOn }),
      }),
      TriggeredMailAction: ({ id, key }) => {
        const index = model.mails.findIndex(mail => mail.id === id)
        const mail = model.mails[index]
        if (mail === undefined) return { model }
        const next = said(model, `${key} on ${id}`)
        if (key === 'delete') {
          return {
            model: modifyFields(next, {
              mails: mails => mails.filter(each => each.id !== id),
              deleted: () => Option.some({ mail, index }),
            }),
          }
        }
        const change = (each: Mail): Mail =>
          each.id !== id
            ? each
            : key === 'flag'
              ? { ...each, isFlagged: !each.isFlagged }
              : { ...each, isRead: !each.isRead }
        return { model: modifyFields(next, { mails: mails => mails.map(change) }) }
      },
      TriggeredTaskAction: ({ id, key }) => {
        const next = said(model, `${key} on ${id}`)
        if (key === 'delete') {
          return { model: modifyFields(next, { tasks: tasks => tasks.filter(each => each.id !== id) }) }
        }
        const change = (each: Task): Task =>
          each.id !== id
            ? each
            : key === 'pin'
              ? { ...each, isPinned: !each.isPinned }
              : { ...each, title: `${each.title} (renamed)` }
        return { model: modifyFields(next, { tasks: tasks => tasks.map(change) }) }
      },
      OpenedRow: ({ id, side }) => ({ model: said(model, `opened ${id} on its ${side} side`) }),
      ClosedRow: ({ id }) => ({ model: said(model, `closed ${id}`) }),
      CrossedFullSwipeLine: ({ id, isArmed }) => ({
        model: said(model, isArmed ? `${id} is past the full swipe line` : `${id} came back`),
        // The tap under the finger that says "let go now and it happens".
        commands: isArmed
          ? [
              Command.mapMessage(Haptics.Impact({ style: 'medium' }), haptics =>
                Message.GotHapticsMessage({ message: haptics }),
              ),
            ]
          : [],
      }),
      PressedInsideRow: () => ({ model: modifyFields(model, { taps: taps => taps + 1 }) }),
      PressedUndo: () =>
        Option.match(model.deleted, {
          onNone: () => ({ model }),
          onSome: ({ mail, index }) => ({
            model: modifyFields(said(model, `undo: ${mail.id} is back`), {
              mails: mails => [...mails.slice(0, index), mail, ...mails.slice(index)],
              deleted: () => Option.none(),
            }),
          }),
        }),
      PressedCloseAll: () => ({ model, commands: [CloseAll()] }),
      CompletedCloseAll: () => ({ model }),
      GotHapticsMessage: () => ({ model }),
    })
}

// VIEW

const heading = (words: string): Html =>
  text([style({ color: INK, fontSize: 18, fontWeight: '700' })], [words])

const hint = (words: string): Html => text([style({ color: MUTED, fontSize: 13 })], [words])

const chip = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  isOn: boolean,
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
        borderWidth: 1,
        borderColor: isOn ? INK : LINE_COLOR,
        backgroundColor: isOn ? INK : PAPER,
      }),
    ],
    [text([style({ color: isOn ? PAPER : INK, fontSize: 14, fontWeight: '600' })], [label])],
  )

const chips = (children: ReadonlyArray<Html>): Html =>
  box([style({ flexDirection: 'row', flexWrap: 'wrap', gap: 8 })], children)

/** The small button inside every row: a tap counts, a sideways drag swipes. */
const tapButton = (h: HtmlBuilder<Message>, id: string, color: string): Html =>
  box(
    [
      h.Attribute('testID', `${id}-tap`),
      h.OnClick(Message.PressedInsideRow({ id })),
      style({
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: color,
      }),
    ],
    [text([style({ color, fontSize: 13, fontWeight: '600' })], ['Tap'])],
  )

const makeView =
  (env: DemoEnv, options: SwipeDemoOptions) =>
  (model: Model, h: HtmlBuilder<Message>): Html => {
    const isRightToLeft = model.isRightToLeft
    /** A row lays its parts out from its leading edge. */
    const across = isRightToLeft ? 'row-reverse' : 'row'
    const align = isRightToLeft ? 'right' : 'left'
    const shared = (id: string, group: string) =>
      ({
        id,
        group,
        driver: model.wantedDriver,
        rightToLeft: isRightToLeft,
        reduceMotion: options.reduceMotion ?? false,
        onOpened: (side: string) => Message.OpenedRow({ id, side }),
        onClosed: () => Message.ClosedRow({ id }),
        onFullSwipeArmed: (isArmed: boolean) => Message.CrossedFullSwipeLine({ id, isArmed }),
      }) as const

    const mailRow = (mail: Mail): Html =>
      swipeRow(
        h,
        {
          ...shared(mail.id, 'inbox'),
          style: STYLES[model.styleName],
          leading: swipeActions(
            [
              swipeAction({
                key: 'read',
                label: mail.isRead ? 'Unread' : 'Read',
                onTriggered: Message.TriggeredMailAction({ id: mail.id, key: 'read' }),
              }),
            ],
            { allowsFullSwipe: model.allowsFullSwipe },
          ),
          trailing: swipeActions(
            [
              swipeAction({
                key: 'delete',
                label: 'Delete',
                role: 'destructive',
                onTriggered: Message.TriggeredMailAction({ id: mail.id, key: 'delete' }),
              }),
              swipeAction({
                key: 'flag',
                label: mail.isFlagged ? 'Unflag' : 'Flag',
                onTriggered: Message.TriggeredMailAction({ id: mail.id, key: 'flag' }),
              }),
            ],
            { allowsFullSwipe: model.allowsFullSwipe },
          ),
          accessibilityLabel: `${mail.from}, ${mail.subject}${mail.isRead ? '' : ', unread'}`,
          attributes: [h.Key(mail.id), h.Attribute('testID', mail.id)],
        },
        [
          box(
            [
              style({
                flexDirection: across,
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                paddingHorizontal: 18,
                backgroundColor: ROW,
              }),
            ],
            [
              box(
                [
                  style({
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: mail.isRead ? ROW : ACCENT,
                  }),
                ],
                [],
              ),
              box(
                [style({ flex: 1, gap: 2 })],
                [
                  text(
                    [style({ color: ROW_TEXT, fontSize: 16, fontWeight: '600', textAlign: align })],
                    [mail.isFlagged ? `${mail.from} (flagged)` : mail.from],
                  ),
                  text([style({ color: ROW_MUTED, fontSize: 14, textAlign: align })], [mail.subject]),
                ],
              ),
              tapButton(h, mail.id, ROW_MUTED),
            ],
          ),
        ],
      )

    const taskRow = (task: Task): Html =>
      swipeRow(
        h,
        {
          ...shared(task.id, 'tasks'),
          style: strip,
          trailing: swipeActions(
            [
              swipeAction({
                key: 'delete',
                label: 'Delete',
                role: 'destructive',
                onTriggered: Message.TriggeredTaskAction({ id: task.id, key: 'delete' }),
              }),
              swipeAction({
                key: 'pin',
                label: task.isPinned ? 'Unpin' : 'Pin',
                tint: ACCENT,
                onTriggered: Message.TriggeredTaskAction({ id: task.id, key: 'pin' }),
              }),
              swipeAction({
                key: 'rename',
                label: 'Rename',
                role: 'cancel',
                onTriggered: Message.TriggeredTaskAction({ id: task.id, key: 'rename' }),
              }),
            ],
            { allowsFullSwipe: model.allowsFullSwipe },
          ),
          accessibilityLabel: task.title,
          attributes: [h.Key(task.id), h.Attribute('testID', task.id)],
        },
        [
          box(
            [
              style({
                flexDirection: across,
                alignItems: 'center',
                gap: 12,
                paddingVertical: 14,
                paddingHorizontal: 16,
                backgroundColor: '#FFFFFF',
                borderBottomWidth: 1,
                borderBottomColor: LINE_COLOR,
              }),
            ],
            [
              text(
                [style({ flex: 1, color: INK, fontSize: 16, textAlign: align })],
                [task.isPinned ? `${task.title} (pinned)` : task.title],
              ),
              tapButton(h, task.id, MUTED),
            ],
          ),
        ],
      )

    const bubbleRow = (bubble: (typeof BUBBLES)[number]): Html =>
      swipeRow(
        h,
        {
          ...shared(bubble.id, 'chat'),
          style: info,
          trailing: swipeInfo(
            text([style({ color: MUTED, fontSize: 12, textAlign: 'center' })], [bubble.time]),
            { width: 64 },
          ),
          accessibilityLabel: `${bubble.words}, sent at ${bubble.time}`,
          attributes: [h.Key(bubble.id), h.Attribute('testID', bubble.id)],
        },
        [
          box(
            [
              style({
                flexDirection: across,
                justifyContent: bubble.isMine ? 'flex-end' : 'flex-start',
                alignItems: 'center',
                gap: 8,
                paddingVertical: 4,
                paddingHorizontal: 12,
                backgroundColor: PAPER,
              }),
            ],
            [
              box(
                [
                  style({
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    backgroundColor: bubble.isMine ? INK : '#E4DFD3',
                    maxWidth: '75%',
                  }),
                ],
                [
                  text(
                    [style({ color: bubble.isMine ? PAPER : INK, fontSize: 15 })],
                    [bubble.words],
                  ),
                ],
              ),
              tapButton(h, bubble.id, MUTED),
            ],
          ),
        ],
      )

    const driverChips = [
      chip(h, 'swipe-driver-auto', 'Automatic', model.wantedDriver === 'auto', Message.PressedDriver({ name: 'auto' })),
      ...model.drivers.map(driver =>
        chip(
          h,
          `swipe-driver-${driver.name}`,
          driver.label,
          model.wantedDriver === driver.name,
          Message.PressedDriver({ name: driver.name }),
        ),
      ),
    ]
    const activeLabel =
      model.drivers.find(driver => driver.name === model.activeDriver)?.label ?? model.activeDriver

    return stack(
      [h.Attribute('testID', 'stack')],
      [
        screen(
          [h.Key('swipe'), h.Attribute('testID', 'screen-swipe')],
          [
            header([title('Swipe actions')], []),
            safeArea(env.device, { hasHeader: true }, [
              // Android reads gestures inside this box. Elsewhere it is a plain view.
              gestureRoot(
                [style({ flex: 1 })],
                [
                  scrollView(
                    [h.Attribute('testID', 'swipe-scroll'), style({ flex: 1, backgroundColor: PAPER })],
                    [
                      box(
                        [style({ padding: 16, gap: 10 })],
                        [
                          heading('What moves the rows'),
                          chips(driverChips),
                          text(
                            [h.Attribute('testID', 'swipe-active'), style({ color: INK, fontSize: 14 })],
                            [
                              model.activeDriver === ''
                                ? 'Checking which drivers can run...'
                                : `In use: ${activeLabel} (${model.activeWhy})`,
                            ],
                          ),
                          ...model.drivers
                            .filter(driver => !driver.ok)
                            .map(driver =>
                              text(
                                [
                                  h.Attribute('testID', `swipe-driver-${driver.name}-reason`),
                                  style({ color: BAD, fontSize: 13 }),
                                ],
                                [`${driver.label}: not available. ${driver.reason}`],
                              ),
                            ),
                          hint('Style of the inbox'),
                          chips(
                            (['tiles', 'strip', 'info'] as const).map(name =>
                              chip(
                                h,
                                `swipe-style-${name}`,
                                name === 'tiles' ? 'Tiles' : name === 'strip' ? 'Strip' : 'Info',
                                model.styleName === name,
                                Message.PressedStyle({ name }),
                              ),
                            ),
                          ),
                          chips([
                            chip(
                              h,
                              'swipe-rtl',
                              isRightToLeft ? 'Right to left: on' : 'Right to left: off',
                              isRightToLeft,
                              Message.PressedRightToLeft(),
                            ),
                            chip(
                              h,
                              'swipe-full',
                              model.allowsFullSwipe ? 'Full swipe: on' : 'Full swipe: off',
                              model.allowsFullSwipe,
                              Message.PressedFullSwipe(),
                            ),
                            chip(h, 'swipe-close-all', 'Close all', false, Message.PressedCloseAll()),
                            chip(h, 'swipe-exit', 'Back to the menu', false, Message.PressedExit()),
                          ]),
                          text(
                            [h.Attribute('testID', 'swipe-last-event'), style({ color: INK, fontSize: 14 })],
                            [
                              model.events === 0
                                ? 'Last event: none yet'
                                : `Last event: ${model.lastEvent} (${model.events} so far)`,
                            ],
                          ),
                          text(
                            [h.Attribute('testID', 'swipe-taps'), style({ color: INK, fontSize: 14 })],
                            [`Taps on the small buttons: ${model.taps}`],
                          ),
                        ],
                      ),

                      box(
                        [style({ paddingHorizontal: 16, gap: 4 })],
                        [
                          heading('Inbox'),
                          hint('Drag left for Flag and Delete. Drag right for Read. Only one row stays open.'),
                        ],
                      ),
                      box(
                        [
                          h.Attribute('testID', 'swipe-inbox'),
                          style({ margin: 12, padding: 8, gap: 8, borderRadius: 30, backgroundColor: PANEL }),
                        ],
                        model.mails.map(mailRow),
                      ),
                      Option.match(model.deleted, {
                        onNone: () => h.empty,
                        onSome: ({ mail }) =>
                          box(
                            [
                              style({
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 12,
                                paddingHorizontal: 16,
                                paddingBottom: 8,
                              }),
                            ],
                            [
                              text(
                                [h.Attribute('testID', 'swipe-deleted'), style({ flex: 1, color: INK, fontSize: 14 })],
                                [`Deleted "${mail.subject}".`],
                              ),
                              chip(h, 'swipe-undo', 'Undo', true, Message.PressedUndo()),
                            ],
                          ),
                      }),

                      box(
                        [style({ paddingHorizontal: 16, paddingTop: 8, gap: 4 })],
                        [heading('Tasks'), hint('The classic strip, with three actions. Drag left.')],
                      ),
                      box(
                        [h.Attribute('testID', 'swipe-tasks'), style({ marginVertical: 12 })],
                        model.tasks.map(taskRow),
                      ),

                      box(
                        [style({ paddingHorizontal: 16, paddingTop: 8, gap: 4 })],
                        [
                          heading('Chat'),
                          hint('Drag a bubble left to see when it was sent. It springs back.'),
                        ],
                      ),
                      box(
                        [h.Attribute('testID', 'swipe-chat'), style({ marginVertical: 12, paddingBottom: 40 })],
                        BUBBLES.map(bubbleRow),
                      ),
                    ],
                  ),
                ],
              ),
            ]),
          ],
        ),
      ],
    )
  }

/**
 * `resources` is the Layer with the phone's services (`Phone.live({...})`
 * in an app, `Phone.makeTest().layer` in a test). The demo uses haptics.
 */
export const makeDemo = (
  container: HTMLElement,
  env: DemoEnv,
  resources: Layer.Layer<Phone.Services>,
  options: SwipeDemoOptions = {},
) => {
  const commands = makeCommands(env)
  const init: Runtime.ElementInit<Model, Message> = () => ({
    model: {
      wantedDriver: 'auto',
      drivers: [],
      activeDriver: '',
      activeWhy: '',
      styleName: 'tiles',
      isRightToLeft: options.rightToLeft ?? false,
      allowsFullSwipe: true,
      mails: MAILS,
      deleted: Option.none(),
      tasks: TASKS,
      lastEvent: '',
      events: 0,
      taps: 0,
    },
    commands: [commands.CheckDrivers({ wanted: 'auto' })],
  })
  return Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(commands),
    view: makeView(env, options),
    resources,
    container,
  })
}
