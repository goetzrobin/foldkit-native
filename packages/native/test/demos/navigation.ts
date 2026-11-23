/**
 * The navigation demo: three tabs, each with its own stack of screens.
 *
 *   Stack    push several levels deep, pop, pop to a level, replace. The
 *            screen prints the depth and the routes the Model holds, so a
 *            person can see the Model agree after a swipe-back.
 *   Present  a modal and a sheet, closed by a button (the Model) or by a
 *            swipe-down (the phone, with the Model catching up).
 *   Bar      navigation bar options: large title, a bar button that counts,
 *            hiding the bar, and a screen that refuses to go back.
 *
 * Android's Back button pops the top screen of the tab in front, and leaves
 * the app from a tab's first screen.
 */
import { Effect, Schema } from 'effect'
import { Command, Runtime, Subscription, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { scrollView, text, view as box } from '../../src/index.js'
import {
  type BackSource,
  type Device,
  backBlocked,
  canPop,
  hardwareBack,
  navigationBar,
  noBackSource,
  pop,
  popByPhone,
  popTo,
  popToRoot,
  presentation,
  prop,
  push,
  replace,
  safeArea,
  sheet,
  stackOf,
  style,
  tab,
  tabs,
} from '../../src/navigation.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

/** The demo also listens for Android's Back button when given a source. */
export type NavigationDemoEnv = DemoEnv & Readonly<{ backSource?: BackSource }>

// MODEL

/** A screen in the first tab. The id tells two screens at one depth apart. */
const Level = Schema.Struct({ id: Schema.Number })
type Level = typeof Level.Type

const PresentRoute = defineTaggedUnion({
  Home: {},
  /** A modal, in the native view made for presented screens. */
  Modal: {},
  /** A sheet that rests at half height and at full height. */
  Sheet: {},
  /** A modal in the plain screen view, to compare on a phone. */
  PlainModal: {},
})
type PresentRoute = typeof PresentRoute.Type

const BarRoute = defineTaggedUnion({ Options: {}, Detail: {} })
type BarRoute = typeof BarRoute.Type

const TAB_STACK = 'stack'
const TAB_PRESENT = 'present'
const TAB_BAR = 'bar'

export const Model = Schema.Struct({
  /** The key of the tab in front. */
  tab: Schema.String,
  /** Each tab's own stack, the last route on top. */
  levels: Schema.Array(Level),
  presented: Schema.Array(PresentRoute),
  bar: Schema.Array(BarRoute),
  nextLevelId: Schema.Number,
  closedByButton: Schema.Number,
  closedByPhone: Schema.Number,
  isLargeTitle: Schema.Boolean,
  isBarHidden: Schema.Boolean,
  isBackBlocked: Schema.Boolean,
  barButtonPresses: Schema.Number,
  refusedBacks: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  SelectedTab: { key: Schema.String },
  ReselectedTab: { key: Schema.String },
  PressedGoToBarTab: {},
  PressedPush: { count: Schema.Number },
  PressedPop: {},
  PressedPopToRoot: {},
  PressedPopToSecond: {},
  PressedReplace: {},
  PoppedLevelsByPhone: { count: Schema.Number },
  PressedPresent: { route: PresentRoute },
  PressedClose: {},
  ClosedByPhone: { count: Schema.Number },
  PressedBarButton: {},
  PressedToggleLargeTitle: {},
  PressedToggleBar: {},
  PressedToggleBlockBack: {},
  PressedOpenDetail: {},
  PressedLeaveDetail: {},
  PoppedBarByPhone: { count: Schema.Number },
  TriedToGoBack: {},
  PressedHardwareBack: {},
  PressedExit: {},
  CompletedExit: {},
})
export type Message = typeof Message.Type

// UPDATE

const pushLevels = (model: Model, count: number): Model => {
  const added = Array.from({ length: count }, (_unused, index) => ({
    id: model.nextLevelId + index,
  }))
  return modifyFields(model, {
    levels: levels => added.reduce(push, levels),
    nextLevelId: nextLevelId => nextLevelId + count,
  })
}

/** Whether the screen in front may not be left right now. */
const isBackRefused = (model: Model): boolean =>
  model.tab === TAB_BAR && model.isBackBlocked && model.bar.at(-1)?._tag === 'Detail'

/** Whether the tab in front has a screen to go back from. */
export const canGoBack = (model: Model): boolean =>
  model.tab === TAB_STACK
    ? canPop(model.levels)
    : model.tab === TAB_PRESENT
      ? canPop(model.presented)
      : canPop(model.bar)

const goBack = (model: Model): Model =>
  model.tab === TAB_STACK
    ? modifyFields(model, { levels: levels => pop(levels) })
    : model.tab === TAB_PRESENT
      ? modifyFields(model, {
          presented: presented => pop(presented),
          closedByButton: count => count + 1,
        })
      : modifyFields(model, { bar: bar => pop(bar) })

const popTabToRoot = (model: Model, key: string): Model =>
  key === TAB_STACK
    ? modifyFields(model, { levels: popToRoot })
    : key === TAB_PRESENT
      ? modifyFields(model, { presented: popToRoot })
      : key === TAB_BAR
        ? modifyFields(model, { bar: popToRoot })
        : model

/** One Command, as `update` returns them. */
type DemoCommand = NonNullable<Update.Return<Model, Message>['commands']>[number]

const makeUpdate =
  (Exit: () => DemoCommand) =>
  (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      // The phone already shows this tab. The Model agrees.
      SelectedTab: ({ key }) => ({ model: modifyFields(model, { tab: () => key }) }),
      ReselectedTab: ({ key }) => ({ model: popTabToRoot(model, key) }),
      PressedGoToBarTab: () => ({ model: modifyFields(model, { tab: () => TAB_BAR }) }),

      PressedPush: ({ count }) => ({ model: pushLevels(model, count) }),
      PressedPop: () => ({ model: modifyFields(model, { levels: levels => pop(levels) }) }),
      PressedPopToRoot: () => ({ model: modifyFields(model, { levels: popToRoot }) }),
      PressedPopToSecond: () => ({
        model: modifyFields(model, {
          levels: levels => popTo(levels, level => level === levels[1]),
        }),
      }),
      PressedReplace: () => ({
        model: modifyFields(model, {
          levels: levels => replace(levels, { id: model.nextLevelId }),
          nextLevelId: nextLevelId => nextLevelId + 1,
        }),
      }),
      // The phone has already popped these screens. Drop the same number.
      PoppedLevelsByPhone: ({ count }) => ({
        model: modifyFields(model, { levels: levels => popByPhone(levels, count) }),
      }),

      PressedPresent: ({ route }) => ({
        model: modifyFields(model, { presented: presented => push(presented, route) }),
      }),
      PressedClose: () => ({
        model: modifyFields(model, {
          presented: presented => pop(presented),
          closedByButton: count => count + 1,
        }),
      }),
      ClosedByPhone: ({ count }) => ({
        model: modifyFields(model, {
          presented: presented => popByPhone(presented, count),
          closedByPhone: closed => closed + 1,
        }),
      }),

      PressedBarButton: () => ({
        model: modifyFields(model, { barButtonPresses: presses => presses + 1 }),
      }),
      PressedToggleLargeTitle: () => ({
        model: modifyFields(model, { isLargeTitle: isLarge => !isLarge }),
      }),
      PressedToggleBar: () => ({
        model: modifyFields(model, { isBarHidden: isHidden => !isHidden }),
      }),
      PressedToggleBlockBack: () => ({
        model: modifyFields(model, { isBackBlocked: isBlocked => !isBlocked }),
      }),
      PressedOpenDetail: () => ({
        model: modifyFields(model, { bar: bar => push(bar, BarRoute.Detail()) }),
      }),
      // The Model may always leave, blocked or not: the block is for the phone.
      PressedLeaveDetail: () => ({ model: modifyFields(model, { bar: bar => pop(bar) }) }),
      PoppedBarByPhone: ({ count }) => ({
        model: modifyFields(model, { bar: bar => popByPhone(bar, count) }),
      }),
      TriedToGoBack: () => ({
        model: modifyFields(model, { refusedBacks: refused => refused + 1 }),
      }),

      PressedHardwareBack: () => ({
        model: isBackRefused(model)
          ? modifyFields(model, { refusedBacks: refused => refused + 1 })
          : goBack(model),
      }),

      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
    })

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    tab: TAB_STACK,
    levels: [{ id: 1 }],
    presented: [PresentRoute.Home()],
    bar: [BarRoute.Options()],
    nextLevelId: 2,
    closedByButton: 0,
    closedByPhone: 0,
    isLargeTitle: false,
    isBarHidden: false,
    isBackBlocked: false,
    barButtonPresses: 0,
    refusedBacks: 0,
  },
})

