import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const normalizeCss = (css: string) => css.replace(/\r\n/g, "\n");
const stylesCss = normalizeCss(readFileSync(join(process.cwd(), "src", "styles.css"), "utf8"));
const pagesCss = normalizeCss(readFileSync(join(process.cwd(), "src", "styles", "pages.css"), "utf8"));

describe("AI markdown styles", () => {
  it("keeps AI message text selectable on mobile WebView", () => {
    expect(stylesCss).toContain(".ai-markdown *");
    expect(stylesCss).toContain("-webkit-user-select: text");
    expect(stylesCss).toContain("-webkit-touch-callout: default");
    expect(pagesCss).toContain(".ai-markdown,\n.ai-markdown *");
  });

  it("uses visible selection colors for assistant and user bubbles", () => {
    expect(stylesCss).toContain(".ai-markdown *::selection");
    expect(stylesCss).toContain("background: rgba(47, 111, 94, 0.32)");
    expect(stylesCss).toContain(".ai-bubble-row.user .ai-markdown *::selection");
    expect(stylesCss).toContain("background: rgba(255, 255, 255, 0.38)");
    expect(pagesCss).toContain(".ai-bubble-row.user .ai-markdown *::selection");
  });

  it("allows KaTeX, tables and code blocks to scroll horizontally", () => {
    expect(stylesCss).toContain(".ai-markdown .katex-display");
    expect(stylesCss).toContain(".ai-markdown table");
    expect(stylesCss).toContain(".ai-markdown pre");
    expect(stylesCss).toContain("overflow-x: auto");
    expect(stylesCss).toContain("-webkit-overflow-scrolling: touch");
  });
});
