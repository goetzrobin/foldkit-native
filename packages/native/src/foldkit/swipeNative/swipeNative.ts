/**
 * A row you can swipe sideways to show actions, drawn and moved by native
 * code: UIKit on iOS, Android's own View system on Android.
 *
 *   nativeSwipeRow(
 *     [
 *       nativeSwipeOptions({
 *         trailing: [
 *           swipeAction({ key: 'delete', label: 'Delete', symbol: 'trash', role: 'destructive',
 *             onTriggered: () => DeletedMail({ id }) }),
 *           swipeAction({ key: 'flag', label: 'Flag', symbol: 'flag', role: 'normal',
 *             tint: '#f59e0b', onTriggered: () => FlaggedMail({ id }) }),
 *         ],
 *         allowsFullSwipe: true,
 *         group: 'inbox',
 *       }),
 *     ],
 *     [view([style({ backgroundColor: '#ffffff', padding: 16 })], [text([], ['Hello'])])],
 *   )
 *
 * The children are ordinary Foldkit views. The native view holds them and
 * slides them. The action tiles behind are drawn by the native code. Give
 * the child a background colour, or the tiles show through it.
 *
 * The first action in `leading` or `trailing` sits at the outer edge of the
 * screen. It is the one a full swipe triggers.
 *
 * The finger never reaches JavaScript while it drags. The native view tells
 * JavaScript three things only: the row opened, the row closed, an action
 * was triggered. Each becomes a Foldkit Message.
 *
 * Where the native view is not in the build (Expo Go), the row is a plain
 * view with the same children. Nothing swipes and nothing crashes. See
 * `detect.ts` for what decides it, and `docs/NATIVE_VIEWS.md` for how the
 * native side is written and built.
 */
import { registerViewName } from '@ng-native/fabric'
import { Effect, Option } from 'effect'
import type { Html } from 'foldkit/html'
import { OnCustomEvent, element } from 'foldkit/renderTarget'

import { type Color, type NativeStyle, prop } from '../attributes.js'
import {
  SWIPE_MODULE,
  SWIPE_VIEW,
  isNativeSwipeAvailable,
  noteNativeSwipeRegistered,
  swipeExpoGlobal,
  swipeModule,
} from '../../host/swipeNative/detect.js'

const el = element<any>()

/** The element name the engine knows the native view by. */
export const NATIVE_SWIPE_TAG = 'native-swipe-row'

/**
 * What an action is for. `destructive` is drawn red and slides the row away
 * when triggered. `cancel` is drawn grey and only closes the row.
 */
export type SwipeActionRole = 'normal' | 'destructive' | 'cancel'

/** Which side of the row was opened. Leading is the left in left-to-right languages. */
export type SwipeSide = 'leading' | 'trailing'

/**
 * How the actions look.
 * - `tiles`: separate rounded tiles that come out from under the row's edge
 *   and spread apart. On a full swipe one grows to fill.
 * - `strip`: the classic look, square blocks edge to edge.
 * - `info`: shows the labels as passive information. Nothing can be
 *   triggered and the row springs back when let go.
 */
export type SwipeMode = 'tiles' | 'strip' | 'info'

/** What is known when an action is triggered. */
export type SwipeTriggerInfo = Readonly<{
  key: string
  /** True when the row was swiped all the way, false when the tile was pressed. */
  viaFullSwipe: boolean
}>

export type SwipeAction<Message> = Readonly<{
  /** Names the action in events. Unique within one row. */
  key: string
  /** The words on the tile, and what VoiceOver and TalkBack read. */
  label: string
  /** An SF Symbol name for iOS, such as `trash`. Android shows the label only. */
  symbol?: string
  role: SwipeActionRole
  /** The tile's colour. Without it the role decides. Use `#rrggbb`. */
  tint?: Color
  /** The Message to send, or a function from what happened to a Message. */
  onTriggered?: Message | ((info: SwipeTriggerInfo) => Message)
}>

/** Makes one action. It only fills in `role` where it was left out. */
export const swipeAction = <Message>(
  action: Omit<SwipeAction<Message>, 'role'> & { role?: SwipeActionRole },
): SwipeAction<Message> => ({ ...action, role: action.role ?? 'normal' })

