/**
 * How a chat's scroll view answers the keyboard on iOS, as
 * react-native-keyboard-controller's `KeyboardChatScrollView` does it.
 *
 * Adapted from react-native-keyboard-controller 1.22.7,
 * Copyright (c) Kiryl Ziusko, MIT licence (see LICENSE beside this file):
 *
 *   src/components/KeyboardChatScrollView/useChatKeyboard/index.ios.ts
 *   src/components/KeyboardChatScrollView/useExtraContentPadding/index.ts
 *   src/components/KeyboardChatScrollView/index.tsx   (the total padding)
 *
 * Those are React hooks that run on the phone's UI thread through Reanimated.
 * This project has neither React nor Reanimated in its drawing, so the hooks
 * are rewritten here as one plain object with the same handlers and the same
 * arithmetic, line for line where that was possible. Two things are ours:
 * `keyboardLiftBehavior` and `offset` are read from `options` on every event
 * (so they may be changed), and `forgetLift`. The values are plain
 * `{ value }` boxes, which is what the library's own tests pass in, so its
 * test cases run against this file unchanged (see
 * `test/kbcChatKeyboard.test.ts`).
 *
 * What it works out, and what it leaves to the caller:
 *
 * - `padding`: the keyboard's height above the scroll view's bottom edge.
 * - `contentOffsetY`: where the scroll view should be. It is written ONCE,
 *   as the keyboard starts to move. The caller hands it to the phone, which
 *   animates there. Nothing runs per frame.
 * - `totalPadding()`: the bottom inset, `max(blankSpace, padding + extra)`.
 *   The blank space under a sent question takes the keyboard in, so a
 *   question at the top of the screen does not move.
 * - `indicatorPadding()`: the scroll bar's inset, without the blank space.
 */
import {
  computeIOSContentOffset,
  getEffectiveHeight,
  getScrollEffective,
  getVisibleMinimumPaddingFraction,
  isScrollAtEnd,
  shouldShiftContent,
} from "./helpers";

import type { KeyboardLiftBehavior } from "./types";

export type Box<T> = { value: T };

export type ChatKeyboardOptions = {
  inverted: boolean;
  keyboardLiftBehavior: KeyboardLiftBehavior;
  /** While true, the keyboard changes nothing. */
  freeze: Box<boolean>;
  /** What sits between the scroll view's bottom edge and the screen's. */
  offset: number;
  /** Where the scroll view starts, if not at 0. */
  initialContentOffsetY?: number;
  /** The least bottom inset: the blank space under a sent question. */
  blankSpace: Box<number>;
  /** The composer's height. */
  extraContentPadding: Box<number>;
  /** Where the scroll view is now. The caller keeps these three up to date. */
  scroll: Box<number>;
  layout: Box<{ width: number; height: number }>;
  size: Box<{ width: number; height: number }>;
};

export type ChatKeyboardEvent = { height: number; duration?: number };

export type ChatKeyboard = {
  padding: Box<number>;
  contentOffsetY: Box<number>;
  handlers: {
    onStart: (e: ChatKeyboardEvent) => void;
    onInteractive: (e?: ChatKeyboardEvent) => void;
    onMove: (e?: ChatKeyboardEvent) => void;
    onEnd: (e: ChatKeyboardEvent) => void;
  };
  /**
   * The composer changed height. Returns the scroll position to go to, or
   * `undefined` to stay. `extraContentPadding.value` must already be `current`.
   */
  onExtraContentPadding: (current: number, previous: number | null) => number | undefined;
  /**
   * Not in the library. The list has put itself somewhere on its own account
   * (a new question went to the top) while the keyboard was up. The lift
   * that opening the keyboard gave is forgotten, so that closing it does not
   * take the list back down by as much. The library's users reach the same
   * end with `freeze` around the scroll.
   */
  forgetLift: () => void;
  totalPadding: () => number;
  indicatorPadding: () => number;
};

