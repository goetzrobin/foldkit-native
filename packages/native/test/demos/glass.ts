/**
 * The Liquid Glass demo.
 *
 * First screen: blocks of colour and rows of text that scroll, and floating
 * over them four things made of glass: a card with words on it, two shapes
 * side by side that flow into one when they are close, a round button, and a
 * pill with two buttons. The line at the top says whether this build of the
 * app draws real Liquid Glass or the plain fallback, and why. Buttons under
 * it switch the glass style, a tint, the reaction to touch, how close the
 * two shapes are, and (where there is real glass) the fallback, to compare.
 *
 * What to try: scroll the colours and watch them bend and blur through the
 * glass. Press the round button and the pill: the numbers on the card count
 * the presses.
 *
 * Second screen ("Open the tabs screen"): the phone's own tab bar with the
 * options iOS 26 added. The bar can shrink while the list scrolls, one tab
 * is a search tab set apart from the others, a strip can sit above the bar,
 * and the title bar's buttons get glass of their own.
 */
import { Effect, Option, Schema } from 'effect'
import { Command, Runtime, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Device,
  header,
  onBarButtonPressed,
  onPress,
  prop,
  rightBarButtons,
  safeArea,
  screen,
  scrollEdgeEffects,
  scrollView,
  stack,
  style,
  tab,
  tabs,
  text,
  title,
  view as box,
} from '../../src/index.js'
import {
  glass,
  glassContainer,
  glassContainerOptions,
  glassOptions,
  isLiquidGlassAvailable,
  liquidGlassStatus,
} from '../../src/glass/index.js'

export type DemoEnv = Readonly<{
  device: Device
  /** Call to leave the demo (back to the menu). */
  exit: () => void
}>

// MODEL

const TAB_LIST = 'list'
const TAB_SAVED = 'saved'
const TAB_SEARCH = 'search'

export const Model = Schema.Struct({
  /** Which of the demo's two screens shows. */
  isOnTabs: Schema.Boolean,
  glassStyle: Schema.Literals(['regular', 'clear']),
  isTinted: Schema.Boolean,
  isInteractive: Schema.Boolean,
  /** Whether the two shapes sit close enough to flow into one. */
  isClose: Schema.Boolean,
  /** The demo's own switch, for comparing glass and fallback on one phone. */
  isFallbackForced: Schema.Boolean,
  pillCount: Schema.Number,
  roundPresses: Schema.Number,
  // The tabs screen.
  tab: Schema.String,
  isBarShrinking: Schema.Boolean,
  hasStrip: Schema.Boolean,
  isEdgeSoft: Schema.Boolean,
  barButtonPresses: Schema.Number,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  PressedExit: {},
  CompletedExit: {},
  PressedStyle: { glassStyle: Schema.Literals(['regular', 'clear']) },
  PressedToggleTint: {},
  PressedToggleInteractive: {},
  PressedToggleClose: {},
  PressedToggleFallback: {},
  PressedPillLess: {},
  PressedPillMore: {},
  PressedRound: {},
  PressedOpenTabs: {},
  PressedCloseTabs: {},
  SelectedTab: { key: Schema.String },
  PressedToggleShrink: {},
  PressedToggleStrip: {},
  PressedToggleEdge: {},
  PressedBarButton: {},
})
export type Message = typeof Message.Type

// UPDATE

