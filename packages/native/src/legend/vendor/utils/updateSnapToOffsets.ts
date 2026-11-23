import { getContentSize } from "../state/getContentSize.js";
import { type StateContext, set$ } from "../state/state.js";
import { getId } from "./getId.js";
import { toNativeHorizontalOffset } from "./rtl.js";

export function updateSnapToOffsets(ctx: StateContext) {
    const state = ctx.state;
    const {
        props: { snapToIndices },
    } = state;

    // Preserve snap coordinates when a container minimum adds space.
    const contentSize = state.props.horizontal ? getContentSize(ctx, false) : undefined;
    const snapToOffsets: number[] = Array<number>(snapToIndices!.length);
    for (let i = 0; i < snapToIndices!.length; i++) {
        const idx = snapToIndices![i];
        getId(state, idx);
        const logicalOffset = state.positions[idx]!;
        snapToOffsets[i] = toNativeHorizontalOffset(state, logicalOffset, contentSize);
    }

    set$(ctx, "snapToOffsets", snapToOffsets);
}
