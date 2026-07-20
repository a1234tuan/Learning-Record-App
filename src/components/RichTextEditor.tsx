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
import java from "highlight.js/lib/languages/java";
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
  normalizeCodeLanguage,
  selectMarkdownPasteSources,
} from "../lib/markdownEditor";
import { applyComposedMarkdownTransform, MarkdownTypingExtension } from "../lib/markdownInputRules";
import { MarkdownLinkMark } from "../lib/markdownLinkMark";
import { isNativePlatform } from "../lib/platform";
import { TrailingEditableParagraph } from "../lib/trailingEditableParagraph";

const lowlight = createLowlight();
lowlight.register("cpp", cpp);
lowlight.register("java", java);
lowlight.register("javascript", javascript);
lowlight.register("python", python);

const HIGHLIGHT_MENU_WIDTH = 188;
const HIGHLIGHT_MENU_ESTIMATED_HEIGHT = 142;
const codeLanguageOptions = [
  { value: "", label: "纯文本" },
  { value: "cpp", label: "C++" },
  { value: "java", label: "Java" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
];

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

const parseMarkdownPasteScheduled = async (
  view: EditorView,
  source: string,
  cancelled: () => boolean = () => false,
): Promise<unknown[] | undefined> => {
  if (source.length > 64 * 1024) {
    await new Promise<void>((resolve) => {
      const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback;
      if (idle) {
        idle(resolve);
      } else {
        window.setTimeout(resolve, 0);
      }
    });
    if (cancelled()) {
      return undefined;
    }
  }
  return cancelled() ? undefined : parseMarkdownPaste(view, source);
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
const ANDROID_IME_PASTE_GUARD_MS = 2_000;
const ANDROID_IME_SESSION_CANCEL_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Delete",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

type ChangedDocumentRange = {
  from: number;
  to: number;
};

type NativeInputPasteSession = {
  id: number;
  initialDoc: ProseMirrorNode;
  changedRange?: ChangedDocumentRange;
  isPaste: boolean;
  revision: number;
  expectedMarkdown: string | null | undefined;
  clipboardReadPending: boolean;
};

type PasteAnchor = {
  requestId: number;
  doc: ProseMirrorNode;
  bookmark: SelectionBookmark;
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

const isClipboardTextPrefix = (partial: string, full: string): boolean => {
  const normalizedPartial = normalizeClipboardText(partial);
  const normalizedFull = normalizeClipboardText(full);
  return clipboardTextsMatch(normalizedPartial, normalizedFull) || normalizedFull.startsWith(normalizedPartial);
};

const withoutEmptyLines = (value: string): string =>
  normalizeClipboardText(value)
    .split("\n")
    .filter((line) => line.length > 0)
    .join("\n");

const clipboardTextsMatchWithImeLineBreaks = (left: string, right: string): boolean =>
  clipboardTextsMatch(left, right) || clipboardTextsMatch(withoutEmptyLines(left), withoutEmptyLines(right));

const isClipboardTextPrefixWithImeLineBreaks = (partial: string, full: string): boolean =>
  isClipboardTextPrefix(partial, full) || isClipboardTextPrefix(withoutEmptyLines(partial), withoutEmptyLines(full));

const findChangedDocumentRange = (
  initialDoc: ProseMirrorNode,
  currentDoc: ProseMirrorNode,
): ChangedDocumentRange | undefined => {
  const from = initialDoc.content.findDiffStart(currentDoc.content);
  const end = initialDoc.content.findDiffEnd(currentDoc.content);
  if (from === null || !end || end.b < from) {
    return undefined;
  }
  return { from, to: end.b };
};

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
  const docSize = view.state.doc.content.size;
  const rawFrom = Math.max(0, Math.min(from, docSize));
  const rawTo = Math.max(rawFrom, Math.min(to, docSize));
  let safeFrom = rawFrom;
  let safeTo = rawTo;
  try {
    const $from = view.state.doc.resolve(rawFrom);
    const $to = view.state.doc.resolve(rawTo);
    const sharedDepth = $from.sharedDepth(rawTo);
    if ($from.depth > sharedDepth) {
      safeFrom = $from.before(sharedDepth + 1);
    }
    if ($to.depth > sharedDepth) {
      safeTo = $to.after(sharedDepth + 1);
    }
  } catch {
    // Keep the clamped diff range when a native editor reports an invalid end.
  }
  const replacement = Slice.maxOpen(Fragment.fromArray(nodes));
  const transaction = view.state.tr.replace(safeFrom, safeTo, replacement);
  try {
    const cursor = Math.max(1, Math.min(transaction.doc.content.size, safeFrom + replacement.size));
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(cursor), -1));
  } catch {
    // A block-only replacement can leave no inline endpoint. ProseMirror's
    // mapped selection remains the safest fallback in that case.
  }
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
  const pasteAnchorRef = useRef<PasteAnchor | undefined>();
  const mountedRef = useRef(true);
  const nativeInputSessionRef = useRef<NativeInputPasteSession | undefined>();
  const nativeInputSequenceRef = useRef(0);
  const nativeTypingTransformSuppressedRef = useRef(false);
  const nativeTypingTransformSkipOnceRef = useRef(false);
  const nativeTypingTransformSkipTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const nativeInputGuardTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const nativeInputDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  useEffect(() => {
    onPasteImageRef.current = onPasteImage;
  }, [onPasteImage]);
  useEffect(() => () => {
    mountedRef.current = false;
    pasteRequestRef.current += 1;
    pasteAnchorRef.current = undefined;
    if (nativeInputGuardTimeoutRef.current) {
      clearTimeout(nativeInputGuardTimeoutRef.current);
    }
    if (nativeInputDebounceTimeoutRef.current) {
      clearTimeout(nativeInputDebounceTimeoutRef.current);
    }
    if (nativeTypingTransformSkipTimeoutRef.current) {
      clearTimeout(nativeTypingTransformSkipTimeoutRef.current);
    }
  }, []);

  const beginPasteOperation = (view: EditorView): PasteAnchor => {
    const requestId = ++pasteRequestRef.current;
    const anchor: PasteAnchor = {
      requestId,
      doc: view.state.doc,
      bookmark: view.state.selection.getBookmark(),
    };
    pasteAnchorRef.current = anchor;
    return anchor;
  };

  const isPasteAnchorCurrent = (view: EditorView, anchor: PasteAnchor): boolean => {
    if (!mountedRef.current || pasteAnchorRef.current?.requestId !== anchor.requestId || view.state.doc !== anchor.doc) {
      return false;
    }
    try {
      const expected = anchor.bookmark.resolve(view.state.doc);
      return view.state.selection.from === expected.from && view.state.selection.to === expected.to;
    } catch {
      return false;
    }
  };

  const cancelPendingPaste = (view?: EditorView) => {
    pasteRequestRef.current += 1;
    pasteAnchorRef.current = undefined;
    const session = nativeInputSessionRef.current;
    if (session && view) {
      releaseNativeInputSession(session, false, view);
    }
  };

  const insertPastedAsset = async (view: EditorView, file: File, anchor?: PasteAnchor) => {
    if (anchor && !isPasteAnchorCurrent(view, anchor)) {
      return;
    }
    const asset = await onPasteImageRef.current?.(file);
    if (
      !asset ||
      !mountedRef.current ||
      (anchor && !isPasteAnchorCurrent(view, anchor))
    ) {
      return;
    }
    replaceSelectionWithContent(view, [
      {
        type: "recordAsset",
        attrs: { assetId: asset.id, kind: "image", title: asset.title },
      },
      { type: "paragraph" },
    ], anchor?.bookmark);
    if (anchor) {
      const nextAnchor: PasteAnchor = {
        requestId: anchor.requestId,
        doc: view.state.doc,
        bookmark: view.state.selection.getBookmark(),
      };
      pasteAnchorRef.current = nextAnchor;
    }
  };

  const insertPastedAssets = async (view: EditorView, files: readonly File[], anchor?: PasteAnchor) => {
    for (const file of files) {
      await insertPastedAsset(view, file, anchor);
      if (anchor) {
        const currentAnchor = pasteAnchorRef.current;
        if (!currentAnchor || currentAnchor.requestId !== anchor.requestId) {
          return;
        }
        anchor = currentAnchor;
      }
    }
  };

  const readNativeText = async (): Promise<string | undefined> => {
    let timeout: number | undefined;
    const nativeText = await new Promise<string | undefined>((resolve) => {
      timeout = window.setTimeout(() => resolve(undefined), 1_500);
      void readNativeClipboardText().then(resolve, () => resolve(undefined));
    });
    if (timeout) {
      window.clearTimeout(timeout);
    }
    return nativeText || readClipboardTextFallback({ skipNative: true });
  };

  const processNativePaste = async (
    view: EditorView,
    clipboard: ClipboardSnapshot,
    inputSession?: NativeInputPasteSession,
  ) => {
    const anchor = beginPasteOperation(view);
    const requestId = anchor.requestId;
    const initialDoc = view.state.doc;
    let nativeText: string | undefined;
    try {
      nativeText = await readNativeText();
    } catch {
      nativeText = undefined;
    }

    if (!isPasteAnchorCurrent(view, anchor)) {
      return;
    }

    // Some Android WebViews report beforeinput as cancelable but still commit
    // the text. The input fallback will replace that raw range as one unit.
    if (inputSession && view.state.doc !== initialDoc) {
      return;
    }

    const targetBookmark = view.state.doc === initialDoc ? anchor.bookmark : undefined;
    if (!targetBookmark) {
      return;
    }
    const markdownSource = selectMarkdownPasteSources([nativeText, clipboard.markdown, clipboard.plainText])[0];
    const parsedMarkdown = markdownSource
      ? await parseMarkdownPasteScheduled(view, markdownSource, () => !isPasteAnchorCurrent(view, anchor))
      : undefined;
    if (!isPasteAnchorCurrent(view, anchor)) {
      return;
    }
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

    const assetAnchor: PasteAnchor = {
      requestId,
      doc: view.state.doc,
      bookmark: view.state.selection.getBookmark(),
    };
    pasteAnchorRef.current = assetAnchor;

    if (clipboard.files.length > 0) {
      await insertPastedAssets(view, clipboard.files, assetAnchor);
      return;
    }
    if (
      onPasteImageRef.current &&
      (clipboard.hasImageClipboardItem || (!nativeText && !clipboard.plainText && !clipboard.htmlText))
    ) {
      const image = await readClipboardImageFallback();
      if (image && isPasteAnchorCurrent(view, assetAnchor)) {
        await insertPastedAsset(view, image, assetAnchor);
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
      return;
    }
    nativeTypingTransformSkipOnceRef.current = true;
    if (nativeTypingTransformSkipTimeoutRef.current) {
      clearTimeout(nativeTypingTransformSkipTimeoutRef.current);
    }
    nativeTypingTransformSkipTimeoutRef.current = setTimeout(() => {
      nativeTypingTransformSkipOnceRef.current = false;
      nativeTypingTransformSkipTimeoutRef.current = undefined;
    }, 0);
  };

  const captureNativeInputSession = (view: EditorView, isPaste = false): NativeInputPasteSession | undefined => {
    if (!(view.state.selection instanceof TextSelection)) {
      return undefined;
    }
    const current = nativeInputSessionRef.current;
    if (current) {
      current.isPaste ||= isPaste;
      current.revision += 1;
      return current;
    }
    const session: NativeInputPasteSession = {
      id: ++nativeInputSequenceRef.current,
      initialDoc: view.state.doc,
      isPaste,
      revision: 0,
      expectedMarkdown: undefined,
      clipboardReadPending: false,
    };
    nativeInputSessionRef.current = session;
    nativeTypingTransformSuppressedRef.current = true;
    if (nativeInputGuardTimeoutRef.current) {
      clearTimeout(nativeInputGuardTimeoutRef.current);
    }
    nativeInputGuardTimeoutRef.current = setTimeout(() => {
      releaseNativeInputSession(session, false, view);
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
        if (
          !mountedRef.current ||
          nativeInputSessionRef.current?.id !== session.id ||
          session.revision !== revision
        ) {
          return;
        }

        const changedRange = findChangedDocumentRange(session.initialDoc, view.state.doc);
        if (!changedRange) {
          return;
        }
        session.changedRange = changedRange;

        if (session.expectedMarkdown === undefined) {
          if (session.clipboardReadPending) {
            return;
          }
          session.clipboardReadPending = true;
          let nativeText: string | undefined;
          try {
            nativeText = await readNativeText();
          } catch {
            nativeText = undefined;
          }
          if (!mountedRef.current || nativeInputSessionRef.current?.id !== session.id) {
            return;
          }
          session.clipboardReadPending = false;
          session.expectedMarkdown = selectMarkdownPasteSources([nativeText])[0] ?? null;
          finalizeNativeInputSession(view, session);
          return;
        }

        const expectedMarkdown = session.expectedMarkdown;
        if (!expectedMarkdown) {
          releaseNativeInputSession(session, true, view);
          return;
        }

        const insertedText = normalizeClipboardText(view.state.doc.textBetween(changedRange.from, changedRange.to, "\n"));
        if (!isClipboardTextPrefixWithImeLineBreaks(insertedText, expectedMarkdown)) {
          releaseNativeInputSession(session, true, view);
          return;
        }

        if (!clipboardTextsMatchWithImeLineBreaks(insertedText, expectedMarkdown)) {
          return;
        }

        const parsedMarkdown = await parseMarkdownPasteScheduled(
          view,
          expectedMarkdown,
          () => nativeInputSessionRef.current?.id !== session.id || session.revision !== revision,
        );
        if (nativeInputSessionRef.current?.id !== session.id || session.revision !== revision) {
          return;
        }
        if (!parsedMarkdown) {
          releaseNativeInputSession(session, true, view);
          return;
        }
        replaceRangeWithContent(view, parsedMarkdown, changedRange.from, changedRange.to);
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
        shouldSkipInputTransform: () => nativeTypingTransformSuppressedRef.current || nativeTypingTransformSkipOnceRef.current,
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
      TrailingEditableParagraph,
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
        pointerdown: (view) => {
          cancelPendingPaste(view);
          return false;
        },
        touchstart: (view) => {
          cancelPendingPaste(view);
          return false;
        },
        keydown: (view, event) => {
          if (pasteAnchorRef.current || (isNativePlatform() && ANDROID_IME_SESSION_CANCEL_KEYS.has((event as KeyboardEvent).key))) {
            cancelPendingPaste(view);
          }
          return false;
        },
        beforeinput: (view, event) => {
          const inputEvent = event as InputEvent;
          if (!isNativePlatform()) {
            if (pasteAnchorRef.current && inputEvent.inputType !== "insertFromPaste" && inputEvent.inputType !== "insertFromPasteAsPlainText") {
              cancelPendingPaste(view);
            }
            return false;
          }
          if (inputEvent.isComposing || view.composing) {
            return false;
          }
          if (inputEvent.inputType === "insertFromPaste" || inputEvent.inputType === "insertFromPasteAsPlainText") {
            if (event.cancelable) {
              const session = captureNativeInputSession(view, true);
              event.preventDefault();
              void processNativePaste(view, snapshotClipboardData(inputEvent.dataTransfer), session);
              return true;
            }
            captureNativeInputSession(view, true);
            return false;
          }
          if (inputEvent.inputType === "insertText" || inputEvent.inputType === "insertReplacementText") {
            if (pasteAnchorRef.current) {
              cancelPendingPaste(view);
            }
            captureNativeInputSession(view);
          }
          return false;
        },
        input: (view, event) => {
          if (!isNativePlatform() || (event as InputEvent).isComposing) {
            return false;
          }
          const session = nativeInputSessionRef.current;
          const pendingPaste = pasteAnchorRef.current;
          if (pendingPaste && view.state.doc !== pendingPaste.doc && !session) {
            cancelPendingPaste(view);
          }
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
          void processNativePaste(view, snapshotClipboardData(event.clipboardData), session);
          return true;
        }

        const clipboard = snapshotClipboardData(event.clipboardData);
        const markdownSource = selectMarkdownPasteSources([clipboard.markdown, clipboard.plainText])[0];
        if (markdownSource) {
          event.preventDefault();
          if (markdownSource.length <= 64 * 1024) {
            const parsedMarkdown = parseMarkdownPaste(view, markdownSource);
            if (parsedMarkdown) {
              replaceSelectionWithContent(view, parsedMarkdown);
            } else {
              view.dispatch(view.state.tr.insertText(normalizeClipboardText(markdownSource)).scrollIntoView());
            }
            const anchor: PasteAnchor = {
              requestId: ++pasteRequestRef.current,
              doc: view.state.doc,
              bookmark: view.state.selection.getBookmark(),
            };
            pasteAnchorRef.current = anchor;
            void insertPastedAssets(view, clipboard.files, anchor);
            return true;
          }
          const initialDoc = view.state.doc;
          const anchor = beginPasteOperation(view);
          const rawTransaction = view.state.tr;
          rawTransaction.setSelection(anchor.bookmark.resolve(view.state.doc));
          rawTransaction.insertText(normalizeClipboardText(markdownSource));
          view.dispatch(rawTransaction.scrollIntoView());
          const rawRange = findChangedDocumentRange(initialDoc, view.state.doc);
          if (!rawRange) {
            return true;
          }
          const rawAnchor: PasteAnchor = {
            requestId: anchor.requestId,
            doc: view.state.doc,
            bookmark: view.state.selection.getBookmark(),
          };
          pasteAnchorRef.current = rawAnchor;
          void (async () => {
            const parsedMarkdown = await parseMarkdownPasteScheduled(view, markdownSource, () => !isPasteAnchorCurrent(view, rawAnchor));
            if (!isPasteAnchorCurrent(view, rawAnchor)) {
              return;
            }
            if (parsedMarkdown) {
              replaceRangeWithContent(view, parsedMarkdown, rawRange.from, rawRange.to);
            }
            const assetAnchor: PasteAnchor = {
              requestId: rawAnchor.requestId,
              doc: view.state.doc,
              bookmark: view.state.selection.getBookmark(),
            };
            pasteAnchorRef.current = assetAnchor;
            await insertPastedAssets(view, clipboard.files, assetAnchor);
          })();
          return true;
        }

        if (clipboard.files.length > 0) {
          const hasTextOrHtml = Boolean(clipboard.markdown || clipboard.plainText || clipboard.htmlText);
          const anchor = beginPasteOperation(view);
          // Keep the browser's native text/HTML paste when Markdown parsing was
          // skipped or failed, then anchor image insertion after that paste.
          if (hasTextOrHtml) {
            window.setTimeout(() => {
              if (pasteRequestRef.current !== anchor.requestId || !mountedRef.current) {
                return;
              }
              const postPasteAnchor: PasteAnchor = {
                requestId: anchor.requestId,
                doc: view.state.doc,
                bookmark: view.state.selection.getBookmark(),
              };
              pasteAnchorRef.current = postPasteAnchor;
              void insertPastedAssets(view, clipboard.files, postPasteAnchor);
            }, 0);
            return false;
          }
          void insertPastedAssets(view, clipboard.files, anchor);
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
          const anchor = beginPasteOperation(view);
          void readClipboardImageFallback().then((file) => {
            if (file && isPasteAnchorCurrent(view, anchor)) {
              return insertPastedAsset(view, file, anchor);
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
    if (!readOnly) {
      editor.commands.ensureTrailingEditableParagraph();
    }
  }, [editor, readOnly, value]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  if (!editor) {
    return null;
  }

  const codeLanguage = normalizeCodeLanguage(String(editor.getAttributes("codeBlock").language ?? "")) ?? "";

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
          <button type="button" className={editor.isActive("codeBlock") ? "active" : ""} title="代码块" aria-label="代码块" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            &lt;/&gt;
          </button>
          <select
            className="editor-code-language-select"
            aria-label="代码块语言"
            value={codeLanguage}
            onChange={(event) => {
              const language = normalizeCodeLanguage(event.target.value);
              const codeBlockLanguage = language ?? "plaintext";
              if (editor.isActive("codeBlock")) {
                editor.chain().focus().updateAttributes("codeBlock", { language: codeBlockLanguage }).run();
                return;
              }
              editor.chain().focus().setCodeBlock({ language: codeBlockLanguage }).run();
            }}
          >
            {codeLanguageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <HighlightInsertMenu editor={editor} />
          {renderInsertTools?.(editor)}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
};
