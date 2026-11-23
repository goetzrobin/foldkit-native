import type { InternalState } from "../types.internal.js";
import { getId } from "../utils/getId.js";

export function shouldMaintainScrollAtEndOnDataChange(state: InternalState, didColumnsChange = state.didColumnsChange) {
    const {
        previousData,
        props: { data, keyExtractor, maintainScrollAtEnd },
    } = state;
    const onDataChange = maintainScrollAtEnd?.onDataChange;
    return !!(
        !didColumnsChange &&
        onDataChange &&
        (onDataChange !== "append" ||
            (previousData &&
                data.length > previousData.length &&
                previousData.every(
                    (item, index) =>
                        item === data[index] || (keyExtractor?.(item, index) ?? index) === getId(state, index),
                )))
    );
}
