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
});
