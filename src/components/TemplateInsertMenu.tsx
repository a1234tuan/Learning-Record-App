import { ChevronDown, LayoutTemplate } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ContentTemplate } from "../types";
import { computePopoverPosition, type PopoverPosition } from "../lib/popoverPosition";

interface TemplateInsertMenuProps {
  templates: readonly ContentTemplate[];
  onInsert: (template: ContentTemplate) => void;
  compact?: boolean;
  disabled?: boolean;
}

const POPOVER_WIDTH = 272;
const POPOVER_ESTIMATED_HEIGHT = 220;

export const TemplateInsertMenu = ({
  templates,
  onInsert,
  compact = false,
  disabled = false,
}: TemplateInsertMenuProps) => {
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

  const insert = (template: ContentTemplate) => {
    onInsert(template);
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
        title="插入模板"
        aria-label="插入模板"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <LayoutTemplate size={16} />
        {!compact && <span>模板</span>}
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
          {templates.length === 0 ? (
            <p className="template-insert-empty">还没有模板，可在“更多 - 模板”中新建。</p>
          ) : templates.map((template) => (
            <button key={template.id} type="button" onClick={() => insert(template)}>
              <LayoutTemplate size={17} />
              <span>
                <strong>{template.title}</strong>
                <small>插入到当前位置</small>
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  );
};