export type NativeSwipeSettings<Message> = Readonly<{
  /** Actions shown when the row is dragged away from the leading edge. */
  leading?: ReadonlyArray<SwipeAction<Message>>
  /** Actions shown when the row is dragged away from the trailing edge. */
  trailing?: ReadonlyArray<SwipeAction<Message>>
  /** Whether swiping all the way triggers the first action. On unless said. */
  allowsFullSwipe?: boolean
  /** `tiles` unless said. */
  mode?: SwipeMode
  /** Rows with the same group close each other: only one is open at a time. */
  group?: string
  /** Rounds the corners of the row and of the tiles, in points. */
  cornerRadius?: number
  /** `false` stops the row from swiping. On unless said. */
  isEnabled?: boolean
  /**
   * `auto` follows the phone's language. `rtl` and `ltr` force a direction,
   * which is how the demo shows right-to-left without restarting the app.
   */
  layoutDirection?: 'auto' | 'ltr' | 'rtl'
  /**
   * Closes the row from JavaScript: whenever this number changes, the row
   * closes. Keep a counter in the Model and add one to it.
   */
  closeSignal?: number
  onOpened?: (side: SwipeSide) => Message
  onClosed?: () => Message
  /** Called for every action, after the action's own `onTriggered`. */
  onActionTriggered?: (info: SwipeTriggerInfo) => Message
  /** Draws the plain fallback even where the native view is present. */
  isFallbackForced?: boolean
  /** Styles for the plain view drawn where the native view is not present. */
  fallbackStyle?: NativeStyle
}>

const SETTINGS = 'nativeSwipeSettings'

/** How a swipe row behaves. One of a `nativeSwipeRow`'s attributes. */
export const nativeSwipeOptions = <Message>(settings: NativeSwipeSettings<Message>) =>
  prop(SETTINGS, settings)

/** The names the native view sends its three events by, without the `on`. */
export const SWIPE_OPENED = 'swipeOpened'
export const SWIPE_CLOSED = 'swipeClosed'
export const ACTION_TRIGGERED = 'actionTriggered'

/**
 * The name the phone knows the native view by. It is the name Expo's own
 * JavaScript works out (`requireNativeView` in `expo-modules-core`). Expo Go
 * adds the running project's name to every view name. An app built on its
 * own has no such addition.
 */
export const nativeSwipeViewName = (): string => {
  let identifier = ''
  try {
    identifier = swipeExpoGlobal()?.__expo_app_identifier__ ?? ''
  } catch {
    identifier = ''
  }
  return `ViewManagerAdapter_${SWIPE_MODULE}_${SWIPE_VIEW}${identifier === '' ? '' : `_${identifier}`}`
}

let named: { name: string; undo: unknown } | undefined

/** Names the element, again if Expo's project name has changed since. */
const name = (): void => {
  const wanted = nativeSwipeViewName()
  if (named?.name === wanted) return
  if (typeof named?.undo === 'function') named.undo()
  named = { name: wanted, undo: registerViewName(NATIVE_SWIPE_TAG, { ios: wanted, android: wanted }) }
}

/**
 * Call once at startup, before the first draw, and after `import 'expo'`.
 * It only names the native view. It does not need the view to exist: a
 * build without it draws the fallback.
 */
export const registerNativeSwipe = (): void => {
  try {
    name()
    noteNativeSwipeRegistered()
  } catch {
    // Not registered means every row is its fallback.
  }
}

/** Forgets the name. For tests. */
export const resetNativeSwipeName = (): void => {
  if (typeof named?.undo === 'function') named.undo()
  named = undefined
}

type PropAttribute = Readonly<{ _tag: 'Prop'; key: string; value: unknown }>

const isProp = (attribute: unknown): attribute is PropAttribute =>
  typeof attribute === 'object' &&
  attribute !== null &&
  (attribute as { _tag?: unknown })._tag === 'Prop'

/** The attributes with the settings and the styles taken out and put together. */
const split = (
  attributes: ReadonlyArray<unknown>,
): { settings: NativeSwipeSettings<unknown>; styles: NativeStyle | undefined; rest: Array<unknown> } => {
  let settings: NativeSwipeSettings<unknown> = {}
  let styles: NativeStyle | undefined
  const rest: Array<unknown> = []
  for (const attribute of attributes) {
    if (isProp(attribute) && attribute.key === SETTINGS) {
      settings = { ...settings, ...(attribute.value as NativeSwipeSettings<unknown>) }
    } else if (isProp(attribute) && attribute.key === 'style') {
      styles = { ...styles, ...(attribute.value as NativeStyle) }
    } else {
      rest.push(attribute)
    }
  }
  return { settings, styles, rest }
}

const styled = (styles: NativeStyle | undefined): Array<unknown> =>
  styles === undefined ? [] : [prop('style', styles)]

/** Whether a row with these settings is drawn by the native view. */
const drawsNative = (settings: { isFallbackForced?: boolean }): boolean => {
  if (settings.isFallbackForced === true || !isNativeSwipeAvailable()) return false
  try {
    // Expo may only have known the project's name after `registerNativeSwipe` ran.
    name()
    return true
  } catch {
    return false
  }
}

/**
 * What crosses to the native side for one action: plain data, no functions.
 * `symbol` and `tint` are left out when there is none. The native code then
 * uses its own "nothing" for them, which is safer than sending a null.
 */
