import type {
  AiContextChunk,
  AiContextPack,
  AiKnowledgeScope,
  AiSkippedAsset,
  Asset,
  Block,
  ISODate,
  RecordBlock,
} from "../types";
import { addDaysISO, todayISO } from "../lib/date";
import { parseLinearRecordContent } from "../lib/recordContent";
import { normalizeRecordTags, recordTagKey, subjectTagKey } from "../lib/recordTags";
import { describeOcrForAi } from "./ocrDiagnostics";

const MAX_SELECTED_CHARS = 12_000;
const LONG_CONTEXT_CHARS = 16_000;
const MAX_CHUNK_CHARS = 2_400;
const MAX_INDEXED_CONTEXT_CHARS = 1_000_000;
const MAX_STORED_MARKDOWN_CHARS = 64_000;
const CONTEXT_CACHE_LIMIT = 4;

export const FOCUSED_AI_RETRIEVAL_TOKENS = 16_000;
export const COVERAGE_AI_RETRIEVAL_TOKENS = 24_000;
export const MAX_AI_RETRIEVAL_TOKENS = COVERAGE_AI_RETRIEVAL_TOKENS;

export type AiRetrievalMode = "focused" | "coverage";

export interface AiContextSelectionOptions {
  maxTokens?: number;
  preferDiverse?: boolean;
  retrievalMode?: AiRetrievalMode;
}

export interface AiKnowledgeContextOptions extends AiContextSelectionOptions {
  referenceDate?: ISODate;
}

type ContextBuildState = {
  allChunks: AiContextChunk[];
  warnings: Set<string>;
  skippedAssets: AiSkippedAsset[];
  missingOcrAssetIds: string[];
  markdownLines: string[];
  includedImages: number;
  skippedImages: number;
};

const contextCache = new Map<string, AiContextPack>();

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
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const parts: string[] = [];
  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
    } else if (`${current}\n\n${paragraph}`.length > maxLength) {
      parts.push(current);
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`;
    }
  }
  if (current) parts.push(current);

  return parts.flatMap((part) => {
    if (part.length <= maxLength) return [part];
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

const chineseBigrams = (value: string): string[] => {
  const characters = Array.from(value.toLocaleLowerCase("zh-CN"));
  const bigrams = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    if (/\p{Script=Han}/u.test(characters[index]) && /\p{Script=Han}/u.test(characters[index + 1])) {
      bigrams.add(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return [...bigrams];
};

/** A deliberately conservative local estimate used to stay below provider context windows. */
export const estimateAiTokens = (value: string): number => {
  const chars = Array.from(value);
  let cjk = 0;
  for (const char of chars) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) cjk += 1;
  }
  return Math.ceil((cjk * 1.5 + (chars.length - cjk) / 3 + 8) * 1.1);
};

export const formatAiContextSource = (chunk: AiContextChunk, index: number): string => [
  `[[S${index + 1}]] ${chunk.sourceLabel}`,
  chunk.markdown ?? chunk.content,
].join("\n");

export const estimateAiContextSourceTokens = (chunk: AiContextChunk, index: number): number =>
  estimateAiTokens(formatAiContextSource(chunk, index));

const scoreChunk = (chunk: AiContextChunk, query: string): number => {
  const queryText = normalizeText(query).toLocaleLowerCase("zh-CN");
  if (!queryText) return 0;
  const title = chunk.title.toLocaleLowerCase("zh-CN");
  const subject = chunk.subject.toLocaleLowerCase("zh-CN");
  const tags = (chunk.tags ?? []).join(" ").toLocaleLowerCase("zh-CN");
  const source = chunk.sourceLabel.toLocaleLowerCase("zh-CN");
  const content = chunk.content.toLocaleLowerCase("zh-CN");
  const markdown = (chunk.markdown ?? "").toLocaleLowerCase("zh-CN");
  const haystack = `${subject} ${title} ${tags} ${source} ${content} ${markdown}`;
  let score = haystack.includes(queryText) ? 24 : 0;

  for (const token of tokenize(query)) {
    if (title.includes(token)) score += 9;
    if (tags.includes(token)) score += 8;
    if (subject.includes(token)) score += 6;
    if (source.includes(token)) score += 4;
    if (content.includes(token) || markdown.includes(token)) score += 3;
  }
  for (const bigram of chineseBigrams(query)) {
    if (title.includes(bigram) || tags.includes(bigram)) score += 2.5;
    if (content.includes(bigram) || markdown.includes(bigram)) score += 0.75;
  }
  if (chunk.kind === "formula" && (content.includes(queryText) || markdown.includes(queryText))) score += 8;
  if (chunk.kind === "imageOcr") score += 0.5;
  return score;
};

export const getAiRetrievalMode = (query: string): AiRetrievalMode =>
  /抽测|抽问|出题|测试|考我|复盘|总结|梳理|覆盖|quiz/i.test(query) ? "coverage" : "focused";

const scopeDate = (scope: AiKnowledgeScope, referenceDate: ISODate): ISODate =>
  scope.kind === "date" ? scope.date : referenceDate;

export const aiKnowledgeScopeTitle = (scope: AiKnowledgeScope, referenceDate = todayISO()): string => {
  switch (scope.kind) {
    case "date":
      return `${scope.date} 日志`;
    case "tag":
      return `${scope.subject} / #${scope.tag}`;
    case "recent": {
      const start = addDaysISO(referenceDate, 1 - scope.days);
      return `最近 ${scope.days} 天（${start} 至 ${referenceDate}）`;
    }
  }
};

