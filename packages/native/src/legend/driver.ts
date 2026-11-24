/**
 * Runs Legend List's core without React.
 *
 * Legend List keeps its arithmetic in plain functions (`vendor/core`) and
 * calls them from one large React component, `LegendList.tsx`. That component
 * is the only place that knows the order: what to compute while rendering,
 * what to do in which layout effect, which native event calls which function.
 *
 * This file is that component, rewritten as an object with methods. Nothing
 * here decides which rows are visible or where anything sits. It only calls
 * Legend's functions in the order Legend's component does. Each block names
 * the part of `LegendList.tsx` (Legend 3.7.3) it stands for, so the two can be
 * read side by side when Legend changes.
 *
 * How React's phases map to this object:
 *
 *   React                              here
 *   a render of LegendListInner        `render(props)`
 *   children's layout effects          `afterCommit()`: measure containers
 *   LegendListInner's layout effects   `afterCommit()`: `runEffects()`
 *   native events                      `onScroll`, `onLayout`, ...
 *   the ref's methods                  `handle` (Legend's own imperative handle)
 *
 * The object draws nothing. `module.ts` listens to the values Legend sets
 * (which container shows which item, at what position) and draws them.
 *
 * Left out, because the list element built on this does not offer them yet:
 * headers and footers, sticky rows, columns, horizontal lists, snapping,
 * content insets, `getFixedItemSize`, viewability callbacks, and Legend's
 * web-only paths.
 */
import { cancelBootstrapInitialScrollFrame, handleBootstrapInitialScrollLayoutChange } from './vendor/core/bootstrapInitialScroll.js'
import { calculateItemsInView } from './vendor/core/calculateItemsInView.js'
import { cancelImperativeScroll, syncScrollActive } from './vendor/core/cancelImperativeScroll.js'
import { interruptUserScroll } from './vendor/core/cancelScroll.js'
import { checkFinishedScrollFallback } from './vendor/core/checkFinishedScroll.js'
import { checkResetContainers } from './vendor/core/checkResetContainers.js'
import { checkStructuralDataChange } from './vendor/core/checkStructuralDataChange.js'
import { doInitialAllocateContainers } from './vendor/core/doInitialAllocateContainers.js'
import { doMaintainScrollAtEnd, reissueClampedNativeEndScroll } from './vendor/core/doMaintainScrollAtEnd.js'
import { doScrollTo } from './vendor/core/doScrollTo.js'
import { getEndAlignedViewOffset } from './vendor/core/endOfContentTarget.js'
import { clearPreservedInitialScrollTarget } from './vendor/core/finishInitialScroll.js'
import { finishMaintainScrollAtEnd } from './vendor/core/finishMaintainScrollAtEnd.js'
import { handleLayout } from './vendor/core/handleLayout.js'
import { advanceCurrentInitialScrollSession, resolveInitialScrollOffset } from './vendor/core/initialScroll.js'
import { handleInitialScrollDataChange, initializeInitialScrollOnMount } from './vendor/core/initialScrollLifecycle.js'
import { restoreItemSizeEstimates, saveItemSizeEstimates } from './vendor/core/itemSizeCache.js'
import { measureContainersInLayoutEffect } from './vendor/core/measureContainersInLayoutEffect.js'
import { onScroll } from './vendor/core/onScroll.js'
import { resetLayoutCachesForDataChange } from './vendor/core/resetLayoutCachesForDataChange.js'
import { ScheduledWork } from './vendor/core/ScheduledWork.js'
import { getContainerLayoutEffectScope, scheduleContainerLayout } from './vendor/core/scheduleContainerLayout.js'
import { ScrollAdjustHandler } from './vendor/core/ScrollAdjustHandler.js'
import { scrollTo } from './vendor/core/scrollTo.js'
import { scrollToEnd } from './vendor/core/scrollToEnd.js'
import { maybeUpdateAnchoredEndSpace } from './vendor/core/updateAnchoredEndSpace.js'
import { updateContentInsetEndAdjustment } from './vendor/core/updateContentInsetEndAdjustment.js'
import { setFooterSize, setHeaderSize } from './vendor/core/updateContentMetrics.js'
import { updateContentMetricsState } from './vendor/core/updateContentMetricsState.js'
import { updateItemPositions } from './vendor/core/updateItemPositions.js'
import { updateItemSizes } from './vendor/core/updateItemSizes.js'
import { updateScroll } from './vendor/core/updateScroll.js'
import { armUserScrollSettle, settleUserScroll } from './vendor/core/userMomentum.js'
import { setupViewability } from './vendor/core/viewability.js'
import type { LayoutRectangle, NativeScrollEvent, NativeSyntheticEvent } from './vendor/platform/platform-types.js'
import { getContentSize } from './vendor/state/getContentSize.js'
import { type StateContext, createStateContext, peek$, set$ } from './vendor/state/state.js'
import type { MaintainScrollAtEndOptions } from './vendor/types.base.js'
import type { InternalState, LegendListInternalRef, LegendListScrollerRef } from './vendor/types.internal.js'
import { checkThresholds } from './vendor/utils/checkThresholds.js'
import { createImperativeHandle } from './vendor/utils/createImperativeHandle.js'
import { prepareReachedEdgeForNextUserScroll } from './vendor/utils/edgeReachedGate.js'
import { getAlwaysRenderIndices } from './vendor/utils/getAlwaysRenderIndices.js'
import { getId } from './vendor/utils/getId.js'
import { getRenderedItem } from './vendor/utils/getRenderedItem.js'
import { roundSize } from './vendor/utils/helpers.js'
import { normalizeMaintainScrollAtEnd } from './vendor/utils/normalizeMaintainScrollAtEnd.js'
import { normalizeMaintainVisibleContentPosition } from './vendor/utils/normalizeMaintainVisibleContentPosition.js'
import { resetInitialRenderState } from './vendor/utils/setInitialRenderState.js'
import { setPaddingTop } from './vendor/utils/setPaddingTop.js'

