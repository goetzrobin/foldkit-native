/**
 * Draws what Legend List's core decides, with native views and no React.
 *
 * Foldkit draws the scroll view and one empty content view and never looks
 * inside. This module owns what is inside, laid out as Legend's own
 * components lay it out:
 *
 *   scroll-view                     drawn by Foldkit
 *     view (content)                drawn by Foldkit, left empty
 *       view (scroll adjust)        Legend's ScrollAdjust: see below
 *       view (start spacer)         pushes a short list to the bottom
 *       view (layer)                as tall as every row together
 *         view (container) ...      a fixed set, each placed with `top`
 *       view (end spacer)           room below the last row for an anchored row
 *
 * A container is a slot, not a row. Legend makes about as many as fit on the
 * screen plus a margin, and as the list scrolls it gives each one a new item
 * and a new `top`. With `recycleItems` the container's native views stay and
 * only their content changes.
 *
 * Who does what:
 *   `driver.ts` calls Legend's functions in the order its React component does.
 *   Legend writes its decisions as named values (`containerItemKey3`,
 *   `containerPosition3`, `totalSize` ...). This module listens to them, builds
 *   the views with the same updater Foldkit uses, and commits. It also brings
 *   the phone's events (scroll, layout, drag) to the driver. No Foldkit Message
 *   is sent for any of this and the program's view function does not run.
 *
 * The scroll adjust view is how Legend keeps the screen still when rows above
 * it change size. The native scroll view is told to keep its first child in
 * place (`maintainVisibleContentPosition`). That first child is an empty view
 * placed far down the content. Moving it by 12 points makes the native scroll
 * view move its own position by 12 points in the same frame.
 */
import type { Engine, EngineNode } from '@ng-native/fabric'
import type { Html } from 'foldkit/html'
import { type VNode, h, init, onUnmountModule } from 'foldkit/renderTarget'

import { type ModuleFactory, registerModule } from '../extend.js'
import { makeModules, nodeOf } from '../modules.js'
import { makeNodeApi } from '../nodeApi.js'
import {
  type LegendDriver,
  type LegendDriverProps,
  type ScrollEvent,
  createLegendDriver,
} from '../../host/legend/driver.js'
import { type LegendPlatform, Platform, setLegendPlatform } from '../../host/legend/platform/Platform.js'
import { POSITION_OUT_OF_VIEW } from '../../host/legend/vendor/constants.js'
import { type ListenerType, listen$, peek$ } from '../../host/legend/vendor/state/state.js'
import type { LegendListInternalRef } from '../../host/legend/vendor/types.internal.js'

/** What `legendList(...)` leaves on its scroll view for this module to read. */
export type LegendSpec = Readonly<{
  id: string
  platform: LegendPlatform
  items: ReadonlyArray<unknown>
  key: (item: any, index: number) => string
  row: (item: any, index: number) => Html
  options: Omit<LegendDriverProps<unknown>, 'data' | 'keyExtractor' | 'renderItem'>
  /** Runs a function that builds Foldkit elements as if inside the program's view. */
  inFrame: (build: () => Html) => Html
  /** Written by this module: the scroll view, so `legendList` can reach its handlers. */
  target: { scroll: EngineNode | undefined }
}>

export const LEGEND_DATA = 'foldkitLegendList'
/** On the content view: the same spec, so the module can pair it with its scroll view. */
export const LEGEND_CONTENT_DATA = 'foldkitLegendListContent'

/** Legend's own number: large enough that the adjust view's `top` never goes negative. */
const SCROLL_ADJUST_BIAS = 10_000_000

/** How many times one flush may draw again before it gives up. Legend settles in two or three. */
const MAX_TURNS = 16

/** What the phone reports for one container, by the testID of the row inside it, for tests. */
export type LegendContainerInfo = Readonly<{ id: number; itemKey: string; position: number }>

