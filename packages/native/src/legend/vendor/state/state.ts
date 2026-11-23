// foldkit-native: this is Legend's `src/state/state.tsx` with its React half removed.
// Kept as Legend wrote it: the types, `listen$`, `peek$`, `set$`, `listenPosition$` and
// `notifyPosition$`. Removed: the React context and provider, `useStateContext`, `useArr$`,
// `useSelector$` and their helpers. Added: `createStateContext`, which builds the same object
// the provider built. Each change is marked with a `foldkit-native:` comment.
// foldkit-native: `React.RefObject` now comes from our stand-in, and the two React imports are gone.
import type * as React from "../../platform/react.js";

import type { DoScrollToParams } from "../core/doScrollParams.js";
import type { ScrollRequestTracker } from "../core/scrollRequestTracker.js";
import type { LooseView } from "../platform/scrollview-types.js";
import type {
    ColumnWrapperStyle,
    ScrollToEndOptions,
    ViewAmountToken,
    ViewabilityAmountCallback,
    ViewabilityCallback,
    ViewabilityConfigCallbackPair,
    ViewToken,
} from "../types.base.js";
import type { InternalScrollTarget, InternalState, MaintainVisibleContentPositionNormalized } from "../types.internal.js";

// foldkit-native: Legend's `AnimatedValue` is React Native's `Animated.Value`, used only by
// sticky headers, which this adapter does not draw. Nothing reads it here.
type AnimatedValue = unknown;

// This is an implementation of a simple state management system, inspired by Legend State.
// It stores values and listeners in Maps, with peek$ and set$ functions to get and set values.
// The set$ function also triggers the listeners.
//
// This is definitely not general purpose and has one big optimization/caveat: use$ is only ever called
// once for each unique name. So we don't need to manage a Set of listeners or dispose them,
// which saves needing useEffect hooks or managing listeners in a Set.

export type ListenerType =
    | "activeStickyIndex"
    | "alignItemsAtEndPadding"
    | "anchoredEndSpaceSize"
    | "containerLayoutEpoch"
    | "debugComputedScroll"
    | "debugRawScroll"
    | "extraData"
    | "footerSize"
    | "headerSize"
    | "lastItemKeys"
    | "lastPositionUpdate"
    | "maintainVisibleContentPosition"
    | "numColumns"
    | "numContainers"
    | "numContainersPooled"
    | "otherAxisSize"
    | "readyToRender"
    | "isScrollActive"
    | "scrollAdjust"
    | "scrollAdjustPending"
    | "scrollAdjustUserOffset"
    | "scrollSize"
    | "snapToOffsets"
    | "stickySettle"
    | "stylePaddingTop"
    | "totalSize"
    | "isFollowingEnd"
    | "isAtEnd"
    | "isAtStart"
    | "isNearEnd"
    | "isNearStart"
    | "isWithinMaintainScrollAtEndThreshold"
    | "adaptiveRender"
    | `containerColumn${number}`
    | `containerSpan${number}`
    | `containerItemData${number}`
    | `containerItemIndex${number}`
    | `containerItemKey${number}`
    | `containerLayoutReady${number}`
    | `containerPosition${number}`
    | `containerSticky${number}`;

export type LegendListListenerType = Extract<
    ListenerType,
    | "activeStickyIndex"
    | "anchoredEndSpaceSize"
    | "footerSize"
    | "headerSize"
    | "isFollowingEnd"
    | "isAtEnd"
    | "isAtStart"
    | "isNearEnd"
    | "isNearStart"
    | "isWithinMaintainScrollAtEndThreshold"
    | "adaptiveRender"
    | "lastItemKeys"
    | "lastPositionUpdate"
    | "numContainers"
    | "numContainersPooled"
    | "otherAxisSize"
    | "readyToRender"
    | "snapToOffsets"
    | "totalSize"
>;

export type ListenerTypeValueMap = {
    activeStickyIndex: number;
    alignItemsAtEndPadding: number;
    anchoredEndSpaceSize: number;
    containerLayoutEpoch: number;
    animatedScrollY: any;
    debugComputedScroll: number;
    debugRawScroll: number;
    extraData: any;
    footerSize: number;
    headerSize: number;
    isFollowingEnd: boolean;
    isAtEnd: boolean;
    isAtStart: boolean;
    isNearEnd: boolean;
    isNearStart: boolean;
    isWithinMaintainScrollAtEndThreshold: boolean;
    lastItemKeys: string[];
    lastPositionUpdate: number;
    maintainVisibleContentPosition: MaintainVisibleContentPositionNormalized;
    numColumns: number;
    numContainers: number;
    numContainersPooled: number;
    otherAxisSize: number;
    readyToRender: boolean;
    isScrollActive: boolean;
    scrollAdjust: number;
    scrollAdjustPending: number;
    scrollAdjustUserOffset: number;
    scrollSize: { width: number; height: number };
    snapToOffsets: number[];
    stickySettle: number;
    stylePaddingTop: number;
    totalSize: number;
    adaptiveRender: "normal" | "light";
} & {
    [K in ListenerType as K extends `containerItemKey${number}` ? K : never]: string;
} & {
    [K in ListenerType as K extends `containerLayoutReady${number}` ? K : never]: boolean;
} & {
    [K in ListenerType as K extends `containerItemData${number}` ? K : never]: any;
} & {
    [K in ListenerType as K extends `containerItemIndex${number}` ? K : never]: number;
} & {
    [K in ListenerType as K extends `containerPosition${number}` ? K : never]: number;
} & {
    [K in ListenerType as K extends `containerColumn${number}` ? K : never]: number;
} & {
    [K in ListenerType as K extends `containerSpan${number}` ? K : never]: number;
} & {
    [K in ListenerType as K extends `containerSticky${number}` ? K : never]: boolean;
};

