import { act, render, waitFor } from "@testing-library/react";
import katex from "katex";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeferredMathMarkup, renderCellMarkup, renderKaTeX } from "./DeferredMath";

describe("DeferredMath", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders inline and block table math while preserving Markdown code spans", () => {
    const inline = renderCellMarkup("`$code$`、\\$escaped 和 $x^2$", true);
    const block = renderCellMarkup("$$\n\\int_0^1 x^2\\,dx\n$$", true);

    expect(inline).toContain("<code>$code$</code>");
    expect(inline).toContain("katex");
    expect(block).toContain("katex-display");
  });

  it("caches repeated KaTeX output", () => {
    const renderSpy = vi.spyOn(katex, "renderToString");
    const source = "cache_unique_formula_98765";

    renderKaTeX(source, false);
    renderKaTeX(source, false);

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  it("waits for an observed cell before rendering its formula", async () => {
    const observers: Array<{ callback: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }> = [];
    const originalObserver = globalThis.IntersectionObserver;
    class TestIntersectionObserver {
      readonly disconnect = vi.fn();
      constructor(readonly callback: IntersectionObserverCallback) {
        observers.push(this);
      }
      observe = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => [] as IntersectionObserverEntry[]);
      root = null;
      rootMargin = "400px 0px";
      thresholds = [0];
    }
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });
    const renderSpy = vi.spyOn(katex, "renderToString");
    const source = "$deferred_visibility_formula_54321$";
    const { container } = render(<DeferredMathMarkup source={source} markdown />);

    expect(container.querySelector(".formula-render-pending")).toHaveTextContent(source);
    expect(renderSpy).not.toHaveBeenCalled();

    act(() => {
      observers[0].callback([{ isIntersecting: true }] as IntersectionObserverEntry[], observers[0] as unknown as IntersectionObserver);
    });

    await waitFor(() => expect(container.querySelector(".katex")).toBeInTheDocument());
    Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: originalObserver });
  });
});
