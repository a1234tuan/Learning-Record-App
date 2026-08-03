import type {
  AiCompletionResult,
  AiContextPack,
  AiKnowledgeScope,
  AppSettings,
  KnowledgePodcast,
  KnowledgePodcastAudioUnit,
  KnowledgePodcastScriptDiagnostic,
  KnowledgePodcastSegment,
  RecordBlock,
} from "../types";
import { createBaseEntity, newId } from "../lib/entity";
import { buildAiKnowledgeContextPackAsync, getAiKnowledgeScopeRecords } from "./aiContextService";
import { getCurrentAiProvider } from "../lib/aiProviders";
import { calculateAiRequestBudget, sendChatCompletionDetailed } from "./aiClientService";
import { storage } from "./storageAdapter";
import { synthesizeFishAudioOnHost } from "./nativeTts";

export const FISH_AUDIO_PROVIDER_ID = "fish-audio";
export const DEFAULT_FISH_MODEL = "s2.1-pro-free";
export const PODCAST_MAX_SOURCE_RECORDS = 20;
export const PODCAST_SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;
export const PODCAST_MIN_OUTPUT_TOKENS = 16_384;
export const PODCAST_MAX_OUTPUT_TOKENS = 32_768;

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : undefined;

export const hashText = async (value: string): Promise<string> => {
  if (typeof crypto !== "undefined" && crypto.subtle && encoder) {
    const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(bytes)).map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const createPodcastAudioUnits = async (podcast: Pick<KnowledgePodcast, "opening" | "segments" | "closing">): Promise<KnowledgePodcastAudioUnit[]> => {
  const units: KnowledgePodcastAudioUnit[] = [];
  const opening = podcast.opening?.trim();
  if (opening) {
    units.push({ id: newId(), kind: "opening", order: 0, title: "开场", textHash: await hashText(opening), audioStatus: "pending" });
  }
  const segmentOffset = units.length;
  for (const [index, segment] of [...podcast.segments].sort((a, b) => a.order - b.order).entries()) {
    units.push({
      id: newId(), kind: "segment", order: segmentOffset + index,
      title: segment.title.trim() || `第 ${segment.order + 1} 章`, segmentId: segment.id,
      textHash: await hashText(segment.text), audioStatus: "pending",
    });
  }
  const closing = podcast.closing?.trim();
  if (closing) {
    units.push({ id: newId(), kind: "closing", order: units.length, title: "结尾", textHash: await hashText(closing), audioStatus: "pending" });
  }
  return units;
};

const audioUnitKey = (unit: Pick<KnowledgePodcastAudioUnit, "kind" | "segmentId">): string => `${unit.kind}:${unit.segmentId ?? ""}`;

export const reconcilePodcastAudioUnits = async (podcast: KnowledgePodcast): Promise<KnowledgePodcast> => {
  const desired = await createPodcastAudioUnits(podcast);
  const existing = new Map((podcast.audioUnits ?? []).map((unit) => [audioUnitKey(unit), unit]));
  const pendingCleanup = new Set(podcast.pendingAudioCleanupAssetIds ?? []);
  const audioUnits = desired.map((unit) => {
    const previous = existing.get(audioUnitKey(unit));
    if (!previous) return unit;
    existing.delete(audioUnitKey(unit));
    if (previous.textHash === unit.textHash) {
      return { ...previous, title: unit.title, order: unit.order, segmentId: unit.segmentId };
    }
    if (previous.audioAssetId) pendingCleanup.add(previous.audioAssetId);
    return { ...unit, id: previous.id };
  });
  for (const unit of existing.values()) {
    if (unit.audioAssetId) pendingCleanup.add(unit.audioAssetId);
  }
  return {
    ...podcast,
    audioLayoutVersion: 2,
    audioUnits,
    pendingAudioCleanupAssetIds: pendingCleanup.size ? Array.from(pendingCleanup) : undefined,
    audioStatus: "idle",
  };
};

export const invalidatePodcastAudioUnits = (podcast: KnowledgePodcast): KnowledgePodcast => {
  const pendingCleanup = new Set([
    ...(podcast.pendingAudioCleanupAssetIds ?? []),
    ...(podcast.audioUnits ?? []).flatMap((unit) => unit.audioAssetId ? [unit.audioAssetId] : []),
  ]);
  return {
    ...podcast,
    audioStatus: "idle",
    audioUnits: podcast.audioUnits?.map((unit) => ({ ...unit, audioAssetId: undefined, durationSeconds: undefined, audioStatus: "pending", error: undefined })),
    pendingAudioCleanupAssetIds: pendingCleanup.size ? Array.from(pendingCleanup) : undefined,
  };
};

const stripCodeFence = (value: string): string => value
  .trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/i, "")
  .trim();

