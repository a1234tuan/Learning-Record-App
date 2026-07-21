import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { type FocusEvent, useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import type { RecordAssetRef } from "../types";
import { AssetPreview } from "./AssetPreview";

const KATEX_CACHE_LIMIT = 256;
const katexHtmlCache = new Map<string, string>();
const queuedFormulaRenders = new Map<number, () => void>();
let formulaRenderSequence = 0;
let formulaRenderScheduled = false;

const cacheKeyFor = (latex: string, displayMode: boolean): string => `${displayMode ? "block" : "inline"}:${latex}`;

const cachedKaTeX = (latex: string, displayMode: boolean): string | undefined => {
  const key = cacheKeyFor(latex, displayMode);
  const cached = katexHtmlCache.get(key);
  if (cached !== undefined) {
    katexHtmlCache.delete(key);
    katexHtmlCache.set(key, cached);
  }
  return cached;
};

const scheduleFormulaRender = () => {
  if (formulaRenderScheduled || queuedFormulaRenders.size === 0) {
    return;
  }
  formulaRenderScheduled = true;
  const run = () => {
    formulaRenderScheduled = false;
    const next = queuedFormulaRenders.entries().next().value as [number, () => void] | undefined;
    if (next) {
      queuedFormulaRenders.delete(next[0]);
      next[1]();
    }
    scheduleFormulaRender();
  };
  if (typeof window !== "undefined") {
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      idle(run, { timeout: 100 });
      return;
    }
    window.setTimeout(run, 16);
  }
};

const enqueueFormulaRender = (render: () => void): (() => void) => {
  const id = ++formulaRenderSequence;
  queuedFormulaRenders.set(id, render);
  scheduleFormulaRender();
  return () => queuedFormulaRenders.delete(id);
};

const renderKaTeX = (latex: string, displayMode: boolean): string => {
  const key = cacheKeyFor(latex, displayMode);
  const cached = cachedKaTeX(latex, displayMode);
  if (cached !== undefined) {
    return cached;
  }

  let html = "";
  try {
    html = katex.renderToString(latex || " ", { throwOnError: false, displayMode });
  } catch {
    html = "";
  }
  katexHtmlCache.set(key, html);
  if (katexHtmlCache.size > KATEX_CACHE_LIMIT) {
    const oldestKey = katexHtmlCache.keys().next().value;
    if (oldestKey) {
      katexHtmlCache.delete(oldestKey);
    }
  }
  return html;
};

const useDeferredKaTeX = (latex: string, displayMode: boolean, immediate: boolean) => {
  const hostRef = useRef<HTMLElement | null>(null);
  const setHostRef = useCallback((element: HTMLElement | null) => {
    hostRef.current = element;
  }, []);
  const [html, setHtml] = useState<string | undefined>(() => cachedKaTeX(latex, displayMode));

  useEffect(() => {
    const cached = cachedKaTeX(latex, displayMode);
    if (cached !== undefined) {
      setHtml(cached);
      return undefined;
    }
    setHtml(undefined);
    let cancelled = false;
    let cancelQueuedRender: (() => void) | undefined;
    const render = () => {
      const rendered = renderKaTeX(latex, displayMode);
      if (!cancelled) {
        setHtml(rendered);
      }
    };
    if (immediate) {
      render();
      return () => {
        cancelled = true;
      };
    }

    const host = hostRef.current;
    if (typeof IntersectionObserver === "undefined" || !host) {
      cancelQueuedRender = enqueueFormulaRender(render);
      return () => {
        cancelled = true;
        cancelQueuedRender?.();
      };
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return;
      }
      observer.disconnect();
      cancelQueuedRender = enqueueFormulaRender(render);
    }, { rootMargin: "400px 0px" });
    observer.observe(host);
    return () => {
      cancelled = true;
      observer.disconnect();
      cancelQueuedRender?.();
    };
  }, [displayMode, immediate, latex]);

  return { hostRef: setHostRef, html };
};

type RecordAssetNodeOptions = {
  onAssetChanged?: () => void;
  onAssetTitleChange?: (assetId: string, title: string) => Promise<void> | void;
  onOpenImage?: (assetRef: RecordAssetRef, position: number) => void;
  highlightedAssetId?: string;
};

