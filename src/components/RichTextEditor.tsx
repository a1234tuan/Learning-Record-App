import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Fragment, Slice, type Node as ProseMirrorNode, type ResolvedPos } from "@tiptap/pm/model";
import * as pmView from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import { TextSelection, type SelectionBookmark } from "@tiptap/pm/state";
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
import {
  clipboardImageFiles,
  normalizeClipboardText,
  readClipboardImageFallback,
  readClipboardTextFallback,
  readNativeClipboardText,
} from "../lib/clipboard";
import {
  MAX_MARKDOWN_PASTE_LENGTH,
  markdownToTiptapContent,
  selectMarkdownPasteSources,
} from "../lib/markdownEditor";
import { applyComposedMarkdownTransform, MarkdownTypingExtension } from "../lib/markdownInputRules";
import { MarkdownLinkMark } from "../lib/markdownLinkMark";
import { isNativePlatform } from "../lib/platform";

const lowlight = createLowlight();
lowlight.register("cpp", cpp);
lowlight.register("javascript", javascript);
lowlight.register("python", python);

const HIGHLIGHT_MENU_WIDTH = 188;
const HIGHLIGHT_MENU_ESTIMATED_HEIGHT = 142;

const parseMarkdownPaste = (view: EditorView, source: string | undefined): unknown[] | undefined => {
  if (!source) {
    return undefined;
  }
  try {
    return markdownToTiptapContent(view.state.schema as never, source);
  } catch {
    return undefined;
  }
};

const parseFirstMarkdownPaste = (view: EditorView, sources: readonly (string | undefined)[]): unknown[] | undefined => {
  for (const source of selectMarkdownPasteSources(sources)) {
    const parsed = parseMarkdownPaste(view, source);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
};

type InternalClipboardParser = (
  view: EditorView,
  text: string,
  html: string | null,
  plainText: boolean,
  context: ResolvedPos,
) => Slice | null;

type ClipboardSnapshot = {
  markdown: string;
  plainText: string;
  htmlText: string;
  files: File[];
  hasImageClipboardItem: boolean;
};

const ANDROID_IME_PASTE_DEBOUNCE_MS = 120;
const ANDROID_IME_PASTE_GUARD_MS = 750;

type NativeInputPasteSession = {
  id: number;
  from: number;
  isPaste: boolean;
  revision: number;
};

const snapshotClipboardData = (clipboardData: DataTransfer | null | undefined): ClipboardSnapshot => ({
  markdown: clipboardData?.getData("text/markdown") || "",
  plainText: clipboardData?.getData("text/plain") || "",
  htmlText: clipboardData?.getData("text/html") || "",
  files: clipboardImageFiles(clipboardData),
  hasImageClipboardItem: Array.from(clipboardData?.items ?? []).some((item) => item.type.startsWith("image/")),
});

const clipboardTextsMatch = (left: string, right: string): boolean =>
  normalizeClipboardText(left).replace(/\n+$/, "") === normalizeClipboardText(right).replace(/\n+$/, "");

const parseClipboardSlice = (
  view: EditorView,
  text: string,
  html: string,
  plainText: boolean,
): Slice | undefined => {
  const parser = (pmView as unknown as { __parseFromClipboard?: InternalClipboardParser }).__parseFromClipboard;
  if (!parser || (!text && !html)) {
    return undefined;
  }
  try {
    return parser(view, text, html || null, plainText, view.state.selection.$from) ?? undefined;
  } catch {
    return undefined;
  }
};

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
  bookmark?: SelectionBookmark,
) => {
  const nodes = content.map((item) => view.state.schema.nodeFromJSON(item));
  const transaction = view.state.tr;
  if (bookmark) {
    transaction.setSelection(bookmark.resolve(view.state.doc));
  }
  transaction.replaceSelection(Slice.maxOpen(Fragment.fromArray(nodes)));
  view.dispatch(transaction.scrollIntoView());
};

const replaceRangeWithContent = (
  view: EditorView,
  content: unknown[],
  from: number,
  to: number,
) => {
  const nodes = content.map((item) => view.state.schema.nodeFromJSON(item));
  const transaction = view.state.tr
    .setSelection(TextSelection.create(view.state.doc, from, to))
    .replaceSelection(Slice.maxOpen(Fragment.fromArray(nodes)));
  view.dispatch(transaction.scrollIntoView());
};

