import { rearmEndFollowIfSettled } from "../core/finishMaintainScrollAtEnd";
import type { StateContext } from "../state/state";
import { checkAtBottom } from "./checkAtBottom";
import { checkAtTop } from "./checkAtTop";
import type { ReachedEdge } from "./edgeReachedGate";

export function checkThresholds(ctx: StateContext, allowedEdge?: ReachedEdge) {
    const allowGateCreatedInCurrentCheck = !ctx.state.edgeReachedGate;
    checkAtBottom(ctx, allowedEdge, allowGateCreatedInCurrentCheck);
    checkAtTop(ctx, allowedEdge, allowGateCreatedInCurrentCheck);
    rearmEndFollowIfSettled(ctx);
}
