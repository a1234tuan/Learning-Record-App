import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";

import type { RecordAssetRef } from "../types";
import { AssetPreview } from "./AssetPreview";

type RecordAssetNodeOptions = {
  onAssetChanged?: () => void;
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
        onAssetChanged={extensionOptions.onAssetChanged}
        highlight={assetRef.id === extensionOptions.highlightedAssetId}
      />
    </NodeViewWrapper>
  );
};

const RecordFormulaNodeView = ({ node, updateAttributes, editor }: NodeViewProps) => {
  const title = String(node.attrs.title ?? "");
  const latex = String(node.attrs.latex ?? "");
  const html = katex.renderToString(latex || " ", { throwOnError: false, displayMode: true });
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper className="record-inline-node formula-editor-card">
      {editable ? (
        <>
          <input value={title} placeholder="公式标题" onChange={(event) => updateAttributes({ title: event.target.value })} />
          <textarea value={latex} onChange={(event) => updateAttributes({ latex: event.target.value })} />
        </>
      ) : (
        title && <strong>{title}</strong>
      )}
      <div className="formula-preview" dangerouslySetInnerHTML={{ __html: html }} />
    </NodeViewWrapper>
  );
};

export const RecordAssetNode = Node.create({
  name: "recordAsset",
  addOptions() {
    return {
      onAssetChanged: undefined,
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
});