/** Legend's options that this driver passes on. Names and defaults are Legend's. */
export type LegendDriverProps<Item> = Readonly<{
  data: ReadonlyArray<Item>
  keyExtractor: (item: Item, index: number) => string
  /** Builds a row. What it returns is kept as it is and handed back by `renderedItem`. */
  renderItem: (props: { item: Item; index: number; type: string | undefined }) => unknown
  estimatedItemSize?: number
  drawDistance?: number
  initialScrollAtEnd?: boolean
  maintainVisibleContentPosition?: boolean | { data?: boolean; size?: boolean }
  maintainScrollAtEnd?: boolean | MaintainScrollAtEndOptions
  maintainScrollAtEndThreshold?: number
  alignItemsAtEnd?: boolean
  recycleItems?: boolean
  anchoredEndSpace?: { anchorIndex: number; anchorMaxSize?: number; anchorOffset?: number }
  getItemType?: (item: Item, index: number) => string | undefined
  itemsAreEqual?: (previous: Item, next: Item, index: number, data: ReadonlyArray<Item>) => boolean
  extraData?: unknown
  dataVersion?: string | number
  /** Padding of the scroll view's content view, which the caller also sets as its style. */
  paddingTop?: number
  paddingBottom?: number
  onEndReached?: (info: { distanceFromEnd: number }) => void
  onEndReachedThreshold?: number
  onStartReached?: (info: { distanceFromStart: number }) => void
  onStartReachedThreshold?: number
  onUserScroll?: () => void
  onLoad?: (info: { elapsedTimeInMs: number }) => void
}>

/** What the driver needs from whoever owns the native views. */
export type LegendDriverHost = Readonly<{
  /** Sends a scroll command to the native scroll view. */
  scrollTo: (options: { animated?: boolean; x?: number; y?: number }) => void
  /**
   * Reads the scroll view's box as the last commit laid it out and calls back
   * before returning. Calls nothing if it cannot be read now; the scroll
   * view's layout event then brings it later.
   */
  measureScroller: (into: (layout: LayoutRectangle) => void) => void
  /**
   * Legend wants to "render again" although no option changed (React's
   * `setState`). The owner should call `render` with the same options, commit,
   * and call `afterCommit`. `takeRerender` says whether that is still wanted.
   */
  requestRender: () => void
}>

export type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>

