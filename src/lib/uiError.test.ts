import { describe, expect, it } from "vitest";

import { formatUiError, normalizeUiError } from "./uiError";

describe("uiError", () => {
  it("never exposes a raw IndexedDB error to the user", () => {
    const raw = new Error("DexieError QuotaExceeded records secret-token prompt-body");
    const result = formatUiError(raw, "review-rating");

    expect(result).toContain("复习评分失败");
    expect(result).toContain("诊断编号");
    expect(result).not.toContain("Dexie");
    expect(result).not.toContain("secret-token");
    expect(result).not.toContain("prompt-body");
  });

  it("uses context-specific recovery copy and a short diagnostic id", () => {
    const result = normalizeUiError(new DOMException("database closed", "InvalidStateError"), "record-save");

    expect(result.message).toContain("本机草稿");
    expect(result.diagnosticId).toMatch(/^RS-[A-Z0-9]{8}$/);
  });
});
