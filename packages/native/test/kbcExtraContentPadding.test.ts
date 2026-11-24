/**
 * Test cases from react-native-keyboard-controller 1.22.7 (MIT, copyright
 * Kiryl Ziusko), copied by scripts/port-kbc-specs.mjs from:
 *
 *   useExtraContentPadding/__tests__/always.spec.ts
 *   useExtraContentPadding/__tests__/whenAtEnd.spec.ts
 *   useExtraContentPadding/__tests__/persistent.spec.ts
 *   useExtraContentPadding/__tests__/never.spec.ts
 *   useExtraContentPadding/__tests__/blankSpace.spec.ts
 *   useExtraContentPadding/__tests__/edge-cases.spec.ts
 *   useExtraContentPadding/__tests__/contentOffsetY.spec.ts
 *
 * Do not edit by hand. The cases are the library's own. Only the lines above
 * the first `describe` of each file were replaced, to call our port.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createEcpRender as createRender,
  flushRAF,
  mockScrollTo,
  reactionEffect,
  setupEcpBeforeEach,
  sv,
  withLegacyArch,
} from './support/kbcFixture.js'

beforeEach(() => {
  setupEcpBeforeEach()
})

// ---- useExtraContentPadding/__tests__/always.spec.ts

describe("useExtraContentPadding — always behavior", () => {
  it("should scrollTo on grow when at end (non-inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(1200),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(
      expect.anything(),
      0,
      1220,
      false,
    );
  });

  it("should scrollTo on grow when NOT at end (non-inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, 120, false);
  });

  it("should scrollTo on shrink (non-inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(0),
      keyboardPadding: sv(300),
      scroll: sv(1220),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(0, 20);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(
      expect.anything(),
      0,
      1200,
      false,
    );
  });

  it("should scrollTo on grow (inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(5),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: true,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, -15, false);
  });
});


// ---- useExtraContentPadding/__tests__/whenAtEnd.spec.ts

describe("useExtraContentPadding — whenAtEnd behavior", () => {
  it("should scrollTo when at end (non-inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(1200),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "whenAtEnd",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalled();
  });

  it("should NOT scrollTo when NOT at end (non-inverted)", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "whenAtEnd",
      freeze: false,
    });

    reactionEffect(20, 0);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should scrollTo when at end (inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(5),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: true,
      keyboardLiftBehavior: "whenAtEnd",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalled();
  });

  it("should NOT scrollTo when NOT at end (inverted)", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: true,
      keyboardLiftBehavior: "whenAtEnd",
      freeze: false,
    });

    reactionEffect(20, 0);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});


// ---- useExtraContentPadding/__tests__/persistent.spec.ts

describe("useExtraContentPadding — persistent behavior", () => {
  it("should scrollTo on grow", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "persistent",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, 120, false);
  });

  it("should NOT scrollTo on shrink when NOT at end", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(0),
      keyboardPadding: sv(300),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "persistent",
      freeze: false,
    });

    reactionEffect(0, 20);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should scrollTo on shrink when at end", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(0),
      keyboardPadding: sv(300),
      scroll: sv(1200),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "persistent",
      freeze: false,
    });

    reactionEffect(0, 20);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalled();
  });
});


// ---- useExtraContentPadding/__tests__/never.spec.ts

describe("useExtraContentPadding — never behavior", () => {
  it("should NOT scrollTo on grow", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(1200),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "never",
      freeze: false,
    });

    reactionEffect(20, 0);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });
});


// ---- useExtraContentPadding/__tests__/blankSpace.spec.ts

describe("useExtraContentPadding — blankSpace floor", () => {
  it("should skip scroll when blankSpace fully absorbs the change", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      blankSpace: sv(500),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // previousTotal = max(500, 0+0) = 500
    // currentTotal = max(500, 0+20) = 500
    // effectiveDelta = 0 → skip
    reactionEffect(20, 0);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should scroll by effective delta when blankSpace partially absorbs", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(300),
      keyboardPadding: sv(200),
      blankSpace: sv(400),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // previousTotal = max(400, 200+0) = 400
    // currentTotal = max(400, 200+300) = 500
    // effectiveDelta = 100
    // maxScroll = max(2000 - 800 + 500, 0) = 1700
    // target = min(100 + 100, 1700) = 200
    reactionEffect(300, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, 200, false);
  });

  it("blankSpace=0 produces identical behavior to default", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      blankSpace: sv(0),
      scroll: sv(1200),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // previousTotal = max(0, 300+0) = 300
    // currentTotal = max(0, 300+20) = 320
    // effectiveDelta = 20
    // maxScroll = max(2000 - 800 + 320, 0) = 1520
    // target = min(1200 + 20, 1520) = 1220
    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(
      expect.anything(),
      0,
      1220,
      false,
    );
  });

  it("should use currentTotal for inverted clamp", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      blankSpace: sv(400),
      scroll: sv(5),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: true,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // previousTotal = max(400, 300+0) = 400
    // currentTotal = max(400, 300+20) = 400
    // effectiveDelta = 0 → skip (blankSpace floor absorbs)
    reactionEffect(20, 0);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should scroll when change exceeds blankSpace floor (inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(200),
      keyboardPadding: sv(300),
      blankSpace: sv(400),
      scroll: sv(5),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: true,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // previousTotal = max(400, 300+0) = 400
    // currentTotal = max(400, 300+200) = 500
    // effectiveDelta = 100
    // target = max(5 - 100, -500) = max(-95, -500) = -95
    reactionEffect(200, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, -95, false);
  });
});


// ---- useExtraContentPadding/__tests__/edge-cases.spec.ts

describe("useExtraContentPadding — edge cases", () => {
  it("should not scrollTo when delta is 0", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 20);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should not scrollTo on first render (previous is null)", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, null);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should not scrollTo when freeze is true", () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(0),
      scroll: sv(1200),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: true,
    });

    reactionEffect(20, 0);

    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should clamp to maxScroll (non-inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(50),
      keyboardPadding: sv(300),
      scroll: sv(1490),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // delta = 50, scroll + delta = 1540, maxScroll = 2000 - 800 + 300 + 50 = 1550
    reactionEffect(50, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(
      expect.anything(),
      0,
      1540,
      false,
    );
  });

  it("should clamp to -totalPadding (inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(50),
      keyboardPadding: sv(300),
      scroll: sv(-280),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      inverted: true,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // delta = 50, target = -280 - 50 = -330, clamp to -350
    reactionEffect(50, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(
      expect.anything(),
      0,
      -330,
      false,
    );
  });
});


// ---- useExtraContentPadding/__tests__/contentOffsetY.spec.ts

describe("useExtraContentPadding — contentOffsetY (iOS atomic path)", () => {
  it("should set contentOffsetY instead of scrollTo on grow (non-inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(100);

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      contentOffsetY,
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 0);

    expect(contentOffsetY.value).toBe(120);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should set contentOffsetY instead of scrollTo on grow (inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(5);

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(5),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      contentOffsetY,
      inverted: true,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 0);

    expect(contentOffsetY.value).toBe(-15);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should set contentOffsetY instead of scrollTo on shrink (non-inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(1220);

    render({
      extraContentPadding: sv(0),
      keyboardPadding: sv(300),
      scroll: sv(1220),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      contentOffsetY,
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(0, 20);

    expect(contentOffsetY.value).toBe(1200);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should clamp contentOffsetY to maxScroll (non-inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(1490);

    render({
      extraContentPadding: sv(50),
      keyboardPadding: sv(300),
      scroll: sv(1490),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      contentOffsetY,
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // delta = 50, scroll + delta = 1540, maxScroll = 2000 - 800 + 300 + 50 = 1550
    reactionEffect(50, 0);

    expect(contentOffsetY.value).toBe(1540);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should clamp contentOffsetY to 0 on shrink when content is shorter than the viewport (non-inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(0);

    render({
      extraContentPadding: sv(0),
      keyboardPadding: sv(0),
      scroll: sv(0),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 200 }),
      contentOffsetY,
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // delta = -80, scroll + delta = -80, maxScroll = 0 -> target must not go below 0
    reactionEffect(0, 80);

    expect(contentOffsetY.value).toBe(0);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should clamp contentOffsetY to -totalPadding (inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(-280);

    render({
      extraContentPadding: sv(50),
      keyboardPadding: sv(300),
      scroll: sv(-280),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      contentOffsetY,
      inverted: true,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    // delta = 50, target = -280 - 50 = -330, clamp to -350
    reactionEffect(50, 0);

    expect(contentOffsetY.value).toBe(-330);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it("should clamp scrollTo target to 0 on shrink when content is shorter than the viewport (non-inverted)", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(0),
      keyboardPadding: sv(0),
      scroll: sv(0),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 200 }),
      contentOffsetY: undefined,
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(0, 80);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, 0, false);
  });

  it("should fall back to scrollTo when contentOffsetY is undefined", async () => {
    const render = createRender();

    render({
      extraContentPadding: sv(20),
      keyboardPadding: sv(300),
      scroll: sv(100),
      layout: sv({ width: 390, height: 800 }),
      size: sv({ width: 390, height: 2000 }),
      contentOffsetY: undefined,
      inverted: false,
      keyboardLiftBehavior: "always",
      freeze: false,
    });

    reactionEffect(20, 0);
    await flushRAF();

    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, 120, false);
  });
});

describe("useExtraContentPadding — iOS legacy arch (scrollTo path)", () => {
  it("should use scrollTo directly when on legacy arch even if contentOffsetY is provided (non-inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(100);

    withLegacyArch(() => {
      render({
        extraContentPadding: sv(20),
        keyboardPadding: sv(300),
        scroll: sv(100),
        layout: sv({ width: 390, height: 800 }),
        size: sv({ width: 390, height: 2000 }),
        contentOffsetY,
        inverted: false,
        keyboardLiftBehavior: "always",
        freeze: false,
      });
    });

    reactionEffect(20, 0);

    expect(contentOffsetY.value).toBe(100);
    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, 120, false);
  });

  it("should use scrollTo directly when on legacy arch even if contentOffsetY is provided (inverted)", () => {
    const render = createRender();
    const contentOffsetY = sv(5);

    withLegacyArch(() => {
      render({
        extraContentPadding: sv(20),
        keyboardPadding: sv(300),
        scroll: sv(5),
        layout: sv({ width: 390, height: 800 }),
        size: sv({ width: 390, height: 2000 }),
        contentOffsetY,
        inverted: true,
        keyboardLiftBehavior: "always",
        freeze: false,
      });
    });

    reactionEffect(20, 0);

    expect(contentOffsetY.value).toBe(5);
    expect(mockScrollTo).toHaveBeenCalledWith(expect.anything(), 0, -15, false);
  });
});