const asText = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export const parsePodcastScript = async (
  raw: string,
  records: RecordBlock[],
): Promise<Pick<KnowledgePodcast, "title" | "opening" | "segments" | "closing">> => {
  const parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") throw new Error("AI 返回的播客脚本不是对象。");
  const validIds = new Set(records.map((record) => record.id));
  const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
  if (rawSegments.length === 0) throw new Error("AI 没有返回可播放的播客章节。");
  const segments: KnowledgePodcastSegment[] = [];
  for (const [index, item] of rawSegments.entries()) {
    if (!item || typeof item !== "object") continue;
    const sourceRecordIds = Array.isArray((item as Record<string, unknown>).sourceRecordIds)
      ? ((item as Record<string, unknown>).sourceRecordIds as unknown[]).filter((id): id is string => typeof id === "string" && validIds.has(id))
      : [];
    const text = asText((item as Record<string, unknown>).text);
    const title = asText((item as Record<string, unknown>).title) || `第 ${index + 1} 节`;
    if (!text || sourceRecordIds.length === 0) continue;
    segments.push({
      id: newId(), order: index, title, text, sourceRecordIds,
      textHash: await hashText(text), audioStatus: "pending",
    });
  }
  if (segments.length === 0) throw new Error("AI 返回的播客章节缺少正文。");
  return {
    title: asText(parsed.title) || "知识回顾",
    opening: asText(parsed.opening),
    segments,
    closing: asText(parsed.closing),
  };
};

export const buildPodcastPrompt = (options: {
  mode: KnowledgePodcast["mode"];
  targetMinutes: KnowledgePodcast["targetMinutes"];
  context: AiContextPack;
}): string => {
  const modeText = options.mode === "summary" ? "精炼回顾" : "复习讲解";
  const sourceIndex = [...new Map(options.context.selectedChunks.map((chunk) => [chunk.recordId, chunk.sourceLabel.split(" / ").slice(0, 3).join(" / ")])).entries()]
    .map(([id, label]) => `${id}: ${label}`)
    .join("\n");
  return `请把下面的本地学习记录整理成一份适合中文语音播放的个人知识播客脚本。
模式：${modeText}
目标时长：约 ${options.targetMinutes} 分钟（允许有合理误差）
标题：简短、具体，不要使用 Markdown。

严格要求：
1. 只能使用知识范围中的信息，不要编造来源中没有的事实。
2. 输出纯 JSON，不要 Markdown 代码围栏，不要解释 JSON 以外的内容。
3. JSON 格式必须是：{"title":"...","opening":"...","segments":[{"title":"...","text":"...","sourceRecordIds":["记录 ID"]}],"closing":"..."}。
4. segments 至少 1 个，最多 8 个；每个章节正文适合朗读，避免表格、项目符号和复杂符号。
5. 每个章节必须有来源；sourceRecordIds 只能填写下面记录中的 ID，无法确定来源的内容不要写进脚本。
6. ${options.mode === "summary" ? "提炼重点、结论和记录之间的联系。" : "像老师一样解释重点、联系、易错点，并穿插少量回忆提示。"}

知识范围：${options.context.scopeTitle}
可用来源记录：
${sourceIndex}`;
};

const buildPodcastRetryPrompt = (prompt: string): string => `${prompt}

这是第二次也是最后一次尝试。请停止继续分析，立即输出最终 JSON 对象。不要输出思考过程、解释、代码围栏或 JSON 以外的字符。`;

const isOfficialDeepSeekV4 = (provider: NonNullable<ReturnType<typeof getCurrentAiProvider>>): boolean => {
  try {
    return new URL(provider.baseUrl).hostname.toLowerCase() === "api.deepseek.com" && /^deepseek-v4(?:-|$)/i.test(provider.model);
  } catch {
    return false;
  }
};

const scriptOutputTokens = (provider: NonNullable<ReturnType<typeof getCurrentAiProvider>>): number =>
  Math.min(PODCAST_MAX_OUTPUT_TOKENS, Math.max(PODCAST_MIN_OUTPUT_TOKENS, provider.maxTokens));