export const aiKnowledgeScopeKey = (scope: AiKnowledgeScope): string => {
  switch (scope.kind) {
    case "date":
      return `date:${scope.date}`;
    case "tag":
      return `tag:${subjectTagKey(scope.subject, scope.tag)}`;
    case "recent":
      return `recent:${scope.days}`;
  }
};

export const sessionKnowledgeScope = (session: { scope?: AiKnowledgeScope; sourceDate?: ISODate; attachment?: AiContextPack }): AiKnowledgeScope | undefined =>
  session.scope ?? session.attachment?.scope ?? (session.sourceDate ? { kind: "date", date: session.sourceDate } : undefined) ??
  (session.attachment?.date ? { kind: "date", date: session.attachment.date } : undefined);

export const getAiKnowledgeScopeRecords = (
  scope: AiKnowledgeScope,
  blocks: Block[],
  referenceDate = todayISO(),
): RecordBlock[] => {
  const records = blocks.filter((block): block is RecordBlock => block.type === "record" && !block.deletedAt);
  const matched = records.filter((record) => {
    if (scope.kind === "date") return record.date === scope.date;
    if (scope.kind === "tag") {
      const sameSubject = record.subject.trim().toLocaleLowerCase("zh-CN") === scope.subject.trim().toLocaleLowerCase("zh-CN");
      return sameSubject && normalizeRecordTags(record.tags).some((tag) => recordTagKey(tag) === recordTagKey(scope.tag));
    }
    const start = addDaysISO(referenceDate, 1 - scope.days);
    return record.date >= start && record.date <= referenceDate;
  });
  return matched.sort((left, right) =>
    left.date.localeCompare(right.date) || left.order - right.order || left.createdAt.localeCompare(right.createdAt));
};

const buildSummary = (scopeTitle: string, records: RecordBlock[], chunks: AiContextChunk[]): string => {
  if (records.length === 0) return `${scopeTitle} 没有可用于 AI 问答的正式日志。`;
  const subjects = Array.from(new Set(records.map((record) => record.subject))).join("、");
  const titles = records.map((record) => `《${record.title}》`).slice(0, 6).join("、");
  const more = records.length > 6 ? `等 ${records.length} 条记录` : `${records.length} 条记录`;
  return `${scopeTitle} 共 ${more}，涉及 ${subjects || "未分类"}。主要记录：${titles}。可用上下文片段 ${chunks.length} 个。`;
};

