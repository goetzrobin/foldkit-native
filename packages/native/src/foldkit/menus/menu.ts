/**
 * Menus on views: a context menu (press and hold) and a pull-down menu (a
 * button that opens a menu when pressed).
 *
 *   contextMenu(
 *     { items, onSelected: key => Message.SelectedCardAction({ key }) },
 *     card(model),
 *   )
 *
 *   menuButton({
 *     label: 'Sort',
 *     symbol: 'arrow.up.arrow.down',
 *     items,
 *     onSelected: key => Message.SelectedSort({ key }),
 *   })
 *
 * The Model stays out of it: whether a menu is open is the phone's business.
 * Only the choice comes back, as the Message `onSelected` makes from its key.
 *
 * Four ways to draw them, best first. `menuRoute()` says which one this
 * build uses.
 *
 * 1. `swiftui` (iOS with Expo UI): SwiftUI's own `contextMenu` and `Menu`.
 *    A context menu lifts the view off the screen as its preview, or shows
 *    the `preview` it was given.
 * 2. `compose` (Android with Expo UI): Material's dropdown menu. Android
 *    has no lifted preview. The menu opens under the view. Entries show no
 *    icons, a submenu's entries are listed with its title in front, and a
 *    check mark is drawn as text.
 * 3. `sheet` (no Expo UI): React Native's action sheet on iOS, its list
 *    dialog on Android. A flat list: see `flatten` in `items.ts`.
 * 4. `in-app` (none of the above): a plain list that opens in place, under
 *    the view, drawn with ordinary views.
 *
 * On routes 2 to 4 the press or the hold is noticed by the view around the
 * trigger. A part of the trigger that has an `onPress` of its own takes the
 * touch first, so a hold on that part does not open the menu.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { OnCustomEvent, type VNode, element } from 'foldkit/renderTarget'

import { type NativeStyle, onPress, prop, style } from '../attributes.js'
import {
  disabledModifier,
  expoUiHost,
  expoUiKind,
  expoUiName,
  expoUiTag,
  expoUiUnavailableReason,
  hasExpoUiView,
  hostedView,
  modifiers,
  slot,
  ui,
  uiText,
} from '../controls/expoUi.js'
import { ANCHOR_TAG, LIST_TAG } from '../../host/menus/views.js'
import { type ModuleFactory, registerModule } from '../extend.js'
import { type Handler, bagOf, customEvent, handlersByNode, nodeOf } from '../modules.js'
import {
  type FlatAction,
  type MenuAction,
  type MenuItem,
  type MenuSubmenu,
  checkedTitle,
  flatten,
  isSection,
  isSubmenu,
} from '../../host/menus/items.js'
import { presentSheet, sheetRoute, sheetRouteName } from '../../host/menus/sheet.js'

const el = element<any>()
const view = el('view')
const text = el('text')

export type MenuRoute = 'swiftui' | 'compose' | 'sheet' | 'in-app'

/** Which of the four ways this build draws menus. Never throws. */
export const menuRoute = (): MenuRoute => {
  const kind = expoUiKind()
  if (
    kind === 'swiftui' &&
    (['host', 'rn-host', 'slot', 'button', 'menu', 'context-menu'] as const).every(hasExpoUiView)
  ) {
    return 'swiftui'
  }
  if (
    kind === 'compose' &&
    (['host', 'slot', 'text', 'menu', 'menu-item'] as const).every(hasExpoUiView)
  ) {
    return 'compose'
  }
  return sheetRoute() === 'none' ? 'in-app' : 'sheet'
}

/** The route in words, for a line on screen. */
export const menuRouteName = (): string => {
  const route = menuRoute()
  if (route === 'swiftui' || route === 'compose') return expoUiName()
  const why = expoUiUnavailableReason()
  const because = why === '' ? '' : ` (no Expo UI: ${why})`
  return route === 'sheet'
    ? `${sheetRouteName()}${because}`
    : `a plain in-app list${because}`
}

