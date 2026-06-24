import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

interface PageTransitionProps {
  pageKey: string;
  children: ReactNode;
}

type TransitionLayer = {
  id: number;
  pageKey: string;
  children: ReactNode;
  state: "entering" | "exiting";
};

export const PAGE_TRANSITION_DURATION_MS = 240;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const PageTransition = ({ pageKey, children }: PageTransitionProps) => {
  const nextLayerId = useRef(1);
  const activePageKey = useRef(pageKey);
  const cleanupTimer = useRef<number | null>(null);
  const [layers, setLayers] = useState<TransitionLayer[]>([
    { id: 0, pageKey, children, state: "entering" },
  ]);

  useEffect(() => {
    if (activePageKey.current === pageKey) {
      setLayers((current) =>
        current.map((layer) =>
          layer.state === "exiting" ? layer : { ...layer, pageKey, children },
        ),
      );
      return;
    }

    activePageKey.current = pageKey;
    const id = nextLayerId.current;
    nextLayerId.current += 1;

    setLayers((current) => {
      const activeLayer = current.find((layer) => layer.state !== "exiting") ?? current[current.length - 1];
      const exitingLayer = activeLayer ? { ...activeLayer, state: "exiting" as const } : undefined;
      return [
        ...(exitingLayer ? [exitingLayer] : []),
        { id, pageKey, children, state: "entering" as const },
      ];
    });

    if (cleanupTimer.current) {
      window.clearTimeout(cleanupTimer.current);
    }
    cleanupTimer.current = window.setTimeout(
      () => {
        setLayers((current) => current.filter((layer) => layer.state !== "exiting"));
        cleanupTimer.current = null;
      },
      prefersReducedMotion() ? 0 : PAGE_TRANSITION_DURATION_MS,
    );
  }, [children, pageKey]);

  useEffect(
    () => () => {
      if (cleanupTimer.current) {
        window.clearTimeout(cleanupTimer.current);
      }
    },
    [],
  );

  return (
    <div className="page-transition-frame">
      {layers.map((layer) => (
        <div
          key={layer.id}
          className={`page-transition-layer page-transition-layer-${layer.state}`}
          aria-hidden={layer.state === "exiting" ? true : undefined}
        >
          {layer.children}
        </div>
      ))}
    </div>
  );
};
