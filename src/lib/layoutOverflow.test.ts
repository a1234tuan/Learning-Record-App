import { describe, expect, it } from "vitest";

import { findHorizontalOverflowCandidates } from "./layoutOverflow";

describe("layoutOverflow", () => {
  it("reports elements whose scroll width exceeds their client width", () => {
    const root = document.createElement("div");
    const overflowing = document.createElement("section");
    overflowing.className = "wide-block";
    Object.defineProperty(overflowing, "scrollWidth", { configurable: true, value: 600 });
    Object.defineProperty(overflowing, "clientWidth", { configurable: true, value: 320 });
    root.append(overflowing);

    expect(findHorizontalOverflowCandidates(root)).toEqual([
      {
        selector: "section.wide-block",
        scrollWidth: 600,
        clientWidth: 320,
        allowed: false,
      },
    ]);
  });

  it("marks expected internal scrollers as allowed candidates", () => {
    const root = document.createElement("div");
    const scroller = document.createElement("div");
    scroller.className = "comparison-table-scroll";
    Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 680 });
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 320 });
    root.append(scroller);

    expect(findHorizontalOverflowCandidates(root, { allowedSelectors: [".comparison-table-scroll"] })).toEqual([
      {
        selector: "div.comparison-table-scroll",
        scrollWidth: 680,
        clientWidth: 320,
        allowed: true,
      },
    ]);
  });
});
