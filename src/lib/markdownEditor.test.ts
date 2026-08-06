import { describe, expect, it } from "vitest";

import { normalizeCodeLanguage } from "./markdownEditor";

describe("normalizeCodeLanguage", () => {
  it("returns null for blank or plaintext markers", () => {
    expect(normalizeCodeLanguage(undefined)).toBeNull();
    expect(normalizeCodeLanguage(null)).toBeNull();
    expect(normalizeCodeLanguage("  ")).toBeNull();
    expect(normalizeCodeLanguage("plain")).toBeNull();
    expect(normalizeCodeLanguage("plaintext")).toBeNull();
    expect(normalizeCodeLanguage("TEXT")).toBeNull();
  });

  it("keeps javascript and typescript distinct instead of collapsing ts into js", () => {
    expect(normalizeCodeLanguage("js")).toBe("javascript");
    expect(normalizeCodeLanguage("javascript")).toBe("javascript");
    expect(normalizeCodeLanguage("node")).toBe("javascript");
    expect(normalizeCodeLanguage("ts")).toBe("typescript");
    expect(normalizeCodeLanguage("TypeScript")).toBe("typescript");
  });

  it("maps common aliases to their canonical lowlight language id", () => {
    expect(normalizeCodeLanguage("c++")).toBe("cpp");
    expect(normalizeCodeLanguage("cxx")).toBe("cpp");
    expect(normalizeCodeLanguage("c#")).toBe("csharp");
    expect(normalizeCodeLanguage("golang")).toBe("go");
    expect(normalizeCodeLanguage("rs")).toBe("rust");
    expect(normalizeCodeLanguage("sh")).toBe("bash");
    expect(normalizeCodeLanguage("zsh")).toBe("bash");
    expect(normalizeCodeLanguage("html")).toBe("xml");
    expect(normalizeCodeLanguage("kt")).toBe("kotlin");
    expect(normalizeCodeLanguage("rb")).toBe("ruby");
    expect(normalizeCodeLanguage("yml")).toBe("yaml");
  });

  it("falls back to the normalized string for unknown languages", () => {
    expect(normalizeCodeLanguage("Lua")).toBe("lua");
  });
});
