import { doMaintainScrollAtEnd } from "../core/doMaintainScrollAtEnd";
import type { StateContext } from "../state/state";
import { checkThresholds } from "./checkThresholds";
import { setInitialRenderState } from "./setInitialRenderState";

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