// VIEW

const INK = '#111111'
const MUTED = '#6b6b6b'
const PAPER = '#ffffff'
const ACCENT = '#0a66d8'
const QUIET = '#4a4a4a'
const DANGER = '#c62828'

const button = (
  h: HtmlBuilder<Message>,
  id: string,
  label: string,
  color: string,
  message: Message,
): Html =>
  box(
    [
      h.Attribute('testID', id),
      h.OnClick(message),
      style({
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 17, fontWeight: '600' })], [label])],
  )

const heading = (id: string, words: string): Html =>
  text([prop('testID', id), style({ color: INK, fontSize: 28, fontWeight: '700' })], [words])

const line = (id: string, words: string): Html =>
  text([prop('testID', id), style({ color: INK, fontSize: 17 })], [words])

/** What to try and what should happen, in small grey words. */
const hint = (words: string): Html => text([style({ color: MUTED, fontSize: 14 })], [words])

const page = (children: ReadonlyArray<Html>): Html =>
  scrollView(
    [style({ flex: 1, backgroundColor: PAPER })],
    [box([style({ padding: 16, gap: 12 })], children)],
  )

const onOff = (isOn: boolean): string => (isOn ? 'ON' : 'OFF')

const levelName = (level: Level): string => `#${level.id}`

const stackTab = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  stackOf<Level, Message>(h, model.levels, {
    attributes: [h.Attribute('testID', 'levels')],
    key: level => `level-${level.id}`,
    onPoppedByPhone: count => Message.PoppedLevelsByPhone({ count }),
    screen: (level, place) => ({
      attributes: [h.Attribute('testID', `level-${level.id}`)],
      children: [
        navigationBar(h, device, { title: `Level ${place.index + 1}` }),
        safeArea(device, { hasHeader: true }, [
          // Only the screen on top carries the ids a test presses.
          page([
            heading(place.isTop ? 'depth' : `depth-${level.id}`, `Depth ${place.index + 1}`),
            line(
              place.isTop ? 'routes' : `routes-${level.id}`,
              `Routes in the Model: ${model.levels.map(levelName).join(' > ')}`,
            ),
            hint(
              'This is screen ' +
                levelName(level) +
                '. Push a few levels, then swipe from the left edge to go back. ' +
                'The depth and the route list must match what you see. ' +
                'On an iPhone, hold the back button to jump back several levels at once.',
            ),
            ...(place.isTop
              ? [
                  button(h, 'push', 'Push one level', ACCENT, Message.PressedPush({ count: 1 })),
                  button(
                    h,
                    'push-three',
                    'Push three levels',
                    ACCENT,
                    Message.PressedPush({ count: 3 }),
                  ),
                  button(h, 'pop', 'Pop one (from the Model)', QUIET, Message.PressedPop()),
                  button(h, 'pop-to-second', 'Pop to level 2', QUIET, Message.PressedPopToSecond()),
                  button(h, 'pop-to-root', 'Pop to level 1', QUIET, Message.PressedPopToRoot()),
                  button(
                    h,
                    'replace',
                    'Replace this screen with a new one',
                    QUIET,
                    Message.PressedReplace(),
                  ),
                  hint(
                    'Tap the Stack tab again while several levels deep: it should return to level 1.',
                  ),
                  button(
                    h,
                    'go-to-bar',
                    'Go to the Bar tab (from the Model)',
                    QUIET,
                    Message.PressedGoToBarTab(),
                  ),
                  button(h, 'exit', 'Exit the demo', DANGER, Message.PressedExit()),
                ]
              : []),
          ]),
        ]),
      ],
    }),
  })

