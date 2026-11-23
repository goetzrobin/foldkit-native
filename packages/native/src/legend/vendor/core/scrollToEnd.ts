import { getEndAlignedViewOffset } from "./endOfContentTarget.js";
import { scrollToIndex } from "./scrollToIndex.js";
import { peek$, type StateContext } from "../state/state.js";
import type { ScrollToEndOptions } from "../types.base.js";
import { getStylePaddingEnd } from "../utils/rtl.js";

export function scrollToEnd(ctx: StateContext, options?: ScrollToEndOptions) {
    const state = ctx.state;
    const data = state.props.data;
    const index = data.length - 1;
    if (index === -1) {
        return false;
    }

    const paddingBottom = getStylePaddingEnd(state.props);
    const footerSize = peek$(ctx, "footerSize") || 0;
    scrollToIndex(ctx, {
        ...options,
        clampToContentContainerMinSize: true,
        index,
        viewOffset: getEndAlignedViewOffset(paddingBottom, footerSize) + (options?.viewOffset || 0),
        viewPosition: 1,
    });
    if (state.scrollingTo) {
        state.scrollingTo.isScrollToEnd = true;
    }
    return true;
}
