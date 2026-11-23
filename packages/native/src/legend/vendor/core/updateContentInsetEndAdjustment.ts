import { retargetActiveInitialScrollAtEnd } from "./initialScrollLifecycle.js";
import { updateScroll } from "./updateScroll.js";
import { Platform } from "../../platform/Platform.js";
import { getContentInsetEnd } from "../state/getContentInsetEnd.js";
import { peek$, type StateContext } from "../state/state.js";
import { requestAdjust } from "../utils/requestAdjust.js";

export function updateContentInsetEndAdjustment(ctx: StateContext, previousContentInsetEndAdjustment?: number) {
    const state = ctx.state;
    const previousContentInsetEnd = getContentInsetEnd(ctx, previousContentInsetEndAdjustment);
    const nextContentInsetEnd = getContentInsetEnd(ctx);
    const insetDiff = nextContentInsetEnd - previousContentInsetEnd;

    if (insetDiff !== 0) {
        const wasWithinEndThreshold = !!peek$(ctx, "isWithinMaintainScrollAtEndThreshold");

        updateScroll(ctx, state.scroll, true, { markHasScrolled: false });

        const didRetargetInitialScroll = retargetActiveInitialScrollAtEnd(ctx);
        if (!didRetargetInitialScroll && wasWithinEndThreshold && (Platform.OS !== "web" || insetDiff > 0)) {
            requestAdjust(ctx, insetDiff);
        }
    }
}
