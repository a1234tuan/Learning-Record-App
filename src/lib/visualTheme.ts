export type VisualTheme = "modern" | "reading";

export const VISUAL_THEME_STORAGE_KEY = "study-journal-visual-theme-v1";
export const DEFAULT_VISUAL_THEME: VisualTheme = "reading";

export const normalizeVisualTheme = (value: unknown): VisualTheme =>
  value === "modern" || value === "reading" ? value : DEFAULT_VISUAL_THEME;

export const readVisualTheme = (storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): VisualTheme => {
  if (!storage) return DEFAULT_VISUAL_THEME;
  try {
    return normalizeVisualTheme(storage.getItem(VISUAL_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_VISUAL_THEME;
  }
};

export const writeVisualTheme = (theme: VisualTheme, storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): void => {
  try {
    storage?.setItem(VISUAL_THEME_STORAGE_KEY, theme);
  } catch {
    // Appearance remains usable even when browser storage is unavailable.
  }
};
