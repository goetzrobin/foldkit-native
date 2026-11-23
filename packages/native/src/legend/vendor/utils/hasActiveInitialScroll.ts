import type { InternalState } from "../types.internal.js";

export function hasActiveInitialScroll(state: InternalState | null | undefined) {
    return !!state?.initialScroll && !state.didFinishInitialScroll;
}
