import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { Check, ChevronDown, Highlighter, List, ListOrdered } from "lucide-react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import cpp from "highlight.js/lib/languages/cpp";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import { RecordAssetNode, RecordFormulaNode, RecordInlineMathNode } from "./RecordEditorNodes";
import {
  RecordCollapseBlockNode,
  RecordComparisonTableNode,
  RecordStickyBoardNode,
  RecordStructureDiagramNode,
} from "./RecordStructureNodes";
import {
  highlightToneOptions,
  normalizeHighlightTone,
  RecordHighlightBlockNode,
  type HighlightTone,
} from "./RecordHighlightBlockNode";
import { computePopoverPosition, type PopoverPosition } from "../lib/popoverPosition";
import { createPortal } from "react-dom";
import { clipboardImageFiles, readClipboardImageFallback, readClipboardTextFallback } from "../lib/clipboard";
import { looksLikeMarkdown, markdownToTiptapContent } from "../lib/markdownEditor";
import { MarkdownTypingExtension } from "../lib/markdownInputRules";
import { isNativePlatform } from "../lib/platform";

const lowlight = createLowlight();
lowlight.register("cpp", cpp);
lowlight.register("javascript", javascript);
lowlight.register("python", python);

const HIGHLIGHT_MENU_WIDTH = 188;
const HIGHLIGHT_MENU_ESTIMATED_HEIGHT = 142;

const findActiveHighlightBlock = (editor: Editor): { pos: number; node: ProseMirrorNode } | null => {
  const { selection } = editor.state;
  const selectedNode = "node" in selection ? (selection as { node?: ProseMirrorNode }).node : undefined;
  if (selectedNode?.type.name === "recordHighlightBlock") {
    return { pos: selection.from, node: selectedNode };
  }

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node.type.name === "recordHighlightBlock") {
      return { pos: selection.$from.before(depth), node };
    }
  }

  return null;
};

const applyHighlightTone = (editor: Editor, tone: HighlightTone) => {
  const activeHighlight = findActiveHighlightBlock(editor);
  if (activeHighlight) {
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(activeHighlight.pos, undefined, {
          ...activeHighlight.node.attrs,
          tone,
        });
        return true;
      })
      .run();
    return;
  }

  editor
    .chain()
    .focus()
    .insertContent({
      type: "recordHighlightBlock",
      attrs: { tone },
      content: [{ type: "paragraph" }],
    })
    .run();
};