const toScriptDiagnostic = (
  provider: NonNullable<ReturnType<typeof getCurrentAiProvider>>,
  result: AiCompletionResult | undefined,
  attempts: number,
): KnowledgePodcastScriptDiagnostic => ({
  providerName: provider.providerName,
  model: provider.model,
  finishReason: result?.finishReason,
  usage: result?.usage,
  requestId: result?.requestId,
  attempts,
});

export class KnowledgePodcastScriptError extends Error {
  constructor(message: string, readonly diagnostic: KnowledgePodcastScriptDiagnostic) {
    super(message);
    this.name = "KnowledgePodcastScriptError";
  }
}

const usageSummary = (result: AiCompletionResult | undefined): string => {
  const usage = result?.usage;
  if (!usage) return "";
  return [
    usage.promptTokens !== undefined ? `输入 ${usage.promptTokens} Token` : "",
    usage.completionTokens !== undefined ? `输出 ${usage.completionTokens} Token` : "",
    usage.reasoningTokens !== undefined ? `其中推理 ${usage.reasoningTokens} Token` : "",
  ].filter(Boolean).join("，");
};

export const formatPodcastScriptFailure = (
  provider: NonNullable<ReturnType<typeof getCurrentAiProvider>>,
  result: AiCompletionResult | undefined,
  attempts: number,
  parseError?: unknown,
): string => {
  const details = [
    `${provider.providerName} / ${provider.model} 未返回可用的最终脚本`,
    result?.finishReason ? `结束原因 ${result.finishReason}` : "",
    usageSummary(result),
    result?.requestId ? `请求 ID ${result.requestId}` : "",
    `已尝试 ${attempts} 次`,
    parseError instanceof Error && result?.content ? `脚本解析失败：${parseError.message}` : "",
  ].filter(Boolean);
  return `${details.join("；")}。`;
};