const makeUpdate = (env: DemoEnv) => {
  // Leaving the demo is a side effect, so it runs as a Command.
  const Exit = Command.define('Exit', {
    messages: [Message.CompletedExit],
    execute: Effect.sync(() => {
      env.exit()
      return Message.CompletedExit()
    }),
  })
  const flip = (flag: boolean): boolean => !flag

  return (model: Model, message: Message) =>
    Message.match<Update.Return<Model, Message>>(message, {
      PressedExit: () => ({ model, commands: [Exit()] }),
      CompletedExit: () => ({ model }),
      PressedStyle: ({ glassStyle }) => ({
        model: modifyFields(model, { glassStyle: () => glassStyle }),
      }),
      PressedToggleTint: () => ({ model: modifyFields(model, { isTinted: flip }) }),
      PressedToggleInteractive: () => ({ model: modifyFields(model, { isInteractive: flip }) }),
      PressedToggleClose: () => ({ model: modifyFields(model, { isClose: flip }) }),
      PressedToggleFallback: () => ({ model: modifyFields(model, { isFallbackForced: flip }) }),
      PressedPillLess: () => ({ model: modifyFields(model, { pillCount: count => count - 1 }) }),
      PressedPillMore: () => ({ model: modifyFields(model, { pillCount: count => count + 1 }) }),
      PressedRound: () => ({ model: modifyFields(model, { roundPresses: count => count + 1 }) }),
      PressedOpenTabs: () => ({ model: modifyFields(model, { isOnTabs: () => true }) }),
      PressedCloseTabs: () => ({
        model: modifyFields(model, { isOnTabs: () => false, tab: () => TAB_LIST }),
      }),
      SelectedTab: ({ key }) => ({ model: modifyFields(model, { tab: () => key }) }),
      PressedToggleShrink: () => ({ model: modifyFields(model, { isBarShrinking: flip }) }),
      PressedToggleStrip: () => ({ model: modifyFields(model, { hasStrip: flip }) }),
      PressedToggleEdge: () => ({ model: modifyFields(model, { isEdgeSoft: flip }) }),
      PressedBarButton: () => ({
        model: modifyFields(model, { barButtonPresses: count => count + 1 }),
      }),
    })
}

const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    isOnTabs: false,
    glassStyle: 'regular',
    isTinted: false,
    isInteractive: true,
    isClose: true,
    isFallbackForced: false,
    pillCount: 0,
    roundPresses: 0,
    tab: TAB_LIST,
    isBarShrinking: true,
    // Off to begin with: it is the newest and least tried of the options.
    hasStrip: false,
    isEdgeSoft: true,
    barButtonPresses: 0,
  },
})

// VIEW

const INK = '#111111'
const PAPER = '#ffffff'
const MUTED = '#5c5c5c'
const LINE = '#e3e3e3'
const ACCENT = '#c2410c'
const QUIET = '#4a4a4a'
/** The tint, and the same colour a little more solid for the fallback. */
const TINT = 'rgba(249, 115, 22, 0.35)'
const TINT_FALLBACK = 'rgba(253, 186, 116, 0.9)'

/** The background: strong colours, so the glass has something to bend. */
const BLOCKS: ReadonlyArray<Readonly<{ name: string; color: string; ink: string }>> = [
  { name: 'Orange', color: '#f97316', ink: INK },
  { name: 'Teal', color: '#0d9488', ink: PAPER },
  { name: 'Yellow', color: '#facc15', ink: INK },
  { name: 'Blue', color: '#2563eb', ink: PAPER },
  { name: 'Red', color: '#dc2626', ink: PAPER },
  { name: 'Green', color: '#16a34a', ink: PAPER },
  { name: 'Black', color: '#111111', ink: PAPER },
  { name: 'Sky', color: '#38bdf8', ink: INK },
]

const onOff = (isOn: boolean): string => (isOn ? 'ON' : 'OFF')

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

const row = (children: ReadonlyArray<Html>): Html =>
  box([style({ flexDirection: 'row', gap: 8 })], children)

/** What every glass view in the demo shares, from the switches. */
const settings = (model: Model, isInteractive: boolean) =>
  glassOptions({
    glassStyle: model.glassStyle,
    isInteractive,
    isFallbackForced: model.isFallbackForced,
    ...(model.isTinted ? { tintColor: TINT, fallbackStyle: { backgroundColor: TINT_FALLBACK } } : {}),
  })

