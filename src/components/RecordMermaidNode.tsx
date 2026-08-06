import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { AlertTriangle, Code2, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const DEFAULT_MERMAID_SOURCE = "graph TD\n  A[开始] --> B{判断条件}\n  B -->|是| C[处理]\n  B -->|否| D[结束]";

type MermaidRenderApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidRenderApi> | undefined;

// mermaid.js is a large dependency only a subset of users will ever touch; load it lazily so it
// never inflates the main editor bundle, and only pay the cost once a diagram actually mounts.
const loadMermaid = (): Promise<MermaidRenderApi> => {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => {
      const mermaid = module.default as unknown as MermaidRenderApi;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
      return mermaid;
    });
  }
  return mermaidPromise;
};

const svgCache = new Map<string, string>();
let renderCounter = 0;

const RecordMermaidNodeView = ({ node, updateAttributes, editor, selected }: NodeViewProps) => {
  const source = String(node.attrs.source ?? "");
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(Boolean(editable && node.attrs.editing));
  const [draft, setDraft] = useState(source);
  const [svg, setSvg] = useState<string | undefined>(() => svgCache.get(source));
  const [error, setError] = useState<string>();
  const renderIdRef = useRef("");
  if (!renderIdRef.current) {
    renderCounter += 1;
    renderIdRef.current = `record-mermaid-${renderCounter}`;
  }

  useEffect(() => {
    if (!editing) {
      setDraft(source);
    }
  }, [editing, source]);

  useEffect(() => {
    if (editable && node.attrs.editing) {
      setEditing(true);
    }
  }, [editable, node.attrs.editing]);

  useEffect(() => {
    if (editing) {
      return undefined;
    }
    if (!source.trim()) {
      setSvg(undefined);
      setError(undefined);
      return undefined;
    }
    const cached = svgCache.get(source);
    if (cached !== undefined) {
      setSvg(cached);
      setError(undefined);
      return undefined;
    }
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => mermaid.render(renderIdRef.current, source))
      .then(({ svg: rendered }) => {
        if (cancelled) {
          return;
        }
        svgCache.set(source, rendered);
        setSvg(rendered);
        setError(undefined);
      })
      .catch((renderError: unknown) => {
        if (cancelled) {
          return;
        }
        setSvg(undefined);
        setError(renderError instanceof Error ? renderError.message : "流程图语法有误，无法渲染");
      });
    return () => {
      cancelled = true;
    };
  }, [editing, source]);

  const commit = () => {
    updateAttributes({ source: draft, editing: false });
    setEditing(false);
  };

  const cancel = () => {
    updateAttributes({ editing: false });
    setDraft(source);
    setEditing(false);
  };

  return (
    <NodeViewWrapper className={`structure-block mermaid-block${selected ? " selected" : ""}`} data-structure-kind="mermaid">
      {editable && (
        <div className="structure-block-toolbar" contentEditable={false}>
          <button type="button" title={editing ? "预览流程图" : "编辑源码"} onClick={() => (editing ? commit() : setEditing(true))}>
            {editing ? <Eye size={14} /> : <Code2 size={14} />}
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          className="mermaid-source-editor"
          aria-label="Mermaid 流程图源码"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
      ) : error ? (
        <div className="mermaid-render-error" contentEditable={false}>
          <span className="mermaid-render-error-message">
            <AlertTriangle size={14} />
            {error}
          </span>
          <pre>{source}</pre>
        </div>
      ) : svg ? (
        <div className="mermaid-preview" contentEditable={false} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className="formula-render-pending" contentEditable={false}>{source}</pre>
      )}
    </NodeViewWrapper>
  );
};

export const RecordMermaidNode = Node.create({
  name: "recordMermaidDiagram",
  group: "block",
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      source: {
        default: DEFAULT_MERMAID_SOURCE,
        parseHTML: (element) => element.getAttribute("data-source") ?? "",
        renderHTML: (attributes) => ({ "data-source": attributes.source }),
      },
      editing: {
        default: false,
        parseHTML: () => false,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-mermaid-diagram" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-mermaid-diagram", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecordMermaidNodeView);
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