type ListState = {
  spec: LegendSpec
  readonly engine: Engine
  readonly scroll: EngineNode
  readonly content: EngineNode
  readonly driver: LegendDriver<unknown>
  /** The content view as the row updater last drew it. */
  drawn: VNode
  /** Row elements already built, by container. Kept so an unchanged row is not built again. */
  rows: Map<number, { itemKey: string; data: unknown; index: number; vnode: VNode | null }>
  /** Container ids whose values are already listened to. */
  watched: number
  /** Something Legend decided has changed since the last draw. */
  isDirty: boolean
  isFlushing: boolean
  isFlushQueued: boolean
  /** True while Foldkit is in the middle of its own draw, before its commit. */
  isInFoldkitDraw: boolean
  /** Scroll commands asked for before the scroll view reached the phone. */
  heldCommands: Array<() => void>
  /** The last place the phone was asked to scroll to, for `legendNumbers`. */
  lastScroll: { target: number; animated: boolean; sends: number } | undefined
  isAlive: boolean
  stops: Array<() => void>
}

const listsById = new Map<string, Set<ListState>>()

const propsOf = (spec: LegendSpec): LegendDriverProps<unknown> => ({
  ...spec.options,
  data: spec.items,
  keyExtractor: spec.key,
  renderItem: ({ item, index }) => spec.inFrame(() => spec.row(item, index)),
})

const nativeEventOf = (event: unknown): ScrollEvent =>
  ({ nativeEvent: (event as { nativeEvent?: unknown })?.nativeEvent ?? {} }) as ScrollEvent

type Layout = { x: number; y: number; width: number; height: number }

const layoutIn = (event: unknown): Layout | undefined => {
  const from = event as { nativeEvent?: { layout?: Layout }; detail?: { layout?: Layout } }
  const layout = from?.nativeEvent?.layout ?? from?.detail?.layout
  return layout !== undefined && typeof layout.height === 'number' ? layout : undefined
}

