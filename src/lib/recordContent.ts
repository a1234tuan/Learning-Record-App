import type { Asset, RecordAssetRef, RecordBlock, RecordFormula } from "../types";

export type LinearNode =
  | { kind: "text"; text: string }
  | { kind: "asset"; ref: RecordAssetRef; asset?: Asset; ocrText?: string }
  | { kind: "formula"; formula: RecordFormula };

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const decodeHtml = (value: string): string => {
  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
};

const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const parseElement = (html: string): Document => new DOMParser().parseFromString(html, "text/html");

const serializeAssetNode = (asset: RecordAssetRef): string =>
  `<record-asset data-asset-id="${escapeHtml(asset.id)}" data-kind="${escapeHtml(asset.kind)}" data-title="${escapeHtml(asset.title)}"></record-asset>`;

const serializeFormulaNode = (formula: RecordFormula): string =>
  `<record-formula data-formula-id="${escapeHtml(formula.id)}" data-title="${escapeHtml(formula.title ?? "")}" data-latex="${escapeHtml(formula.latex)}"></record-formula>`;

export const hasLinearRecordNodes = (contentHtml: string): boolean =>
  /<record-(asset|formula)\b/i.test(contentHtml);

export const normalizeRecordContent = (record: RecordBlock): string => {
  if (hasLinearRecordNodes(record.contentHtml)) {
    return record.contentHtml || "<p></p>";
  }

  const baseContent = record.contentHtml?.trim() || "<p></p>";
  const appended = [
    ...record.assets.map(serializeAssetNode),
    ...record.formulas.map(serializeFormulaNode),
  ];
  if (appended.length === 0) {
    return baseContent;
  }
  return [baseContent, ...appended, "<p></p>"].join("");
};

export const extractRecordRefsFromContent = (
  contentHtml: string,
): { assets: RecordAssetRef[]; formulas: RecordFormula[] } => {
  const doc = parseElement(contentHtml);
  const assets: RecordAssetRef[] = Array.from(doc.querySelectorAll("record-asset")).map((node) => ({
    id: node.getAttribute("data-asset-id") ?? "",
    kind: (node.getAttribute("data-kind") as RecordAssetRef["kind"]) ?? "attachment",
    title: node.getAttribute("data-title") ?? "资源",
  })).filter((asset) => Boolean(asset.id));

  const formulas: RecordFormula[] = Array.from(doc.querySelectorAll("record-formula")).map((node) => ({
    id: node.getAttribute("data-formula-id") ?? "",
    title: node.getAttribute("data-title") || undefined,
    latex: node.getAttribute("data-latex") ?? "",
  })).filter((formula) => Boolean(formula.id));

  return { assets, formulas };
};

export const syncRecordRefsFromContent = (record: RecordBlock): RecordBlock => {
  const contentHtml = normalizeRecordContent(record);
  const refs = extractRecordRefsFromContent(contentHtml);
  return {
    ...record,
    contentHtml,
    assets: refs.assets,
    formulas: refs.formulas,
    mistakeRefs: [],
  };
};

export const parseLinearRecordContent = (record: RecordBlock, assets: Asset[] = []): LinearNode[] => {
  const contentHtml = normalizeRecordContent(record);
  const doc = parseElement(contentHtml);
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const nodes: LinearNode[] = [];

  for (const child of Array.from(doc.body.childNodes)) {
    if (child.nodeType === 1) {
      const element = child as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (tag === "record-asset") {
        const id = element.getAttribute("data-asset-id") ?? "";
        const asset = assetMap.get(id);
        nodes.push({
          kind: "asset",
          ref: {
            id,
            kind: (element.getAttribute("data-kind") as RecordAssetRef["kind"]) ?? asset?.kind ?? "attachment",
            title: element.getAttribute("data-title") ?? asset?.title ?? asset?.fileName ?? "资源",
          },
          asset,
          ocrText: asset?.ocrText,
        });
        continue;
      }
      if (tag === "record-formula") {
        nodes.push({
          kind: "formula",
          formula: {
            id: element.getAttribute("data-formula-id") ?? "",
            title: element.getAttribute("data-title") || undefined,
            latex: element.getAttribute("data-latex") ?? "",
          },
        });
        continue;
      }
    }

    const wrapper = document.createElement("div");
    wrapper.append(child.cloneNode(true));
    const text = decodeHtml(stripHtml(wrapper.innerHTML));
    if (text) {
      nodes.push({ kind: "text", text });
    }
  }

  return nodes;
};

export const recordToPlainText = (record: RecordBlock, assets: Asset[] = []): string =>
  parseLinearRecordContent(record, assets)
    .map((node) => {
      if (node.kind === "text") {
        return node.text;
      }
      if (node.kind === "formula") {
        return [node.formula.title, node.formula.latex].filter(Boolean).join("\n");
      }
      const assetLabel = [node.ref.title, node.asset?.title, node.asset?.fileName].filter(Boolean).join(" / ");
      return [assetLabel, node.ocrText].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

export const recordToLinearMarkdown = (record: RecordBlock, assets: Asset[] = []): string =>
  [
    `## ${record.title}`,
    "",
    `学科：${record.subject}`,
    "",
    ...parseLinearRecordContent(record, assets).map((node) => {
      if (node.kind === "text") {
        return node.text;
      }
      if (node.kind === "formula") {
        return [
          node.formula.title ? `### ${node.formula.title}` : "",
          `$$\n${node.formula.latex}\n$$`,
        ].filter(Boolean).join("\n");
      }
      const assetName = node.asset?.fileName ?? node.ref.title;
      const assetText = node.ref.kind === "image"
        ? `![${node.ref.title}](../assets/${node.ref.id}-${assetName})`
        : `[${node.ref.title}](../assets/${node.ref.id}-${assetName})`;
      return [assetText, node.ocrText ? `\n> 图片 OCR：${node.ocrText}` : ""].filter(Boolean).join("");
    }),
    "",
  ].join("\n");