const presentedBody = (
  h: HtmlBuilder<Message>,
  device: Device,
  id: string,
  name: string,
  howToClose: string,
): ReadonlyArray<Html> => [
  safeArea(device, { hasHeader: false }, [
    box(
      [style({ flex: 1, backgroundColor: PAPER, padding: 16, gap: 12 })],
      [
        heading(`${id}-title`, name),
        hint(
          howToClose +
            ' Either way the counters on the screen below must go up by one, ' +
            'and the buttons there must open exactly one screen again.',
        ),
        button(h, 'close', 'Close (from the Model)', ACCENT, Message.PressedClose()),
      ],
    ),
  ]),
]

const presentTab = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  stackOf<PresentRoute, Message>(h, model.presented, {
    attributes: [h.Attribute('testID', 'presented')],
    key: route => route._tag,
    onPoppedByPhone: count => Message.ClosedByPhone({ count }),
    screen: route =>
      PresentRoute.match(route, {
        Home: () => ({
          attributes: [h.Attribute('testID', 'present-home')],
          children: [
            navigationBar(h, device, { title: 'Present' }),
            safeArea(device, { hasHeader: true }, [
              page([
                line('closed-by-button', `Closed by the button: ${model.closedByButton}`),
                line('closed-by-phone', `Closed by the phone: ${model.closedByPhone}`),
                hint('Open each one. Close it once with its button and once by swiping down.'),
                button(
                  h,
                  'open-modal',
                  'Open a modal',
                  ACCENT,
                  Message.PressedPresent({ route: PresentRoute.Modal() }),
                ),
                button(
                  h,
                  'open-sheet',
                  'Open a sheet (half height, then full)',
                  ACCENT,
                  Message.PressedPresent({ route: PresentRoute.Sheet() }),
                ),
                button(
                  h,
                  'open-plain-modal',
                  'Open a modal (plain screen view)',
                  QUIET,
                  Message.PressedPresent({ route: PresentRoute.PlainModal() }),
                ),
                hint(
                  'The last button shows the same modal through the ordinary screen view. ' +
                    'If the two look different, say which one looks right.',
                ),
              ]),
            ]),
          ],
        }),
        Modal: () => ({
          isModal: true,
          attributes: [h.Attribute('testID', 'modal'), presentation('modal')],
          children: presentedBody(h, device, 'modal', 'A modal', 'Swipe down to close it.'),
        }),
        Sheet: () => ({
          isModal: true,
          attributes: [
            h.Attribute('testID', 'sheet'),
            ...sheet({ detents: [0.5, 1], hasGrabber: true }),
          ],
          children: presentedBody(
            h,
            device,
            'sheet',
            'A sheet',
            'Drag it up to full height, then down past half to close it.',
          ),
        }),
        PlainModal: () => ({
          attributes: [h.Attribute('testID', 'plain-modal'), presentation('modal')],
          children: presentedBody(
            h,
            device,
            'plain-modal',
            'A modal (plain screen view)',
            'Swipe down to close it.',
          ),
        }),
      }),
  })

