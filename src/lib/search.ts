import type { Asset, Block, DayEntry, RecordBlock, SearchResult } from "../types";
import { recordToPlainText } from "./recordContent";

const normalize = (value: string): string => value.toLocaleLowerCase("zh-CN");
const DEFAULT_SEARCH_LIMIT = Number.POSITIVE_INFINITY;

const excerpt = (text: string, query: string): string => {
  const normalizedText = normalize(text);
  const normalizedQuery = normalize(query);
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) {
    return text.slice(0, 90);
  }
  return text.slice(Math.max(0, index - 24), Math.min(text.length, index + query.length + 60));
};

export const blockToText = (block: Block, assets: Asset[] = []): string => {
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  return blockToTextWithAssetMap(block, assetMap);
};

const blockToTextWithAssetMap = (block: Block, assetMap: Map<string, Asset>): string => {
  const assetTitle = (id: string) => {
    const asset = assetMap.get(id);
    return `${asset?.title ?? ""} ${asset?.fileName ?? ""}`;
  };
  switch (block.type) {
    case "record":
      const recordAssets = block.assets
        .map((asset) => assetMap.get(asset.id))
        .filter((asset): asset is Asset => Boolean(asset));
      return [
        block.title,
        block.subject,
        recordToPlainText(block, recordAssets),
        block.assets.map((asset) => `${asset.title} ${assetTitle(asset.id)}`).join(" "),
        block.formulas.map((formula) => `${formula.title ?? ""} ${formula.latex}`).join(" "),
      ].join(" ");
    case "richText":
      return block.content.replace(/<[^>]+>/g, " ");
    case "code":
      return `${block.language} ${block.code}`;
    case "formula":
      return block.latex;
    case "todo":
      return `${block.title} ${block.items.map((item) => item.text).join(" ")}`;
    case "studySession":
      return `${block.subject} ${block.minutes} ${block.note ?? ""}`;
    case "quote":
      return `${block.text} ${block.source ?? ""}`;
    case "image":
      return `${block.caption ?? ""} ${assetTitle(block.assetId)}`;
    case "attachment":
      return `${block.note ?? ""} ${assetTitle(block.assetId)}`;
    case "mistakeRef":
      return "";
  }
};

const recordAssetText = (record: RecordBlock, assetMap: Map<string, Asset>, kind: "meta" | "ocr") =>
  record.assets
    .map((ref) => {
      const asset = assetMap.get(ref.id);
      if (!asset) {
        return "";
      }
      return kind === "ocr"
        ? asset.ocrText ?? ""
        : `${ref.title} ${asset.title ?? ""} ${asset.fileName}`;
    })
    .join(" ");

export const searchAll = (
  query: string,
  entries: DayEntry[],
  blocks: Block[],
  assets: Asset[] = [],
  limit = DEFAULT_SEARCH_LIMIT,
): SearchResult[] => {
  const normalizedQuery = normalize(query.trim());
  if (!normalizedQuery) {
    return [];
  }

  const maxResults = Number.isFinite(limit) ? Math.max(0, limit) : DEFAULT_SEARCH_LIMIT;
  const isFull = () => results.length >= maxResults;
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const results: SearchResult[] = [];
  for (const entry of entries) {
    const text = `${entry.title} ${entry.summary ?? ""} ${entry.tags.join(" ")}`;
    if (normalize(text).includes(normalizedQuery)) {
      results.push({
        id: entry.id,
        type: "entry",
        title: entry.title,
        excerpt: excerpt(text, query),
        date: entry.date,
        tags: entry.tags,
        matchSource: "entry",
      });
      if (isFull()) {
        return results;
      }
    }
  }

  for (const block of blocks) {
    const contentText = blockToTextWithAssetMap(block, assetMap);
    const assetMetaText = block.type === "record" ? recordAssetText(block, assetMap, "meta") : "";
    const assetOcrText = block.type === "record" ? recordAssetText(block, assetMap, "ocr") : "";
    const hitContent = normalize(contentText).includes(normalizedQuery);
    const hitAssetMeta = normalize(assetMetaText).includes(normalizedQuery);
    const hitAssetOcr = normalize(assetOcrText).includes(normalizedQuery);
    if (hitContent || hitAssetMeta || hitAssetOcr) {
      const matchSource = hitAssetOcr ? "assetOcr" : hitAssetMeta ? "assetMeta" : "content";
      const matchedAsset = block.type === "record" && matchSource !== "content"
        ? block.assets.find((ref) => {
          const asset = assetMap.get(ref.id);
          const text = matchSource === "assetOcr"
            ? asset?.ocrText ?? ""
            : `${ref.title} ${asset?.title ?? ""} ${asset?.fileName ?? ""}`;
          return normalize(text).includes(normalizedQuery);
        })
        : undefined;
      const text = matchSource === "assetOcr" ? assetOcrText : matchSource === "assetMeta" ? assetMetaText : contentText;
      results.push({
        id: block.id,
        type: "block",
        title: block.type === "record" ? block.title : `${block.date} 的记录`,
        excerpt: excerpt(text, query),
        date: block.date,
        tags: block.type === "record" ? [block.subject] : [],
        recordId: block.type === "record" ? block.id : undefined,
        assetId: matchedAsset?.id,
        matchSource,
      });
      if (isFull()) {
        return results;
      }
    }
  }

  return results;
};