const replaceSelectionWithSlice = (
  view: EditorView,
  slice: Slice,
  bookmark?: SelectionBookmark,
) => {
  const transaction = view.state.tr;
  if (bookmark) {
    transaction.setSelection(bookmark.resolve(view.state.doc));
  }
  transaction.replaceSelection(slice);
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
  const pasteRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const nativeInputSessionRef = useRef<NativeInputPasteSession | undefined>();
  const nativeInputSequenceRef = useRef(0);
  const nativeTypingTransformSuppressedRef = useRef(false);
  const nativeInputGuardTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const nativeInputDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  useEffect(() => {
    onPasteImageRef.current = onPasteImage;
  }, [onPasteImage]);
  useEffect(() => () => {
    mountedRef.current = false;
    if (nativeInputGuardTimeoutRef.current) {
      clearTimeout(nativeInputGuardTimeoutRef.current);
    }
    if (nativeInputDebounceTimeoutRef.current) {
      clearTimeout(nativeInputDebounceTimeoutRef.current);
    }
  }, []);

  const insertPastedAsset = async (view: EditorView, file: File, requestId?: number) => {
    const asset = await onPasteImageRef.current?.(file);
    if (
      !asset ||
      !mountedRef.current ||
      (requestId !== undefined && requestId !== pasteRequestRef.current)
    ) {
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

  const insertPastedAssets = async (view: EditorView, files: readonly File[], requestId?: number) => {
    for (const file of files) {
      await insertPastedAsset(view, file, requestId);
    }
  };

  const readNativeText = async (): Promise<string | undefined> => {
    const nativeText = await readNativeClipboardText();
    return nativeText || readClipboardTextFallback();
  };

  const processNativePaste = async (
    view: EditorView,
    clipboard: ClipboardSnapshot,
    bookmark = view.state.selection.getBookmark(),
    inputSession?: NativeInputPasteSession,
  ) => {
    const requestId = ++pasteRequestRef.current;
    const initialDoc = view.state.doc;
    let nativeText: string | undefined;
    try {
      nativeText = await readNativeText();
    } catch {
      nativeText = undefined;
    }

    if (!mountedRef.current || requestId !== pasteRequestRef.current) {
      return;
    }

    // Some Android WebViews report beforeinput as cancelable but still commit
    // the text. The input fallback will replace that raw range as one unit.
    if (inputSession && view.state.doc !== initialDoc) {
      return;
    }

    const targetBookmark = view.state.doc === initialDoc ? bookmark : undefined;
    const parsedMarkdown = parseFirstMarkdownPaste(view, [nativeText, clipboard.markdown, clipboard.plainText]);
    if (parsedMarkdown) {
      replaceSelectionWithContent(view, parsedMarkdown, targetBookmark);
    } else {
      const normalizedNativeText = nativeText ? normalizeClipboardText(nativeText) : "";
      const fallbackText = clipboard.plainText ? normalizeClipboardText(clipboard.plainText) : normalizedNativeText;
      const slice = (clipboard.htmlText || fallbackText.length <= MAX_MARKDOWN_PASTE_LENGTH)
        ? parseClipboardSlice(view, fallbackText, clipboard.htmlText, !clipboard.htmlText)
        : undefined;
      if (slice) {
        replaceSelectionWithSlice(view, slice, targetBookmark);
      } else if (fallbackText) {
        const transaction = view.state.tr;
        if (targetBookmark) {
          transaction.setSelection(targetBookmark.resolve(view.state.doc));
        }
        transaction.insertText(fallbackText);
        view.dispatch(transaction.scrollIntoView());
      }
    }

    if (inputSession) {
      releaseNativeInputSession(inputSession, false, view);
    }

    if (clipboard.files.length > 0) {
      await insertPastedAssets(view, clipboard.files, requestId);
      return;
    }
    if (
      onPasteImageRef.current &&
      (clipboard.hasImageClipboardItem || (!nativeText && !clipboard.plainText && !clipboard.htmlText))
    ) {
      const image = await readClipboardImageFallback();
      if (image && mountedRef.current && requestId === pasteRequestRef.current) {
        await insertPastedAsset(view, image, requestId);
      }
    }
  };

  const releaseNativeInputSession = (session: NativeInputPasteSession, replayTypingTransform: boolean, view: EditorView) => {
    if (nativeInputSessionRef.current?.id !== session.id) {
      return;
    }
    nativeInputSessionRef.current = undefined;
    nativeTypingTransformSuppressedRef.current = false;
    if (nativeInputGuardTimeoutRef.current) {
      clearTimeout(nativeInputGuardTimeoutRef.current);
      nativeInputGuardTimeoutRef.current = undefined;
    }
    if (nativeInputDebounceTimeoutRef.current) {
      clearTimeout(nativeInputDebounceTimeoutRef.current);
      nativeInputDebounceTimeoutRef.current = undefined;
    }
    if (replayTypingTransform) {
      applyComposedMarkdownTransform(view);
    }
  };

  const captureNativeInputSession = (view: EditorView, isPaste = false): NativeInputPasteSession | undefined => {
    if (!(view.state.selection instanceof TextSelection)) {
      return undefined;
    }
    const current = nativeInputSessionRef.current;
    if (current && view.state.selection.from >= current.from) {
      current.isPaste ||= isPaste;
      current.revision += 1;
      return current;
    }
    if (current) {
      releaseNativeInputSession(current, true, view);
    }
    const session: NativeInputPasteSession = {
      id: ++nativeInputSequenceRef.current,
      from: view.state.selection.from,
      isPaste,
      revision: 0,
    };
    nativeInputSessionRef.current = session;
    nativeTypingTransformSuppressedRef.current = true;
    if (nativeInputGuardTimeoutRef.current) {
      clearTimeout(nativeInputGuardTimeoutRef.current);
    }
    nativeInputGuardTimeoutRef.current = setTimeout(() => {
      releaseNativeInputSession(session, true, view);
    }, ANDROID_IME_PASTE_GUARD_MS);
    return session;
  };

  const finalizeNativeInputSession = (view: EditorView, session: NativeInputPasteSession) => {
    const revision = ++session.revision;
    if (nativeInputDebounceTimeoutRef.current) {
      clearTimeout(nativeInputDebounceTimeoutRef.current);
    }
    nativeInputDebounceTimeoutRef.current = setTimeout(() => {
      nativeInputDebounceTimeoutRef.current = undefined;
      void (async () => {
        if (!mountedRef.current || nativeInputSessionRef.current?.id !== session.id || session.revision !== revision) {
          return;
        }

        const to = view.state.selection.from;
        if (to < session.from) {
          releaseNativeInputSession(session, true, view);
          return;
        }
        const insertedText = normalizeClipboardText(view.state.doc.textBetween(session.from, to, "\n"));
        const insertedMarkdown = selectMarkdownPasteSources([insertedText])[0];
        if (!insertedMarkdown) {
          releaseNativeInputSession(session, false, view);
          return;
        }

        const requestId = ++pasteRequestRef.current;
        let nativeText: string | undefined;
        try {
          nativeText = await readNativeText();
        } catch {
          nativeText = undefined;
        }
        if (
          !mountedRef.current ||
          requestId !== pasteRequestRef.current ||
          nativeInputSessionRef.current?.id !== session.id ||
          session.revision !== revision
        ) {
          return;
        }

        const nativeMarkdown = selectMarkdownPasteSources([nativeText])[0];
        const parsedMarkdown = nativeMarkdown ? parseMarkdownPaste(view, nativeMarkdown) : undefined;
        if (!nativeMarkdown || !parsedMarkdown || !clipboardTextsMatch(insertedMarkdown, nativeMarkdown)) {
          releaseNativeInputSession(session, true, view);
          return;
        }

        replaceRangeWithContent(view, parsedMarkdown, session.from, to);
        releaseNativeInputSession(session, false, view);
      })();
    }, ANDROID_IME_PASTE_DEBOUNCE_MS);
  };

  const editor = useEditor({
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      MarkdownLinkMark,
      MarkdownTypingExtension.configure({
        shouldSkipInputTransform: () => nativeTypingTransformSuppressedRef.current,
      }),
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
        beforeinput: (view, event) => {
          if (!isNativePlatform()) {
            return false;
          }
          const inputEvent = event as InputEvent;
          if (inputEvent.isComposing || view.composing) {
            return false;
          }
          if (inputEvent.inputType === "insertFromPaste" || inputEvent.inputType === "insertFromPasteAsPlainText") {
            if (event.cancelable) {
              const session = captureNativeInputSession(view, true);
              event.preventDefault();
              void processNativePaste(view, snapshotClipboardData(inputEvent.dataTransfer), undefined, session);
              return true;
            }
            captureNativeInputSession(view, true);
            return false;
          }
          if (inputEvent.inputType === "insertText" || inputEvent.inputType === "insertReplacementText") {
            captureNativeInputSession(view);
          }
          return false;
        },
        input: (view, event) => {
          if (!isNativePlatform() || (event as InputEvent).isComposing) {
            return false;
          }
          const session = nativeInputSessionRef.current;
          if (session) {
            finalizeNativeInputSession(view, session);
          }
          return false;
        },
      },
      handlePaste: (view, event) => {
        if (isNativePlatform()) {
          event.preventDefault();
          const activeSession = nativeInputSessionRef.current;
          const session = activeSession?.isPaste ? activeSession : undefined;
          if (activeSession && !activeSession.isPaste) {
            releaseNativeInputSession(activeSession, false, view);
          }
          void processNativePaste(view, snapshotClipboardData(event.clipboardData), undefined, session);
          return true;
        }

        const clipboard = snapshotClipboardData(event.clipboardData);
        const parsedMarkdown = parseFirstMarkdownPaste(view, [clipboard.markdown, clipboard.plainText]);
        if (parsedMarkdown) {
          event.preventDefault();
          replaceSelectionWithContent(view, parsedMarkdown);
          void insertPastedAssets(view, clipboard.files);
          return true;
        }

        if (clipboard.files.length > 0) {
          void insertPastedAssets(view, clipboard.files);
          // Keep the browser's native text/HTML paste when Markdown parsing was
          // skipped or failed, then add the image assets without losing content.
          if (clipboard.markdown || clipboard.plainText || clipboard.htmlText) {
            return false;
          }
          event.preventDefault();
          return true;
        }

        const shouldReadClipboardImage = Boolean(
          onPasteImageRef.current &&
          !clipboard.markdown &&
          !clipboard.plainText &&
          ((event.clipboardData?.items?.length ?? 0) === 0 || clipboard.hasImageClipboardItem),
        );
        if (shouldReadClipboardImage) {
          void readClipboardImageFallback().then((file) => {
            if (file) {
              return insertPastedAsset(view, file);
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
