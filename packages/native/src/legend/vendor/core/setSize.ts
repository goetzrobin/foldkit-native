import { addTotalSize } from "./addTotalSize.js";
import type { StateContext } from "../state/state.js";

export function setSize(ctx: StateContext, itemKey: string, size: number, notifyTotalSize = true) {
    const state = ctx.state;
    const { sizes } = state;
    const previousSize = sizes.get(itemKey);
    const diff = previousSize !== undefined ? size - previousSize : size;
    if (diff !== 0) {
        state.positionsAreCurrent = false;
        addTotalSize(ctx, itemKey, diff, notifyTotalSize);
    }

    // Save to rendered sizes
    sizes.set(itemKey, size);
}