const legendModule: ModuleFactory = (engine, afterCommit) => {
  const lists = new Map<EngineNode, ListState>()

  // A second updater for what is inside the content view, with the same
  // modules as Foldkit's own. Made on first use. See `list/module.ts`.
  const rowJobs: Array<() => void> = []
  let rowPatch: ((before: VNode, after: VNode) => VNode) | undefined
  const patchRows = (before: VNode, after: VNode): VNode => {
    rowPatch ??= init(
      [...makeModules(engine, job => rowJobs.push(job)), onUnmountModule],
      makeNodeApi(engine),
    )
    return rowPatch(before, after)
  }
  const runRowJobs = (): void => {
    for (const job of rowJobs.splice(0)) job()
  }

  /** A box as the last commit laid it out, where the engine and the phone can say. */
  const boxOf = (node: EngineNode): Layout | undefined => {
    const layoutOf = (engine as { layoutOf?: (node: EngineNode) => Layout | undefined }).layoutOf
    if (typeof layoutOf !== 'function') return undefined
    const box = layoutOf.call(engine, node)
    return box !== undefined && Number.isFinite(box.height) && Number.isFinite(box.width)
      ? box
      : undefined
  }

  const markDirty = (state: ListState): void => {
    state.isDirty = true
    if (state.isFlushing || state.isFlushQueued || state.isInFoldkitDraw) return
    state.isFlushQueued = true
    // Legend also changes its mind from timers and frames, with nobody to draw
    // afterwards. A microtask is early enough: it runs before the phone paints.
    queueMicrotask(() => {
      state.isFlushQueued = false
      flush(state)
    })
  }

  /** Listens to the values Legend sets for containers that are new since last time. */
  const watchContainers = (state: ListState): void => {
    const { ctx } = state.driver
    const pooled = peek$(ctx, 'numContainersPooled') ?? 0
    for (let id = state.watched; id < pooled; id++) {
      for (const name of [
        `containerItemKey${id}`,
        `containerPosition${id}`,
        `containerItemData${id}`,
        `containerItemIndex${id}`,
        `containerLayoutReady${id}`,
      ] as Array<ListenerType>) {
        state.stops.push(listen$(ctx, name, () => markDirty(state)))
      }
    }
    state.watched = Math.max(state.watched, pooled)
  }

  // Container.tsx and PositionView.native.tsx (PositionViewState).
  const containerVNode = (state: ListState, id: number): VNode | undefined => {
    const { ctx } = state.driver
    const itemKey = peek$(ctx, `containerItemKey${id}`)
    // ContainerSlot.tsx: a container with no item draws nothing.
    if (itemKey === undefined) {
      state.rows.delete(id)
      return undefined
    }
    const data = peek$(ctx, `containerItemData${id}`)
    const index = peek$(ctx, `containerItemIndex${id}`)
    let row = state.rows.get(id)
    if (row === undefined || row.itemKey !== itemKey || row.data !== data || row.index !== index) {
      const built = state.driver.renderedItem(itemKey, id) as VNode | null | undefined
      row = { itemKey, data, index, vnode: built ?? null }
      state.rows.set(id, row)
      // useContainerMeasurement.tsx: a drawn container is measured after the commit.
      state.driver.containerDrawn(id)
    }
    const position = peek$(ctx, `containerPosition${id}`) ?? POSITION_OUT_OF_VIEW
    const isReady = peek$(ctx, `containerLayoutReady${id}`) ?? true
    const recycle = ctx.state.props.recycleItems
    return h(
      'view',
      {
        // With recycling the native view is kept when its item changes.
        key: recycle ? `c${id}` : `c${id}:${itemKey}`,
        props: {
          // Kept as a real native view, so it is there to measure and to recycle.
          collapsable: false,
          pointerEvents: isReady ? 'auto' : 'none',
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            top: position,
            opacity: isReady ? 1 : 0,
          },
        },
        on: {
          layout: (event: unknown) => {
            const layout = layoutIn(event)
            if (layout === undefined || !state.isAlive) return
            state.driver.onContainerLayout(id, itemKey, layout)
          },
        },
      },
      row.vnode === null ? [] : [row.vnode],
    )
  }

  // ListComponent.tsx, Containers.native.tsx and ScrollAdjust.native.tsx.
  const contentVNode = (state: ListState): VNode => {
    const { ctx } = state.driver
    watchContainers(state)
    const pooled = peek$(ctx, 'numContainersPooled') ?? 0
    const containers: Array<VNode> = []
    for (let id = 0; id < pooled; id++) {
      const container = containerVNode(state, id)
      if (container !== undefined) containers.push(container)
    }
    for (const id of [...state.rows.keys()]) if (id >= pooled) state.rows.delete(id)

    const totalSize = peek$(ctx, 'totalSize') ?? 0
    const isVisible = !!peek$(ctx, 'readyToRender')
    const adjust =
      (peek$(ctx, 'scrollAdjust') || 0) + (peek$(ctx, 'scrollAdjustUserOffset') || 0) + SCROLL_ADJUST_BIAS
    const startSpace = ctx.state.props.alignItemsAtEndPaddingEnabled
      ? Math.max(0, peek$(ctx, 'alignItemsAtEndPadding') ?? 0)
      : 0
    const endSpace = ctx.state.props.anchoredEndSpace
      ? Math.max(0, peek$(ctx, 'anchoredEndSpaceSize') ?? 0)
      : 0

    return {
      ...state.drawn,
      children: [
        h('view', {
          key: 'legend-adjust',
          props: {
            // Never optimised away: the native scroll view must find it as its first child.
            collapsable: false,
            style: { position: 'absolute', left: 0, top: adjust, width: 0, height: 0 },
          },
        }),
        h('view', { key: 'legend-start', props: { style: { flexShrink: 0, height: startSpace } } }),
        h(
          'view',
          {
            key: 'legend-layer',
            props: {
              collapsable: false,
              pointerEvents: isVisible ? 'auto' : 'none',
              style: { height: totalSize, minHeight: totalSize, opacity: isVisible ? 1 : 0 },
            },
          },
          containers,
        ),
        // Legend adds this room as bottom padding on the content view. A view of
        // that height after the rows makes the content exactly as tall.
        h('view', { key: 'legend-end', props: { style: { flexShrink: 0, height: endSpace } } }),
      ],
    }
  }

  const draw = (state: ListState): void => {
    state.isDirty = false
    state.drawn = patchRows(state.drawn, contentVNode(state))
  }

  const sendHeld = (state: ListState): void => {
    for (const send of state.heldCommands.splice(0)) send()
  }

  /**
   * Draws until Legend has nothing more to say. One turn is what React does in
   * one pass: render if asked, commit, run the layout effects. Measuring rows in
   * a layout effect usually moves some containers, which asks for another turn.
   */
  const flush = (state: ListState): void => {
    if (state.isFlushing || state.isInFoldkitDraw || !state.isAlive) return
    state.isFlushing = true
    try {
      for (let turn = 0; turn < MAX_TURNS && state.isAlive; turn++) {
        const wantsRender = state.driver.takeRerender()
        if (!state.isDirty && !wantsRender) break
        if (wantsRender) state.driver.render(propsOf(state.spec))
        draw(state)
        engine.commit()
        runRowJobs()
        sendHeld(state)
        state.driver.afterCommit()
      }
    } finally {
      state.isFlushing = false
    }
    // Still not settled after that many turns: carry on in a moment, so the
    // phone can paint and take touches in between.
    if (state.isAlive && state.isDirty && !state.isFlushQueued) {
      state.isFlushQueued = true
      setTimeout(() => {
        state.isFlushQueued = false
        flush(state)
      }, 0)
    }
  }

  /** Runs something Legend should hear, then draws what it decided. */
  const tell = (state: ListState, run: () => void): void => {
    if (!state.isAlive) return
    run()
    flush(state)
  }

  /** The part of a draw that happens inside Foldkit's own draw. */
  const drawWithFoldkit = (state: ListState): void => {
    state.isInFoldkitDraw = true
    draw(state)
    // Foldkit commits when its own draw is done.
    afterCommit(() => {
      state.isInFoldkitDraw = false
      if (!state.isAlive) return
      runRowJobs()
      sendHeld(state)
      state.driver.afterCommit()
      flush(state)
    })
  }

  // Scroll views created in this draw whose content view has not been yet.
  const scrollBySpec = new Map<LegendSpec, EngineNode>()

  const createList = (scroll: EngineNode, contentVnode: VNode, spec: LegendSpec): void => {
    const content = nodeOf(contentVnode)
    if (content === undefined) return
    setLegendPlatform(spec.platform)
    spec.target.scroll = scroll

    // The driver is made before the state that holds it, and may call back at once.
    const holder: { state: ListState | undefined } = { state: undefined }
    const send = (run: () => void): void => {
      const state = holder.state
      if (state === undefined) return
      // A command for a view the phone has not been given yet is dropped, so it waits.
      if (state.isInFoldkitDraw || engine.tagOf(scroll) === null) state.heldCommands.push(run)
      else run()
    }
    const driver = createLegendDriver<unknown>(
      {
        scrollTo: ({ animated, x, y }) => {
          const state = holder.state
          if (state !== undefined) {
            const last = state.lastScroll
            const target = y ?? 0
            state.lastScroll = {
              target,
              animated: !!animated,
              sends: last !== undefined && Math.abs(last.target - target) < 1 ? last.sends + 1 : 1,
            }
          }
          send(() => engine.dispatchCommand(scroll, 'scrollTo', [x ?? 0, y ?? 0, !!animated]))
        },
        measureScroller: into => {
          const box = boxOf(scroll)
          if (box !== undefined && box.height > 0) into(box)
        },
        requestRender: () => {
          if (holder.state !== undefined) markDirty(holder.state)
        },
      },
      propsOf(spec),
    )
    const state: ListState = {
      spec,
      engine,
      scroll,
      content,
      driver,
      // The row updater is handed the content view as Foldkit drew it: empty.
      drawn: { ...contentVnode, data: {}, children: [], text: undefined },
      rows: new Map(),
      watched: 0,
      isDirty: false,
      isFlushing: false,
      isFlushQueued: false,
      isInFoldkitDraw: false,
      heldCommands: [],
      lastScroll: undefined,
      isAlive: true,
      stops: [],
    }
    holder.state = state
    const { ctx } = driver

    // measureContainersInLayoutEffect asks each container for its size through
    // `ctx.viewRefs`, as it would ask a React ref. The answer is read from the
    // commit just made, where the engine and the phone can give it. Where they
    // cannot (the tests, an older engine) nothing is answered here and the
    // container's layout event brings the size a moment later.
    const containerNode = (id: number): EngineNode | undefined => {
      const layer = state.drawn.children?.[2]
      const key = peek$(ctx, `containerItemKey${id}`)
      if (typeof layer !== 'object' || layer === null || key === undefined) return undefined
      const wanted = ctx.state.props.recycleItems ? `c${id}` : `c${id}:${key}`
      const found = layer.children?.find(child => typeof child === 'object' && child.key === wanted)
      return typeof found === 'object' ? (found.elm as unknown as EngineNode | undefined) : undefined
    }
    const refFor = (id: number) => ({
      current: {
        measure: (into: (x: number, y: number, width: number, height: number) => void): void => {
          const node = containerNode(id)
          const box = node === undefined ? undefined : boxOf(node)
          if (box !== undefined) into(box.x, box.y, box.width, box.height)
        },
      },
    })
    const refs = new Map<number, ReturnType<typeof refFor>>()
    ctx.viewRefs = {
      get: (id: number) => {
        let ref = refs.get(id)
        if (ref === undefined) refs.set(id, (ref = refFor(id)))
        return ref
      },
      keys: () => state.rows.keys(),
      [Symbol.iterator]: function* () {
        for (const id of state.rows.keys()) yield [id, refs.get(id) ?? refFor(id)] as const
      },
    } as never

    for (const name of [
      'numContainersPooled',
      'totalSize',
      'readyToRender',
      'scrollAdjust',
      'scrollAdjustUserOffset',
      'alignItemsAtEndPadding',
      'anchoredEndSpaceSize',
      // ContainerLayoutCoordinator.tsx: a new epoch asks for a commit and a measurement.
      'containerLayoutEpoch',
    ] as Array<ListenerType>) {
      state.stops.push(listen$(ctx, name, () => markDirty(state)))
    }

    const hear = (type: string, run: (event: ScrollEvent) => void): void => {
      state.stops.push(
        engine.setEventListener(scroll, type, event => tell(state, () => run(nativeEventOf(event)))),
      )
    }
    hear('topScroll', driver.onScroll)
    hear('topScrollBeginDrag', driver.onScrollBeginDrag)
    hear('topScrollEndDrag', driver.onScrollEndDrag)
    hear('topMomentumScrollBegin', driver.onMomentumScrollBegin)
    hear('topMomentumScrollEnd', driver.onMomentumScrollEnd)
    state.stops.push(
      engine.setEventListener(scroll, 'topLayout', event => {
        const layout = layoutIn(event)
        if (layout !== undefined) tell(state, () => driver.onLayout(layout))
      }),
      // React Native's ScrollView reports a new content size from its content
      // view's layout. Legend uses it to repeat a scroll to the end that the
      // phone cut short because the content was not tall enough yet.
      engine.setEventListener(content, 'topLayout', () =>
        tell(state, () => driver.onContentSizeChange()),
      ),
    )

    // ListComponent.tsx: the scroll view's own props.
    const mvcp = ctx.state.props.maintainVisibleContentPosition
    if (mvcp.size || mvcp.data) {
      engine.setProp(scroll, 'maintainVisibleContentPosition', { minIndexForVisible: 0 })
    }
    const initialScroll = ctx.state.initialScroll
    const initialOffset = initialScroll?.contentOffset
    if (typeof initialOffset === 'number' && initialOffset > 0) {
      engine.setProp(scroll, 'contentOffset', { x: 0, y: initialOffset })
    }
    if (Platform.OS === 'android') {
      // Android only reports the end of a fling when asked to.
      engine.setProp(scroll, 'sendMomentumEvents', true)
    }

    lists.set(scroll, state)
    let sameId = listsById.get(spec.id)
    if (sameId === undefined) listsById.set(spec.id, (sameId = new Set()))
    sameId.add(state)
    drawWithFoldkit(state)
  }

  const updateList = (state: ListState, spec: LegendSpec): void => {
    state.spec = spec
    spec.target.scroll = state.scroll
    // The new `row` function may read newer parts of the Model, so every row
    // drawn is built again. Containers are few.
    state.rows = new Map()
    state.driver.render(propsOf(spec))
    drawWithFoldkit(state)
  }

  const destroyList = (state: ListState): void => {
    state.isAlive = false
    for (const stop of state.stops) stop()
    state.driver.dispose()
    // An empty content view, so every row's own clean-up runs.
    state.rows = new Map()
    state.drawn = patchRows(state.drawn, { ...state.drawn, children: [] })
    lists.delete(state.scroll)
    listsById.get(state.spec.id)?.delete(state)
  }

  return {
    create: (_empty, vnode) => {
      const node = nodeOf(vnode)
      const scrollSpec = vnode.data?.[LEGEND_DATA] as LegendSpec | undefined
      if (scrollSpec !== undefined && node !== undefined) scrollBySpec.set(scrollSpec, node)
      const contentSpec = vnode.data?.[LEGEND_CONTENT_DATA] as LegendSpec | undefined
      const scroll = contentSpec === undefined ? undefined : scrollBySpec.get(contentSpec)
      if (contentSpec !== undefined && scroll !== undefined) {
        scrollBySpec.delete(contentSpec)
        createList(scroll, vnode, contentSpec)
      }
    },
    update: (_old, vnode) => {
      const spec = vnode.data?.[LEGEND_DATA] as LegendSpec | undefined
      const node = nodeOf(vnode)
      const state = node === undefined ? undefined : lists.get(node)
      if (state === undefined) return
      if (spec !== undefined) updateList(state, spec)
      else destroyList(state)
    },
    destroy: vnode => {
      const node = nodeOf(vnode)
      const state = node === undefined ? undefined : lists.get(node)
      if (state !== undefined) destroyList(state)
    },
  }
}

