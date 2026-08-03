import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, KnowledgePodcast } from "../types";

const { generatePodcastScriptMock, synthesizeMock } = vi.hoisted(() => ({ generatePodcastScriptMock: vi.fn(), synthesizeMock: vi.fn() }));

vi.mock("./knowledgePodcastService", async (importOriginal) => {
  const original = await importOriginal<typeof import("./knowledgePodcastService")>();
  return {
    ...original,
    generatePodcastScript: generatePodcastScriptMock,
    createTtsProvider: () => ({ synthesize: synthesizeMock }),
  };
});

import { cancelKnowledgePodcastJob, isKnowledgePodcastJobRunning, startKnowledgePodcastAudioJob, startKnowledgePodcastScriptJob } from "./knowledgePodcastJobService";
import { storage } from "./storageAdapter";
import { DEFAULT_SETTINGS } from "../db/defaults";

const settings = (): AppSettings => ({
  ...DEFAULT_SETTINGS,
  ai: {
    currentProviderId: "deepseek",
    providers: [{
      id: "deepseek",
      providerName: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      temperature: 0.7,
      maxTokens: 4096,
      contextWindowTokens: 65_536,
    }],
    presets: [],
    imageInputMode: "local-ocr",
  },
  tts: {
    currentProviderId: "fish-audio",
    providers: [{ id: "fish-audio", providerId: "fish-audio" as const, providerName: "Fish Audio", model: "s2.1-pro-free", voice: "test-voice" }],
  },
});

const podcast = (): KnowledgePodcast => ({
  id: "podcast-job",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  title: "后台任务",
  mode: "summary",
  targetMinutes: 5,
  scope: { kind: "recent", days: 7 },
  sourceRecordIds: ["record-1"],
  contextHash: "",
  scriptStatus: "idle",
    audioStatus: "idle",
    audioLayoutVersion: 2,
    audioUnits: [],
    segments: [],
  ttsConfig: { providerId: "fish-audio", model: "s2.1-pro-free", voiceId: "voice", format: "mp3" },
});

afterEach(() => {
  cancelKnowledgePodcastJob("podcast-job", "script");
  cancelKnowledgePodcastJob("podcast-job", "audio");
  vi.restoreAllMocks();
  generatePodcastScriptMock.mockReset();
  synthesizeMock.mockReset();
});