export const hashAiContext = (value: string): string => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
};

export const selectRelevantChunks = (
  chunks: AiContextChunk[],
  query: string,
  maxCharsOrOptions: number | AiContextSelectionOptions = MAX_SELECTED_CHARS,
): AiContextChunk[] => {
  if (chunks.length === 0) return [];
  const options: AiContextSelectionOptions & { maxChars?: number } = typeof maxCharsOrOptions === "number"
    ? { maxChars: maxCharsOrOptions }
    : maxCharsOrOptions;
  const maxChars = options.maxChars ?? (options.maxTokens ? Number.MAX_SAFE_INTEGER : MAX_SELECTED_CHARS);
  const maxTokens = options.maxTokens;
  const ranked = chunks
    .map((chunk, index) => ({ chunk, index, score: scoreChunk(chunk, query) }))
    .sort((left, right) => right.score - left.score || left.chunk.order - right.chunk.order || left.index - right.index);
  const hasPositiveScore = ranked.some((item) => item.score > 0);
  const candidates = hasPositiveScore ? ranked.filter((item) => item.score > 0) : ranked;
  const diverse = options.preferDiverse ?? (options.retrievalMode ?? getAiRetrievalMode(query)) === "coverage";
  const selected: AiContextChunk[] = [];
  const perRecord = new Map<string, number>();
  let totalChars = 0;
  let totalTokens = 0;

  const trySelect = (item: typeof candidates[number]): boolean => {
    const chars = item.chunk.content.length;
    const tokens = estimateAiContextSourceTokens(item.chunk, selected.length);
    if (selected.length > 0 && (totalChars + chars > maxChars || (maxTokens && totalTokens + tokens > maxTokens))) {
      return false;
    }
    selected.push(item.chunk);
    perRecord.set(item.chunk.recordId, (perRecord.get(item.chunk.recordId) ?? 0) + 1);
    totalChars += chars;
    totalTokens += tokens;
    return true;
  };

  const remaining = [...candidates];
  if (diverse) {
    const firstByRecord = new Map<string, typeof candidates[number]>();
    for (const item of remaining) {
      if (!firstByRecord.has(item.chunk.recordId)) firstByRecord.set(item.chunk.recordId, item);
    }
    for (const item of firstByRecord.values()) {
      trySelect(item);
      if (totalChars >= maxChars || (maxTokens && totalTokens >= maxTokens)) break;
    }
    const selectedIds = new Set(selected.map((chunk) => chunk.chunkId));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (selectedIds.has(remaining[index].chunk.chunkId)) remaining.splice(index, 1);
    }
  }

  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftScore = left.score - (diverse ? (perRecord.get(left.chunk.recordId) ?? 0) * 4 : 0);
      const rightScore = right.score - (diverse ? (perRecord.get(right.chunk.recordId) ?? 0) * 4 : 0);
      return rightScore - leftScore || left.chunk.order - right.chunk.order || left.index - right.index;
    });
    const next = remaining.shift()!;
    trySelect(next);
    if (totalChars >= maxChars || (maxTokens && totalTokens >= maxTokens)) break;
  }
  return selected.sort((left, right) => left.order - right.order);
};

const createState = (scopeTitle: string): ContextBuildState => ({
  allChunks: [],
  warnings: new Set(),
  skippedAssets: [],
  missingOcrAssetIds: [],
  markdownLines: [
    `# ${scopeTitle}`,
    "",
    "> 下面内容来自本地学习日志。图片仅包含已完成 OCR 的文字；音频、PDF、附件不会参与问答。",
    "",
  ],
  includedImages: 0,
  skippedImages: 0,
});

const pushChunk = (state: ContextBuildState, chunk: Omit<AiContextChunk, "order">) => {
  state.allChunks.push({ ...chunk, order: state.allChunks.length });
};