registerModule(legendModule)

/**
 * Legend's own ref for every list with this id: `scrollToEnd`, `scrollToIndex`,
 * `getState` and the rest, as documented by Legend List. A scroll asked for
 * here is drawn by the list itself.
 */
export const legendHandles = (id: string): Array<LegendListInternalRef> =>
  [...(listsById.get(id) ?? [])].map(state => state.driver.handle)

/** Which container shows which item and where, for every list with this id. For tests and labels. */
export const legendContainers = (id: string): Array<Array<LegendContainerInfo>> =>
  [...(listsById.get(id) ?? [])].map(state => {
    const { ctx } = state.driver
    const pooled = peek$(ctx, 'numContainersPooled') ?? 0
    const found: Array<LegendContainerInfo> = []
    for (let containerId = 0; containerId < pooled; containerId++) {
      const itemKey = peek$(ctx, `containerItemKey${containerId}`)
      if (itemKey === undefined) continue
      found.push({
        id: containerId,
        itemKey,
        position: peek$(ctx, `containerPosition${containerId}`) ?? POSITION_OUT_OF_VIEW,
      })
    }
    return found
  })

/**
 * One list's own numbers as two lines of text, for finding out on a real
 * phone why it is not where it should be. Reads Legend's state as it is now.
 */
export const legendNumbers = (id: string): string => {
  const state = [...(listsById.get(id) ?? [])].at(-1)
  if (state === undefined) return 'No list on screen.'
  const { ctx } = state.driver
  const seen = state.driver.handle.getState()
  const round = (value: number | undefined): number => Math.round(value ?? 0)
  const last = state.lastScroll
  const asked =
    last === undefined
      ? 'none'
      : `${round(last.target)} ${last.animated ? 'gliding' : 'at once'}, sent ${last.sends}x`
  return (
    `list ${round(seen.scrollLength)} content ${round(seen.contentLength)} ` +
    `blank ${round(peek$(ctx, 'anchoredEndSpaceSize'))}\n` +
    `at ${round(seen.scroll)} of ${round(seen.contentLength - seen.scrollLength)}, ` +
    `asked: ${asked}, at end: ${seen.isAtEnd ? 'yes' : 'no'}`
  )
}