export type MenuSettings<Message> = Readonly<{
  items: ReadonlyArray<MenuItem>
  /** The Message for the entry the user chose, from its `key`. */
  onSelected: (key: string) => Message
  /** A heading. Shown by the action sheet, the dialog and the in-app list. */
  title?: string
  /** For tests to find the menu's outer view. */
  testID?: string
}>

export type ContextMenuSettings<Message> = MenuSettings<Message> &
  Readonly<{
    /**
     * iOS with Expo UI: a view shown above the open menu in place of the
     * lifted trigger. Other routes do not show it.
     */
    preview?: Html
    /**
     * `width` (the default): the menu's box is as wide as the layout makes
     * it, and as tall as the view inside. `content`: as wide as the view
     * inside too, which then needs a width of its own.
     */
    fit?: 'width' | 'content'
  }>

export type MenuButtonSettings<Message> = MenuSettings<Message> &
  Readonly<{
    label?: string
    /** iOS with Expo UI: an SF Symbol shown beside the label. */
    symbol?: string
    /** A view of the app's own to press, in place of the button drawn here. */
    trigger?: Html
    isDisabled?: boolean
  }>

// THE VIEW AROUND A TRIGGER (routes 2 to 4)

// Plain views, named in `src/host/menus/views.ts` so the module below can find them.

/** What the module needs to know about one menu. Sent as text so an unchanged menu is no change. */
type Spec = Readonly<{
  opensOn: 'press' | 'hold'
  route: Exclude<MenuRoute, 'swiftui'>
  title?: string
  options?: ReadonlyArray<FlatAction>
  isDisabled?: boolean
}>

const SPEC = 'fkMenu'
const SELECTED = 'menuSelected'

/** How long a finger rests before a hold opens the menu, as on the phone's own menus. */
export const HOLD_MS = 500
/** How far it may drift meanwhile, in points. */
const HOLD_SLOP = 10

const LIST_LOOK: NativeStyle = {
  marginTop: 6,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: '#d4d4d4',
  backgroundColor: '#ffffff',
  overflow: 'hidden',
}

const findTag = (node: EngineNode, tag: string): EngineNode | undefined => {
  for (const child of node.childList ?? []) {
    if (child.tag === tag) return child
    const deeper = findTag(child, tag)
    if (deeper !== undefined) return deeper
  }
  return undefined
}

type Point = Readonly<{ x: number; y: number }>

const pointOf = (event: unknown): Point | undefined => {
  const native = (event as { nativeEvent?: { pageX?: number; pageY?: number } })?.nativeEvent
  return typeof native?.pageX === 'number' && typeof native?.pageY === 'number'
    ? { x: native.pageX, y: native.pageY }
    : undefined
}

type State = {
  spec: Spec | undefined
  isOpen: boolean
  isWired: boolean
  timer: ReturnType<typeof setTimeout> | undefined
  stops: Array<() => void>
}

const readSpec = (value: unknown): Spec | undefined => {
  if (typeof value !== 'string') return undefined
  try {
    return JSON.parse(value) as Spec
  } catch {
    return undefined
  }
}

/**
 * Opens and closes the menus of routes 2 to 4. It notices the press or the
 * hold, then: tells Material's menu to show (route 2), asks the phone for
 * its sheet (route 3), or unhides the list (route 4).
 */