export type LegendDriver<Item> = Readonly<{
  /** Legend's state, for reading with `peek$` and listening with `listen$`. */
  ctx: StateContext
  /** Legend's own ref object: `scrollToEnd`, `scrollToIndex`, `getState` ... */
  handle: LegendListInternalRef
  /** Take new options. Call `afterCommit` once the views drawn for them are committed. */
  render: (props: LegendDriverProps<Item>) => void
  /** Call after every commit of the list's views. */
  afterCommit: () => void
  /** True when `render` should run again without new options, as React would re-render. */
  takeRerender: () => boolean
  /** What `renderItem` returned for the item a container shows, or undefined. */
  renderedItem: (itemKey: string, containerId: number) => unknown
  /** A container's content was built or rebuilt: measure it after the next commit. */
  containerDrawn: (containerId: number) => void
  onLayout: (layout: LayoutRectangle) => void
  onContainerLayout: (containerId: number, itemKey: string, layout: LayoutRectangle) => void
  onScroll: (event: ScrollEvent) => void
  onScrollBeginDrag: (event: ScrollEvent) => void
  onScrollEndDrag: (event: ScrollEvent) => void
  onMomentumScrollBegin: (event: ScrollEvent) => void
  onMomentumScrollEnd: (event: ScrollEvent) => void
  onContentSizeChange: () => void
  dispose: () => void
}>

const sameDeps = (a: ReadonlyArray<unknown> | undefined, b: ReadonlyArray<unknown>): boolean =>
  a !== undefined && a.length === b.length && a.every((value, at) => Object.is(value, b[at]))