type RecordAssetNodeViewProps = NodeViewProps & {
  extensionOptions: RecordAssetNodeOptions;
};

const asAssetKind = (value: unknown): RecordAssetRef["kind"] =>
  value === "image" || value === "audio" || value === "attachment" ? value : "attachment";

const RecordAssetNodeView = ({ node, getPos, updateAttributes, extensionOptions, editor }: RecordAssetNodeViewProps) => {
  const assetRef: RecordAssetRef = {
    id: String(node.attrs.assetId ?? ""),
    kind: asAssetKind(node.attrs.kind),
    title: String(node.attrs.title ?? "资源"),
  };

  const editable = editor.isEditable;
  const getNodePosition = (): number | undefined => {
    try {
      const position = typeof getPos === "function" ? getPos() : getPos;
      return typeof position === "number" ? position : undefined;
    } catch {
      return undefined;
    }
  };

  const openImage = () => {
    const position = getNodePosition();
    if (assetRef.kind === "image" && position !== undefined) {
      extensionOptions.onOpenImage?.(assetRef, position);
    }
  };

  const deleteImage = () => {
    const position = getNodePosition();
    const paragraph = editor.state.schema.nodes.paragraph;
    if (assetRef.kind !== "image" || position === undefined || !paragraph) {
      return;
    }
    const transaction = editor.state.tr.replaceWith(position, position + node.nodeSize, paragraph.create());
    try {
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(position + 1), 1));
    } catch {
      // The replacement paragraph is still valid even if a nested container
      // maps the selection to a different boundary.
    }
    editor.view.dispatch(transaction.scrollIntoView());
  };

  return (
    <NodeViewWrapper className="record-inline-node">
      <AssetPreview
        assetRef={assetRef}
        mode={editable ? "edit" : "view"}
        editableTitle={editable ? assetRef.title : undefined}
        onTitleChange={editable ? (title) => updateAttributes({ title }) : undefined}
        onTitleCommit={editable ? (title) => void extensionOptions.onAssetTitleChange?.(assetRef.id, title) : undefined}
        onAssetChanged={extensionOptions.onAssetChanged}
        onOpenImage={assetRef.kind === "image" ? openImage : undefined}
        onDeleteImage={editable && assetRef.kind === "image" ? deleteImage : undefined}
        highlight={assetRef.id === extensionOptions.highlightedAssetId}
      />
    </NodeViewWrapper>
  );
};

const RecordFormulaNodeView = ({ node, updateAttributes, editor }: NodeViewProps) => {
  const title = String(node.attrs.title ?? "");
  const latex = String(node.attrs.latex ?? "");
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftLatex, setDraftLatex] = useState(latex);
  const { hostRef, html } = useDeferredKaTeX(latex, true, editing);

  useEffect(() => {
    if (!editing) {
      setDraftTitle(title);
      setDraftLatex(latex);
    }
  }, [editing, latex, title]);

  useEffect(() => {
    if (editable && node.attrs.editing) {
      setEditing(true);
    }
  }, [editable, node.attrs.editing]);

  const commit = () => {
    updateAttributes({ title: draftTitle, latex: draftLatex, editing: false });
    setEditing(false);
  };

  const cancel = () => {
    updateAttributes({ editing: false });
    setDraftTitle(title);
    setDraftLatex(latex);
    setEditing(false);
  };

  const commitOnBlur = (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof globalThis.Node && event.currentTarget.parentElement?.contains(nextTarget)) {
      return;
    }
    commit();
  };

  return (
    <NodeViewWrapper className="record-inline-node formula-editor-card" contentEditable={false} onClick={() => {
      if (editable && !editing) {
        setEditing(true);
      }
    }}>
      {editing ? (
        <>
          <input value={draftTitle} placeholder="公式标题" onChange={(event) => setDraftTitle(event.target.value)} onBlur={commitOnBlur} />
          <textarea
            autoFocus
            value={draftLatex}
            aria-label="块公式"
            onChange={(event) => setDraftLatex(event.target.value)}
            onBlur={commitOnBlur}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                commit();
              }
            }}
          />
        </>
      ) : (
        title && <strong>{title}</strong>
      )}
      <div ref={hostRef} className="formula-preview">
        {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code className="formula-render-pending">{latex}</code>}
      </div>
    </NodeViewWrapper>
  );
};

