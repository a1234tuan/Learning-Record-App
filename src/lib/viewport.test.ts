import { describe, expect, it } from "vitest";

import { isKeyboardViewportVisible, nextKeyboardBaselineHeight, resolveViewportHeight } from "./viewport";

describe("viewport helpers", () => {
  it("uses the layout viewport for native resize-based WebViews", () => {
    expect(resolveViewportHeight({ native: true, innerHeight: 780, visualViewportHeight: 402 })).toBe(780);
  });

  it("uses the visual viewport for web soft-keyboard layouts", () => {
    expect(resolveViewportHeight({ native: false, innerHeight: 780, visualViewportHeight: 402 })).toBe(402);
    expect(resolveViewportHeight({ native: false, innerHeight: 780, visualViewportHeight: 0 })).toBe(780);
  });

  it("refreshes the resting height after the keyboard closes and clears keyboard state", () => {
    const reducedHeight = 430;
    const restingHeight = nextKeyboardBaselineHeight(780, reducedHeight, true);
    expect(isKeyboardViewportVisible(true, restingHeight, reducedHeight)).toBe(true);

    const restoredHeight = nextKeyboardBaselineHeight(restingHeight, 780, true);
    expect(restoredHeight).toBe(780);
    expect(isKeyboardViewportVisible(true, restoredHeight, 780)).toBe(false);
  });
});
