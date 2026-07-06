import { Download, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

import type { Asset } from "../types";
import { downloadAsset } from "../services/assetDownloadService";
import {
  clampImageScale,
  clampImageTransform,
  getContainedImageSize,
  nextDoubleTapTransform,
  panImageTransform,
  zoomImageAtPoint,
  type ImageTransform,
  type Point,
  type Size,
} from "../lib/imageTransform";

interface ImageLightboxProps {
  asset: Asset;
  url: string;
  title: string;
  onClose: () => void;
  onStatus?: (message: string) => void;
}

const initialTransform: ImageTransform = { scale: 1, x: 0, y: 0 };

const distance = (first: Point, second: Point): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

const midpoint = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

const hasMeasuredSize = (size: Size): boolean => size.width > 0 && size.height > 0;

export const getLightboxViewportSize = (visualViewport?: Pick<VisualViewport, "width" | "height"> | null): Size => ({
  width: Math.max(0, visualViewport?.width ?? window.innerWidth),
  height: Math.max(0, visualViewport?.height ?? window.innerHeight),
});

export const constrainLightboxViewport = (rect: Size, visualViewport?: Pick<VisualViewport, "width" | "height"> | null): Size => {
  const viewport = getLightboxViewportSize(visualViewport);
  return {
    width: Math.max(0, Math.min(rect.width, viewport.width)),
    height: Math.max(0, Math.min(rect.height, viewport.height)),
  };
};

export const getLightboxStageViewport = (
  visualViewport: Pick<VisualViewport, "width" | "height"> | null | undefined,
  toolbarHeight: number,
): Size => {
  const fullViewport = getLightboxViewportSize(visualViewport);
  return {
    width: fullViewport.width,
    height: Math.max(0, fullViewport.height - Math.max(0, toolbarHeight)),
  };
};

export const ImageLightbox = ({ asset, url, title, onClose, onStatus }: ImageLightboxProps) => {
  const [transform, setTransform] = useState<ImageTransform>(initialTransform);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<Size>({ width: 0, height: 0 });
  const [interacting, setInteracting] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionRef = useRef({ x: 0, y: 0 });
  const transformRef = useRef<ImageTransform>(initialTransform);
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<{
    mode: "pan" | "pinch" | null;
    startDistance: number;
    startCenter: Point;
    startPoint: Point;
    startTransform: ImageTransform;
  }>({
    mode: null,
    startDistance: 0,
    startCenter: { x: 0, y: 0 },
    startPoint: { x: 0, y: 0 },
    startTransform: initialTransform,
  });

  const imageSize = useMemo(() => getContainedImageSize(naturalSize, viewport), [naturalSize, viewport]);
  const imageReady = hasMeasuredSize(viewport) && hasMeasuredSize(imageSize);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: event.clientX, y: event.clientY };
    }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const clampNext = useCallback(
    (next: ImageTransform) => clampImageTransform(next, viewport, imageSize),
    [imageSize, viewport],
  );

  const resetToCenter = useCallback(() => {
    transformRef.current = initialTransform;
    pointersRef.current.clear();
    gestureRef.current.mode = null;
    setInteracting(false);
    setTransform(initialTransform);
  }, []);

  useEffect(() => {
    scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
  }, []);

  const closePreservingScroll = useCallback(() => {
    const { x, y } = scrollPositionRef.current;
    onClose();
    window.requestAnimationFrame(() => {
      window.scrollTo(x, y);
    });
  }, [onClose]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return undefined;
    }
    let remove: (() => Promise<void>) | undefined;
    let cancelled = false;
    void CapacitorApp.addListener("backButton", () => {
      closePreservingScroll();
    }).then((handle) => {
      remove = handle.remove;
      if (cancelled) {
        void handle.remove();
      }
    });
    return () => {
      cancelled = true;
      if (remove) {
        void remove();
      }
    };
  }, [closePreservingScroll]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    const updateViewport = () => {
      const toolbarHeight = toolbarRef.current?.getBoundingClientRect().height ?? 0;
      setViewport(getLightboxStageViewport(window.visualViewport, toolbarHeight));
    };
    updateViewport();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewport);
      window.visualViewport?.addEventListener("resize", updateViewport);
      return () => {
        window.removeEventListener("resize", updateViewport);
        window.visualViewport?.removeEventListener("resize", updateViewport);
      };
    }
    const observer = new ResizeObserver(updateViewport);
    observer.observe(stage);
    if (toolbarRef.current) {
      observer.observe(toolbarRef.current);
    }
    window.visualViewport?.addEventListener("resize", updateViewport);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!imageReady) {
      return;
    }
    setTransform((current) => {
      if (current.scale <= 1) {
        return initialTransform;
      }
      return clampNext(current);
    });
  }, [clampNext, imageReady]);

  useEffect(() => {
    setNaturalSize({ width: 0, height: 0 });
    resetToCenter();
  }, [resetToCenter, url]);

  const resetRemainingPointerGesture = () => {
    const remaining = Array.from(pointersRef.current.values())[0];
    if (!remaining) {
      gestureRef.current.mode = null;
      setInteracting(false);
      return;
    }
    gestureRef.current = {
      mode: "pan",
      startDistance: 0,
      startCenter: remaining,
      startPoint: remaining,
      startTransform: transformRef.current,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageReady) {
      return;
    }
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, point);
    setInteracting(true);

    const pointers = Array.from(pointersRef.current.values());
    if (pointers.length >= 2) {
      const [first, second] = pointers;
      gestureRef.current = {
        mode: "pinch",
        startDistance: distance(first, second),
        startCenter: midpoint(first, second),
        startPoint: point,
        startTransform: transformRef.current,
      };
      return;
    }

    gestureRef.current = {
      mode: "pan",
      startDistance: 0,
      startCenter: point,
      startPoint: point,
      startTransform: transformRef.current,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageReady) {
      return;
    }
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    const point = pointFromEvent(event);
    pointersRef.current.set(event.pointerId, point);
    const pointers = Array.from(pointersRef.current.values());
    const gesture = gestureRef.current;

    if (pointers.length >= 2 && gesture.mode === "pinch" && gesture.startDistance > 0) {
      const [first, second] = pointers;
      const center = midpoint(first, second);
      const nextScale = clampImageScale(gesture.startTransform.scale * (distance(first, second) / gesture.startDistance));
      const anchored = zoomImageAtPoint(gesture.startTransform, nextScale, gesture.startCenter, viewport, imageSize);
      setTransform(clampNext({
        ...anchored,
        x: anchored.x + center.x - gesture.startCenter.x,
        y: anchored.y + center.y - gesture.startCenter.y,
      }));
      return;
    }

    if (pointers.length === 1 && gesture.mode === "pan" && gesture.startTransform.scale > 1) {
      setTransform(panImageTransform(
        gesture.startTransform,
        { x: point.x - gesture.startPoint.x, y: point.y - gesture.startPoint.y },
        viewport,
        imageSize,
      ));
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    resetRemainingPointerGesture();
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!imageReady) {
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setTransform((current) => nextDoubleTapTransform(current, point, viewport, imageSize));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!imageReady) {
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const multiplier = event.deltaY < 0 ? 1.12 : 0.88;
    setTransform((current) => zoomImageAtPoint(current, current.scale * multiplier, point, viewport, imageSize));
  };

  const lightbox = (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={title}>
      <div ref={toolbarRef} className="image-lightbox-toolbar">
        <strong>{title}</strong>
        <div>
          <button
            type="button"
            className="icon-button"
            title="下载"
            onClick={async () => {
              try {
                onStatus?.(await downloadAsset(asset));
              } catch (error) {
                onStatus?.(error instanceof Error ? error.message : "下载失败。");
              }
            }}
          >
            <Download size={18} />
          </button>
          <button type="button" className="icon-button" title="关闭" aria-label="关闭" onClick={closePreservingScroll}>
            <X size={18} />
          </button>
        </div>
      </div>
      <div
        ref={stageRef}
        className="image-lightbox-stage"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      >
        <img
          src={url}
          alt={title}
          style={{
            width: imageReady ? `${imageSize.width}px` : undefined,
            height: imageReady ? `${imageSize.height}px` : undefined,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
            opacity: imageReady ? 1 : 0,
            transition: interacting ? "none" : "transform 120ms ease, opacity 80ms ease",
          }}
          onLoad={(event) => {
            setNaturalSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
            resetToCenter();
          }}
          draggable={false}
        />
      </div>
    </div>
  );

  return createPortal(lightbox, document.body);
};
