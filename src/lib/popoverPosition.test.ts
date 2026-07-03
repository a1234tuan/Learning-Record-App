import { describe, expect, it } from "vitest";

import { computePopoverPosition } from "./popoverPosition";

const rect = (patch: Partial<DOMRect>): DOMRect => ({
  x: 0,
  y: 0,
  width: 100,
  height: 36,
  top: 0,
  right: 100,
  bottom: 36,
  left: 0,
  toJSON: () => ({}),
  ...patch,
});

describe("computePopoverPosition", () => {
  it("places tall popovers above the trigger when there is not enough room below", () => {
    const position = computePopoverPosition(
      rect({ top: 430, bottom: 466, left: 220, right: 320 }),
      { width: 420, height: 500 },
      { width: 188, height: 180, align: "right" },
    );

    expect(position.placement).toBe("top");
    expect(position.top).toBeGreaterThanOrEqual(8);
    expect(position.top + 180).toBeLessThanOrEqual(430);
  });

  it("clamps horizontal position inside the viewport", () => {
    const position = computePopoverPosition(
      rect({ top: 80, bottom: 116, left: 360, right: 400 }),
      { width: 390, height: 700 },
      { width: 220, height: 140 },
    );

    expect(position.left).toBeLessThanOrEqual(390 - 220 - 8);
    expect(position.left).toBeGreaterThanOrEqual(8);
  });
});