describe("knowledgePodcastJobService", () => {
  it("keeps a script task alive after the caller returns and rejects duplicates", async () => {
    let rejectGeneration: (error: Error) => void = () => undefined;
    generatePodcastScriptMock.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
      rejectGeneration = reject;
      signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));

    let current = podcast();
    vi.spyOn(storage, "getKnowledgePodcast").mockImplementation(async () => current);
    vi.spyOn(storage, "getSettings").mockResolvedValue(settings());
    vi.spyOn(storage, "getAiSecret").mockResolvedValue({ id: "deepseek", apiKey: "test", updatedAt: "2026-08-03T00:00:00.000Z" });
    vi.spyOn(storage, "listBlocks").mockResolvedValue([]);
    vi.spyOn(storage, "listAssets").mockResolvedValue([]);
    vi.spyOn(storage, "saveKnowledgePodcast").mockImplementation(async (next) => { current = next; return next; });

    await startKnowledgePodcastScriptJob(current.id);
    expect(isKnowledgePodcastJobRunning(current.id, "script")).toBe(true);
    await expect(startKnowledgePodcastScriptJob(current.id)).rejects.toThrow("正在生成脚本");

    cancelKnowledgePodcastJob(current.id, "script");
    rejectGeneration(new DOMException("cancelled", "AbortError"));
    await vi.waitFor(() => expect(isKnowledgePodcastJobRunning(current.id, "script")).toBe(false));
    expect(current.generation?.status).toBe("cancelled");
    expect(current.scriptStatus).toBe("failed");
  });

  it("persists the latest non-sensitive diagnostic when the provider returns no final script", async () => {
    const { KnowledgePodcastScriptError } = await import("./knowledgePodcastService");
    generatePodcastScriptMock.mockRejectedValue(new KnowledgePodcastScriptError(
      "DeepSeek / deepseek-v4-pro 未返回可用的最终脚本。",
      {
        providerName: "DeepSeek",
        model: "deepseek-v4-pro",
        finishReason: "length",
        usage: { promptTokens: 2000, completionTokens: 16384, reasoningTokens: 16120 },
        requestId: "req-empty",
        attempts: 2,
      },
    ));
    let current = podcast();
    vi.spyOn(storage, "getKnowledgePodcast").mockImplementation(async () => current);
    vi.spyOn(storage, "getSettings").mockResolvedValue(settings());
    vi.spyOn(storage, "getAiSecret").mockResolvedValue({ id: "deepseek", apiKey: "test", updatedAt: "2026-08-03T00:00:00.000Z" });
    vi.spyOn(storage, "listBlocks").mockResolvedValue([]);
    vi.spyOn(storage, "listAssets").mockResolvedValue([]);
    vi.spyOn(storage, "saveKnowledgePodcast").mockImplementation(async (next) => { current = next; return next; });

    await startKnowledgePodcastScriptJob(current.id);
    await vi.waitFor(() => expect(isKnowledgePodcastJobRunning(current.id, "script")).toBe(false));

    expect(current.scriptDiagnostic).toMatchObject({ finishReason: "length", requestId: "req-empty", attempts: 2 });
    expect(current.scriptStatus).toBe("failed");
  });

  it("generates opening, each chapter and closing as independent TTS assets", async () => {
    let current: KnowledgePodcast = {
      ...podcast(),
      opening: "这是开场。",
      closing: "这是结尾。",
      segments: [
        { id: "segment-1", order: 0, title: "第一章", text: "这是正文。", sourceRecordIds: ["record-1"], textHash: "", audioStatus: "pending" },
      ],
    };
    let nextAsset = 0;
    synthesizeMock.mockResolvedValue(new Blob(["audio"], { type: "audio/mpeg" }));
    vi.spyOn(storage, "getKnowledgePodcast").mockImplementation(async () => current);
    vi.spyOn(storage, "getSettings").mockResolvedValue(settings());
    vi.spyOn(storage, "getAiSecret").mockResolvedValue({ id: "fish-audio", apiKey: "test", updatedAt: "2026-08-03T00:00:00.000Z" });
    vi.spyOn(storage, "getAsset").mockResolvedValue(undefined);
    vi.spyOn(storage, "saveAsset").mockImplementation(async (file) => ({
      id: `asset-${++nextAsset}`, createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z",
      fileName: file.name, title: file.name, mimeType: file.type, size: file.size, kind: "audio", data: file,
    }));
    vi.spyOn(storage, "patchAsset").mockResolvedValue(undefined);
    vi.spyOn(storage, "saveKnowledgePodcast").mockImplementation(async (next) => { current = next; return next; });

    await startKnowledgePodcastAudioJob(current.id);
    await vi.waitFor(() => expect(isKnowledgePodcastJobRunning(current.id, "audio")).toBe(false));

    expect(synthesizeMock.mock.calls.map(([text]) => text)).toEqual(["这是开场。", "这是正文。", "这是结尾。"]);
    expect(current.audioUnits?.map((unit) => [unit.kind, unit.audioStatus, unit.audioAssetId])).toEqual([
      ["opening", "ready", "asset-1"], ["segment", "ready", "asset-2"], ["closing", "ready", "asset-3"],
    ]);
    expect(current.audioStatus).toBe("ready");
  });

  it("uses the globally configured Voice ID for new audio generation", async () => {
    let current: KnowledgePodcast = {
      ...podcast(),
      segments: [{ id: "segment-1", order: 0, title: "第一章", text: "正文。", sourceRecordIds: ["record-1"], textHash: "", audioStatus: "pending" }],
    };
    const globalSettings = {
      ...settings(),
      tts: {
        currentProviderId: "fish-audio",
        providers: [{ id: "fish-audio", providerId: "fish-audio" as const, providerName: "Fish Audio", model: "s2.1-pro-free", voice: "global-voice" }],
      },
    };
    synthesizeMock.mockResolvedValue(new Blob(["audio"], { type: "audio/mpeg" }));
    vi.spyOn(storage, "getKnowledgePodcast").mockImplementation(async () => current);
    vi.spyOn(storage, "getSettings").mockResolvedValue(globalSettings);
    vi.spyOn(storage, "getAiSecret").mockResolvedValue({ id: "fish-audio", apiKey: "test", updatedAt: "2026-08-03T00:00:00.000Z" });
    vi.spyOn(storage, "getAsset").mockResolvedValue(undefined);
    vi.spyOn(storage, "saveAsset").mockImplementation(async (file) => ({ id: "asset-global", createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z", fileName: file.name, title: file.name, mimeType: file.type, size: file.size, kind: "audio", data: file }));
    vi.spyOn(storage, "patchAsset").mockResolvedValue(undefined);
    vi.spyOn(storage, "saveKnowledgePodcast").mockImplementation(async (next) => { current = next; return next; });

    await startKnowledgePodcastAudioJob(current.id);
    await vi.waitFor(() => expect(isKnowledgePodcastJobRunning(current.id, "audio")).toBe(false));

    expect(synthesizeMock).toHaveBeenCalledWith("正文。", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(current.ttsConfig.voiceId).toBe("global-voice");
  });
});