export type NativeSwipeActionProp = Readonly<{
  key: string
  label: string
  symbol?: string
  role: SwipeActionRole
  tint?: string
}>

const actionProps = (
  actions: ReadonlyArray<SwipeAction<unknown>> | undefined,
): ReadonlyArray<NativeSwipeActionProp> =>
  (actions ?? []).map(action => ({
    key: action.key,
    label: action.label,
    role: action.role,
    ...(action.symbol === undefined ? {} : { symbol: action.symbol }),
    ...(action.tint === undefined ? {} : { tint: action.tint }),
  }))

type Detail = Readonly<Record<string, unknown>> | null | undefined

/** What the native view sent: the event's `detail`. */
const detailOf = (event: unknown): Detail => (event as { detail?: Detail } | null)?.detail

const messageFor = (
  settings: NativeSwipeSettings<unknown>,
  info: SwipeTriggerInfo,
): Option.Option<unknown> => {
  const action = [...(settings.leading ?? []), ...(settings.trailing ?? [])].find(
    candidate => candidate.key === info.key,
  )
  const own = action?.onTriggered
  if (own !== undefined) {
    return Option.some(
      typeof own === 'function' ? (own as (info: SwipeTriggerInfo) => unknown)(info) : own,
    )
  }
  return settings.onActionTriggered === undefined
    ? Option.none()
    : Option.some(settings.onActionTriggered(info))
}

/** See the top of this file. */
export const nativeSwipeRow = (
  attributes: ReadonlyArray<any>,
  children: ReadonlyArray<any>,
): Html => {
  const { settings, styles, rest } = split(attributes)
  if (!drawsNative(settings)) {
    const look = settings.fallbackStyle === undefined ? styles : { ...styles, ...settings.fallbackStyle }
    return el('view')([...styled(look), ...rest] as never, children as never)
  }
  const { onOpened, onClosed } = settings
  return el(NATIVE_SWIPE_TAG)(
    [
      // Every prop is sent every time, so one that was set and is then left
      // out goes back to its usual value on the phone.
      prop('actionsLeading', actionProps(settings.leading)),
      prop('actionsTrailing', actionProps(settings.trailing)),
      prop('allowsFullSwipe', settings.allowsFullSwipe ?? true),
      prop('mode', settings.mode ?? 'tiles'),
      prop('group', settings.group ?? ''),
      prop('cornerRadius', settings.cornerRadius ?? 0),
      prop('isEnabled', settings.isEnabled ?? true),
      // Not called `layoutDirection` or `direction` on the native side:
      // React Native has style props close to those names.
      prop('rowDirection', settings.layoutDirection ?? 'auto'),
      prop('closeSignal', settings.closeSignal ?? 0),
      // The row must be a real view on the phone, never folded into its
      // parent as "layout only": the native code is the view.
      prop('collapsable', false),
      OnCustomEvent({
        name: SWIPE_OPENED,
        f: (event: unknown) =>
          onOpened === undefined
            ? Option.none()
            : Option.some(
                onOpened(detailOf(event)?.['side'] === 'leading' ? 'leading' : 'trailing'),
              ),
      }),
      OnCustomEvent({
        name: SWIPE_CLOSED,
        f: () => (onClosed === undefined ? Option.none() : Option.some(onClosed())),
      }),
      OnCustomEvent({
        name: ACTION_TRIGGERED,
        f: (event: unknown) => {
          const detail = detailOf(event)
          const key = detail?.['key']
          if (typeof key !== 'string') return Option.none()
          return messageFor(settings, { key, viaFullSwipe: detail?.['viaFullSwipe'] === true })
        },
      }),
      // The content slides out past the row's edge. It must be cut off there.
      ...styled({ overflow: 'hidden', ...styles }),
      ...rest,
    ] as never,
    children as never,
  )
}

/**
 * Closes every open row of a group, now. Does nothing where the native view
 * is not present. Never throws.
 */
export const closeNativeSwipesNow = (group: string): void => {
  try {
    const result = swipeModule()?.closeAll?.(group)
    // The native function answers with a promise. A failure there is not
    // worth crashing the app for: the rows simply stay as they are.
    if (result !== null && typeof result === 'object' && 'catch' in result) {
      ;(result as Promise<unknown>).catch(() => {})
    }
  } catch {
    // The same.
  }
}

/**
 * The same as an Effect, for a Command:
 *
 *   const CloseRows = Command.define('CloseRows', {
 *     messages: [ClosedRows],
 *     execute: closeNativeSwipes('inbox').pipe(Effect.as(ClosedRows())),
 *   })
 */
export const closeNativeSwipes = (group: string): Effect.Effect<void> =>
  Effect.sync(() => closeNativeSwipesNow(group))