export const createChatKeyboard = (options: ChatKeyboardOptions): ChatKeyboard => {
  const { inverted, freeze, blankSpace, extraContentPadding, scroll, layout, size } =
    options;

  const padding: Box<number> = { value: 0 };
  const contentOffsetY: Box<number> = { value: options.initialContentOffsetY ?? 0 };
  const targetKeyboardHeight: Box<number> = { value: 0 };
  const prevAbsorption: Box<number> = { value: 0 };
  const isInteractiveDismissal: Box<boolean> = { value: false };

  const onStart = (e: ChatKeyboardEvent): void => {
    if (freeze.value) {
      return;
    }

    // Read on every event, so that the caller may change them between two.
    const { keyboardLiftBehavior, offset } = options;

    if (e.height > 0) {
      targetKeyboardHeight.value = e.height;
    }

    const effective = getEffectiveHeight(
      e.height,
      targetKeyboardHeight.value,
      offset,
    );

    const atEnd = isScrollAtEnd(
      scroll.value,
      layout.value.height,
      size.value.height,
      inverted,
    );

    // Scale minimum padding absorption by how much of it is visible.
    // Fully visible → full absorption; fully off-screen → no absorption.
    const visibleFraction = getVisibleMinimumPaddingFraction(
      scroll.value,
      layout.value.height,
      size.value.height,
      blankSpace.value,
      inverted,
    );
    const visiblePadding = visibleFraction * blankSpace.value;
    const minimumPaddingAbsorbed = Math.max(
      0,
      visiblePadding - extraContentPadding.value,
    );
    const scrollEffective = getScrollEffective(
      effective,
      minimumPaddingAbsorbed,
    );
    const actualTotalPadding = Math.max(
      blankSpace.value,
      effective + extraContentPadding.value,
    );

    // `onInteractive` owns the native scroll offset. When its final
    // keyboardWillHide event arrives, consume the marker so this
    // transition only removes the inset and does not scroll programmatically.
    if (isInteractiveDismissal.value) {
      isInteractiveDismissal.value = false;
      padding.value = effective;
      prevAbsorption.value = minimumPaddingAbsorbed;

      return;
    }

    // persistent mode: when keyboard shrinks, clamp to valid range
    if (keyboardLiftBehavior === "persistent" && effective < padding.value) {
      padding.value = effective;
      prevAbsorption.value = minimumPaddingAbsorbed;

      if (inverted) {
        const maxScroll = Math.max(size.value.height - layout.value.height, 0);

        contentOffsetY.value = Math.max(
          -actualTotalPadding,
          Math.min(scroll.value, maxScroll),
        );
      } else {
        const maxScroll = Math.max(
          size.value.height - layout.value.height + actualTotalPadding,
          0,
        );

        contentOffsetY.value = Math.max(0, Math.min(scroll.value, maxScroll));
      }

      return;
    }

    // never mode: when keyboard shrinks, clamp to valid range
    // to avoid ghost padding
    if (
      keyboardLiftBehavior === "never" &&
      effective < padding.value &&
      atEnd
    ) {
      padding.value = effective;
      prevAbsorption.value = minimumPaddingAbsorbed;

      if (inverted) {
        const maxScroll = Math.max(size.value.height - layout.value.height, 0);

        contentOffsetY.value = Math.max(
          -actualTotalPadding,
          Math.min(scroll.value, maxScroll),
        );
      } else {
        const maxScroll = Math.max(
          size.value.height - layout.value.height + actualTotalPadding,
          0,
        );

        contentOffsetY.value = Math.max(0, Math.min(scroll.value, maxScroll));
      }

      return;
    }

    // Undo only the scroll displacement that was actually applied
    // (not the full padding, which includes the absorbed portion).
    // Use the stored absorption from the previous event so that
    // the unwind matches the shift that was originally applied.
    const prevScrollEffective = getScrollEffective(
      padding.value,
      prevAbsorption.value,
    );
    const relativeScroll = inverted
      ? scroll.value + prevScrollEffective
      : scroll.value - prevScrollEffective;

    padding.value = effective;
    prevAbsorption.value = minimumPaddingAbsorbed;

    if (!shouldShiftContent(keyboardLiftBehavior, atEnd)) {
      // Preserve current scroll position so animated props
      // don't re-apply a stale contentOffset when padding changes
      contentOffsetY.value = scroll.value;

      return;
    }

    // When blankSpace fully absorbs the keyboard opening, preserve current scroll position
    // (only when keyboard is open — effective > 0 — not when closing)
    if (scrollEffective === 0 && minimumPaddingAbsorbed > 0 && effective > 0) {
      contentOffsetY.value = scroll.value;

      return;
    }

    contentOffsetY.value = computeIOSContentOffset(
      relativeScroll,
      scrollEffective,
      size.value.height,
      layout.value.height,
      inverted,
      actualTotalPadding,
    );
  };

  const onEnd = (e: ChatKeyboardEvent): void => {
    if (freeze.value) {
      return;
    }

    const effective = getEffectiveHeight(
      e.height,
      targetKeyboardHeight.value,
      options.offset,
    );

    padding.value = effective;
  };

  // From useExtraContentPadding. There it is a reaction that scrolls; here it
  // answers where to scroll and the caller does the scrolling.
  const onExtraContentPadding = (
    current: number,
    previous: number | null,
  ): number | undefined => {
    if (freeze.value || previous === null) {
      return undefined;
    }

    const { keyboardLiftBehavior } = options;
    const rawDelta = current - previous;

    if (rawDelta === 0) {
      return undefined;
    }

    // Compute effective delta considering blankSpace floor
    const previousTotal = Math.max(blankSpace.value, padding.value + previous);
    const currentTotal = Math.max(blankSpace.value, padding.value + current);
    const effectiveDelta = currentTotal - previousTotal;

    if (effectiveDelta === 0) {
      // blankSpace absorbed the change
      return undefined;
    }

    const atEnd = isScrollAtEnd(
      scroll.value,
      layout.value.height,
      size.value.height,
      inverted,
    );

    // "persistent": scroll on grow, hold position on shrink (unless at end)
    if (keyboardLiftBehavior === "persistent" && effectiveDelta < 0 && !atEnd) {
      return undefined;
    }

    if (!shouldShiftContent(keyboardLiftBehavior, atEnd)) {
      return undefined;
    }

    let target: number;

    if (inverted) {
      target = Math.max(scroll.value - effectiveDelta, -currentTotal);
    } else {
      const maxScroll = Math.max(
        size.value.height - layout.value.height + currentTotal,
        0,
      );

      // Clamp at 0 as well: when the content is shorter than the viewport a
      // shrinking padding makes `effectiveDelta` negative while `scroll.value`
      // is already 0, so the target would go below the top of the content.
      target = Math.max(Math.min(scroll.value + effectiveDelta, maxScroll), 0);
    }

    contentOffsetY.value = target;

    return target;
  };

  return {
    padding,
    contentOffsetY,
    handlers: {
      onStart,
      onInteractive: () => {
        isInteractiveDismissal.value = true;
      },
      onMove: () => {
        // iOS doesn't need per-frame updates (contentOffset handles it)
      },
      onEnd,
    },
    onExtraContentPadding,
    forgetLift: () => {
      prevAbsorption.value = padding.value;
    },
    // From KeyboardChatScrollView: blank space is clamped at one viewport.
    totalPadding: () =>
      Math.min(
        layout.value.height,
        Math.max(blankSpace.value, padding.value + extraContentPadding.value),
      ),
    indicatorPadding: () => padding.value + extraContentPadding.value,
  };
};
