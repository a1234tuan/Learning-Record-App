export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

export const clampImageScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number.isFinite(scale) ? scale : MIN_SCALE));

export const getContainedImageSize = (natural: Size, viewport: Size): Size => {
  if (natural.width <= 0 || natural.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(viewport.width / natural.width, viewport.height / natural.height, 1);
  return {
    width: natural.width * ratio,
    height: natural.height * ratio,
  };
};

export const clampImageTransform = (transform: ImageTransform, viewport: Size, image: Size): ImageTransform => {
  const scale = clampImageScale(transform.scale);
  if (scale <= 1 || viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) {
    return { scale: 1, x: 0, y: 0 };
  }

  const overflowX = Math.max(0, (image.width * scale - viewport.width) / 2);
  const overflowY = Math.max(0, (image.height * scale - viewport.height) / 2);
  return {
    scale,
    x: Math.min(overflowX, Math.max(-overflowX, transform.x)),
    y: Math.min(overflowY, Math.max(-overflowY, transform.y)),
  };
};

export const zoomImageAtPoint = (
  current: ImageTransform,
  targetScale: number,
  anchor: Point,
  viewport: Size,
  image: Size,
): ImageTransform => {
  const nextScale = clampImageScale(targetScale);
  const previousScale = clampImageScale(current.scale);
  if (nextScale <= 1) {
    return { scale: 1, x: 0, y: 0 };
  }

  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const anchorOffset = { x: anchor.x - center.x, y: anchor.y - center.y };
  const ratio = nextScale / previousScale;
  const next = {
    scale: nextScale,
    x: current.x * ratio + anchorOffset.x * (1 - ratio),
    y: current.y * ratio + anchorOffset.y * (1 - ratio),
  };
  return clampImageTransform(next, viewport, image);
};

export const panImageTransform = (
  current: ImageTransform,
  delta: Point,
  viewport: Size,
  image: Size,
): ImageTransform =>
  clampImageTransform({
    ...current,
    x: current.x + delta.x,
    y: current.y + delta.y,
  }, viewport, image);

export const nextDoubleTapTransform = (
  current: ImageTransform,
  anchor: Point,
  viewport: Size,
  image: Size,
): ImageTransform =>
  current.scale > 1 ? { scale: 1, x: 0, y: 0 } : zoomImageAtPoint(current, DOUBLE_TAP_SCALE, anchor, viewport, image);
