import { ChevronDown, Rows3, SquareStack, StickyNote, Workflow } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { StructureBlockKind } from "../lib/recordStructureBlocks";
import { computePopoverPosition, type PopoverPosition } from "../lib/popoverPosition";

interface StructureInsertMenuProps {
  onInsert: (kind: StructureBlockKind) => void;
  compact?: boolean;
}

const options: Array<{ kind: StructureBlockKind; label: string; description: string; icon: typeof Workflow }> = [
  { kind: "diagram", label: "结构图", description: "层级、主链、分叉", icon: Workflow },
  { kind: "comparison", label: "对照表", description: "概念、作用、类比、易错点", icon: Rows3 },
  { kind: "sticky", label: "便签板", description: "脑暴、疑问、例子", icon: StickyNote },
  { kind: "collapse", label: "折叠块", description: "先回忆，后展开验证", icon: SquareStack },
];

const POPOVER_WIDTH = 260;
const POPOVER_ESTIMATED_HEIGHT = 264;

export const StructureInsertMenu = ({ onInsert, compact = false }: StructureInsertMenuProps) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPosition(computePopoverPosition(rect, {
      width: window.innerWidth,
      height: window.innerHeight,
    }, {
      width: POPOVER_WIDTH,
      height: popoverRef.current?.offsetHeight ?? POPOVER_ESTIMATED_HEIGHT,
      align: compact ? "right" : "left",
    }));
  }, [compact]);

  const insert = (kind: StructureBlockKind) => {
    onInsert(kind);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (open) {
      updatePosition();
      const frame = window.requestAnimationFrame(updatePosition);
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  return (
    <span className={`structure-insert-menu${open ? " open" : ""}${compact ? " compact" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="structure-insert-trigger"
        title="结构块"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Workflow size={16} />
        {!compact && <span>结构</span>}
        <ChevronDown size={13} />
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          className="structure-insert-popover"
          data-placement={position.placement}
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            width: POPOVER_WIDTH,
            maxHeight: position.maxHeight,
          }}
        >
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button key={option.kind} type="button" onClick={() => insert(option.kind)}>
                <Icon size={17} />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
};
