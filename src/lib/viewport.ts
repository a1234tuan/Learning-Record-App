export interface ViewportHeightInput {
  native: boolean;
  innerHeight: number;
  visualViewportHeight?: number | null;
}

const validHeight = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Uses the layout viewport on native resize-based WebViews and the visual viewport on the web. */
export const resolveViewportHeight = ({ native, innerHeight, visualViewportHeight }: ViewportHeightInput): number => {
  const preferred = native ? innerHeight : visualViewportHeight;
  const height = validHeight(preferred) ? preferred : innerHeight;
  return validHeight(height) ? Math.round(height) : 0;
};

export const nextKeyboardBaselineHeight = (baselineHeight: number, currentHeight: number, activeEditable: boolean): number => {
  if (!validHeight(currentHeight)) {
    return baselineHeight;
  }
  return !activeEditable || currentHeight >= baselineHeight ? currentHeight : baselineHeight;
};

export const isKeyboardViewportVisible = (
  activeEditable: boolean,
  baselineHeight: number,
  currentHeight: number,
  threshold = 120,
): boolean => activeEditable && validHeight(baselineHeight) && validHeight(currentHeight) && baselineHeight - currentHeight > threshold;
