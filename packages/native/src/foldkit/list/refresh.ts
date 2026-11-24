/**
 * Pull to refresh, for a scroll view or a list.
 *
 *   refreshScrollView(
 *     {
 *       platform: device.platform,
 *       refreshing: model.isRefreshing,
 *       onRefresh: () => Message.PulledToRefresh(),
 *     },
 *     [style({ flex: 1 })],
 *     rows,
 *   )
 *
 * The phone shows its own spinner the moment the user pulls, before the
 * program has heard of it. The pull then arrives as the `onRefresh` Message.
 * The program sets `refreshing` to true in its Model while it works and back
 * to false when it is done, and the spinner stops.
 *
 * The native shape differs by platform, as it does in React Native:
 *   iOS      the control is the scroll view's first child.
 *   Android  the control wraps the scroll view, and takes over the styles
 *            that size and place it.
 *
 * The facts here (view names, the `setNativeRefreshing` command, the Android
 * wrapping and which style names move to the wrapper) come from ng-native's
 * `refresh-control.ts` and `swipe-refresh-layout.ts` (MIT, Ashley Hunter),
 * which follow React Native's `RefreshControl` and `ScrollView.js`. The list
 * of style names is React Native's `splitLayoutProps`.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import { Option } from 'effect'
import type { Html } from 'foldkit/html'
import { OnCustomEvent, Prop, type VNode, element } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend.js'
import { bagOf, nodeOf } from '../modules.js'

const el = element<any>()

const REFRESH_CONTROL = 'refresh-control'

export type Refresh<Message> = Readonly<{
  /** `device.platform`. The native shape differs between iOS and Android. */
  platform: string
  /** Whether the spinner shows. Only the Model decides this. */
  refreshing: boolean
  /** The user pulled far enough. Set `refreshing` to true in response. */
  onRefresh: () => Message
  /** The spinner's colour. */
  color?: string
}>

/** Styles that size and place a view, as opposed to painting it. On Android
 *  these belong on the control that wraps the scroll view. */
const LAYOUT_STYLES: ReadonlySet<string> = new Set([
  'margin', 'marginHorizontal', 'marginVertical', 'marginBottom', 'marginTop',
  'marginLeft', 'marginRight', 'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'alignSelf', 'height', 'minHeight', 'maxHeight', 'width', 'minWidth',
  'maxWidth', 'position', 'left', 'right', 'bottom', 'top', 'transform',
  'transformOrigin', 'rowGap', 'columnGap', 'gap',
])

type AttributeLike = Readonly<{ _tag?: string; key?: unknown; value?: unknown }>

const isStyle = (attribute: AttributeLike): boolean =>
  attribute._tag === 'Prop' && attribute.key === 'style'

const isKey = (attribute: AttributeLike): boolean => attribute._tag === 'Key'

/** The scroll view's attributes, split between the wrapper and itself. */
const splitForWrapper = (attributes: ReadonlyArray<AttributeLike>) => {
  const outer: Record<string, unknown> = {}
  const inner: Record<string, unknown> = {}
  for (const attribute of attributes) {
    if (!isStyle(attribute)) continue
    for (const [name, value] of Object.entries(attribute.value ?? {})) {
      ;(LAYOUT_STYLES.has(name) ? outer : inner)[name] = value
    }
  }
  return {
    outer,
    inner,
    keys: attributes.filter(isKey),
    rest: attributes.filter(attribute => !isStyle(attribute) && !isKey(attribute)),
  }
}

const control = (refresh: Refresh<any>, attributes: ReadonlyArray<unknown>, children: ReadonlyArray<unknown>) =>
  el(REFRESH_CONTROL)(
    [
      Prop({ key: 'refreshing', value: refresh.refreshing }),
      ...(refresh.color === undefined
        ? []
        : [
            Prop({ key: 'tintColor', value: refresh.color }),
            Prop({ key: 'colors', value: [refresh.color] }),
          ]),
      OnCustomEvent({ name: 'refresh', f: () => Option.some(refresh.onRefresh()) }),
      ...attributes,
    ] as never,
    children as never,
  )

/**
 * A scroll view with one content view, and a refresh control where the
 * platform wants it. `root` is what goes in the view. `scroll` is the scroll
 * view itself, which on Android sits inside `root`.
 */
