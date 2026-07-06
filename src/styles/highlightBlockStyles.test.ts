import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const stylesCss = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
const themeCss = readFileSync(join(process.cwd(), "src", "styles", "theme.css"), "utf8");
const pagesCss = readFileSync(join(process.cwd(), "src", "styles", "pages.css"), "utf8");

const tones = ["green", "yellow", "pink"] as const;

const cssBlockFor = (css: string, selector: string): string => {
  const escapedSelector = selector.replaceAll(".", "\\.");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`).exec(css);
  if (!match) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }
  return match[1];
};

const expectNoHorizontalClipping = (css: string, selector: string) => {
  const body = cssBlockFor(css, selector);

  expect(body).not.toMatch(/overflow-x\s*:\s*(?:clip|hidden)\b/);
};

const expectNoContentWidthSizing = (css: string, selector: string) => {
  const body = cssBlockFor(css, selector);

  expect(body).not.toMatch(/\bwidth\s*:\s*(?:fit-content|max-content)\b/);
  expect(body).not.toMatch(/\bmin-width\s*:\s*max-content\b/);
};

describe("highlight block styles", () => {
  it("uses stable theme tokens for highlight backgrounds in light and dark themes", () => {
    for (const tone of tones) {
      expect(themeCss).toContain(`--highlight-${tone}-bg:`);
      expect(themeCss).toContain(`--highlight-${tone}-border:`);
      expect(themeCss).toContain(`--highlight-${tone}-swatch:`);
    }
  });

  it("does not use color-mix as the final highlight block background", () => {
    for (const tone of tones) {
      const body = cssBlockFor(stylesCss, `.record-highlight-block.highlight-${tone}`);

      expect(body).toContain(`background-color: var(--highlight-${tone}-bg`);
      expect(body).toContain(`border-color: var(--highlight-${tone}-border`);
      expect(body).toContain("background-image: none");
      expect(body).not.toContain("color-mix");
      expect(body).not.toMatch(/\bbackground\s*:/);
    }
  });

  it("adds editor-scoped Android-safe fallback rules after page editor styles load", () => {
    for (const tone of tones) {
      const body = cssBlockFor(pagesCss, `.rich-editor .record-highlight-block.highlight-${tone}`);

      expect(body).toContain(`background-color: var(--highlight-${tone}-bg`);
      expect(body).toContain("!important");
      expect(body).toContain("background-image: none !important");
      expect(body).not.toContain("color-mix");
    }
  });

  it("keeps wide record structures inside their own horizontal scrollers", () => {
    const flowBody = cssBlockFor(stylesCss, ".structure-flow-view");
    const chainBody = cssBlockFor(stylesCss, ".structure-flow-chain");
    const comparisonBody = cssBlockFor(stylesCss, ".comparison-table-scroll");
    const comparisonPanelBody = cssBlockFor(stylesCss, ".comparison-panel-view");
    const rightScrollBody = cssBlockFor(stylesCss, ".comparison-table-right-scroll");
    const structureBody = cssBlockFor(stylesCss, ".structure-block");

    expect(flowBody).toContain("max-width: 100%");
    expect(flowBody).toContain("inline-size: 100%");
    expect(flowBody).toContain("overflow-x: auto");
    expect(flowBody).toContain("overscroll-behavior-x: contain");
    expect(flowBody).toContain("touch-action: pan-x pan-y");
    expect(flowBody).toContain("contain: layout paint");
    expect(flowBody).not.toContain("overflow-y: hidden");
    expect(chainBody).toContain("width: max-content");
    expect(chainBody).toContain("max-width: none");
    expect(comparisonBody).toContain("max-width: 100%");
    expect(comparisonBody).toContain("inline-size: 100%");
    expect(comparisonBody).toContain("overflow-x: visible");
    expect(comparisonBody).toContain("overscroll-behavior-x: contain");
    expect(comparisonBody).toContain("touch-action: pan-x pan-y");
    expect(comparisonBody).toContain("position: relative");
    expect(comparisonBody).toContain("isolation: isolate");
    expect(comparisonBody).not.toContain("overflow-y: hidden");
    expect(comparisonPanelBody).toContain("display: grid");
    expect(comparisonPanelBody).toContain("grid-template-columns: minmax(150px, 38%) minmax(0, 1fr)");
    expect(rightScrollBody).toContain("overflow-x: auto");
    expect(rightScrollBody).toContain("touch-action: pan-x pan-y");
    expect(structureBody).toContain("contain: inline-size");
  });

  it("keeps comparison first-column cells outside the scrolling layer", () => {
    const cellBody = cssBlockFor(stylesCss, ".comparison-grid-cell");
    const stickyBody = cssBlockFor(stylesCss, ".comparison-grid-cell.sticky-column");
    const stickyHeadBody = cssBlockFor(stylesCss, ".comparison-grid-head.sticky-column");
    const fixedPanelBody = cssBlockFor(stylesCss, ".comparison-fixed-panel");
    const scrollPanelBody = cssBlockFor(stylesCss, ".comparison-scroll-panel");
    const scrollGridRowBody = cssBlockFor(stylesCss, ".comparison-scroll-grid-row");

    expect(cellBody).toContain("position: relative");
    expect(cellBody).toContain("z-index: 1");
    expect(cellBody).toContain("background: var(--surface)");
    expect(fixedPanelBody).toContain("z-index: 2");
    expect(scrollPanelBody).toContain("overflow: hidden");
    expect(scrollGridRowBody).toContain("grid-template-columns: repeat(var(--comparison-scroll-column-count), minmax(150px, 260px))");
    expect(scrollGridRowBody).toContain("width: max-content");
    expect(stickyBody).not.toContain("position: sticky");
    expect(stickyBody).not.toContain("left: 0");
    expect(stickyBody).toContain("z-index: 10");
    expect(stickyBody).toContain("background-clip: padding-box");
    expect(stickyHeadBody).toContain("z-index: 20");
    expect(stylesCss).not.toContain(".comparison-table-view th,\n.comparison-table-view td");
    expect(stylesCss).not.toContain(".comparison-row-scroll");
  });

  it("keeps rich editor node wrappers from sizing the whole page by their content", () => {
    for (const selector of [
      ".record-inline-node",
      ".asset-card-view",
      ".image-preview-button",
      ".compact-image-button",
      ".collapse-block-content",
      ".structure-flow-branch",
    ]) {
      expectNoContentWidthSizing(stylesCss, selector);
    }

    expect(cssBlockFor(stylesCss, ".record-inline-node")).toContain("inline-size: 100%");
    expect(cssBlockFor(stylesCss, ".collapse-block-content")).toContain("inline-size: 100%");
    expect(cssBlockFor(stylesCss, ".asset-card-view")).toContain("inline-size: 100%");
    expect(cssBlockFor(stylesCss, ".structure-block")).toContain("display: block");
    expect(cssBlockFor(stylesCss, ".record-highlight-block")).toContain("inline-size: 100%");
  });

  it("limits max-content sizing to inner wide-content canvases", () => {
    const allowedSelectors = new Set([".structure-flow-chain", ".comparison-scroll-grid-row"]);
    const selectorMatches = Array.from(stylesCss.matchAll(/(^|\n)\s*([^{}\n]+)\s*\{([^{}]*(?:width|min-width)\s*:\s*max-content[^{}]*)\}/g));
    const recordStructureSelectors = selectorMatches
      .map((match) => ({
        selector: match[2].trim(),
        body: match[3],
      }))
      .filter(({ selector }) => /structure|comparison|collapse|sticky|asset|record-inline|image-preview/.test(selector));

    for (const { selector, body } of recordStructureSelectors) {
      const selectors = selector.split(",").map((item) => item.trim());
      const allowed = selectors.every((item) => allowedSelectors.has(item));
      expect(allowed, `${selector} should not use max-content outside inner scroll canvases:\n${body}`).toBe(true);
    }
  });

  it("does not horizontally clip record page ancestors or top actions", () => {
    expect(stylesCss).not.toMatch(/html,\s*body\s*\{[^}]*overflow-x\s*:\s*(?:clip|hidden)\b/s);

    for (const selector of [".record-editor-topbar", ".record-action-row", ".structure-block", ".sticky-board-view", ".comparison-table-scroll", ".structure-flow-view"]) {
      expectNoHorizontalClipping(stylesCss, selector);
    }
    for (const selector of [".record-editor-page", ".record-view-page", ".editor-shell", ".rich-editor", ".record-editor-topbar"]) {
      expectNoHorizontalClipping(pagesCss, selector);
    }
  });

  it("keeps the record topbar single-line so it does not cover the editor toolbar", () => {
    const topbarBody = cssBlockFor(stylesCss, ".record-editor-topbar");
    const actionBody = cssBlockFor(stylesCss, ".record-action-row");

    expect(topbarBody).not.toContain("flex-wrap");
    expect(actionBody).not.toContain("flex-wrap");
  });

  it("renders image preview as a viewport-sized fixed overlay", () => {
    const lightboxBody = cssBlockFor(stylesCss, ".image-lightbox");
    const stageBody = cssBlockFor(stylesCss, ".image-lightbox-stage");

    expect(lightboxBody).toContain("position: fixed");
    expect(lightboxBody).toContain("inset: 0");
    expect(lightboxBody).not.toMatch(/\bwidth\s*:\s*100d?vw\b/);
    expect(lightboxBody).not.toMatch(/\bheight\s*:\s*100d?vh\b/);
    expect(lightboxBody).toContain("overflow: hidden");
    expect(stageBody).not.toMatch(/max-width\s*:\s*100d?vw\b/);
    expect(stylesCss).not.toContain("image-lightbox-open");
  });
});
