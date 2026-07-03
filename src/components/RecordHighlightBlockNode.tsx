import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Check, ChevronDown, Highlighter, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { computePopoverPosition, type PopoverPosition } from "../lib/popoverPosition";

export type HighlightTone = "green" | "yellow" | "pink";

export const highlightToneOptions: Array<{ tone: HighlightTone; label: string }> = [
  { tone: "green", label: "浅绿色" },
  { tone: "yellow", label: "浅黄色" },
  { tone: "pink", label: "浅粉色" },
];

const POPOVER_WIDTH = 188;
const POPOVER_ESTIMATED_HEIGHT = 142;

export const normalizeHighlightTone = (value: unknown): HighlightTone =>
  value === "yellow" || value === "pink" ? value : "green";

export const HighlightToneMenu = ({
  tone,
  onToneChange,
}: {
  tone: HighlightTone;
  onToneChange: (tone: HighlightTone) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pointerHandledRef = useRef(false);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    setPosition(computePopoverPosition(trigger.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    }, {
      width: POPOVER_WIDTH,
      height: popoverRef.current?.offsetHeight ?? POPOVER_ESTIMATED_HEIGHT,
      align: "right",
    }));
  }, []);

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
      if (!(target instanceof globalThis.Node)) {
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

  const toggleOpen = () => setOpen((value) => !value);

  const selectTone = (nextTone: HighlightTone) => {
    onToneChange(nextTone);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="highlight-tone-trigger"
        title="高亮颜色"
        aria-label="高亮颜色"
        aria-expanded={open}
        onPointerDown={(event) => {
          event.preventDefault();
          pointerHandledRef.current = true;
          toggleOpen();
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          if (pointerHandledRef.current) {
            pointerHandledRef.current = false;
            return;
          }
          toggleOpen();
        }}
      >
        <span className={`highlight-tone-swatch highlight-${tone}`} />
        <ChevronDown size={13} />
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          className="highlight-tone-popover"
          data-placement={position.placement}
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            width: POPOVER_WIDTH,
            maxHeight: position.maxHeight,
          }}
        >
          {highlightToneOptions.map((option) => (
            <button
              key={option.tone}
              type="button"
              className={`highlight-tone-option highlight-${option.tone}`}
              aria-pressed={tone === option.tone}
              onPointerDown={(event) => {
                event.preventDefault();
                pointerHandledRef.current = true;
                selectTone(option.tone);
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault();
                if (pointerHandledRef.current) {
                  pointerHandledRef.current = false;
                  return;
                }
                selectTone(option.tone);
              }}
            >
              <span className={`highlight-tone-swatch highlight-${option.tone}`} />
              <span>{option.label}</span>
              {tone === option.tone && <Check size={14} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

const RecordHighlightBlockView = ({ node, editor, getPos, updateAttributes, selected }: NodeViewProps) => {
  const tone = normalizeHighlightTone(node.attrs.tone);
  const deleteBlock = useCallback(() => {
    if (typeof getPos !== "function") {
      return;
    }
    const pos = getPos();
    if (typeof pos !== "number") {
      return;
    }
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.delete(pos, pos + node.nodeSize);
        return true;
      })
      .run();
  }, [editor, getPos, node.nodeSize]);

  return (
    <NodeViewWrapper className={`record-highlight-block highlight-${tone}${selected ? " selected" : ""}`} data-tone={tone}>
      {editor.isEditable && (
        <div className="highlight-block-toolbar" contentEditable={false}>
          <Highlighter size={14} />
          <HighlightToneMenu tone={tone} onToneChange={(nextTone) => updateAttributes({ tone: nextTone })} />
          <button
            type="button"
            className="highlight-block-delete"
            title="删除高亮块"
            aria-label="删除高亮块"
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              deleteBlock();
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      <NodeViewContent className="highlight-block-content" />
    </NodeViewWrapper>
  );
};

export const RecordHighlightBlockNode = TiptapNode.create({
  name: "recordHighlightBlock",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      tone: {
        default: "green",
        parseHTML: (element) => normalizeHighlightTone(element.getAttribute("data-tone")),
        renderHTML: (attributes) => ({ "data-tone": normalizeHighlightTone(attributes.tone) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-highlight-block" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-highlight-block", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecordHighlightBlockView);
  },
});