export const createLegendDriver = <Item>(
  host: LegendDriverHost,
  firstProps: LegendDriverProps<Item>,
): LegendDriver<Item> => {
  // LegendList.tsx: <StateProvider>
  const ctx = createStateContext()

  let props = firstProps
  let rerender = false
  let effectsPending = false
  let didMount = false
  let isDisposed = false
  // LegendList.tsx: const [canRender, setCanRender] = React.useState(!IsNewArchitecture)
  let canRender = false
  const askForRender = (): void => {
    rerender = true
    host.requestRender()
  }
  const setCanRender = (value: boolean): void => {
    if (canRender !== value) {
      canRender = value
      askForRender()
    }
  }

  // The values a render leaves for the effects that follow it.
  let rendered!: {
    isFirst: boolean
    dataChangeEpoch: number
    freshDataTransitionEpoch: number
    didAnchoredEndSpaceAnchorIndexChange: boolean
    initialScroll: InternalState['initialScroll']
    stylePaddingEnd: number
    lastItemKeys: string[]
    alwaysRenderKey: string
  }
  let initialContentOffset: number | undefined
  let previousAlwaysRender: { arr: number[]; set: Set<number> } | undefined
  let handle: LegendListInternalRef | undefined

  /** React's dependency arrays: an effect runs when its values differ from last time. */
  const lastDeps = new Map<string, ReadonlyArray<unknown>>()
  const changed = (name: string, deps: ReadonlyArray<unknown>): boolean => {
    const same = sameDeps(lastDeps.get(name), deps)
    lastDeps.set(name, deps)
    return !same
  }

  // LegendList.tsx: const refScroller = useRef<LooseScrollView>(null)
  const refScroller: { current: LegendListScrollerRef | null } = {
    current: {
      flashScrollIndicators: () => {},
      getScrollableNode: () => null,
      getScrollResponder: () => null,
      scrollTo: options => host.scrollTo(options),
      scrollToEnd: () => {},
    },
  }

  const usesBootstrapInitialScroll = (): boolean => !!props.initialScrollAtEnd

  // ------------------------------------------------------------------
  // LegendList.tsx: the body of LegendListInner, top to bottom.
  // ------------------------------------------------------------------
  const render = (nextProps: LegendDriverProps<Item>): void => {
    if (isDisposed) return
    props = nextProps
    rerender = false
    const {
      alignItemsAtEnd = false,
      anchoredEndSpace,
      data: dataProp,
      dataVersion,
      drawDistance = 250,
      estimatedItemSize = 100,
      extraData,
      initialScrollAtEnd = false,
      maintainScrollAtEnd = false,
      maintainScrollAtEndThreshold = 0.1,
      onEndReachedThreshold = 0.5,
      onStartReachedThreshold = 0.5,
      recycleItems = false,
    } = props
    const keyExtractor = props.keyExtractor as (item: unknown, index: number) => string
    const stylePaddingTopState = props.paddingTop ?? 0
    const stylePaddingBottomState = props.paddingBottom ?? 0
    const stylePaddingEndState = stylePaddingBottomState
    // No `minHeight` on the content view here, so this is Legend's condition less that test.
    const useAlignItemsAtEndPadding = alignItemsAtEnd && dataProp.length > 0
    const maintainScrollAtEndConfig = normalizeMaintainScrollAtEnd(maintainScrollAtEnd)
    const maintainVisibleContentPositionConfig = normalizeMaintainVisibleContentPosition(
      props.maintainVisibleContentPosition,
    )

    const initialScrollProp: InternalState['initialScroll'] = initialScrollAtEnd
      ? {
          index: Math.max(0, dataProp.length - 1),
          preserveForBottomPadding: true,
          viewOffset: getEndAlignedViewOffset(stylePaddingEndState),
          viewPosition: 1,
        }
      : undefined

    const alwaysRenderArr = getAlwaysRenderIndices(
      undefined,
      dataProp,
      keyExtractor,
      anchoredEndSpace?.anchorIndex,
    )
    const alwaysRenderIndices = { arr: alwaysRenderArr, set: new Set(alwaysRenderArr) }

    if (!ctx.state) {
      ctx.values.set('adaptiveRender', 'normal')
      ctx.state = {
        averageSizes: {},
        columnSpans: [],
        columns: [],
        containerItemGenerations: [],
        containerItemKeys: new Map(),
        containerItemMetadata: new Map(),
        contentInsetOverride: undefined,
        dataChangeEpoch: 0,
        dataChangeNeedsScrollUpdate: false,
        didColumnsChange: false,
        didDataChange: false,
        didLoad: false,
        enableScrollForNextCalculateItemsInView: true,
        endBuffered: -1,
        endNoBuffer: -1,
        endReachedSnapshot: undefined,
        firstFullyOnScreenIndex: -1,
        freshDataTransitionEpoch: 0,
        handledDataChangeEpoch: 0,
        handledFreshDataTransitionEpoch: 0,
        hasHadNonEmptyData: dataProp.length > 0,
        idCache: [],
        idsInView: [],
        indexByKey: new Map(),
        initialScroll: initialScrollProp,
        initialScrollSession: initialScrollProp
          ? { kind: 'bootstrap', previousDataLength: dataProp.length }
          : undefined,
        isEndReached: null,
        isFirst: true,
        isStartReached: null,
        lastBatchingAction: Date.now(),
        lastLayout: undefined,
        lastScrollDelta: 0,
        loadStartTime: Date.now(),
        nativeContentInset: undefined,
        nativeMarginTop: 0,
        pendingDataComparison: undefined,
        pendingNativeMVCPAdjust: undefined,
        positionRecalculationStartIndex: 0,
        positions: [],
        props: {} as never,
        queuedCalculateItemsInView: 0,
        refScroller,
        scheduledWork: new ScheduledWork(),
        scroll: 0,
        scrollAdjustHandler: new ScrollAdjustHandler(ctx),
        scrollForNextCalculateItemsInView: undefined,
        scrollHistory: [],
        // On Fabric Legend starts from 0 and waits for the list's real layout.
        scrollLength: 0,
        scrollPending: 0,
        scrollPrev: 0,
        scrollPrevTime: 0,
        scrollProcessingEnabled: true,
        scrollTime: 0,
        sizes: new Map(),
        sizesKnown: new Map(),
        startBuffered: -1,
        startNoBuffer: -1,
        startReachedSnapshot: undefined,
        stickyContainerPool: new Set(),
        stickyContainers: new Map(),
        totalSize: 0,
        viewabilityConfigCallbackPairs: undefined as never,
      }
      const internalState = ctx.state
      ctx.doMaintainScrollAtEnd = () => doMaintainScrollAtEnd(ctx)
      ctx.doScrollTo = params => doScrollTo(ctx, params)
      ctx.interruptUserScroll = () => interruptUserScroll(ctx)
      ctx.scrollTo = params => scrollTo(ctx, params)
      ctx.scrollToEnd = options => scrollToEnd(ctx, options)
      internalState.triggerCalculateItemsInView = params => calculateItemsInView(ctx, params)
      internalState.reprocessCurrentScroll = () => updateScroll(ctx, internalState.scroll, true)

      set$(ctx, 'maintainVisibleContentPosition', maintainVisibleContentPositionConfig)
      set$(ctx, 'extraData', extraData)
    }

    const state = ctx.state
    const isFirstLocal = state.isFirst
    state.didColumnsChange = false
    const previousDataLength = state.props.data?.length ?? 0
    const didDataReferenceChangeLocal = state.props.data !== dataProp
    const didDataVersionChangeLocal = state.props.dataVersion !== dataVersion
    const didDataChangeLocal =
      didDataVersionChangeLocal ||
      (didDataReferenceChangeLocal && checkStructuralDataChange(state, dataProp, state.props.data))
    const shouldResetFreshDataLayout =
      !isFirstLocal &&
      didDataChangeLocal &&
      state.hasHadNonEmptyData &&
      previousDataLength === 0 &&
      dataProp.length > 0
    if (
      didDataChangeLocal &&
      !initialScrollAtEnd &&
      state.didFinishInitialScroll &&
      state.initialScroll?.viewPosition === 1 &&
      state.props.data.length > 0
    ) {
      clearPreservedInitialScrollTarget(state)
    }
    if (didDataChangeLocal) {
      state.dataChangeEpoch += 1
      state.dataChangeNeedsScrollUpdate = true
      state.didDataChange = true
      state.previousData = state.props.data
    }
    if (shouldResetFreshDataLayout) {
      state.freshDataTransitionEpoch += 1
    }
    const didAnchoredEndSpaceAnchorIndexChange =
      !isFirstLocal &&
      !didDataChangeLocal &&
      state.props.anchoredEndSpace?.anchorIndex !== anchoredEndSpace?.anchorIndex

    state.props = {
      adaptiveRender: undefined,
      alignItemsAtEnd,
      alignItemsAtEndPaddingEnabled: useAlignItemsAtEndPadding,
      alwaysRender: undefined,
      alwaysRenderIndicesArr: alwaysRenderIndices.arr,
      alwaysRenderIndicesSet: alwaysRenderIndices.set,
      anchoredEndSpace,
      anchoredEndSpaceOwner: 'list',
      animatedProps: undefined as never,
      contentContainerAlignItems: undefined,
      contentContainerMinSize: undefined,
      contentInset: undefined,
      contentInsetEndAdjustment: undefined,
      data: dataProp,
      dataKey: undefined,
      dataVersion,
      drawDistance,
      estimatedItemSize,
      getFixedItemSize: undefined,
      getItemType: props.getItemType as never,
      hasExternalScroll: false,
      hideItemsUntilMeasured: undefined,
      horizontal: false,
      itemsAreEqual: props.itemsAreEqual as never,
      keyExtractor: keyExtractor as never,
      maintainScrollAtEnd: maintainScrollAtEndConfig,
      maintainScrollAtEndThreshold,
      maintainVisibleContentPosition: maintainVisibleContentPositionConfig,
      numColumns: 1,
      onEndReached: props.onEndReached,
      onEndReachedThreshold,
      onFirstVisibleItemChanged: undefined,
      onItemSizeChanged: undefined,
      onLoad: props.onLoad,
      onMetricsChange: undefined,
      onMomentumScrollBegin: undefined,
      onMomentumScrollEnd: undefined,
      onReady: undefined,
      onScroll: undefined,
      onScrollBeginDrag: undefined,
      onScrollEndDrag: undefined,
      onStartReached: props.onStartReached,
      onStartReachedThreshold,
      onStickyHeaderChange: undefined,
      onUserScroll: props.onUserScroll,
      overrideItemLayout: undefined,
      positionComponentInternal: undefined,
      recycleItems: !!recycleItems,
      renderItem: props.renderItem as never,
      rtl: undefined,
      snapToIndices: undefined,
      stickyHeaderIndicesArr: [],
      stickyHeaderIndicesSet: new Set(),
      stickyPositionComponentInternal: undefined,
      stylePaddingBottom: stylePaddingBottomState,
      stylePaddingLeft: 0,
      stylePaddingRight: 0,
      stylePaddingTop: stylePaddingTopState,
      useWindowScroll: false,
    }

    if (didDataChangeLocal && !isFirstLocal) {
      state.previousIndexByKey ??= state.indexByKey
      state.indexByKey = new Map()
      state.idCache.length = dataProp.length
      for (let index = 0; index < dataProp.length; index++) {
        state.indexByKey.set(getId(state, index), index)
      }
    }

    state.refScroller = refScroller

    const lastItemKeys = dataProp.length ? [getId(state, dataProp.length - 1)] : []

    rendered = {
      isFirst: !!isFirstLocal,
      dataChangeEpoch: state.dataChangeEpoch,
      freshDataTransitionEpoch: state.freshDataTransitionEpoch,
      didAnchoredEndSpaceAnchorIndexChange,
      initialScroll: initialScrollProp,
      stylePaddingEnd: stylePaddingEndState,
      lastItemKeys,
      alwaysRenderKey: alwaysRenderIndices.arr.join(','),
    }
    previousAlwaysRender ??= alwaysRenderIndices
    pendingAlwaysRender = alwaysRenderIndices

    if (isFirstLocal) {
      initializeStateVars(false)
      resetLayoutCachesForDataChange(state)
      restoreItemSizeEstimates(ctx, undefined, sizeCacheOwner())
      updateItemPositions(ctx, /*dataChanged*/ true)

      // LegendList.tsx: const initialContentOffset = useMemo(..., [usesBootstrapInitialScroll])
      const initialScroll = state.initialScroll
      initialContentOffset = initialScroll
        ? (initialScroll.contentOffset ?? resolveInitialScrollOffset(ctx, initialScroll))
        : undefined
    }

    if (isFirstLocal || didDataChangeLocal) {
      state.lastBatchingAction = Date.now()
    }

    effectsPending = true
  }

  let pendingAlwaysRender: { arr: number[]; set: Set<number> } | undefined

  // Legend keys its saved size estimates by the keyExtractor function.
  const sizeCacheOwner = (): object => props.keyExtractor

  // LegendList.tsx: initializeStateVars
  const initializeStateVars = (_shouldAdjustPadding: boolean): void => {
    const state = ctx.state
    set$(ctx, 'lastItemKeys', rendered.lastItemKeys)
    set$(ctx, 'numColumns', 1)
    setPaddingTop(ctx, { stylePaddingTop: props.paddingTop ?? 0 })
    state.props.stylePaddingBottom = props.paddingBottom ?? 0
    updateContentMetricsState(ctx)
    // Legend also shifts the scroll position here when the top padding changes
    // on iOS. The list element gives a fixed padding, so that part is left out.
  }

  // LegendList.tsx: onLayoutChange
  const onLayoutChange = (layout: LayoutRectangle, fromLayoutEffect: boolean): void => {
    const state = ctx.state
    const previousScrollLength = state.scrollLength
    const previousOtherAxisSize = state.otherAxisSize
    handleLayout(ctx, layout, setCanRender)
    maybeUpdateAnchoredEndSpace(ctx)
    const didLayoutAffectBootstrapTarget =
      previousScrollLength !== state.scrollLength || previousOtherAxisSize !== state.otherAxisSize
    if (usesBootstrapInitialScroll() && !fromLayoutEffect && didLayoutAffectBootstrapTarget) {
      handleBootstrapInitialScrollLayoutChange(ctx)
    }
    if (usesBootstrapInitialScroll()) return
    advanceCurrentInitialScrollSession(ctx)
  }

  // ------------------------------------------------------------------
  // LegendList.tsx: the layout effects of LegendListInner, in its order.
  // ------------------------------------------------------------------
  const runEffects = (): void => {
    const state = ctx.state
    const { data: dataProp, dataVersion, anchoredEndSpace, initialScrollAtEnd = false } = props
    const isMount = !didMount
    didMount = true

    if (isMount) {
      // ListComponent.tsx: with no header and no footer, their sizes are 0.
      setHeaderSize(ctx, 0)
      setFooterSize(ctx, 0)

      state.isUnmounted = false
      if (state.userScrollContentSize !== undefined || state.isMomentumScrolling) {
        armUserScrollSettle(ctx)
      }

      initializeInitialScrollOnMount(ctx, {
        alwaysDispatchInitialScroll: false,
        dataLength: dataProp.length,
        hasFooterComponent: false,
        initialContentOffset,
        initialScrollAtEnd,
        useBootstrapInitialScroll: usesBootstrapInitialScroll(),
      })
    }

    if (
      changed('data', [
        dataProp.length,
        rendered.dataChangeEpoch,
        rendered.freshDataTransitionEpoch,
        initialScrollAtEnd,
        rendered.stylePaddingEnd,
      ])
    ) {
      const didDataChange = state.handledDataChangeEpoch !== rendered.dataChangeEpoch
      const didStartFreshData =
        state.handledFreshDataTransitionEpoch !== rendered.freshDataTransitionEpoch
      state.handledDataChangeEpoch = rendered.dataChangeEpoch
      state.handledFreshDataTransitionEpoch = rendered.freshDataTransitionEpoch
      if (didStartFreshData) {
        resetInitialRenderState(ctx, { resetInitialScroll: !!rendered.initialScroll, resetLayout: true })
      }
      if (didDataChange) {
        restoreItemSizeEstimates(ctx, state.lastLayout?.width, sizeCacheOwner())
      }
      handleInitialScrollDataChange(ctx, {
        dataLength: dataProp.length,
        didDataChange,
        didStartFreshData,
        initialScrollAtEnd,
        latestInitialScroll: rendered.initialScroll,
        latestInitialScrollSessionKind: 'bootstrap',
        stylePaddingEnd: rendered.stylePaddingEnd,
        useBootstrapInitialScroll: usesBootstrapInitialScroll(),
      })
    }

    if (
      changed('anchoredEndSpace', [
        dataProp,
        dataVersion,
        anchoredEndSpace?.anchorIndex,
        anchoredEndSpace?.anchorMaxSize,
        anchoredEndSpace?.anchorOffset,
        rendered.didAnchoredEndSpaceAnchorIndexChange,
        props.paddingBottom,
      ])
    ) {
      if (rendered.didAnchoredEndSpaceAnchorIndexChange) {
        state.scrollForNextCalculateItemsInView = undefined
        state.triggerCalculateItemsInView?.()
      }
      maybeUpdateAnchoredEndSpace(ctx)
    }

    if (isMount) updateContentInsetEndAdjustment(ctx, undefined)

    // LegendList.tsx: useOnLayoutSync. On Fabric it measures the scroll view in
    // a layout effect, so the list knows its size before the first paint.
    if (isMount) {
      host.measureScroller(layout => onLayoutChange(layout, true))
    }

    if (
      changed('stateVars', [
        dataVersion,
        rendered.lastItemKeys.join(','),
        props.paddingBottom,
        props.paddingTop,
        state.props.alignItemsAtEndPaddingEnabled,
      ])
    ) {
      initializeStateVars(true)
    }

    if (changed('threshold', [props.maintainScrollAtEndThreshold])) {
      checkThresholds(ctx)
    }

    if (changed('maintainScrollAtEnd', [!!state.props.maintainScrollAtEnd])) {
      if (!state.props.maintainScrollAtEnd) {
        finishMaintainScrollAtEnd(ctx)
      } else if (peek$(ctx, 'isFollowingEnd')) {
        doMaintainScrollAtEnd(ctx)
      }
    }

    if (changed('containers', [dataProp, dataVersion, rendered.alwaysRenderKey])) {
      const previousPins = previousAlwaysRender
      const pins = pendingAlwaysRender
      const didPinsChange =
        previousPins !== undefined &&
        pins !== undefined &&
        (previousPins.set.size !== pins.set.size ||
          previousPins.arr.some(index => !pins.set.has(index)))
      previousAlwaysRender = pins
      const {
        didColumnsChange,
        didDataChange,
        isFirst,
        props: { data },
      } = state
      const didAllocateContainers = data.length > 0 && doInitialAllocateContainers(ctx)
      if (!didAllocateContainers && !isFirst && (didDataChange || didColumnsChange)) {
        checkResetContainers(ctx, data, { didColumnsChange })
      }
      if (didPinsChange && !didDataChange && !didColumnsChange && !isFirst) {
        state.scrollForNextCalculateItemsInView = undefined
        calculateItemsInView(ctx)
      }
      if (didDataChange) {
        state.pendingDataComparison = undefined
        state.previousIndexByKey = undefined
      }
      state.didColumnsChange = false
      state.didDataChange = false
      state.isFirst = false
    }

    if (changed('extraData', [props.extraData])) {
      set$(ctx, 'extraData', props.extraData)
    }

    if (isMount) {
      // LegendList.tsx: the viewability effect. No callbacks are offered, but
      // Legend still switches on its scroll shortcut here.
      const viewability = setupViewability({}, ctx)
      state.viewabilityConfigCallbackPairs = viewability
      state.enableScrollForNextCalculateItemsInView = true
      if (viewability) state.scrollForNextCalculateItemsInView = undefined

      // LegendList.tsx: useImperativeHandle
      handle ??= createImperativeHandle(ctx, askForRender)
    }

    // LegendList.tsx: "Run pending scroll to end after props have settled."
    state.runPendingScrollToEnd?.()
  }

  const afterCommit = (): void => {
    if (isDisposed) return
    // ContainerLayoutCoordinator.tsx: measure the containers drawn in this commit.
    const targetContainerIds = getContainerLayoutEffectScope(ctx)
    if (targetContainerIds !== undefined) {
      measureContainersInLayoutEffect(ctx, targetContainerIds)
    }
    if (effectsPending) {
      effectsPending = false
      runEffects()
    }
  }

  const dispose = (): void => {
    if (isDisposed) return
    isDisposed = true
    const state = ctx.state
    if (!state) return
    // LegendList.tsx: the cleanup of the first layout effect.
    saveItemSizeEstimates(ctx, sizeCacheOwner())
    state.isUnmounted = true
    state.maintainingScrollAtEnd = undefined
    state.pendingMaintainScrollAtEnd = false
    cancelImperativeScroll(state)
    syncScrollActive(ctx)
    cancelBootstrapInitialScrollFrame(state)
    state.scheduledWork.dispose()
    refScroller.current = null
  }

  render(firstProps)

  return {
    ctx,
    get handle() {
      // Made in the first `afterCommit`, as React makes a ref on mount.
      handle ??= createImperativeHandle(ctx, askForRender)
      return handle
    },
    render,
    afterCommit,
    takeRerender: () => {
      const wanted = rerender
      rerender = false
      return wanted
    },
    renderedItem: (itemKey, containerId) => getRenderedItem(ctx, itemKey, containerId)?.renderedItem,
    // useContainerMeasurement.tsx: its layout effect with no dependency list.
    containerDrawn: containerId => scheduleContainerLayout(ctx, containerId),
    onLayout: layout => {
      if (!isDisposed) onLayoutChange(layout, false)
    },
    // useContainerMeasurement.tsx: processContainerLayout, the Fabric branch.
    onContainerLayout: (containerId, itemKey, layout) => {
      if (isDisposed) return
      if (peek$(ctx, `containerItemKey${containerId}`) !== itemKey) return
      updateItemSizes(ctx, {
        containerId,
        itemKey,
        size: { height: roundSize(layout.height), width: roundSize(layout.width) },
      })
    },
    // LegendList.tsx: fns
    onScroll: event => {
      if (!isDisposed) onScroll(ctx, event)
    },
    onScrollBeginDrag: () => {
      if (isDisposed) return
      const state = ctx.state
      state.isMomentumScrolling = false
      state.userScrollContentSize = undefined
      state.scheduledWork.cancel('endFollowRearm')
      state.isDragging = true
      interruptUserScroll(ctx)
      state.props.onUserScroll?.()
      prepareReachedEdgeForNextUserScroll(ctx)
    },
    onScrollEndDrag: event => {
      if (isDisposed) return
      const state = ctx.state
      onScroll(ctx, event, false)
      state.isDragging = false
      syncScrollActive(ctx)
      state.userScrollContentSize = getContentSize(ctx)
      armUserScrollSettle(ctx)
    },
    onMomentumScrollBegin: () => {
      if (isDisposed) return
      ctx.state.isMomentumScrolling = true
      set$(ctx, 'isScrollActive', true)
      armUserScrollSettle(ctx)
    },
    onMomentumScrollEnd: event => {
      if (isDisposed) return
      onScroll(ctx, event, false)
      settleUserScroll(ctx)
      checkFinishedScrollFallback(ctx)
    },
    // ListComponent.tsx: onContentSizeChangeInternal
    onContentSizeChange: () => {
      if (!isDisposed) reissueClampedNativeEndScroll(ctx)
    },
    dispose,
  }
}