const barTab = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  stackOf<BarRoute, Message>(h, model.bar, {
    attributes: [h.Attribute('testID', 'bar')],
    key: route => route._tag,
    onPoppedByPhone: count => Message.PoppedBarByPhone({ count }),
    screen: route =>
      BarRoute.match(route, {
        Options: () => ({
          attributes: [h.Attribute('testID', 'bar-options')],
          children: [
            navigationBar(h, device, {
              title: 'Bar options',
              isLargeTitle: model.isLargeTitle,
              isHidden: model.isBarHidden,
              rightButton: {
                label: 'Add',
                symbol: 'plus',
                testID: 'bar-button',
                onPress: Message.PressedBarButton(),
              },
            }),
            safeArea(device, { hasHeader: !model.isBarHidden }, [
              page([
                line('bar-presses', `Bar button pressed: ${model.barButtonPresses}`),
                hint('Press the button at the right of the bar. The number must go up by one.'),
                button(
                  h,
                  'toggle-large-title',
                  `Large title: ${onOff(model.isLargeTitle)}`,
                  ACCENT,
                  Message.PressedToggleLargeTitle(),
                ),
                hint('iPhone only: the title should grow and move below the bar.'),
                button(
                  h,
                  'toggle-bar',
                  `Hide the bar: ${onOff(model.isBarHidden)}`,
                  ACCENT,
                  Message.PressedToggleBar(),
                ),
                hint('The bar should go and this text should stay clear of the clock.'),
                button(
                  h,
                  'toggle-block',
                  `Block back on the next screen: ${onOff(model.isBackBlocked)}`,
                  ACCENT,
                  Message.PressedToggleBlockBack(),
                ),
                button(h, 'open-detail', 'Open the next screen', QUIET, Message.PressedOpenDetail()),
              ]),
            ]),
          ],
        }),
        Detail: () => ({
          attributes: [
            h.Attribute('testID', 'bar-detail'),
            ...backBlocked(model.isBackBlocked, () => Message.TriedToGoBack()),
          ],
          children: [
            navigationBar(h, device, { title: 'Next screen', backTitle: 'Options' }),
            safeArea(device, { hasHeader: true }, [
              page([
                line(
                  'block-state',
                  model.isBackBlocked ? 'Back is blocked.' : 'Back is allowed.',
                ),
                line('refused', `Back refused: ${model.refusedBacks}`),
                hint(
                  'The back button should say "Options". While back is blocked, a swipe, ' +
                    'the back button and Android\'s Back button must leave this screen open ' +
                    'and raise the number above. With the block off they go back.',
                ),
                button(
                  h,
                  'toggle-block-here',
                  `Block back: ${onOff(model.isBackBlocked)}`,
                  ACCENT,
                  Message.PressedToggleBlockBack(),
                ),
                button(
                  h,
                  'leave-detail',
                  'Go back anyway (from the Model)',
                  QUIET,
                  Message.PressedLeaveDetail(),
                ),
              ]),
            ]),
          ],
        }),
      }),
  })