export const generatePodcastScript = async (options: {
  podcast: KnowledgePodcast;
  blocks: unknown[];
  assets: unknown[];
  settings: AppSettings;
  signal?: AbortSignal;
  onProgress?: (stage: "building-context" | "requesting-ai" | "retrying-ai" | "parsing-script", message: string, attempt: number) => void | Promise<void>;
}): Promise<{
  context: AiContextPack;
  script: Pick<KnowledgePodcast, "title" | "opening" | "segments" | "closing">;
  diagnostic: KnowledgePodcastScriptDiagnostic;
}> => {
  const blocks = options.blocks as import("../types").Block[];
  const assets = options.assets as import("../types").Asset[];
  const provider = getCurrentAiProvider(options.settings.ai);
  const apiKey = provider ? (await storage.getAiSecret?.(provider.id))?.apiKey : undefined;
  if (!provider) throw new Error("请先在“更多 → AI 设置”里配置 AI 供应商。");
  const initialPrompt = `请生成一份${options.podcast.mode === "summary" ? "精炼回顾" : "复习讲解"}知识播客脚本。`;
  const outputTokens = scriptOutputTokens(provider);
  const podcastProvider = { ...provider, maxTokens: outputTokens };
  const initialBudget = calculateAiRequestBudget({ provider: podcastProvider, history: [], prompt: initialPrompt });
  await options.onProgress?.("building-context", "正在整理知识范围并构建本地上下文…", 1);
  const context = await buildAiKnowledgeContextPackAsync(options.podcast.scope, blocks, assets, "", options.signal, {
    maxTokens: initialBudget.retrievalTokens,
    retrievalMode: "coverage",
    preferDiverse: true,
  });
  if (context.recordIds.length === 0) throw new Error("当前知识范围没有可用于播客的记录。");
  const prompt = buildPodcastPrompt({ mode: options.podcast.mode, targetMinutes: options.podcast.targetMinutes, context });
  const budget = calculateAiRequestBudget({ provider: podcastProvider, history: [], prompt, attachment: context });
  const records = getAiKnowledgeScopeRecords(options.podcast.scope, blocks, context.date);
  const deepSeek = isOfficialDeepSeekV4(provider);
  let lastResult: AiCompletionResult | undefined;
  let lastParseError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const retrying = attempt === 2;
    await options.onProgress?.(
      retrying ? "retrying-ai" : "requesting-ai",
      retrying ? "AI 第一次未返回可用脚本，正在进行最后一次重试…" : `正在请求 ${provider.providerName} / ${provider.model} 生成脚本…`,
      attempt,
    );
    try {
      lastResult = await sendChatCompletionDetailed({
        provider,
        apiKey,
        attachment: context,
        history: [],
        prompt: retrying ? buildPodcastRetryPrompt(prompt) : prompt,
        budget,
        request: {
          maxTokens: outputTokens,
          structuredOutput: deepSeek,
          thinkingMode: deepSeek ? "enabled" : undefined,
          reasoningEffort: deepSeek ? "high" : undefined,
          timeoutMs: PODCAST_SCRIPT_TIMEOUT_MS,
          signal: options.signal,
        },
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      const rawMessage = error instanceof Error ? error.message : "未知网络错误。";
      const timeout = /超时|等待超过|timeout/i.test(rawMessage);
      throw new KnowledgePodcastScriptError(
        `${provider.providerName} / ${provider.model} ${timeout ? "网络超时" : "请求未到达供应商或未取得响应"}：${rawMessage}`,
        toScriptDiagnostic(provider, undefined, attempt),
      );
    }
    if (!lastResult.content) {
      lastParseError = undefined;
      continue;
    }
    try {
      await options.onProgress?.("parsing-script", "AI 已返回内容，正在校验章节和来源…", attempt);
      const script = await parsePodcastScript(lastResult.content, records);
      return { context, script, diagnostic: toScriptDiagnostic(provider, lastResult, attempt) };
    } catch (error) {
      lastParseError = error;
    }
  }
  throw new KnowledgePodcastScriptError(
    formatPodcastScriptFailure(provider, lastResult, 2, lastParseError),
    toScriptDiagnostic(provider, lastResult, 2),
  );
};

export interface TextToSpeechProvider {
  synthesize(text: string, options: {
    model: string;
    voiceId: string;
    format: "mp3";
    signal?: AbortSignal;
  }): Promise<Blob>;
}

export class FishAudioTtsProvider implements TextToSpeechProvider {
  constructor(private readonly apiKey: string) {}

  async synthesize(text: string, options: Parameters<TextToSpeechProvider["synthesize"]>[1]): Promise<Blob> {
    const hosted = await synthesizeFishAudioOnHost({ apiKey: this.apiKey, model: options.model, voiceId: options.voiceId, text, format: options.format }, options.signal);
    if (hosted) return hosted;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await fetch("https://api.fish.audio/v1/tts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey.trim()}`,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
            model: options.model,
          },
          body: JSON.stringify({
            text,
            reference_id: options.voiceId,
            format: options.format,
            normalize: true,
            mp3_bitrate: 128,
            latency: "normal",
            chunk_length: 300,
          }),
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new Error("浏览器无法直接访问 Fish Audio（可能被 CORS 拦截）。请使用桌面版、Android 版，或配置后端代理。");
      }
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size === 0) throw new Error("Fish Audio 返回了空音频。");
        return blob;
      }
      const detail = await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) {
        throw new Error(`Fish Audio 请求失败（${response.status}）：${detail.slice(0, 180)}`);
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 350 * (attempt + 1));
        options.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("TTS cancelled", "AbortError")); }, { once: true });
      });
    }
    throw new Error("Fish Audio 请求失败。");
  }
}

export const splitTtsText = (text: string, maxBytes = 800): string[] => {
  const parts: string[] = [];
  let current = "";
  const sentences = text.split(/(?<=[。！？!?；;])\s*|\n+/).map((item) => item.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (new TextEncoder().encode(sentence).length > maxBytes) {
      if (current) { parts.push(current); current = ""; }
      let chunk = "";
      for (const character of sentence) {
        const candidate = `${chunk}${character}`;
        if (new TextEncoder().encode(candidate).length > maxBytes && chunk) {
          parts.push(chunk);
          chunk = character;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) current = chunk;
      continue;
    }
    const candidate = current ? `${current}${sentence}` : sentence;
    if (new TextEncoder().encode(candidate).length <= maxBytes || !current) {
      current = candidate;
      continue;
    }
    parts.push(current);
    current = sentence;
  }
  if (current) parts.push(current);
  return parts;
};

export const createEmptyPodcast = (scope: AiKnowledgeScope, mode: KnowledgePodcast["mode"] = "summary", targetMinutes: KnowledgePodcast["targetMinutes"] = 5): KnowledgePodcast => ({
  ...createBaseEntity(), title: "未命名知识播客", mode, targetMinutes, scope, sourceRecordIds: [], contextHash: "",
  scriptStatus: "idle", audioStatus: "idle", segments: [], audioLayoutVersion: 2, audioUnits: [],
  ttsConfig: { providerId: "fish-audio", model: DEFAULT_FISH_MODEL, voiceId: "", format: "mp3" },
});