const sourcePrefix = (record: RecordBlock): string => {
  const tags = normalizeRecordTags(record.tags);
  return `${record.date} / ${record.subject} / ${record.title}${tags.length ? ` / 标签：${tags.map((tag) => `#${tag}`).join(" ")}` : ""}`;
};

const appendRecord = (state: ContextBuildState, record: RecordBlock, assets: Asset[]) => {
  const tags = normalizeRecordTags(record.tags);
  state.markdownLines.push(`## ${record.subject} / ${record.title}`, tags.length ? `标签：${tags.map((tag) => `#${tag}`).join(" ")}` : "", "");
  const nodes = parseLinearRecordContent(record, assets);
  if (nodes.length === 0) {
    state.markdownLines.push("（空记录）", "");
    return;
  }

  let nodeIndex = 0;
  for (const node of nodes) {
    nodeIndex += 1;
    if (node.kind === "text" || node.kind === "structure" || node.kind === "highlight") {
      const markdown = normalizeText(node.markdown ?? node.text);
      const parts = splitText(node.text);
      const label = node.kind === "structure" ? "结构块" : node.kind === "highlight" ? "高亮块" : "正文";
      for (const [partIndex, part] of parts.entries()) {
        pushChunk(state, {
          chunkId: `${record.id}-${node.kind}-${nodeIndex}-${partIndex + 1}`,
          recordId: record.id,
          date: record.date,
          subject: record.subject,
          tags,
          title: record.title,
          kind: "text",
          content: part,
          markdown: parts.length === 1 ? markdown : part,
          sourceLabel: `${sourcePrefix(record)} / ${label}${parts.length > 1 ? partIndex + 1 : ""}`,
        });
      }
      state.markdownLines.push(markdown, "");
      continue;
    }

    if (node.kind === "formula") {
      const content = normalizeText(node.formula.latex);
      const markdown = node.inline ? `$${content}$` : `$$\n${content}\n$$`;
      if (content) {
        pushChunk(state, {
          chunkId: `${record.id}-formula-${node.formula.id || nodeIndex}`,
          recordId: record.id,
          date: record.date,
          subject: record.subject,
          tags,
          title: record.title,
          kind: "formula",
          content,
          markdown,
          sourceLabel: `${sourcePrefix(record)} / 公式${node.formula.title ? `：${node.formula.title}` : ""}`,
        });
      }
      if (node.formula.title) state.markdownLines.push(`### ${node.formula.title}`);
      state.markdownLines.push(markdown, "");
      continue;
    }

    const kind = node.asset?.kind ?? node.ref.kind;
    const title = assetTitle(node.asset, node.ref.title);
    if (kind === "image") {
      const diagnostic = describeOcrForAi(node.asset);
      if (diagnostic.included && node.asset?.ocrText?.trim()) {
        state.includedImages += 1;
        const parts = splitText(node.asset.ocrText);
        for (const [partIndex, part] of parts.entries()) {
          pushChunk(state, {
            chunkId: `${record.id}-image-${node.ref.id}-${partIndex + 1}`,
            recordId: record.id,
            date: record.date,
            subject: record.subject,
            tags,
            title: record.title,
            kind: "imageOcr",
            content: part,
            markdown: `### 图片文字：${title}\n\n${part}`,
            sourceLabel: `${sourcePrefix(record)} / 图片OCR：${title}`,
          });
        }
        state.markdownLines.push(`### 图片文字：${title}`, node.asset.ocrText.trim(), "");
      } else {
        state.skippedImages += 1;
        state.missingOcrAssetIds.push(node.ref.id);
        state.skippedAssets.push(skipped(node.asset, node.ref.id, "image", diagnostic.reason));
      }
      continue;
    }

    state.skippedAssets.push(skipped(
      node.asset,
      node.ref.id,
      kind,
      kind === "audio" ? "音频文件暂不参与 AI 问答。" : "附件暂不参与 AI 问答。",
    ));
  }
};

const finalizeState = (
  scope: AiKnowledgeScope,
  scopeTitle: string,
  referenceDate: ISODate,
  records: RecordBlock[],
  state: ContextBuildState,
  query: string,
  options: AiContextSelectionOptions,
): AiContextPack => {
  if (records.length === 0) state.warnings.add("当前范围没有可用于 AI 问答的日志记录。");
  if (state.missingOcrAssetIds.length > 0) {
    state.warnings.add(`有 ${state.missingOcrAssetIds.length} 张图片未提供可用 OCR 文本，未参与本次问答。`);
  }
  const skippedNonImages = state.skippedAssets.filter((asset) => asset.kind !== "image");
  if (skippedNonImages.length > 0) {
    state.warnings.add(`有 ${skippedNonImages.length} 个音频或附件已跳过，不参与本次问答。`);
  }
  const limitedChunks: AiContextChunk[] = [];
  let indexedChars = 0;
  for (const chunk of state.allChunks) {
    if (indexedChars + chunk.content.length > MAX_INDEXED_CONTEXT_CHARS) {
      state.warnings.add("当前范围内容较多，AI 上下文已按安全上限截取；原始记录未受影响。");
      break;
    }
    limitedChunks.push(chunk);
    indexedChars += chunk.content.length;
  }
  const markdown = state.markdownLines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, MAX_STORED_MARKDOWN_CHARS).trim();
  if (state.markdownLines.join("\n").length > MAX_STORED_MARKDOWN_CHARS) {
    state.warnings.add("AI Markdown 预览已按安全上限截取；AI 问答仍使用选中的语义分片。");
  }
  const summary = buildSummary(scopeTitle, records, limitedChunks);
  const totalChars = limitedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const shouldSelect = totalChars > LONG_CONTEXT_CHARS || query.trim() || options.maxTokens;
  const selectedChunks = shouldSelect
    ? selectRelevantChunks(limitedChunks, query, options)
    : limitedChunks;
  const warnings = [...state.warnings];
  const contextHash = hashAiContext([
    aiKnowledgeScopeKey(scope),
    scopeTitle,
    summary,
    ...limitedChunks.map((chunk) => `${chunk.chunkId}:${chunk.content}:${chunk.markdown ?? ""}`),
    ...warnings,
  ].join("\n"));

  return {
    date: scopeDate(scope, referenceDate),
    scope,
    scopeTitle,
    recordIds: records.map((record) => record.id),
    markdown,
    summary,
    selectedChunks,
    allChunks: limitedChunks,
    totalChunks: limitedChunks.length,
    estimatedChars: selectedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
    warnings,
    skippedAssets: state.skippedAssets,
    missingOcrAssetIds: Array.from(new Set(state.missingOcrAssetIds)),
    ocrSummary: { includedImages: state.includedImages, skippedImages: state.skippedImages },
    contextHash,
  };
};

