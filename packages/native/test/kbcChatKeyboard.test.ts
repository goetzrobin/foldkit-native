/**
 * Test cases from react-native-keyboard-controller 1.22.7 (MIT, copyright
 * Kiryl Ziusko), copied by scripts/port-kbc-specs.mjs from:
 *
 *   useChatKeyboard/__tests__/index.ios.spec.ts
 *   useChatKeyboard/__tests__/blankSpace.ios.spec.ts
 *   useChatKeyboard/__tests__/offset.ios.spec.ts
 *   useChatKeyboard/__tests__/persistent.ios.spec.ts
 *   useChatKeyboard/__tests__/index.ios.ecp.spec.ts
 *
 * Do not edit by hand. The cases are the library's own. Only the lines above
 * the first `describe` of each file were replaced, to call our port.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  KEYBOARD,
  type SharedValue,
  handlers,
  mockLayout,
  mockOffset,
  mockScrollTo,
  mockSize,
  render,
  setupBeforeEach,
  sv,
} from './support/kbcFixture.js'

beforeEach(() => {
  setupBeforeEach()
})

// ---- useChatKeyboard/__tests__/index.ios.spec.ts

describe('index.ios.spec.ts', () => {
describe("`useChatKeyboard` — iOS non-inverted + always", () => {
  it("should set padding and contentOffsetY on keyboard open", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    expect(result.current.contentOffsetY!.value).toBe(400);
  });

  it("should restore contentOffsetY on keyboard close", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });
    mockOffset.value = 400;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    expect(result.current.contentOffsetY!.value).toBe(100);
  });

  it("should not set contentOffsetY after an interactive keyboard dismiss", () => {
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });
    handlers.onMove({ height: KEYBOARD / 2 });
    handlers.onEnd({ height: KEYBOARD });
    expect(result.current.contentOffsetY!.value).toBe(KEYBOARD);

    handlers.onInteractive({ height: KEYBOARD / 2 });
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // UIKit owns the native offset while the keyboard is dismissed interactively.
    expect(result.current.contentOffsetY!.value).toBe(KEYBOARD);

    handlers.onEnd({ height: 0 });

    // check again just in case
    expect(result.current.padding.value).toBe(0);
    expect(result.current.contentOffsetY!.value).toBe(KEYBOARD);
  });

  it("should handle keyboard resize (emoji toggle)", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: 300 });
    mockOffset.value = 400;
    handlers.onStart({ height: 350 });

    expect(result.current.padding.value).toBe(350);
    expect(result.current.contentOffsetY!.value).toBe(450);
  });

  it("should clamp contentOffsetY when content is short", () => {
    mockSize.value = { width: 390, height: 500 };
    mockOffset.value = 0;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.contentOffsetY!.value).toBe(0);
  });

  it("should not call scrollTo on iOS", () => {
    render({ inverted: false, keyboardLiftBehavior: "always" });

    handlers.onStart({ height: KEYBOARD });
    handlers.onMove({ height: 150 });

    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});

describe("`useChatKeyboard` — iOS inverted + always", () => {
  it("should set inverted contentOffsetY on keyboard open", () => {
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.contentOffsetY!.value).toBe(-KEYBOARD);
  });

  it("should restore contentOffsetY on keyboard close", () => {
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });
    mockOffset.value = -300;
    handlers.onStart({ height: 0 });

    expect(result.current.contentOffsetY!.value).toBe(0);
  });

  it("should account for user scrolling while keyboard open", () => {
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: KEYBOARD });
    mockOffset.value = -250;
    handlers.onStart({ height: 0 });

    expect(result.current.contentOffsetY!.value).toBe(50);
  });

  it("should handle keyboard resize (inverted)", () => {
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
    });

    handlers.onStart({ height: 300 });
    mockOffset.value = -300;
    handlers.onStart({ height: 350 });

    expect(result.current.contentOffsetY!.value).toBe(-350);
  });

  it("should clamp contentOffsetY when at max scroll on keyboard close", () => {
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
    });

    // keyboard opens
    handlers.onStart({ height: KEYBOARD });

    // user scrolls to visual top (max scroll offset)
    // maxScroll = contentHeight(2000) - layoutHeight(800) = 1200
    mockOffset.value = 1200;
    handlers.onStart({ height: 0 });

    // relativeScroll = 1200 + 300 = 1500, but maxScroll without keyboard = 1200
    // should be clamped to 1200, not 1500
    expect(result.current.contentOffsetY!.value).toBe(1200);
  });
});

describe("`useChatKeyboard` — iOS behaviors", () => {
  it("never: should set padding but preserve current scroll position", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "never",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    // contentOffsetY must match current scroll position so animated props
    // don't re-apply a stale contentOffset when padding changes
    expect(result.current.contentOffsetY!.value).toBe(100);
  });

  it("never: should snap to end on close when at end to avoid ghost padding", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "never",
    });

    // open keyboard
    handlers.onStart({ height: KEYBOARD });

    // user scrolls to end while keyboard is open
    // end with padding: contentHeight(2000) - layoutHeight(800) + padding(300) = 1500
    mockOffset.value = 1500;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // should snap to natural end (2000 - 800 = 1200), not stay at 1500
    expect(result.current.contentOffsetY!.value).toBe(1200);
  });

  it("never: should preserve position on close when NOT at end", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "never",
    });

    handlers.onStart({ height: KEYBOARD });

    // user stays in the middle
    mockOffset.value = 500;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    expect(result.current.contentOffsetY!.value).toBe(500);
  });

  it("never + inverted: should snap to end on close when at end", () => {
    mockOffset.value = 500;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "never",
    });

    // open keyboard
    handlers.onStart({ height: KEYBOARD });

    // user scrolls to end (offset near 0 for inverted)
    mockOffset.value = 0;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    expect(result.current.contentOffsetY!.value).toBe(0);
  });

  it("whenAtEnd: should shift when at the end", () => {
    mockOffset.value = 1180;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "whenAtEnd",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.contentOffsetY!.value).toBe(1480);
  });

  it("whenAtEnd: should preserve scroll position when far from the end", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "whenAtEnd",
    });

    handlers.onStart({ height: KEYBOARD });

    // contentOffsetY must match current scroll position so animated props
    // don't re-apply a stale contentOffset when padding changes
    expect(result.current.contentOffsetY!.value).toBe(100);
  });

  it("whenAtEnd + inverted: should shift when at latest messages (offset near 0)", () => {
    mockOffset.value = 0;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "whenAtEnd",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.contentOffsetY!.value).toBe(-KEYBOARD);
  });

  it("whenAtEnd + inverted: should preserve scroll position when scrolled to older messages", () => {
    mockOffset.value = 500;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "whenAtEnd",
    });

    handlers.onStart({ height: KEYBOARD });

    // contentOffsetY must match current scroll position so animated props
    // don't re-apply a stale contentOffset when padding changes
    expect(result.current.contentOffsetY!.value).toBe(500);
  });

  it("onEnd: should finalize padding", () => {
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
    });

    handlers.onEnd({ height: KEYBOARD });
    expect(result.current.padding.value).toBe(KEYBOARD);

    handlers.onEnd({ height: 0 });
    expect(result.current.padding.value).toBe(0);
  });
});

describe("`useChatKeyboard` — iOS freeze", () => {
  it("should not change padding on keyboard open", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: true,
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(0);
  });

  it("should not change contentOffsetY on keyboard open", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: true,
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.contentOffsetY!.value).toBe(0);
  });

  it("should not change padding in onEnd", () => {
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: true,
    });

    handlers.onEnd({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(0);
  });
});

})

// ---- useChatKeyboard/__tests__/blankSpace.ios.spec.ts

describe('blankSpace.ios.spec.ts', () => {
describe("blankSpace — iOS non-inverted + always", () => {
  it("blankSpace=0 produces identical behavior to default", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      blankSpace: sv(0),
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    expect(result.current.contentOffsetY!.value).toBe(400);
  });

  it("full absorption: preserves current scroll position when blankSpace > keyboard", () => {
    // Small content so minimum padding fills viewport (pastContentEnd = 0+800-300 = 500, fraction = 1)
    mockSize.value = { width: 390, height: 300 };
    mockOffset.value = 0;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      blankSpace: sv(500),
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    // minimumPaddingAbsorbed=500, scrollEff=0 → contentOffsetY = scroll.value (no shift)
    expect(result.current.contentOffsetY!.value).toBe(0);
  });

  it("partial absorption: reduced content offset displacement", () => {
    // Content slightly smaller than viewport so minimum padding is fully visible
    // (pastContentEnd = 0+800-700 = 100, fraction = 100/100 = 1)
    mockSize.value = { width: 390, height: 700 };
    mockOffset.value = 0;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      blankSpace: sv(100),
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    // minimumPaddingAbsorbed=100, scrollEff=200, actualTotalPadding=max(100,300+0)=300
    // relativeScroll = 0 - 0 = 0 (no previous padding)
    // contentOffsetY = computeIOSContentOffset(0, 200, 700, 800, false, 300)
    //   maxScroll = max(700 - 800 + 300, 0) = 200
    //   target = min(max(200 + 0, 0), 200) = 200
    expect(result.current.contentOffsetY!.value).toBe(200);
  });
});

describe("blankSpace — iOS inverted + always", () => {
  it("full absorption: preserves current scroll position (inverted)", () => {
    // Inverted: minimum padding at top, visible when scroll < 0
    // fraction = -(-500)/500 = 1
    mockOffset.value = -500;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
      blankSpace: sv(500),
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    // minimumPaddingAbsorbed=500, scrollEff=0 → contentOffsetY = scroll.value
    expect(result.current.contentOffsetY!.value).toBe(-500);
  });

  it("partial absorption: reduced content offset displacement (inverted)", () => {
    // Inverted: fraction = -(-100)/100 = 1
    mockOffset.value = -100;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
      blankSpace: sv(100),
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    // minimumPaddingAbsorbed=100, scrollEff=200, actualTotalPadding=max(100,300+0)=300
    // relativeScroll = -100 + 0 = -100 (no previous padding)
    // contentOffsetY = computeIOSContentOffset(-100, 200, 2000, 800, true, 300)
    //   maxScroll = max(2000 - 800, 0) = 1200
    //   result = max(min(-100-200, 1200), -300) = max(-300, -300) = -300
    expect(result.current.contentOffsetY!.value).toBe(-300);
  });
});

describe("blankSpace — iOS persistent behavior", () => {
  it("partial visibility: full absorption when visiblePadding >= keyboard", () => {
    // Scroll near end so minimum padding is partially visible
    // (pastContentEnd = 1000+800-1500 = 300, fraction = 300/500 = 0.6)
    // visiblePadding = 300 >= keyboard = 300 → full absorption → no shift
    mockSize.value = { width: 390, height: 1500 };
    mockOffset.value = 1000;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "persistent",
      blankSpace: sv(500),
    });

    // Open keyboard — visiblePadding (300) absorbs keyboard (300) entirely
    // scrollEff = 0 → preserve scroll position
    handlers.onStart({ height: KEYBOARD });
    expect(result.current.contentOffsetY!.value).toBe(1000);

    // Close keyboard — persistent + at end → clamp to valid range
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // atEnd: 1000+800 >= 1500-20 → true
    // actualTotalPadding = max(500, 0) = 500
    // maxScroll = max(1500-800+500, 0) = 1200
    // clamp: max(0, min(1000, 1200)) = 1000
    expect(result.current.contentOffsetY!.value).toBe(1000);
  });
});

describe("blankSpace — iOS never behavior", () => {
  it("full absorption on close: uses actualTotalPadding when at end", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "never",
      blankSpace: sv(500),
    });

    // Open keyboard
    handlers.onStart({ height: KEYBOARD });
    expect(result.current.contentOffsetY!.value).toBe(100);

    // Close keyboard — user scrolled to end
    // end with blankSpace: contentHeight - layoutHeight + totalPadding
    // totalPadding on close = max(500, 0+0) = 500
    // maxScroll = 2000 - 800 + 500 = 1700
    mockOffset.value = 1700;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // atEnd: 1700 + 800 = 2500 >= 2000 - 20 = 1980 → at end
    // actualTotalPadding = max(500, 0+0) = 500
    // contentOffsetY = max(2000-800+500, 0) = 1700
    expect(result.current.contentOffsetY!.value).toBe(1700);
  });
});

describe("blankSpace — iOS whenAtEnd behavior", () => {
  it("partial visibility: full absorption when visiblePadding >= keyboard", () => {
    // Scroll near end so minimum padding is partially visible
    // (pastContentEnd = 1000+800-1500 = 300, fraction = 300/500 = 0.6)
    // visiblePadding = 300 >= keyboard = 300 → full absorption → no shift
    mockSize.value = { width: 390, height: 1500 };
    mockOffset.value = 1000;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "whenAtEnd",
      blankSpace: sv(500),
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    // visiblePadding = 300, minimumPaddingAbsorbed = 300
    // scrollEff = max(0, 300-300) = 0 → preserve scroll position
    expect(result.current.contentOffsetY!.value).toBe(1000);
  });
});

})

// ---- useChatKeyboard/__tests__/offset.ios.spec.ts

describe('offset.ios.spec.ts', () => {
const OFFSET = 50;

describe("`useChatKeyboard` — iOS non-inverted + offset", () => {
  it("should set padding to effective height", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      offset: OFFSET,
    });

    handlers.onStart({ height: KEYBOARD });

    // effective = interpolate(300, [0, 300], [0, 250]) = 250
    expect(result.current.padding.value).toBe(KEYBOARD - OFFSET);
  });

  it("should compute contentOffsetY with effective height", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      offset: OFFSET,
    });

    handlers.onStart({ height: KEYBOARD });

    // effective = 250
    // contentOffsetY = computeIOSContentOffset(100, 250, 2000, 800, false)
    //   = min(max(250 + 100, 0), max(2000 - 800 + 250, 0))
    //   = min(350, 1450) = 350
    expect(result.current.contentOffsetY!.value).toBe(350);
  });

  it("should restore contentOffsetY on keyboard close", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      offset: OFFSET,
    });

    handlers.onStart({ height: KEYBOARD });
    // effective padding = 250, user is now at scroll offset 350
    mockOffset.value = 350;
    handlers.onStart({ height: 0 });

    // relativeScroll = 350 - 250 = 100 (original position)
    // effective = interpolate(0, [0, 300], [0, 250]) = 0
    // padding = 0
    // contentOffsetY = computeIOSContentOffset(100, 0, 2000, 800, false)
    //   = min(max(0 + 100, 0), max(2000 - 800, 0)) = 100
    expect(result.current.padding.value).toBe(0);
    expect(result.current.contentOffsetY!.value).toBe(100);
  });

  it("should not call scrollTo on iOS", () => {
    render({
      inverted: false,
      keyboardLiftBehavior: "always",
      offset: OFFSET,
    });

    handlers.onStart({ height: KEYBOARD });
    handlers.onMove({ height: 150 });

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should finalize padding with effective height in onEnd", () => {
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "always",
      offset: OFFSET,
    });

    handlers.onStart({ height: KEYBOARD });
    handlers.onEnd({ height: KEYBOARD });
    expect(result.current.padding.value).toBe(KEYBOARD - OFFSET);

    handlers.onEnd({ height: 0 });
    expect(result.current.padding.value).toBe(0);
  });
});

describe("`useChatKeyboard` — iOS inverted + offset", () => {
  it("should set inverted contentOffsetY with effective height", () => {
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "always",
      offset: OFFSET,
    });

    handlers.onStart({ height: KEYBOARD });

    // effective = 250
    // contentOffsetY = computeIOSContentOffset(0, 250, 2000, 800, true)
    //   = 0 - 250 = -250
    expect(result.current.contentOffsetY!.value).toBe(-(KEYBOARD - OFFSET));
  });
});

})

// ---- useChatKeyboard/__tests__/persistent.ios.spec.ts

describe('persistent.ios.spec.ts', () => {
describe("`useChatKeyboard` — iOS persistent non-inverted", () => {
  it("should push content up on keyboard open", () => {
    mockOffset.value = 100;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    expect(result.current.contentOffsetY!.value).toBe(400);
  });

  it("should snap to end of content on keyboard close when at end", () => {
    mockOffset.value = 1180;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });
    // keyboard pushed us to 1480, which is at end (1480+800 >= 1980)
    mockOffset.value = 1480;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // snaps to end of content (2000 - 800 = 1200), not back to 1180
    expect(result.current.contentOffsetY!.value).toBe(1200);
  });

  it("should preserve current scroll position on close when NOT at end", () => {
    mockOffset.value = 1180;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });

    // user scrolls away from end while keyboard is open
    mockOffset.value = 500;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // contentOffsetY must match current scroll position so animated props
    // don't re-apply the stale offset from keyboard open
    expect(result.current.contentOffsetY!.value).toBe(500);
  });

  it("should push content up again after close + re-open", () => {
    mockOffset.value = 1180;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "persistent",
    });

    // open → close (user scrolled away)
    handlers.onStart({ height: KEYBOARD });
    mockOffset.value = 500;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);

    // re-open → should push up from current position
    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    expect(result.current.contentOffsetY!.value).toBe(800);
  });

  it("should snap to end on keyboard resize when at end", () => {
    mockOffset.value = 1180;
    const { result } = render({
      inverted: false,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });

    // keyboard shrinks (e.g. emoji → text), user still at end
    mockOffset.value = 1480;
    handlers.onStart({ height: 200 });

    expect(result.current.padding.value).toBe(200);
    // end = 2000 - 800 + 200 = 1400
    expect(result.current.contentOffsetY!.value).toBe(1400);
  });
});

describe("`useChatKeyboard` — iOS persistent inverted", () => {
  it("should push content up on keyboard open", () => {
    mockOffset.value = 0;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });

    expect(result.current.padding.value).toBe(KEYBOARD);
    expect(result.current.contentOffsetY!.value).toBe(-KEYBOARD);
  });

  it("should preserve current scroll position on close when NOT at end", () => {
    // scrolled to older messages (not at end for inverted)
    mockOffset.value = 500;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });

    // user scrolls further while keyboard is open
    mockOffset.value = 400;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // contentOffsetY must match current scroll position so animated props
    // don't re-apply the stale offset from keyboard open
    expect(result.current.contentOffsetY!.value).toBe(400);
  });

  it("should snap to end on keyboard close when at end", () => {
    // at newest messages (at end for inverted = offset near 0)
    mockOffset.value = 0;
    const { result } = render({
      inverted: true,
      keyboardLiftBehavior: "persistent",
    });

    handlers.onStart({ height: KEYBOARD });
    // user stays at newest messages with keyboard inset
    mockOffset.value = -300;
    handlers.onStart({ height: 0 });

    expect(result.current.padding.value).toBe(0);
    // -effective where effective = 0 produces -0
    expect(result.current.contentOffsetY!.value).toBe(-0);
  });
});

})

// ---- useChatKeyboard/__tests__/index.ios.ecp.spec.ts

describe('index.ios.ecp.spec.ts', () => {
// mockSize: { width: 390, height: 2000 }
// mockLayout: { width: 390, height: 800 }
// KEYBOARD = 300
// base maxScroll (no keyboard, no extraContentPadding) = 2000 - 800 = 1200
// maxScroll with keyboard             = 2000 - 800 + 300 = 1500
// maxScroll with keyboard + extraContentPadding=50    = 2000 - 800 + 300 + 50 = 1550

describe("`useChatKeyboard` — iOS extraContentPadding", () => {
  describe("spurious onStart (keyboard height unchanged)", () => {
    it("should not clamp contentOffsetY when extraContentPadding grew between two onStart calls", () => {
      const extraContentPadding = { value: 0 } as SharedValue<number>;

      mockOffset.value = 1200;
      const { result } = render({
        inverted: false,
        keyboardLiftBehavior: "always",
        extraContentPadding,
      });

      // Step 1: keyboard opens, extraContentPadding=0
      handlers.onStart({ height: KEYBOARD });
      expect(result.current.contentOffsetY!.value).toBe(1500);

      // Step 2: text input grows → extraContentPadding=50, scroll pushed to 1550 via scrollTo
      extraContentPadding.value = 50;
      mockOffset.value = 1550;

      // Step 3: spurious onStart — same keyboard height, fired during input resize
      handlers.onStart({ height: KEYBOARD });

      // Must stay at 1550, not be clamped to 1500 (the no-extraContentPadding max)
      expect(result.current.contentOffsetY!.value).toBe(1550);
    });

    it("should not clamp contentOffsetY for inverted list with extraContentPadding", () => {
      // Inverted: extraContentPadding extends the minimum bound from -300 to -350
      const extraContentPadding = { value: 50 } as SharedValue<number>;

      mockOffset.value = -KEYBOARD;
      const { result } = render({
        inverted: true,
        keyboardLiftBehavior: "always",
        extraContentPadding,
      });

      handlers.onStart({ height: KEYBOARD });
      // Simulate scroll pushed further by extraContentPadding
      mockOffset.value = -350;

      // Spurious onStart — same keyboard height
      handlers.onStart({ height: KEYBOARD });

      // Must stay at -350, not be clamped to -300 (the no-extraContentPadding min)
      expect(result.current.contentOffsetY!.value).toBe(-350);
    });
  });

  describe("persistent: snap to end when keyboard shrinks", () => {
    it("should include extraContentPadding in the snap-to-end position", () => {
      const extraContentPadding = { value: 50 } as SharedValue<number>;

      // Scroll at the end (with keyboard + extraContentPadding)
      mockOffset.value = 1550;
      const { result } = render({
        inverted: false,
        keyboardLiftBehavior: "persistent",
        extraContentPadding,
      });

      handlers.onStart({ height: KEYBOARD });

      // Keyboard shrinks by 50px (e.g. QuickType bar disappears)
      mockOffset.value = 1550;
      handlers.onStart({ height: 250 });

      // Snap-to-end = 2000 - 800 + 250 + 50 = 1500
      expect(result.current.contentOffsetY!.value).toBe(1500);
    });
  });

  describe("never: snap to end when keyboard closes", () => {
    it("should include extraContentPadding in the snap-to-end position", () => {
      const extraContentPadding = { value: 50 } as SharedValue<number>;

      mockOffset.value = 100;
      const { result } = render({
        inverted: false,
        keyboardLiftBehavior: "never",
        extraContentPadding,
      });

      handlers.onStart({ height: KEYBOARD });

      // Scroll at the end (with keyboard + extraContentPadding)
      mockOffset.value = 1550;
      handlers.onStart({ height: 0 });

      // Snap-to-end = 2000 - 800 + 0 + 50 = 1250
      expect(result.current.contentOffsetY!.value).toBe(1250);
    });
  });
});

})
