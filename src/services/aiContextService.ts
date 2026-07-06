import type {
  AiContextChunk,
  AiContextPack,
  AiSkippedAsset,
  Asset,
  Block,
  RecordBlock,
} from "../types";
import { parseLinearRecordContent } from "../lib/recordContent";
import { describeOcrForAi } from "./ocrDiagnostics";

const MAX_SELECTED_CHARS = 12_000;
const LONG_CONTEXT_CHARS = 16_000;
const MAX_CHUNK_CHARS = 2_400;

const normalizeText = (value: string): string =>
  value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

const assetTitle = (asset: Asset | undefined, fallback: string): string =>
  [asset?.title, asset?.fileName, fallback].find((item) => item && item.trim()) ?? "资源";

const skipped = (asset: Asset | undefined, id: string, kind: AiSkippedAsset["kind"], reason: string): AiSkippedAsset => ({
  id,
  kind,
  title: assetTitle(asset, id),
  reason,
});

const splitText = (content: string, maxLength = MAX_CHUNK_CHARS): string[] => {
  const text = normalizeText(content);
  if (!text) {
    return [];
  }
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (`${current}\n\n${paragraph}`.length > maxLength) {
      parts.push(current);
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`;
    }
  }
  if (current) {
    parts.push(current);
  }

  return parts.flatMap((part) => {
    if (part.length <= maxLength) {
      return [part];
    }
    const slices: string[] = [];
    for (let index = 0; index < part.length; index += maxLength) {
      slices.push(part.slice(index, index + maxLength));
    }
    return slices;
  });
};

const tokenize = (query: string): string[] =>
  Array.from(new Set(
    query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_]+/gu, " ")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  ));

const scoreChunk = (chunk: AiContextChunk, query: string): number => {
  const haystack = `${chunk.subject} ${chunk.title} ${chunk.sourceLabel} ${chunk.content}`.toLowerCase();
  const queryText = query.trim().toLowerCase();
  let score = 0;
  if (queryText && haystack.includes(queryText)) {
    score += 10;
  }
  for (const token of tokenize(query)) {
    if (chunk.title.toLowerCase().includes(token)) {
      score += 5;
    }
    if (chunk.subject.toLowerCase().includes(token)) {
      score += 4;
    }
    if (chunk.sourceLabel.toLowerCase().includes(token)) {
      score += 3;
    }
    if (chunk.content.toLowerCase().includes(token)) {
      score += 2;
    }
  }
  if (chunk.kind === "imageOcr") {
    score += 0.5;
  }
  return score;
};

const buildSummary = (date: string, records: RecordBlock[], chunks: AiContextChunk[]): string => {
  if (records.length === 0) {
    return `${date} 没有可用于 AI 问答的正式日志。`;
  }
  const subjects = Array.from(new Set(records.map((record) => record.subject))).join("、");
  const titles = records.map((record) => `《${record.title}》`).slice(0, 6).join("、");
  const more = records.length > 6 ? `等 ${records.length} 条记录` : `${records.length} 条记录`;
  return `${date} 共 ${more}，涉及 ${subjects || "未分类"}。主要记录：${titles}。可用上下文片段 ${chunks.length} 个。`;
};

export const hashAiContext = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
};

export const selectRelevantChunks = (
  chunks: AiContextChunk[],
  query: string,
  maxChars = MAX_SELECTED_CHARS,
): AiContextChunk[] => {
  if (chunks.length === 0) {
    return [];
  }
  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, query) }))
    .sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order || a.index - b.index);
  const hasPositiveScore = ranked.some((item) => item.score > 0);
  const candidates = hasPositiveScore
    ? ranked.filter((item) => item.score > 0)
    : ranked.sort((a, b) => a.chunk.order - b.chunk.order);

  const selected: AiContextChunk[] = [];
  let total = 0;
  for (const item of candidates) {
    const length = item.chunk.content.length;
    if (selected.length > 0 && total + length > maxChars) {
      continue;
    }
    selected.push(item.chunk);
    total += length;
    if (total >= maxChars) {
      break;
    }
  }
  return selected.sort((a, b) => a.order - b.order);
};

export const buildAiContextPack = (
  date: string,
  blocks: Block[],
  assets: Asset[],
  query = "",
): AiContextPack => {
  const records = blocks
    .filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt && block.date === date)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  const warnings: string[] = [];
  const skippedAssets: AiSkippedAsset[] = [];
  const missingOcrAssetIds: string[] = [];
  const allChunks: AiContextChunk[] = [];
  const markdownLines: string[] = [
    `# ${date} 学习日志`,
    "",
    "> 下面内容来自本地学习日志。图片仅包含已完成 OCR 的文字；音频、PDF、附件不会参与问答。",
    "",
  ];
  let includedImages = 0;
  let skippedImages = 0;
  let order = 0;

  if (records.length === 0) {
    warnings.push("当天没有可用于 AI 问答的日志记录。");
  }

  for (const record of records) {
    markdownLines.push(`## ${record.subject} / ${record.title}`, "");
    const nodes = parseLinearRecordContent(record, assets);
    if (nodes.length === 0) {
      markdownLines.push("（空记录）", "");
      continue;
    }

    let nodeIndex = 0;
    for (const node of nodes) {
      nodeIndex += 1;
      if (node.kind === "text") {
        const parts = splitText(node.text);
        for (const [partIndex, part] of parts.entries()) {
          allChunks.push({
            chunkId: `${record.id}-text-${nodeIndex}-${partIndex + 1}`,
            recordId: record.id,
            date: record.date,
            subject: record.subject,
            title: record.title,
            kind: "text",
            content: part,
            sourceLabel: `${record.subject} / ${record.title} / 正文${parts.length > 1 ? partIndex + 1 : ""}`,
            order,
          });
          order += 1;
        }
        markdownLines.push(normalizeText(node.text), "");
        continue;
      }

      if (node.kind === "formula") {
        const content = normalizeText(node.formula.latex);
        if (content) {
          allChunks.push({
            chunkId: `${record.id}-formula-${node.formula.id || nodeIndex}`,
            recordId: record.id,
            date: record.date,
            subject: record.subject,
            title: record.title,
            kind: "formula",
            content,
            sourceLabel: `${record.subject} / ${record.title} / 公式${node.formula.title ? `：${node.formula.title}` : ""}`,
            order,
          });
          order += 1;
        }
        if (node.formula.title) {
          markdownLines.push(`### ${node.formula.title}`);
        }
        markdownLines.push("$$", content, "$$", "");
        continue;
      }

      if (node.kind === "structure") {
        const parts = splitText(node.text);
        for (const [partIndex, part] of parts.entries()) {
          allChunks.push({
            chunkId: `${record.id}-structure-${nodeIndex}-${partIndex + 1}`,
            recordId: record.id,
            date: record.date,
            subject: record.subject,
            title: record.title,
            kind: "text",
            content: part,
            sourceLabel: `${record.subject} / ${record.title} / 结构块${parts.length > 1 ? partIndex + 1 : ""}`,
            order,
          });
          order += 1;
        }
        markdownLines.push(node.markdown, "");
        continue;
      }

      if (node.kind === "highlight") {
        const parts = splitText(node.text);
        for (const [partIndex, part] of parts.entries()) {
          allChunks.push({
            chunkId: `${record.id}-highlight-${nodeIndex}-${partIndex + 1}`,
            recordId: record.id,
            date: record.date,
            subject: record.subject,
            title: record.title,
            kind: "text",
            content: part,
            sourceLabel: `${record.subject} / ${record.title} / 高亮块${parts.length > 1 ? partIndex + 1 : ""}`,
            order,
          });
          order += 1;
        }
        markdownLines.push(node.markdown, "");
        continue;
      }

      const kind = node.asset?.kind ?? node.ref.kind;
      const title = assetTitle(node.asset, node.ref.title);
      if (kind === "image") {
        const diagnostic = describeOcrForAi(node.asset);
        if (diagnostic.included && node.asset?.ocrText?.trim()) {
          includedImages += 1;
          const parts = splitText(node.asset.ocrText);
          for (const [partIndex, part] of parts.entries()) {
            allChunks.push({
              chunkId: `${record.id}-image-${node.ref.id}-${partIndex + 1}`,
              recordId: record.id,
              date: record.date,
              subject: record.subject,
              title: record.title,
              kind: "imageOcr",
              content: part,
              sourceLabel: `${record.subject} / ${record.title} / 图片OCR：${title}`,
              order,
            });
            order += 1;
          }
          markdownLines.push(`### 图片文字：${title}`, node.asset.ocrText.trim(), "");
        } else {
          skippedImages += 1;
          missingOcrAssetIds.push(node.ref.id);
          skippedAssets.push(skipped(node.asset, node.ref.id, "image", diagnostic.reason));
        }
        continue;
      }

      skippedAssets.push(
        skipped(
          node.asset,
          node.ref.id,
          kind,
          kind === "audio" ? "音频文件暂不参与 AI 问答。" : "附件暂不参与 AI 问答。",
        ),
      );
    }
  }

  if (missingOcrAssetIds.length > 0) {
    warnings.push(`有 ${missingOcrAssetIds.length} 张图片未提供可用 OCR 文本，未参与本次问答。`);
  }
  const skippedNonImages = skippedAssets.filter((asset) => asset.kind !== "image");
  if (skippedNonImages.length > 0) {
    warnings.push(`有 ${skippedNonImages.length} 个音频或附件已跳过，不参与本次问答。`);
  }

  const markdown = markdownLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const summary = buildSummary(date, records, allChunks);
  const allChars = allChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const selectedChunks = allChars > LONG_CONTEXT_CHARS || query.trim()
    ? selectRelevantChunks(allChunks, query)
    : allChunks;
  const contextHash = hashAiContext([
    date,
    summary,
    ...allChunks.map((chunk) => `${chunk.chunkId}:${chunk.content}`),
    ...warnings,
  ].join("\n"));

  return {
    date,
    recordIds: records.map((record) => record.id),
    markdown,
    summary,
    selectedChunks,
    allChunks,
    totalChunks: allChunks.length,
    estimatedChars: selectedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
    warnings,
    skippedAssets,
    missingOcrAssetIds,
    ocrSummary: {
      includedImages,
      skippedImages,
    },
    contextHash,
  };
};