const menuModule: ModuleFactory = (engine: Engine) => {
  const states = new WeakMap<EngineNode, State>()

  /**
   * Finds the menu inside the view and listens for what closes it. Done the
   * first time the menu opens: when the view is created its children do not
   * exist yet.
   */
  const wire = (node: EngineNode, state: State): void => {
    if (state.isWired) return
    state.isWired = true
    const close = (): void => {
      if (state.isOpen) show(node, state, false)
    }
    const dropdown = findTag(node, expoUiTag('menu'))
    if (dropdown !== undefined) {
      state.stops.push(
        // A press outside the menu, or Back.
        engine.setEventListener(dropdown, 'topDismissRequest', close),
        // An entry was chosen. Its own handler makes the Message.
        engine.setEventListener(node, 'topItemPressed', close),
      )
    }
    const list = findTag(node, LIST_TAG)
    if (list !== undefined) {
      // Any touch that ends in the list closes it, after the row's own
      // press has been handled.
      state.stops.push(
        engine.setEventListener(list, 'topTouchEnd', () => {
          void Promise.resolve().then(close)
        }),
      )
    }
  }

  const show = (node: EngineNode, state: State, isOpen: boolean): void => {
    wire(node, state)
    state.isOpen = isOpen
    const dropdown = findTag(node, expoUiTag('menu'))
    if (dropdown !== undefined) engine.setProp(dropdown, 'expanded', isOpen)
    const list = findTag(node, LIST_TAG)
    if (list !== undefined) {
      engine.setProp(list, 'style', { ...LIST_LOOK, display: isOpen ? 'flex' : 'none' })
    }
    // A menu opens and closes between draws, so the change is sent now.
    engine.commit()
  }

  const open = (node: EngineNode, state: State): void => {
    const spec = state.spec
    if (spec === undefined || spec.isDisabled === true) return
    if (spec.route !== 'sheet') {
      show(node, state, !state.isOpen)
      return
    }
    try {
      presentSheet({ title: spec.title, options: spec.options ?? [] }, answer => {
        if (answer._tag !== 'Selected') return
        const handler = handlersByNode.get(node)?.[SELECTED] as Handler | undefined
        handler?.(customEvent(SELECTED, { key: answer.key }))
      })
    } catch (error) {
      console.warn(
        `[foldkit-native] the menu could not open: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const create = (_empty: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    if (node === undefined || node.tag !== ANCHOR_TAG) return
    const state: State = {
      spec: readSpec(bagOf(vnode, 'props')[SPEC]),
      isOpen: false,
      isWired: false,
      timer: undefined,
      stops: [],
    }
    states.set(node, state)
    let start: Point | undefined
    let isDown = false
    const cancel = (): void => {
      isDown = false
      if (state.timer !== undefined) clearTimeout(state.timer)
      state.timer = undefined
    }
    state.stops.push(
      cancel,
      engine.setResponder(node, {
        onStartShouldSetResponder: () => state.spec?.isDisabled !== true,
        onResponderTerminationRequest: () => true,
        onResponderGrant: event => {
          start = pointOf(event)
          isDown = true
          if (state.spec?.opensOn !== 'hold') return
          state.timer = setTimeout(() => {
            cancel()
            open(node, state)
          }, HOLD_MS)
        },
        onResponderMove: event => {
          const now = pointOf(event)
          if (!isDown || start === undefined || now === undefined) return
          if (Math.hypot(now.x - start.x, now.y - start.y) > HOLD_SLOP) cancel()
        },
        onResponderTerminate: cancel,
        onResponderRelease: () => {
          const wasDown = isDown
          cancel()
          if (wasDown && state.spec?.opensOn === 'press') open(node, state)
        },
      }),
    )
  }

  const update = (_old: VNode, vnode: VNode): void => {
    const node = nodeOf(vnode)
    const state = node === undefined ? undefined : states.get(node)
    if (state !== undefined) state.spec = readSpec(bagOf(vnode, 'props')[SPEC])
  }

  const destroy = (vnode: VNode): void => {
    const node = nodeOf(vnode)
    const state = node === undefined ? undefined : states.get(node)
    if (node === undefined || state === undefined) return
    for (const stop of state.stops) stop()
    states.delete(node)
  }

  return { create, update, destroy }
}

registerModule(menuModule)

// ENTRIES, PER ROUTE

const DESTRUCTIVE = '#b3261e'
const GREYED = '#9a9a9a'
const INK = '#111111'

const swiftAction = <Message>(action: MenuAction, onSelected: (key: string) => Message): Html => {
  const chosen = (name: string) =>
    OnCustomEvent<Message>({ name, f: () => Option.some(onSelected(action.key)) })
  const shared = [
    prop('label', action.title),
    ...(action.symbol === undefined ? [] : [prop('systemImage', action.symbol)]),
    modifiers([disabledModifier(action.isDisabled)]),
  ]
  // SwiftUI draws a check mark for a toggle in a menu, and for nothing else.
  return action.isChecked === undefined
    ? ui('button')(
        [
          ...shared,
          prop('role', action.isDestructive === true ? 'destructive' : 'default'),
          chosen('buttonPress'),
        ] as never,
        [],
      )
    : ui('toggle')([...shared, prop('isOn', action.isChecked), chosen('isOnChange')] as never, [])
}

const swiftEntry = <Message>(
  entry: MenuAction | MenuSubmenu,
  onSelected: (key: string) => Message,
): Html =>
  isSubmenu(entry)
    ? ui('menu')(
        [
          prop('label', entry.title),
          ...(entry.symbol === undefined ? [] : [prop('systemImage', entry.symbol)]),
        ] as never,
        entry.submenu.map(action => swiftAction(action, onSelected)),
      )
    : swiftAction(entry, onSelected)

const swiftItems = <Message>(settings: MenuSettings<Message>): Array<Html> =>
  settings.items.map(item =>
    isSection(item)
      ? ui('section')(
          (item.title === undefined ? [] : [prop('title', item.title)]) as never,
          [slot('content', item.section.map(entry => swiftEntry(entry, settings.onSelected)))],
        )
      : swiftEntry(item, settings.onSelected),
  )

const composeItems = <Message>(settings: MenuSettings<Message>): Array<Html> =>
  flatten(settings.items).flatMap(action => [
    ...(action.startsSection ? [ui('divider')([], [])] : []),
    ui('menu-item')(
      [
        prop('enabled', !action.isDisabled),
        ...(action.isDestructive ? [prop('elementColors', { textColor: DESTRUCTIVE })] : []),
        OnCustomEvent<Message>({
          name: 'itemPressed',
          f: () => Option.some(settings.onSelected(action.key)),
        }),
      ] as never,
      [slot('text', [uiText(checkedTitle(action))])],
    ),
  ])

const ROW: NativeStyle = { paddingVertical: 11, paddingHorizontal: 14 }
const ROW_AFTER_LINE: NativeStyle = { ...ROW, borderTopWidth: 1, borderTopColor: '#e3e3e3' }

const inAppRow = (
  label: string,
  color: string,
  hasLineAbove: boolean,
  attributes: ReadonlyArray<unknown>,
): Html =>
  view(
    [style(hasLineAbove ? ROW_AFTER_LINE : ROW), ...attributes] as never,
    [text([style({ fontSize: 16, color })], [label])],
  )

const inAppList = <Message>(settings: MenuSettings<Message>): Html =>
  el(LIST_TAG)(
    [
      ...(settings.testID === undefined ? [] : [prop('testID', `${settings.testID}-list`)]),
      prop('collapsable', false),
      style({ ...LIST_LOOK, display: 'none' }),
    ] as never,
    [
      ...(settings.title === undefined
        ? []
        : [inAppRow(settings.title, GREYED, false, [prop('accessibilityRole', 'header')])]),
      ...flatten(settings.items).map(action =>
        inAppRow(
          checkedTitle(action),
          action.isDisabled ? GREYED : action.isDestructive ? DESTRUCTIVE : INK,
          action.startsSection,
          [
            ...(settings.testID === undefined
              ? []
              : [prop('testID', `${settings.testID}-${action.key}`)]),
            ...(action.isDisabled ? [] : [onPress(settings.onSelected(action.key))]),
          ],
        ),
      ),
      // A touch that ends anywhere in the list closes it, so this row needs
      // no handler of its own.
      inAppRow('Close', GREYED, true, []),
    ],
  )

/** Where Material's menu hangs from: a dot at the trigger's lower left corner. */
const composeAnchor = <Message>(settings: MenuSettings<Message>): Html =>
  expoUiHost(
    { match: 'none' },
    [style({ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1 })],
    // Closed to begin with. The module opens and closes it between draws.
    [ui('menu')([prop('expanded', false)] as never, [slot('items', composeItems(settings))])],
  )

const anchored = <Message>(
  route: Exclude<MenuRoute, 'swiftui'>,
  opensOn: 'press' | 'hold',
  settings: MenuSettings<Message> & { isDisabled?: boolean },
  trigger: Html,
  attributes: ReadonlyArray<unknown>,
): Html => {
  const spec: Spec = {
    opensOn,
    route,
    ...(settings.isDisabled === true ? { isDisabled: true } : {}),
    ...(route === 'sheet'
      ? {
          ...(settings.title === undefined ? {} : { title: settings.title }),
          options: flatten(settings.items),
        }
      : {}),
  }
  return el(ANCHOR_TAG)(
    [
      prop(SPEC, JSON.stringify(spec)),
      prop('collapsable', false),
      ...(settings.testID === undefined ? [] : [prop('testID', settings.testID)]),
      ...(route === 'sheet'
        ? [
            OnCustomEvent<Message>({
              name: SELECTED,
              f: event => {
                const key = (event.detail as { key?: unknown } | undefined)?.key
                return typeof key === 'string' ? Option.some(settings.onSelected(key)) : Option.none()
              },
            }),
          ]
        : []),
      ...attributes,
    ] as never,
    [
      trigger,
      ...(route === 'compose' ? [composeAnchor(settings)] : []),
      ...(route === 'in-app' ? [inAppList(settings)] : []),
    ],
  )
}

// THE TWO MENUS

/**
 * Gives a view a context menu: press and hold it. See the top of this file.
 * `attributes` go on the outer view the menu adds around `element`: give it
 * the `style` that places it among its neighbours.
 */
export const contextMenu = <Message>(
  settings: ContextMenuSettings<Message>,
  element: Html,
  attributes: ReadonlyArray<unknown> = [],
): Html => {
  const route = menuRoute()
  if (route !== 'swiftui') return anchored(route, 'hold', settings, element, attributes)
  const match = settings.fit === 'content' ? 'both' : 'vertical'
  return expoUiHost(
    { match },
    [...(settings.testID === undefined ? [] : [prop('testID', settings.testID)]), ...attributes],
    [
      ui('context-menu')(
        [],
        [
          slot('trigger', [hostedView(match, element)]),
          slot('items', swiftItems(settings)),
          ...(settings.preview === undefined
            ? []
            : [slot('preview', [hostedView('both', settings.preview)])]),
        ],
      ),
    ],
  )
}

const BUTTON_LOOK: NativeStyle = {
  flexDirection: 'row',
  alignSelf: 'flex-start',
  alignItems: 'center',
  paddingVertical: 9,
  paddingHorizontal: 14,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: '#bdbdbd',
  backgroundColor: '#ffffff',
}

const drawnButton = (label: string, isDisabled: boolean): Html =>
  view(
    [prop('accessibilityRole', 'button'), style(BUTTON_LOOK)],
    [
      text(
        [style({ fontSize: 16, fontWeight: '600', color: isDisabled ? GREYED : INK })],
        [`${label} ▾`],
      ),
    ],
  )

/**
 * A button that opens a menu when pressed. See the top of this file.
 * `attributes` go on its outer view.
 */
export const menuButton = <Message>(
  settings: MenuButtonSettings<Message>,
  attributes: ReadonlyArray<unknown> = [],
): Html => {
  const route = menuRoute()
  const isDisabled = settings.isDisabled === true
  if (route !== 'swiftui') {
    return anchored(
      route,
      'press',
      settings,
      settings.trigger ?? drawnButton(settings.label ?? 'Menu', isDisabled),
      attributes,
    )
  }
  return expoUiHost(
    { match: 'both' },
    [...(settings.testID === undefined ? [] : [prop('testID', settings.testID)]), ...attributes],
    [
      ui('menu')(
        [
          // With a view of the app's own as the label, SwiftUI must be given
          // no words, or it draws the words and not the view.
          ...(settings.trigger === undefined
            ? [
                prop('label', settings.label ?? ''),
                ...(settings.symbol === undefined ? [] : [prop('systemImage', settings.symbol)]),
              ]
            : []),
          modifiers([disabledModifier(isDisabled)]),
        ] as never,
        [
          ...(settings.trigger === undefined
            ? []
            : [slot('label', [hostedView('both', settings.trigger)])]),
          ...swiftItems(settings),
        ],
      ),
    ],
  )
}
