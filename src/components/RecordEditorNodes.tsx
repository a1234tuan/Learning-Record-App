import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { type FocusEvent, useEffect, useMemo, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import type { RecordAssetRef } from "../types";
import { AssetPreview } from "./AssetPreview";

const KATEX_CACHE_LIMIT = 256;
const katexHtmlCache = new Map<string, string>();

const renderKaTeX = (latex: string, displayMode: boolean): string => {
  const key = `${displayMode ? "block" : "inline"}:${latex}`;
  const cached = katexHtmlCache.get(key);
  if (cached !== undefined) {
    katexHtmlCache.delete(key);
    katexHtmlCache.set(key, cached);
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

type RecordAssetNodeOptions = {
  onAssetChanged?: () => void;
  onAssetTitleChange?: (assetId: string, title: string) => Promise<void> | void;
  highlightedAssetId?: string;
};

type RecordAssetNodeViewProps = NodeViewProps & {
  extensionOptions: RecordAssetNodeOptions;
};

const asAssetKind = (value: unknown): RecordAssetRef["kind"] =>
  value === "image" || value === "audio" || value === "attachment" ? value : "attachment";

const RecordAssetNodeView = ({ node, updateAttributes, extensionOptions, editor }: RecordAssetNodeViewProps) => {
  const assetRef: RecordAssetRef = {
    id: String(node.attrs.assetId ?? ""),
    kind: asAssetKind(node.attrs.kind),
    title: String(node.attrs.title ?? "资源"),
  };

  const editable = editor.isEditable;

  return (
    <NodeViewWrapper className="record-inline-node">
      <AssetPreview
        assetRef={assetRef}
        mode={editable ? "edit" : "view"}
        editableTitle={editable ? assetRef.title : undefined}
        onTitleChange={editable ? (title) => updateAttributes({ title }) : undefined}
        onTitleCommit={editable ? (title) => void extensionOptions.onAssetTitleChange?.(assetRef.id, title) : undefined}
        onAssetChanged={extensionOptions.onAssetChanged}
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
  const html = useMemo(() => renderKaTeX(latex, true), [latex]);

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
      <div className="formula-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  );
};

const RecordInlineMathNodeView = ({ node, updateAttributes, editor }: NodeViewProps) => {
  const latex = String(node.attrs.latex ?? "");
  const html = useMemo(() => renderKaTeX(latex, false), [latex]);
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);
  const [draftLatex, setDraftLatex] = useState(latex);

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
        <span dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <code>{latex}</code>
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