/** Whether the glass on screen right now is the real thing. */
const drawsRealGlass = (model: Model): boolean =>
  isLiquidGlassAvailable() && !model.isFallbackForced

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
        [prop('testID', 'glass-status'), style({ color: ACCENT, fontSize: 15, fontWeight: '600' })],
        [liquidGlassStatus()],
      ),
      text(
        [prop('testID', 'glass-drawn'), style({ color: MUTED, fontSize: 13 })],
        [
          drawsRealGlass(model)
            ? 'Drawing real glass. Scroll the colours: they should bend and blur through it.'
            : 'Drawing the fallback: pale see-through boxes in the same places.',
        ],
      ),
      row([
        button('exit', 'Exit', INK, Message.PressedExit()),
        button('open-tabs', 'Open the tabs screen', INK, Message.PressedOpenTabs()),
      ]),
      row([
        button(
          'style-regular',
          'Style: regular',
          model.glassStyle === 'regular' ? ACCENT : QUIET,
          Message.PressedStyle({ glassStyle: 'regular' }),
        ),
        button(
          'style-clear',
          'Style: clear',
          model.glassStyle === 'clear' ? ACCENT : QUIET,
          Message.PressedStyle({ glassStyle: 'clear' }),
        ),
      ]),
      row([
        button('toggle-tint', `Tint: ${onOff(model.isTinted)}`, QUIET, Message.PressedToggleTint()),
        button(
          'toggle-interactive',
          `Reacts to touch: ${onOff(model.isInteractive)}`,
          QUIET,
          Message.PressedToggleInteractive(),
        ),
      ]),
      row([
        button(
          'toggle-close',
          model.isClose ? 'Shapes: close' : 'Shapes: apart',
          QUIET,
          Message.PressedToggleClose(),
        ),
        // Only where there are two ways to compare.
        ...(isLiquidGlassAvailable()
          ? [
              button(
                'toggle-fallback',
                `Fallback: ${onOff(model.isFallbackForced)}`,
                QUIET,
                Message.PressedToggleFallback(),
              ),
            ]
          : []),
      ]),
    ],
  )

const background = (): Html =>
  scrollView(
    [
      prop('testID', 'glass-background'),
      style({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: PAPER }),
    ],
    BLOCKS.flatMap((block, index) => [
      box(
        [style({ height: 150, padding: 16, justifyContent: 'flex-end', backgroundColor: block.color })],
        [text([style({ color: block.ink, fontSize: 34, fontWeight: '800' })], [block.name])],
      ),
      box(
        [style({ paddingVertical: 12, paddingHorizontal: 16, gap: 6 })],
        [
          text(
            [style({ color: INK, fontSize: 17, fontWeight: '600' })],
            [`Row ${index * 2 + 1}: words to read through the glass`],
          ),
          text(
            [style({ color: MUTED, fontSize: 15 })],
            [`Row ${index * 2 + 2}: scroll me under the card and the pill`],
          ),
        ],
      ),
    ]),
  )

const card = (model: Model): Html =>
  glass(
    [
      prop('testID', 'glass-card'),
      settings(model, false),
      style({
        position: 'absolute',
        top: 12,
        left: 16,
        right: 16,
        padding: 14,
        gap: 4,
        borderRadius: 22,
      }),
    ],
    [
      text([style({ color: INK, fontSize: 18, fontWeight: '700' })], ['A glass card']),
      text(
        [prop('testID', 'counts'), style({ color: INK, fontSize: 15 })],
        [`Pill count: ${model.pillCount}. Round button pressed: ${model.roundPresses}.`],
      ),
    ],
  )

