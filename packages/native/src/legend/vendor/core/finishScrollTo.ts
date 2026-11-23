import { addTotalSize } from "./addTotalSize.js";
import { cancelScrollCompletionChecks, syncScrollActive } from "./cancelImperativeScroll.js";
import { doMaintainScrollAtEnd } from "./doMaintainScrollAtEnd.js";
import { finishInitialScroll } from "./finishInitialScroll.js";
import { recalculateSettledScroll } from "./recalculateSettledScroll.js";
import { PlatformAdjustBreaksScroll } from "../../platform/Platform.js";
import type { StateContext } from "../state/state.js";

export function finishScrollTo(ctx: StateContext) {
    const state = ctx.state;
    if (state?.scrollingTo) {
        cancelScrollCompletionChecks(state);
        // An older active scroll can finish while its replacement still waits for layout.
        // Its completion must not settle or release the newer request's ownership.
        const resolvePendingScroll = ctx.scrollRequestTracker?.isWaitingToRun()
            ? undefined
            : state.pendingScrollResolve;
        if (resolvePendingScroll) {
            state.pendingScrollResolve = undefined;
        }

        // Save scrollingTo before clearing it so we can pass it to commitPendingAdjust
        const scrollingTo = state.scrollingTo;

        state.scrollHistory.length = 0;
        state.scrollingTo = undefined;
        state.scrollTargetPinnedRange = undefined;
        syncScrollActive(ctx);

        if (state.pendingTotalSize !== undefined) {
            addTotalSize(ctx, null, state.pendingTotalSize);
        }

        if (PlatformAdjustBreaksScroll) {
            state.scrollAdjustHandler.commitPendingAdjust(scrollingTo);
        }

        const complete = () => {
            resolvePendingScroll?.();
            if (state.pendingMaintainScrollAtEnd) {
                state.maintainingScrollAtEnd = undefined;
                doMaintainScrollAtEnd(ctx, { immediate: !!scrollingTo.isInitialScroll });
            }
        };

        if (scrollingTo.isInitialScroll || state.initialScroll) {
            const isOffsetSession = state.initialScrollSession?.kind === "offset";
            const shouldPreserveResizeTarget =
                !!scrollingTo.isInitialScroll &&
                !state.clearPreservedInitialScrollOnNextFinish &&
                state.props.data.length > 0 &&
                state.initialScroll?.viewPosition === 1;
            finishInitialScroll(ctx, {
                onFinished: complete,
                preserveTarget: (isOffsetSession && state.props.data.length === 0) || shouldPreserveResizeTarget,
                recalculateItems: true,
                schedulePreservedTargetClear: shouldPreserveResizeTarget,
                syncObservedOffset: isOffsetSession,
                waitForCompletionFrame: !!scrollingTo.waitForInitialScrollCompletionFrame,
            });
            return;
        }

        recalculateSettledScroll(ctx);
        complete();
    }
}
