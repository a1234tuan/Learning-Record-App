import { describe, expect, it } from "vitest";

import { sanitizeFileName } from "./assetDownloadService";

describe("sanitizeFileName", () => {
  it("removes path separators and invalid filename characters", () => {
    expect(sanitizeFileName("a/b\\c:*?\"<>|.pdf")).toBe("a_b_c_.pdf");
  });

  it("falls back when filename is empty", () => {
    expect(sanitizeFileName("   ")).toMatch(/^asset-/);
  });
});