export interface StateContext {
    animatedScrollY: AnimatedValue;
    columnWrapperStyle: ColumnWrapperStyle | undefined;
    containerLayoutTriggers: Map<number, () => void>;
    contextNum: number; // For debug checking that it's the right context
    listeners: Map<ListenerType, Set<(value: any) => void>>;
    mapViewabilityCallbacks: Map<string, ViewabilityCallback>;
    mapViewabilityValues: Map<string, ViewToken>;
    mapViewabilityAmountCallbacks: Map<number, ViewabilityAmountCallback>;
    mapViewabilityAmountValues: Map<number, ViewAmountToken>;
    mapViewabilityConfigStates: Map<
        string,
        {
            end: number;
            endBuffered: number;
            previousStart: number;
            previousEnd: number;
            start: number;
            startBuffered: number;
            viewableItems: ViewToken[];
            // minimumViewTime tracking: when each currently visible key became visible,
            // plus the latest pair, scroll size and deadline for the single pending timer.
            deadline?: number;
            pair?: ViewabilityConfigCallbackPair<any>;
            scrollSize?: number;
            since?: Map<string, number>;
        }
    >;
    pendingContainerIds: Set<number> | null | undefined;
    positionListeners: Map<string, Set<(value: any) => void>>;
    state: InternalState;
    scrollAxisGap: number;
    scrollRequestTracker?: ScrollRequestTracker;
    clearTemporaryScrollAdjust?: () => void;
    // Late-bound by LegendList so lower-level scroll modules can call back up without import cycles.
    doMaintainScrollAtEnd?: () => boolean;
    doScrollTo?: (params: DoScrollToParams) => void;
    interruptUserScroll?: () => void;
    scrollTo?: (params: InternalScrollTarget) => void;
    scrollToEnd?: (options?: ScrollToEndOptions) => boolean;
    values: Map<ListenerType, any>;
    viewRefs: Map<number, React.RefObject<LooseView | null>>;
}

let contextNum = 0;

// foldkit-native: was the body of `StateProvider`'s `React.useState` initialiser, unchanged
// except that `animatedScrollY` is left empty.
export function createStateContext(): StateContext {
    return {
        animatedScrollY: undefined,
        columnWrapperStyle: undefined,
        containerLayoutTriggers: new Map<number, () => void>(),
        contextNum: contextNum++,
        listeners: new Map(),
        mapViewabilityAmountCallbacks: new Map<number, ViewabilityAmountCallback>(),
        mapViewabilityAmountValues: new Map<number, ViewAmountToken>(),
        mapViewabilityCallbacks: new Map<string, ViewabilityCallback>(),
        mapViewabilityConfigStates: new Map(),
        mapViewabilityValues: new Map<string, ViewToken>(),
        pendingContainerIds: undefined,
        positionListeners: new Map(),
        scrollAxisGap: 0,
        state: undefined as any,
        values: new Map<ListenerType, any>([
            ["alignItemsAtEndPadding", 0],
            ["containerLayoutEpoch", 0],
            ["stylePaddingTop", 0],
            ["headerSize", 0],
            ["numContainers", 0],
            ["activeStickyIndex", -1],
            ["isAtEnd", false],
            ["isAtStart", false],
            ["isNearEnd", false],
            ["isNearStart", false],
            ["isWithinMaintainScrollAtEndThreshold", false],
            ["adaptiveRender", "normal"],
            ["totalSize", 0],
            ["scrollAdjustPending", 0],
        ]),
        viewRefs: new Map<number, React.RefObject<LooseView | null>>(),
    };
}

export function listen$<T extends ListenerType>(
    ctx: StateContext,
    signalName: T,
    cb: (value: ListenerTypeValueMap[T]) => void,
): () => void {
    const { listeners } = ctx;
    let setListeners = listeners.get(signalName);
    if (!setListeners) {
        setListeners = new Set();
        listeners.set(signalName, setListeners);
    }
    setListeners!.add(cb);

    return () => setListeners!.delete(cb);
}

// Function to get value based on ListenerType without requiring generic type
export function peek$<T extends ListenerType>(
    ctx: Pick<StateContext, "values">,
    signalName: T,
): ListenerTypeValueMap[T] {
    const { values } = ctx;
    return values.get(signalName);
}

export function set$<T extends ListenerType>(
    ctx: StateContext,
    signalName: T,
    value: ListenerTypeValueMap[T] | undefined,
) {
    const { listeners, values } = ctx;
    if (values.get(signalName) !== value) {
        values.set(signalName, value);
        const setListeners = listeners.get(signalName);
        if (setListeners) {
            for (const listener of setListeners) {
                listener(value);
            }
        }
    }
}

export function listenPosition$<T extends ListenerType>(
    ctx: StateContext,
    key: string,
    cb: (value: ListenerTypeValueMap[T]) => void,
) {
    const { positionListeners } = ctx;
    let setListeners = positionListeners.get(key);
    if (!setListeners) {
        setListeners = new Set();
        positionListeners.set(key, setListeners);
    }
    setListeners!.add(cb);

    return () => setListeners!.delete(cb);
}

export function notifyPosition$<T extends ListenerType>(
    ctx: StateContext,
    key: string,
    value: ListenerTypeValueMap[T] | undefined,
) {
    const { positionListeners } = ctx;
    const setListeners = positionListeners.get(key);
    if (setListeners) {
        for (const listener of setListeners) {
            listener(value);
        }
    }
}

// foldkit-native: `useArr$` and `useSelector$` (React hooks) were here. Our driver uses `listen$`.
