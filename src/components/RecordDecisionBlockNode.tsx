import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { DOMSerializer, Fragment } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Copy, RotateCcw, Target, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  newDecisionBlockId,
  type PendingDecisionBlockRemoval,
} from "../features/reviewCoach/decisionBlockContent";
import { nowISO } from "../lib/date";

export interface RecordDecisionBlockOptions {
  onRemove: (removal: PendingDecisionBlockRemoval) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    recordDecisionBlock: {
      insertDecisionBlock: () => ReturnType;
      wrapSelectionInDecisionBlock: () => ReturnType;
    };
  }
}

const serializeNode = (node: NodeViewProps["node"], editor: NodeViewProps["editor"]): string => {
  const container = document.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeNode(node));
  return container.innerHTML;
};

const findDecisionBlockDepth = (editor: NodeViewProps["editor"]): number | undefined => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "recordDecisionBlock") return depth;
  }
  return undefined;
};

const RecordDecisionBlockView = ({ node, editor, getPos, selected, extension }: NodeViewProps) => {
  const decisionBlockId = String(node.attrs.decisionBlockId ?? "");
  const [selectionInside, setSelectionInside] = useState(false);

  useEffect(() => {
    const updateSelectionInside = () => {
      if (typeof getPos !== "function") {
        setSelectionInside(false);
        return;
      }
      const pos = getPos();
      const { from, to } = editor.state.selection;
      setSelectionInside(typeof pos === "number" && from > pos && to < pos + node.nodeSize);
    };
    updateSelectionInside();
    editor.on("selectionUpdate", updateSelectionInside);
    return () => {
      editor.off("selectionUpdate", updateSelectionInside);
    };
  }, [editor, getPos, node.nodeSize]);

  const remove = useCallback((reason: PendingDecisionBlockRemoval["reason"], keepContent: boolean) => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    extension.options.onRemove({ decisionBlockId, reason, contentHtml: serializeNode(node, editor) });
    editor.chain().focus().command(({ tr }) => {
      if (keepContent) {
        tr.replaceWith(pos, pos + node.nodeSize, Fragment.from(node.content));
      } else {
        tr.delete(pos, pos + node.nodeSize);
      }
      return true;
    }).run();
  }, [decisionBlockId, editor, extension.options, getPos, node]);

  const copy = useCallback(() => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const stamp = nowISO();
    const duplicate = node.type.create({
      ...node.attrs,
      decisionBlockId: newDecisionBlockId(),
      contentVersion: 1,
      createdAt: stamp,
      updatedAt: stamp,
    }, node.content, node.marks);
    editor.chain().focus().command(({ tr }) => {
      tr.insert(pos + node.nodeSize, duplicate);
      return true;
    }).run();
  }, [editor, getPos, node]);

  return (
    <NodeViewWrapper
      className={`record-decision-block${selected ? " selected" : ""}${selectionInside ? " selection-inside" : ""}`}
      data-decision-block-id={decisionBlockId}
      data-content-version={node.attrs.contentVersion}
      data-created-at={node.attrs.createdAt}
      data-updated-at={node.attrs.updatedAt}
    >
      <div className="decision-block-label" contentEditable={false}>
        <Target size={14} />
        <span>复习重点</span>
      </div>
      <NodeViewContent className="decision-block-content" />
      {editor.isEditable && (
        <div className="decision-block-toolbar" contentEditable={false}>
          <button type="button" title="复制复习重点" aria-label="复制复习重点" onMouseDown={(event) => event.preventDefault()} onClick={copy}>
            <Copy size={14} />
          </button>
          <button type="button" title="转为普通内容" aria-label="转为普通内容" onMouseDown={(event) => event.preventDefault()} onClick={() => remove("converted-to-plain", true)}>
            <RotateCcw size={14} />
          </button>
          <button type="button" title="删除复习重点" aria-label="删除复习重点" onMouseDown={(event) => event.preventDefault()} onClick={() => remove("deleted", false)}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
};

export const RecordDecisionBlockNode = TiptapNode.create<RecordDecisionBlockOptions>({
  name: "recordDecisionBlock",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addOptions() {
    return { onRemove: () => undefined };
  },

  addAttributes() {
    return {
      decisionBlockId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-decision-block-id") ?? "",
        renderHTML: (attributes) => ({ "data-decision-block-id": String(attributes.decisionBlockId ?? "") }),
      },
      contentVersion: {
        default: 1,
        parseHTML: (element) => Math.max(1, Number(element.getAttribute("data-content-version")) || 1),
        renderHTML: (attributes) => ({ "data-content-version": String(Math.max(1, Number(attributes.contentVersion) || 1)) }),
      },
      createdAt: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-created-at") ?? "",
        renderHTML: (attributes) => ({ "data-created-at": String(attributes.createdAt ?? "") }),
      },
      updatedAt: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-updated-at") ?? "",
        renderHTML: (attributes) => ({ "data-updated-at": String(attributes.updatedAt ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "record-decision-block" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["record-decision-block", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    const attrs = () => {
      const stamp = nowISO();
      return { decisionBlockId: newDecisionBlockId(), contentVersion: 1, createdAt: stamp, updatedAt: stamp };
    };
    return {
      insertDecisionBlock: () => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: attrs(),
        content: [{ type: "paragraph" }],
      }),
      wrapSelectionInDecisionBlock: () => ({ commands }) => {
        if (findDecisionBlockDepth(this.editor) !== undefined) return false;
        return commands.wrapIn(this.name, attrs());
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(RecordDecisionBlockView);
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const seen = new Set<string>();
        let transaction: ReturnType<typeof newState.tr.setNodeMarkup> | undefined;
        newState.doc.descendants((node, position) => {
          if (node.type.name !== this.name) return true;
          const currentId = String(node.attrs.decisionBlockId ?? "");
          if (!currentId || seen.has(currentId)) {
            const stamp = nowISO();
            transaction ??= newState.tr;
            transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
              decisionBlockId: newDecisionBlockId(),
              contentVersion: 1,
              createdAt: stamp,
              updatedAt: stamp,
            });
          }
          seen.add(currentId);
          return true;
        });
        return transaction?.docChanged ? transaction : null;
      },
    })];
  },
});
