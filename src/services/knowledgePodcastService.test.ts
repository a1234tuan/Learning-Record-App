import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiContextPack, AppSettings, KnowledgePodcast, RecordBlock } from "../types";
import {
  applyPodcastCreativeBriefMode,
  buildPodcastPrompt,
  buildPodcastPromptPreview,
  estimatePodcastScriptDuration,
  generatePodcastScript,
  createPodcastAudioUnits,
  getPodcastCreativeBriefDefaults,
  normalizePodcastCreativeBrief,
  parsePodcastScript,
  PODCAST_MAX_OUTPUT_TOKENS,
  PODCAST_MIN_OUTPUT_TOKENS,
  splitTtsText,
  validatePodcastModeTemplate,
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

  it("keeps the JSON and source constraints after a custom podcast direction", () => {
    const context = {
      scopeTitle: "指定日志",
      selectedChunks: [{ recordId: "r1", sourceLabel: "2026-08-03 / 数据结构 / 树" }],
    } as AiContextPack;
    const prompt = buildPodcastPrompt({
      mode: "custom",
      customMode: { templateId: "mode-1", title: "错题抽测", prompt: "只讲易错点，并设置抽测问题。" },
      focusInstruction: "只针对并查集。",
      targetMinutes: 5,
      context,
    });
    expect(prompt).toContain("只讲易错点，并设置抽测问题。");
    expect(prompt).toContain("只针对并查集。");
    expect(prompt).toContain("约 1200 个朗读字符");
    expect(prompt).toContain("不可覆盖的硬性要求");
    expect(prompt).toContain('"sourceRecordIds"');
  });

  it("renders supported advanced-template variables and appends the structured brief when it is not inserted", () => {
    const context = {
      scopeTitle: "指定日志",
      selectedChunks: [{ recordId: "r1", sourceLabel: "2026-08-03 / 数据结构 / 树" }],
    } as AiContextPack;
    const prompt = buildPodcastPrompt({
      mode: "custom",
      customMode: {
        templateId: "mode-1",
        title: "错题抽测",
        prompt: "你是一位 {{讲述角色}}，面向 {{目标听众}}。优先讲 {{必须覆盖}}。",
      },
      creativeBrief: {
        narratorRole: "复习教练",
        audience: "考前复习者",
        mustCover: "并查集的易错点",
        chapterRequirements: "每章提出一个自测问题",
      },
      targetMinutes: 5,
      context,
    });
    expect(prompt).toContain("你是一位 复习教练，面向 考前复习者。优先讲 并查集的易错点。");
    expect(prompt).toContain("本期节目策划：");
    expect(prompt).toContain("章节要求：每章提出一个自测问题");
    expect(prompt.indexOf("不可覆盖的硬性要求")).toBeGreaterThan(prompt.indexOf("本期节目策划"));
  });

  it("does not duplicate the brief when the advanced template explicitly inserts it", () => {
    const prompt = buildPodcastPromptPreview({
      mode: "custom",
      customMode: { templateId: "mode-1", title: "模板", prompt: "按以下策划生成：\n{{策划摘要}}" },
      creativeBrief: { objective: "系统讲解", supplementaryRequirements: "只讲适用条件" },
      targetMinutes: 3,
      scopeTitle: "最近 7 天",
    });
    expect(prompt.match(/本期节目策划：/g)).toHaveLength(1);
    expect(prompt).toContain("本期补充要求：只讲适用条件");
    expect(prompt).toContain("生成时将根据当前知识范围列出来源");
  });

  it("rejects unknown template variables and migrates legacy focus instructions into the creative brief", () => {
    expect(validatePodcastModeTemplate("解释 {{不存在的字段}} 和 {{目标听众}}")).toEqual(["{{不存在的字段}}"]);
    expect(() => buildPodcastPromptPreview({
      mode: "custom",
      customMode: { templateId: "mode-1", title: "模板", prompt: "{{不存在的字段}}" },
      targetMinutes: 5,
      scopeTitle: "最近 7 天",
    })).toThrow("不支持的变量");
    expect(normalizePodcastCreativeBrief(undefined, "只讲易错点")).toEqual({ supplementaryRequirements: "只讲易错点" });
  });

  it("updates only untouched built-in recommendations when switching modes", () => {
    const summary = getPodcastCreativeBriefDefaults("summary");
    const next = applyPodcastCreativeBriefMode({ ...summary, audience: "专业同行" }, "summary", "explain");
    expect(next.objective).toBe(getPodcastCreativeBriefDefaults("explain").objective);
    expect(next.audience).toBe("专业同行");
  });

  it("estimates duration from speech text only, ignoring title and whitespace", () => {
    const estimate = estimatePodcastScriptDuration({
      opening: "甲 ", closing: "乙",
      segments: [{ id: "s1", order: 0, title: "不应计入", text: " 丙丁 ", sourceRecordIds: ["r1"], textHash: "", audioStatus: "pending" }],
    }, 3);
    expect(estimate).toEqual({ speechCharacterCount: 4, estimatedDurationSeconds: 1, durationTargetDeviation: expect.closeTo(-0.9944, 4) });
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
