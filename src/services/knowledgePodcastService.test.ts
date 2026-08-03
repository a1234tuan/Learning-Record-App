import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, KnowledgePodcast, RecordBlock } from "../types";
import {
  generatePodcastScript,
  createPodcastAudioUnits,
  parsePodcastScript,
  PODCAST_MAX_OUTPUT_TOKENS,
  PODCAST_MIN_OUTPUT_TOKENS,
  splitTtsText,
} from "./knowledgePodcastService";
import { sendChatCompletionDetailed } from "./aiClientService";
import { storage } from "./storageAdapter";
import { DEFAULT_SETTINGS } from "../db/defaults";

vi.mock("./aiClientService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./aiClientService")>();
  return { ...original, sendChatCompletionDetailed: vi.fn() };
});

const record = (id: string): RecordBlock => ({
  id, createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z",
  type: "record", date: "2026-08-03", order: 0, subject: "数据结构", title: id,
  contentHtml: "<p>content</p>", assets: [], formulas: [], mistakeRefs: [], tags: [],
});

const podcast = (): KnowledgePodcast => ({
  id: "podcast-1",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  title: "播客",
  mode: "explain",
  targetMinutes: 5,
  scope: { kind: "records", recordIds: ["r1"] },
  sourceRecordIds: ["r1"],
  contextHash: "",
  scriptStatus: "idle",
  audioStatus: "idle",
  segments: [],
  ttsConfig: { providerId: "fish-audio", model: "s2.1-pro-free", voiceId: "", format: "mp3" },
});

const settings = (maxTokens = 4096): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ai: {
    currentProviderId: "deepseek",
    providers: [{
      id: "deepseek",
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      temperature: 0.7,
      maxTokens,
      contextWindowTokens: 65_536,
      builtIn: "deepseek",
    }],
    presets: [],
    imageInputMode: "local-ocr",
  },
});

afterEach(() => vi.restoreAllMocks());

describe("knowledgePodcastService", () => {
  it("parses fenced JSON and removes unknown source ids", async () => {
    const script = await parsePodcastScript(`\`\`\`json
      {"title":"复习","opening":"开始","segments":[{"title":"树","text":"遍历知识。","sourceRecordIds":["r1","unknown"]}],"closing":"结束"}
    \`\`\``, [record("r1")]);
    expect(script.title).toBe("复习");
    expect(script.segments[0].sourceRecordIds).toEqual(["r1"]);
    expect(script.segments[0].audioStatus).toBe("pending");
  });

  it("rejects scripts without usable segments", async () => {
    await expect(parsePodcastScript('{"title":"空","segments":[]}', [record("r1")])).rejects.toThrow("章节");
  });

  it("splits long text on Chinese sentence boundaries", () => {
    const text = `${"第一句话。".repeat(80)}第二段。`;
    const parts = splitTtsText(text, 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join("")).toBe(text);
  });

  it("creates independent opening, chapter and closing audio units in playback order", async () => {
    const units = await createPodcastAudioUnits({
      opening: "欢迎收听。",
      segments: [
        { id: "s1", order: 0, title: "第一章", text: "正文一。", sourceRecordIds: ["r1"], textHash: "", audioStatus: "pending" },
        { id: "s2", order: 1, title: "第二章", text: "正文二。", sourceRecordIds: ["r1"], textHash: "", audioStatus: "pending" },
      ],
      closing: "本期结束。",
    });

    expect(units.map((unit) => [unit.kind, unit.title, unit.order])).toEqual([
      ["opening", "开场", 0], ["segment", "第一章", 1], ["segment", "第二章", 2], ["closing", "结尾", 3],
    ]);
    expect(units.map((unit) => unit.segmentId)).toEqual([undefined, "s1", "s2", undefined]);
  });

  it("does not create empty opening or closing audio units", async () => {
    const units = await createPodcastAudioUnits({
      opening: "  ", closing: "",
      segments: [{ id: "s1", order: 0, title: "第一章", text: "正文。", sourceRecordIds: ["r1"], textHash: "", audioStatus: "pending" }],
    });
    expect(units.map((unit) => unit.kind)).toEqual(["segment"]);
  });

  it("retries one empty DeepSeek response and keeps structured thinking options", async () => {
    vi.spyOn(storage, "getAiSecret").mockResolvedValue({ id: "deepseek", apiKey: "test", updatedAt: "2026-08-03T00:00:00.000Z" });
    vi.mocked(sendChatCompletionDetailed)
      .mockResolvedValueOnce({ content: "", finishReason: "length", usage: { completionTokens: 16384, reasoningTokens: 16120 }, requestId: "req-1" })
      .mockResolvedValueOnce({
        content: '{"title":"复习","segments":[{"title":"树","text":"遍历知识。","sourceRecordIds":["r1"]}]}',
        finishReason: "stop",
        usage: { completionTokens: 120, reasoningTokens: 80 },
        requestId: "req-2",
      });

    const result = await generatePodcastScript({ podcast: podcast(), blocks: [record("r1")], assets: [], settings: settings() });

    expect(sendChatCompletionDetailed).toHaveBeenCalledTimes(2);
    const first = vi.mocked(sendChatCompletionDetailed).mock.calls[0][0];
    const second = vi.mocked(sendChatCompletionDetailed).mock.calls[1][0];
    expect(first.request).toMatchObject({
      maxTokens: PODCAST_MIN_OUTPUT_TOKENS,
      structuredOutput: true,
      thinkingMode: "enabled",
      reasoningEffort: "high",
      timeoutMs: 300_000,
    });
    expect(second.request).toMatchObject({ thinkingMode: "enabled", structuredOutput: true });
    expect(second.prompt).toContain("第二次也是最后一次尝试");
    expect(result.diagnostic).toMatchObject({ attempts: 2, requestId: "req-2", finishReason: "stop" });
  });

  it("caps the podcast output budget and reports the final DeepSeek diagnostics after two failures", async () => {
    vi.spyOn(storage, "getAiSecret").mockResolvedValue({ id: "deepseek", apiKey: "test", updatedAt: "2026-08-03T00:00:00.000Z" });
    vi.mocked(sendChatCompletionDetailed).mockResolvedValue({
      content: "",
      finishReason: "length",
      usage: { promptTokens: 3000, completionTokens: 32768, reasoningTokens: 32600 },
      requestId: "req-final",
    });

    await expect(generatePodcastScript({ podcast: podcast(), blocks: [record("r1")], assets: [], settings: settings(100_000) })).rejects.toThrow(
      /DeepSeek \/ deepseek-v4-pro.*结束原因 length.*输出 32768 Token.*推理 32600 Token.*请求 ID req-final.*已尝试 2 次/,
    );
    expect(vi.mocked(sendChatCompletionDetailed).mock.calls[0][0].request?.maxTokens).toBe(PODCAST_MAX_OUTPUT_TOKENS);
    expect(sendChatCompletionDetailed).toHaveBeenCalledTimes(2);
  });
});