const cacheKeyFor = (scope: AiKnowledgeScope, referenceDate: ISODate, records: RecordBlock[], assets: Asset[]): string => {
  const assetIds = new Set(records.flatMap((record) => record.assets.map((asset) => asset.id)));
  const recordFingerprint = records.map((record) => [record.id, record.updatedAt, record.tags.join("\u0000"), record.contentHtml.length].join(":"));
  const assetFingerprint = assets
    .filter((asset) => assetIds.has(asset.id))
    .map((asset) => [asset.id, asset.updatedAt, asset.ocrStatus, asset.ocrText?.length ?? 0].join(":"));
  return hashAiContext([aiKnowledgeScopeKey(scope), referenceDate, ...recordFingerprint, ...assetFingerprint].join("\n"));
};

const rememberContext = (key: string, pack: AiContextPack) => {
  contextCache.delete(key);
  contextCache.set(key, pack);
  while (contextCache.size > CONTEXT_CACHE_LIMIT) contextCache.delete(contextCache.keys().next().value!);
};

const selectFromCachedPack = (pack: AiContextPack, query: string, options: AiContextSelectionOptions): AiContextPack => {
  const totalChars = pack.allChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const shouldSelect = totalChars > LONG_CONTEXT_CHARS || query.trim() || options.maxTokens;
  const selectedChunks = shouldSelect ? selectRelevantChunks(pack.allChunks, query, options) : pack.allChunks;
  return {
    ...pack,
    selectedChunks,
    estimatedChars: selectedChunks.reduce((sum, chunk) => sum + chunk.content.length, 0),
  };
};

