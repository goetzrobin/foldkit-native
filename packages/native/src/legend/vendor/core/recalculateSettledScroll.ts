import type { StateContext } from "../state/state.js";
import { checkThresholds } from "../utils/checkThresholds.js";

export function recalculateSettledScroll(ctx: StateContext) {
    const state = ctx.state;
    if (state.props?.data) {
        state.triggerCalculateItemsInView?.({ forceFullItemPositions: true });
    }

    checkThresholds(ctx);
}
