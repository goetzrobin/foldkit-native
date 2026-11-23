import { doMaintainScrollAtEnd } from "../core/doMaintainScrollAtEnd.js";
import type { StateContext } from "../state/state.js";
import { checkThresholds } from "./checkThresholds.js";
import { setInitialRenderState } from "./setInitialRenderState.js";

export function setDidLayout(ctx: StateContext) {
    const state = ctx.state;
    state.queuedInitialLayout = true;
    // Evaluate both edges together so overlapping initial windows share eligibility.
    checkThresholds(ctx);

    setInitialRenderState(ctx, { didLayout: true });
    if (state.pendingMaintainScrollAtEnd) {
        doMaintainScrollAtEnd(ctx);
    }
}
