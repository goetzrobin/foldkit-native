import { rearmEndFollowIfSettled } from "../core/finishMaintainScrollAtEnd.js";
import type { StateContext } from "../state/state.js";
import { checkAtBottom } from "./checkAtBottom.js";
import { checkAtTop } from "./checkAtTop.js";
import type { ReachedEdge } from "./edgeReachedGate.js";

export function checkThresholds(ctx: StateContext, allowedEdge?: ReachedEdge) {
    const allowGateCreatedInCurrentCheck = !ctx.state.edgeReachedGate;
    checkAtBottom(ctx, allowedEdge, allowGateCreatedInCurrentCheck);
    checkAtTop(ctx, allowedEdge, allowGateCreatedInCurrentCheck);
    rearmEndFollowIfSettled(ctx);
}