const HighlightInsertMenu = ({ editor }: { editor: Editor }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pointerHandledRef = useRef(false);
  const activeTone = normalizeHighlightTone(findActiveHighlightBlock(editor)?.node.attrs.tone);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    setPosition(computePopoverPosition(trigger.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    }, {
      width: HIGHLIGHT_MENU_WIDTH,
      height: popoverRef.current?.offsetHeight ?? HIGHLIGHT_MENU_ESTIMATED_HEIGHT,
      align: "right",
    }));
  }, []);

  const toggleOpen = () => setOpen((value) => !value);
  const selectTone = (tone: HighlightTone) => {
    applyHighlightTone(editor, tone);
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
    <>
      <button
        ref={triggerRef}
        type="button"
        className={editor.isActive("recordHighlightBlock") ? "active" : ""}
        title="高亮块"
        aria-label="高亮块"
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
        <Highlighter size={16} />
        <ChevronDown size={12} />
      </button>
      {open && position && createPortal(
        <div
          ref={popoverRef}
          className="highlight-tone-popover highlight-insert-popover"
          data-placement={position.placement}
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            width: HIGHLIGHT_MENU_WIDTH,
            maxHeight: position.maxHeight,
          }}
        >
          {highlightToneOptions.map((option) => (
            <button
              key={option.tone}
              type="button"
              className={`highlight-tone-option highlight-${option.tone}`}
              aria-pressed={activeTone === option.tone}
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
              {activeTone === option.tone && <Check size={14} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  renderInsertTools?: (editor: Editor) => React.ReactNode;
  readOnly?: boolean;
  highlightedAssetId?: string;
  onAssetChanged?: () => void;
  onAssetTitleChange?: (assetId: string, title: string) => Promise<void> | void;
  onPasteImage?: (file: File) => Promise<{ id: string; kind: "image"; title: string } | undefined> | { id: string; kind: "image"; title: string } | undefined;
}

const replaceSelectionWithContent = (
  view: EditorView,
  content: unknown[],
) => {
  const nodes = content.map((item) => view.state.schema.nodeFromJSON(item));
  const transaction = view.state.tr.replaceSelection(Slice.maxOpen(Fragment.fromArray(nodes)));
  view.dispatch(transaction.scrollIntoView());
};

export const RichTextEditor = ({
  value,
  onChange,
  placeholder,
  renderInsertTools,
  readOnly = false,
  highlightedAssetId,
  onAssetChanged,
  onAssetTitleChange,
  onPasteImage,
}: RichTextEditorProps) => {
  const onPasteImageRef = useRef(onPasteImage);
  useEffect(() => {
    onPasteImageRef.current = onPasteImage;
  }, [onPasteImage]);

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      MarkdownTypingExtension,
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      RecordAssetNode.configure({ highlightedAssetId, onAssetChanged, onAssetTitleChange }),
      RecordFormulaNode,
      RecordInlineMathNode,
      RecordStructureDiagramNode,
      RecordComparisonTableNode,
      RecordStickyBoardNode,
      RecordCollapseBlockNode,
      RecordHighlightBlockNode,
      Placeholder.configure({
        placeholder: placeholder ?? "写下今天的学习、卡点、截图、公式或一点心得...",
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "rich-editor",
        draggable: "false",
      },
      handleDOMEvents: {
        dragstart: (_view, event) => {
          event.preventDefault();
          return true;
        },
      },
      handlePaste: (view, event) => {
        const clipboardData = event.clipboardData;
        const files = clipboardImageFiles(clipboardData);
        const markdown = clipboardData?.getData("text/markdown") || "";
        const plainText = clipboardData?.getData("text/plain") || "";
        const source = [markdown, plainText].find((value) => looksLikeMarkdown(value)) || plainText || markdown;
        const shouldParseMarkdown = looksLikeMarkdown(source);
        const hasImageClipboardItem = Array.from(clipboardData?.items ?? []).some((item) => item.type.startsWith("image/"));

        const insertPastedAsset = async (file: File) => {
          const asset = await onPasteImageRef.current?.(file);
          if (!asset || view.state.schema.nodeFromJSON === undefined) {
            return;
          }
          replaceSelectionWithContent(view, [
            {
              type: "recordAsset",
              attrs: { assetId: asset.id, kind: "image", title: asset.title },
            },
            { type: "paragraph" },
          ]);
        };

        if (shouldParseMarkdown) {
          try {
            const content = markdownToTiptapContent(view.state.schema as never, source);
            event.preventDefault();
            replaceSelectionWithContent(view, content);
            void Promise.all(files.map(insertPastedAsset));
            return true;
          } catch {
            return false;
          }
        }

        if (files.length > 0) {
          event.preventDefault();
          void Promise.all(files.map(insertPastedAsset));
          return true;
        }

        if (isNativePlatform() && !markdown && !plainText && !hasImageClipboardItem) {
          event.preventDefault();
          void readClipboardTextFallback().then(async (text) => {
            if (!text) {
              const image = await readClipboardImageFallback();
              if (image) {
                await insertPastedAsset(image);
              }
              return;
            }
            try {
              if (looksLikeMarkdown(text)) {
                replaceSelectionWithContent(view, markdownToTiptapContent(view.state.schema as never, text));
                return;
              }
            } catch {
              // Fall through to plain text so a malformed Markdown clipboard never loses content.
            }
            view.dispatch(view.state.tr.insertText(text).scrollIntoView());
          });
          return true;
        }

        const shouldReadClipboardImage = Boolean(
          onPasteImageRef.current &&
          !markdown &&
          !plainText &&
          ((clipboardData?.items?.length ?? 0) === 0 || hasImageClipboardItem),
        );
        if (shouldReadClipboardImage) {
          void readClipboardImageFallback().then((file) => {
            if (file) {
              return insertPastedAsset(file);
            }
            return undefined;
          });
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) {
    return null;
  }

  return (
    <div className={readOnly ? "editor-shell read-only" : "editor-shell"}>
      {!readOnly && (
        <div className="editor-toolbar" aria-label="编辑工具栏">
          <button type="button" title="加粗" onClick={() => editor.chain().focus().toggleBold().run()}>
            B
          </button>
          <button type="button" title="斜体" onClick={() => editor.chain().focus().toggleItalic().run()}>
            I
          </button>
          <button type="button" title="标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            H
          </button>
          <select
            className="editor-heading-select"
            aria-label="标题级别"
            value={[1, 2, 3, 4, 5, 6].find((level) => editor.isActive("heading", { level })) ?? 0}
            onChange={(event) => {
              const level = Number(event.target.value);
              if (level === 0) {
                editor.chain().focus().setParagraph().run();
                return;
              }
              editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
            }}
          >
            <option value={0}>正文</option>
            {[1, 2, 3, 4, 5, 6].map((level) => <option key={level} value={level}>H{level}</option>)}
          </select>
          <button
            type="button"
            className={editor.isActive("bulletList") ? "active" : ""}
            title="无序列表"
            aria-label="无序列表"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </button>
          <button
            type="button"
            className={editor.isActive("orderedList") ? "active" : ""}
            title="有序列表"
            aria-label="有序列表"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={16} />
          </button>
          <button type="button" className={editor.isActive("blockquote") ? "active" : ""} title="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            “”
          </button>
          <button type="button" title="代码" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            &lt;/&gt;
          </button>
          <HighlightInsertMenu editor={editor} />
          {renderInsertTools?.(editor)}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};