const RecordInlineMathNodeView = ({ node, updateAttributes, editor }: NodeViewProps) => {
  const latex = String(node.attrs.latex ?? "");
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);
  const [draftLatex, setDraftLatex] = useState(latex);
  const { hostRef, html } = useDeferredKaTeX(latex, false, editing);

  useEffect(() => {
    if (!editing) {
      setDraftLatex(latex);
    }
  }, [editing, latex]);

  useEffect(() => {
    if (editable && node.attrs.editing) {
      setEditing(true);
    }
  }, [editable, node.attrs.editing]);

  const commit = () => {
    updateAttributes({ latex: draftLatex, editing: false });
    setEditing(false);
  };

  const cancel = () => {
    updateAttributes({ editing: false });
    setDraftLatex(latex);
    setEditing(false);
  };

  return (
    <NodeViewWrapper as="span" className="record-inline-math" contentEditable={false} onClick={() => {
      if (editable && !editing) {
        setEditing(true);
      }
    }}>
      {editing ? (
        <input
          autoFocus
          aria-label="行内公式"
          value={draftLatex}
          onChange={(event) => setDraftLatex(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              commit();
            }
          }}
        />
      ) : html ? (
        <span ref={hostRef} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code ref={hostRef} className="formula-render-pending">{latex}</code>
      )}
    </NodeViewWrapper>
  );
};

export const RecordAssetNode = Node.create({
  name: "recordAsset",
  addOptions() {
    return {
      onAssetChanged: undefined,
      onAssetTitleChange: undefined,
      onOpenImage: undefined,
      highlightedAssetId: undefined,
    } satisfies RecordAssetNodeOptions;
  },
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      assetId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-asset-id") ?? "",
        renderHTML: (attributes) => ({ "data-asset-id": attributes.assetId }),
      },
      kind: {
        default: "attachment",
        parseHTML: (element) => element.getAttribute("data-kind") ?? "attachment",
        renderHTML: (attributes) => ({ "data-kind": attributes.kind }),
      },
      title: {
        default: "资源",
        parseHTML: (element) => element.getAttribute("data-title") ?? "资源",
        renderHTML: (attributes) => ({ "data-title": attributes.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-asset" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-asset", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    const extensionOptions = this.options as RecordAssetNodeOptions;
    return ReactNodeViewRenderer((props) => <RecordAssetNodeView {...props} extensionOptions={extensionOptions} />);
  },
});

export const RecordFormulaNode = Node.create({
  name: "recordFormula",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      formulaId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-formula-id") ?? "",
        renderHTML: (attributes) => ({ "data-formula-id": attributes.formulaId }),
      },
      title: {
        default: "公式",
        parseHTML: (element) => element.getAttribute("data-title") ?? "公式",
        renderHTML: (attributes) => ({ "data-title": attributes.title }),
      },
      latex: {
        default: "T(n)=O(n\\log n)",
        parseHTML: (element) => element.getAttribute("data-latex") ?? "T(n)=O(n\\log n)",
        renderHTML: (attributes) => ({ "data-latex": attributes.latex }),
      },
      editing: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-formula" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-formula", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecordFormulaNodeView);
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type !== this.type) {
          return false;
        }
        return this.editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, editing: true });
          return true;
        });
      },
    };
  },
});

export const RecordInlineMathNode = Node.create({
  name: "recordInlineMath",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      formulaId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-formula-id") ?? "",
        renderHTML: (attributes) => ({ "data-formula-id": attributes.formulaId }),
      },
      latex: {
        default: "x^2",
        parseHTML: (element) => element.getAttribute("data-latex") ?? "x^2",
        renderHTML: (attributes) => ({ "data-latex": attributes.latex }),
      },
      editing: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-inline-math" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-inline-math", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecordInlineMathNodeView);
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type !== this.type) {
          return false;
        }
        return this.editor.commands.command(({ tr }) => {
          tr.setNodeMarkup(selection.from, undefined, { ...selection.node.attrs, editing: true });
          return true;
        });
      },
    };
  },
});