const buildContext = (
  scope: AiKnowledgeScope,
  blocks: Block[],
  assets: Asset[],
  query: string,
  options: AiKnowledgeContextOptions,
): AiContextPack => {
  const referenceDate = options.referenceDate ?? todayISO();
  const records = getAiKnowledgeScopeRecords(scope, blocks, referenceDate);
  const cacheKey = cacheKeyFor(scope, referenceDate, records, assets);
  const cached = contextCache.get(cacheKey);
  if (cached) {
    contextCache.delete(cacheKey);
    contextCache.set(cacheKey, cached);
    return selectFromCachedPack(cached, query, options);
  }
  const scopeTitle = aiKnowledgeScopeTitle(scope, referenceDate);
  const state = createState(scopeTitle);
  records.forEach((record) => appendRecord(state, record, assets));
  const base = finalizeState(scope, scopeTitle, referenceDate, records, state, "", {});
  rememberContext(cacheKey, base);
  return selectFromCachedPack(base, query, options);
};

export const buildAiKnowledgeContextPack = (
  scope: AiKnowledgeScope,
  blocks: Block[],
  assets: Asset[],
  query = "",
  options: AiKnowledgeContextOptions = {},
): AiContextPack => buildContext(scope, blocks, assets, query, options);

export const buildAiContextPack = (
  date: string,
  blocks: Block[],
  assets: Asset[],
  query = "",
): AiContextPack => buildContext({ kind: "date", date }, blocks, assets, query, { referenceDate: date });

const yieldAiContext = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, 0);
    } else {
      setTimeout(resolve, 0);
    }
  });
};

export const buildAiKnowledgeContextPackAsync = async (
  scope: AiKnowledgeScope,
  blocks: Block[],
  assets: Asset[],
  query = "",
  signal?: AbortSignal,
  options: AiKnowledgeContextOptions = {},
): Promise<AiContextPack> => {
  const referenceDate = options.referenceDate ?? todayISO();
  const records = getAiKnowledgeScopeRecords(scope, blocks, referenceDate);
  const cacheKey = cacheKeyFor(scope, referenceDate, records, assets);
  const cached = contextCache.get(cacheKey);
  if (cached) return selectFromCachedPack(cached, query, options);

  const scopeTitle = aiKnowledgeScopeTitle(scope, referenceDate);
  const state = createState(scopeTitle);
  for (const record of records) {
    if (signal?.aborted) throw new DOMException("AI context cancelled", "AbortError");
    appendRecord(state, record, assets);
    await yieldAiContext();
  }
  const base = finalizeState(scope, scopeTitle, referenceDate, records, state, "", {});
  rememberContext(cacheKey, base);
  return selectFromCachedPack(base, query, options);
};

export const buildAiContextPackAsync = async (
  date: string,
  blocks: Block[],
  assets: Asset[],
  query = "",
  signal?: AbortSignal,
): Promise<AiContextPack> => buildAiKnowledgeContextPackAsync(
  { kind: "date", date },
  blocks,
  assets,
  query,
  signal,
  { referenceDate: date },
);

/** Sessions retain only the current retrieval result; the large local index lives in the in-memory cache. */
export const compactAiContextPack = (pack: AiContextPack): AiContextPack => ({ ...pack, allChunks: [] });

export const clearAiContextCache = () => contextCache.clear();
