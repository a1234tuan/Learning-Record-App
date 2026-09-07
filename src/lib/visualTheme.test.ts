import { describe, expect, it, vi } from "vitest";

import { DEFAULT_VISUAL_THEME, normalizeVisualTheme, readVisualTheme, VISUAL_THEME_STORAGE_KEY, writeVisualTheme } from "./visualTheme";

describe("visualTheme", () => {
  it("defaults invalid and missing values to the reading theme", () => {
    expect(normalizeVisualTheme(undefined)).toBe(DEFAULT_VISUAL_THEME);
    expect(normalizeVisualTheme("unknown")).toBe("reading");
    expect(readVisualTheme({ getItem: () => null })).toBe("reading");
  });

  it("persists only the device-local visual preference", () => {
    const setItem = vi.fn();
    writeVisualTheme("modern", { setItem });
    expect(setItem).toHaveBeenCalledWith(VISUAL_THEME_STORAGE_KEY, "modern");
  });
});