export const scrollWithRefresh = (
  refresh: Refresh<any> | undefined,
  attributes: ReadonlyArray<unknown>,
  content: Html,
): Readonly<{ root: Html; scroll: VNode | null }> => {
  const base = [Prop({ key: 'alwaysBounceVertical', value: true })]
  if (refresh === undefined) {
    const scroll = el('scroll-view')([...base, ...attributes] as never, [content])
    return { root: scroll, scroll }
  }
  if (refresh.platform !== 'android') {
    const scroll = el('scroll-view')(
      [...base, ...attributes] as never,
      [control(refresh, [], []), content],
    )
    return { root: scroll, scroll }
  }
  const { outer, inner, keys, rest } = splitForWrapper(attributes as ReadonlyArray<AttributeLike>)
  const scroll = el('scroll-view')(
    [
      ...base,
      // React Native turns this on whenever a scroll view has a refresh control.
      Prop({ key: 'nestedScrollEnabled', value: true }),
      Prop({ key: 'style', value: inner }),
      ...rest,
    ] as never,
    [content],
  )
  return {
    root: control(refresh, [...keys, Prop({ key: 'style', value: outer })], [scroll]),
    scroll,
  }
}

/** A scroll view the user can pull down to refresh. See the top of this file. */
export const refreshScrollView = <Message>(
  refresh: Refresh<Message>,
  attributes: ReadonlyArray<any>,
  children: ReadonlyArray<any>,
): Html =>
  scrollWithRefresh(
    refresh,
    attributes,
    el('view')([Prop({ key: 'collapsable', value: false })] as never, children as never),
  ).root

/** How long the program has to set `refreshing` after a pull before the
 *  spinner is stopped for it. */
const UNANSWERED_PULL_MS = 400

type Control = {
  /** What the phone's spinner is doing, or null before the first pull. */
  native: boolean | null
  desired: boolean
  stop: () => void
  timer: ReturnType<typeof setTimeout> | undefined
}

/**
 * Keeps the phone's spinner and the Model in step.
 *
 * A pull starts the spinner on the phone by itself. If the Model then says
 * something different, the `refreshing` prop alone does not move the spinner:
 * the phone already believes the prop has that value. So the difference is
 * sent as the `setNativeRefreshing` command, once the draw has reached it.
 */
const refreshModule: ModuleFactory = (engine: Engine, afterCommit) => {
  const controls = new WeakMap<EngineNode, Control>()

  const reconcile = (node: EngineNode, held: Control): void => {
    if (held.native === null || held.native === held.desired) return
    held.native = held.desired
    const desired = held.desired
    afterCommit(() => engine.dispatchCommand(node, 'setNativeRefreshing', [desired]))
  }

  const desiredOf = (vnode: VNode): boolean => bagOf(vnode, 'props')['refreshing'] === true

  return {
    create: (_empty, vnode) => {
      const node = nodeOf(vnode)
      if (node === undefined || node.tag !== REFRESH_CONTROL) return
      const held: Control = {
        native: null,
        desired: desiredOf(vnode),
        stop: () => {},
        timer: undefined,
      }
      controls.set(node, held)
      // The events module turns the pull into the Message. This listener
      // only notes that the phone's spinner is now running.
      held.stop = engine.setEventListener(node, 'topRefresh', () => {
        held.native = true
        // A program that never answers would leave the spinner running.
        clearTimeout(held.timer)
        held.timer = setTimeout(() => {
          if (held.native !== true || held.desired) return
          held.native = false
          engine.dispatchCommand(node, 'setNativeRefreshing', [false])
        }, UNANSWERED_PULL_MS)
      })
    },
    update: (_old, vnode) => {
      const node = nodeOf(vnode)
      const held = node === undefined ? undefined : controls.get(node)
      if (node === undefined || held === undefined) return
      held.desired = desiredOf(vnode)
      reconcile(node, held)
    },
    destroy: vnode => {
      const node = nodeOf(vnode)
      const held = node === undefined ? undefined : controls.get(node)
      if (node === undefined || held === undefined) return
      held.stop()
      clearTimeout(held.timer)
      controls.delete(node)
    },
  }
}

registerModule(refreshModule)