export const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    tabs<Message>(
      {
        selected: model.tab,
        onSelected: key => Message.SelectedTab({ key }),
        onReselected: key => Message.ReselectedTab({ key }),
        attributes: [h.Attribute('testID', 'tabs')],
      },
      [
        tab(
          {
            key: TAB_STACK,
            title: 'Stack',
            symbol: 'square.stack',
            attributes: [h.Attribute('testID', 'tab-stack')],
          },
          [stackTab(model, h, device)],
        ),
        tab(
          {
            key: TAB_PRESENT,
            title: 'Present',
            symbol: 'rectangle.portrait.on.rectangle.portrait',
            attributes: [h.Attribute('testID', 'tab-present')],
          },
          [presentTab(model, h, device)],
        ),
        tab(
          {
            key: TAB_BAR,
            title: 'Bar',
            symbol: 'slider.horizontal.3',
            ...(model.barButtonPresses === 0 ? {} : { badge: String(model.barButtonPresses) }),
            attributes: [h.Attribute('testID', 'tab-bar')],
          },
          [barTab(model, h, device)],
        ),
      ],
    )

// PROGRAM

export const makeDemo = (container: HTMLElement, env: NavigationDemoEnv) => {
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  const subscriptions = Subscription.make<Model, Message>()(() => ({
    back: hardwareBack<Model, Message>(env.backSource ?? noBackSource, {
      // A refused back is still taken: the press must not leave the app.
      canGoBack,
      toMessage: () => Message.PressedHardwareBack(),
    }),
  }))
  return Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(Exit),
    view: makeView(env.device),
    subscriptions,
    container,
  })
}
