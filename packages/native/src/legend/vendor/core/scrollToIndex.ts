import { calculateOffsetForIndex } from "./calculateOffsetForIndex.js";
import { scrollTo } from "./scrollTo.js";
import type { StateContext } from "../state/state.js";
import type { LegendListRef } from "../types.base.js";
import { clampScrollIndex } from "../utils/clampScrollIndex.js";
import { getItemSizeAtIndex } from "../utils/getItemSize.js";

export type ScrollToIndexParams = Parameters<LegendListRef["scrollToIndex"]>[0];

export function scrollToIndex(
    ctx: StateContext,
    {
        index,
        key,
        viewOffset = 0,
        animated = true,
        forceScroll,
        isInitialScroll,
        clampToContentContainerMinSize,
        viewPosition,
        viewPositionFallback,
    }: ScrollToIndexParams & {
        forceScroll?: boolean;
        isInitialScroll?: boolean;
        clampToContentContainerMinSize?: boolean;
        key?: string;
    },
) {
    const state = ctx.state;
    const { data } = state.props;
    index = clampScrollIndex(index, data.length);
    const itemSize = getItemSizeAtIndex(ctx, index);

    const firstIndexOffset = calculateOffsetForIndex(ctx, index);

    const isLast = index === data.length - 1;
    if (isLast && viewPosition === undefined) {
        viewPosition = 1;
    }

    state.scrollForNextCalculateItemsInView = undefined;

    scrollTo(ctx, {
        animated,
        clampToContentContainerMinSize,
        forceScroll,
        index,
        isInitialScroll,
        itemSize,
        key,
        offset: firstIndexOffset,
        viewOffset,
        viewPosition: viewPosition ?? 0,
        viewPositionFallback,
    });
}
