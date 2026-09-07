import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const collectTsxFiles = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectTsxFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });

describe("UI error boundary", () => {
  it("does not render caught raw error messages from pages or components", () => {
    const roots = [
      join(process.cwd(), "src", "pages"),
      join(process.cwd(), "src", "components"),
      join(process.cwd(), "src", "features", "reviewCoach"),
    ];
    const internalOnlyFiles = new Set([
      join(process.cwd(), "src", "components", "PlaybackProvider.tsx"),
    ]);
    const violations = roots
      .flatMap(collectTsxFiles)
      .filter((path) => !internalOnlyFiles.has(path))
      .filter((path) => /error\s+instanceof\s+Error\s*\?\s*error\.message|String\(error\)/.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(process.cwd().length + 1));

    expect(violations).toEqual([]);
  });
});