const shape = (model: Model, id: string, label: string, width: number): Html =>
  glass(
    [
      prop('testID', id),
      settings(model, false),
      style({ width, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' }),
    ],
    [text([style({ color: INK, fontSize: 16, fontWeight: '700' })], [label])],
  )

/** Two shapes in one container. Close together they flow into one. */
const pair = (model: Model): Html =>
  glassContainer(
    [
      prop('testID', 'glass-pair'),
      glassContainerOptions({ spacing: 28, isFallbackForced: model.isFallbackForced }),
      style({
        position: 'absolute',
        top: 112,
        left: 16,
        flexDirection: 'row',
        gap: model.isClose ? 6 : 56,
      }),
    ],
    [shape(model, 'shape-a', 'A', 64), shape(model, 'shape-b', 'B', 104)],
  )

/**
 * A glass that reacts to touch is given a new key when the switch changes,
 * so the phone builds it anew. Expo's notes for the native view say the
 * reaction is best decided when the view is made.
 */
const touchKey = (h: HtmlBuilder<Message>, name: string, model: Model) =>
  h.Key(`${name}-${model.isInteractive ? 'touch' : 'still'}`)

const roundButton = (model: Model, h: HtmlBuilder<Message>): Html =>
  glass(
    [
      touchKey(h, 'round', model),
      prop('testID', 'glass-round'),
      prop('accessibilityRole', 'button'),
      settings(model, model.isInteractive),
      onPress(Message.PressedRound()),
      style({
        position: 'absolute',
        right: 16,
        bottom: 100,
        width: 60,
        height: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
      }),
    ],
    [text([style({ color: INK, fontSize: 28, fontWeight: '600' })], ['+'])],
  )

const pillButton = (id: string, label: string, message: Message): Html =>
  box(
    [
      prop('testID', id),
      prop('accessibilityRole', 'button'),
      onPress(message),
      style({ flex: 1, height: 52, alignItems: 'center', justifyContent: 'center' }),
    ],
    [text([style({ color: INK, fontSize: 16, fontWeight: '600' })], [label])],
  )

const pill = (model: Model, h: HtmlBuilder<Message>): Html =>
  glass(
    [
      touchKey(h, 'pill', model),
      prop('testID', 'glass-pill'),
      settings(model, model.isInteractive),
      style({
        position: 'absolute',
        left: 64,
        right: 64,
        bottom: 24,
        height: 52,
        borderRadius: 26,
        flexDirection: 'row',
        alignItems: 'center',
      }),
    ],
    [
      pillButton('pill-less', 'Less', Message.PressedPillLess()),
      box([style({ width: 1, height: 24, backgroundColor: 'rgba(0, 0, 0, 0.2)' })], []),
      pillButton('pill-more', 'More', Message.PressedPillMore()),
    ],
  )

const glassScreen = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  stack(
    [h.Key('glass-stack')],
    [
      screen(
        [h.Key('glass'), prop('testID', 'screen-glass')],
        [
          header([title('Glass')], []),
          safeArea(device, { hasHeader: true }, [
            box(
              [style({ flex: 1, backgroundColor: PAPER })],
              [
                panel(model),
                box(
                  [style({ flex: 1, overflow: 'hidden' })],
                  [
                    background(),
                    card(model),
                    pair(model),
                    roundButton(model, h),
                    pill(model, h),
                  ],
                ),
              ],
            ),
          ]),
        ],
      ),
    ],
  )

// The tabs screen.

const wideButton = (id: string, label: string, color: string, message: Message): Html =>
  box(
    [
      prop('testID', id),
      onPress(message),
      style({
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
        backgroundColor: color,
        alignItems: 'center',
      }),
    ],
    [text([style({ color: PAPER, fontSize: 16, fontWeight: '600' })], [label])],
  )

const hint = (words: string): Html => text([style({ color: MUTED, fontSize: 14 })], [words])

const LIST_ROWS = 40

const listTab = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  stack(
    [],
    [
      screen(
        [
          h.Key('tabs-list'),
          prop('testID', 'screen-tabs-list'),
          ...scrollEdgeEffects(
            model.isEdgeSoft ? { top: 'soft', bottom: 'soft' } : { top: 'hard', bottom: 'hard' },
          ),
        ],
        [
          header(
            [
              prop('testID', 'tabs-header'),
              title('Bar options'),
              // iPhone only: two bar buttons, each on its own piece of glass,
              // the second filled as the main action.
              rightBarButtons([
                { id: 'share', symbol: 'square.and.arrow.up', sharesBackground: false },
                { id: 'done', label: 'Done', variant: 'prominent', sharesBackground: false },
              ]),
              onBarButtonPressed<Message>(() => Option.some(Message.PressedBarButton())),
            ],
            [],
          ),
          safeArea(device, { hasHeader: true }, [
            scrollView(
              [prop('testID', 'tabs-list-scroll'), style({ flex: 1, backgroundColor: PAPER })],
              [
                box(
                  [style({ padding: 16, gap: 10 })],
                  [
                    wideButton('close-tabs', 'Back to the glass screen', INK, Message.PressedCloseTabs()),
                    text(
                      [prop('testID', 'bar-presses'), style({ color: INK, fontSize: 16 })],
                      [`Title bar buttons pressed: ${model.barButtonPresses}`],
                    ),
                    hint(
                      'iPhone: the title bar has two buttons, each on its own glass. "Done" is filled.',
                    ),
                    wideButton(
                      'toggle-shrink',
                      `Tab bar shrinks on scroll: ${onOff(model.isBarShrinking)}`,
                      QUIET,
                      Message.PressedToggleShrink(),
                    ),
                    hint('iOS 26 and later: scroll this list up and the tab bar becomes a small pill.'),
                    wideButton(
                      'toggle-strip',
                      `Strip above the tab bar: ${onOff(model.hasStrip)}`,
                      QUIET,
                      Message.PressedToggleStrip(),
                    ),
                    hint('iOS 26 and later: a glass strip that says "Strip above the bar".'),
                    wideButton(
                      'toggle-edge',
                      model.isEdgeSoft ? 'List edges: soft' : 'List edges: hard',
                      QUIET,
                      Message.PressedToggleEdge(),
                    ),
                    hint('How the list fades where it runs under the title bar and the tab bar.'),
                  ],
                ),
                ...Array.from({ length: LIST_ROWS }, (_unused, index) =>
                  box(
                    [
                      style({
                        paddingVertical: 14,
                        paddingHorizontal: 16,
                        borderTopWidth: 1,
                        borderTopColor: LINE,
                        backgroundColor: index % 4 === 0 ? '#ffedd5' : PAPER,
                      }),
                    ],
                    [text([style({ color: INK, fontSize: 16 })], [`List row ${index + 1}`])],
                  ),
                ),
              ],
            ),
          ]),
        ],
      ),
    ],
  )

const plainTab = (
  h: HtmlBuilder<Message>,
  device: Device,
  key: string,
  heading: string,
  words: string,
): Html =>
  stack(
    [],
    [
      screen(
        [h.Key(`tabs-${key}`), prop('testID', `screen-tabs-${key}`)],
        [
          header([title(heading)], []),
          safeArea(device, { hasHeader: true }, [
            box(
              [style({ flex: 1, padding: 16, gap: 10, backgroundColor: PAPER })],
              [
                text([style({ color: INK, fontSize: 17 })], [words]),
                wideButton(
                  `close-tabs-${key}`,
                  'Back to the glass screen',
                  INK,
                  Message.PressedCloseTabs(),
                ),
              ],
            ),
          ]),
        ],
      ),
    ],
  )

const strip = (): Html =>
  box(
    [style({ flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 })],
    [text([style({ color: INK, fontSize: 15, fontWeight: '600' })], ['Strip above the bar'])],
  )

const tabsScreen = (model: Model, h: HtmlBuilder<Message>, device: Device): Html =>
  tabs<Message>(
    {
      selected: model.tab,
      onSelected: key => Message.SelectedTab({ key }),
      tintColor: ACCENT,
      minimizeBehavior: model.isBarShrinking ? 'onScrollDown' : 'never',
      ...(model.hasStrip ? { bottomAccessory: { device, regular: [strip()] } } : {}),
      attributes: [h.Key('glass-tabs'), prop('testID', 'glass-tabs')],
    },
    [
      tab(
        {
          key: TAB_LIST,
          title: 'List',
          symbol: 'list.bullet',
          attributes: [prop('testID', 'tab-list')],
        },
        [listTab(model, h, device)],
      ),
      tab(
        {
          key: TAB_SAVED,
          title: 'Saved',
          symbol: 'bookmark',
          attributes: [prop('testID', 'tab-saved')],
        },
        [plainTab(h, device, TAB_SAVED, 'Saved', 'A second tab, so the bar has something to switch to.')],
      ),
      tab(
        {
          key: TAB_SEARCH,
          title: 'Search',
          symbol: 'magnifyingglass',
          role: 'search',
          attributes: [prop('testID', 'tab-search')],
        },
        [
          plainTab(
            h,
            device,
            TAB_SEARCH,
            'Search',
            'This tab has the search role. On iOS 26 and later its button sits apart from the others, at the end of the bar.',
          ),
        ],
      ),
    ],
  )

export const makeView =
  (device: Device) =>
  (model: Model, h: HtmlBuilder<Message>): Html =>
    model.isOnTabs ? tabsScreen(model, h, device) : glassScreen(model, h, device)

// PROGRAM

export const makeDemo = (container: HTMLElement, env: DemoEnv) =>
  Runtime.makeElement({
    Model,
    init,
    update: makeUpdate(env),
    view: makeView(env.device),
    container,
  })
