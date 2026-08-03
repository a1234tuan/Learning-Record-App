import type { KnowledgePodcast, KnowledgePodcastAudioUnit, KnowledgePodcastGenerationProgress } from "../types";
import { getCurrentAiProvider } from "../lib/aiProviders";
import {
  FishAudioTtsProvider,
  createPodcastAudioUnits,
  reconcilePodcastAudioUnits,
  generatePodcastScript,
  hashText,
  KnowledgePodcastScriptError,
  splitTtsText,
} from "./knowledgePodcastService";
import { storage } from "./storageAdapter";

type PodcastJobKind = "script" | "audio";

const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

const jobKey = (podcastId: string, kind: PodcastJobKind) => `${podcastId}:${kind}`;
const now = () => new Date().toISOString();

const emit = () => listeners.forEach((listener) => listener());

const savePodcast = async (podcast: KnowledgePodcast): Promise<KnowledgePodcast> => {
  const saved = await storage.saveKnowledgePodcast?.(podcast) ?? podcast;
  emit();
  return saved;
};

const generatedAssetIds = (podcast: KnowledgePodcast): string[] => [
  ...podcast.segments.flatMap((segment) => segment.audioAssetId ? [segment.audioAssetId] : []),
  ...(podcast.audioUnits ?? []).flatMap((unit) => unit.audioAssetId ? [unit.audioAssetId] : []),
  ...(podcast.pendingAudioCleanupAssetIds ?? []),
];

const unitText = (podcast: KnowledgePodcast, unit: KnowledgePodcastAudioUnit): string => {
  if (unit.kind === "opening") return podcast.opening?.trim() ?? "";
  if (unit.kind === "closing") return podcast.closing?.trim() ?? "";
  return podcast.segments.find((segment) => segment.id === unit.segmentId)?.text.trim() ?? "";
};

const updateUnit = (
  podcast: KnowledgePodcast,
  unitId: string,
  patch: Partial<KnowledgePodcastAudioUnit>,
): KnowledgePodcast => {
  const target = podcast.audioUnits?.find((unit) => unit.id === unitId);
  return {
    ...podcast,
    audioUnits: podcast.audioUnits?.map((unit) => unit.id === unitId ? { ...unit, ...patch } : unit),
    segments: target?.kind === "segment" ? podcast.segments.map((segment) => segment.id === target.segmentId ? {
      ...segment,
      ...(patch.textHash ? { textHash: patch.textHash } : {}),
      ...(patch.audioAssetId !== undefined ? { audioAssetId: patch.audioAssetId } : {}),
      ...(patch.audioStatus ? { audioStatus: patch.audioStatus } : {}),
      ...(patch.durationSeconds !== undefined ? { durationSeconds: patch.durationSeconds } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
    } : segment) : podcast.segments,
  };
};

const audioStatusForUnits = (units: KnowledgePodcastAudioUnit[]): KnowledgePodcast["audioStatus"] => {
  if (!units.length || units.some((unit) => unit.audioStatus !== "ready" || !unit.audioAssetId)) return "partial";
  return "ready";
};

const ensureAudioLayout = async (podcast: KnowledgePodcast): Promise<KnowledgePodcast> => {
  if (podcast.audioLayoutVersion === 2 && podcast.audioUnits) return reconcilePodcastAudioUnits(podcast);
  const audioUnits = await createPodcastAudioUnits(podcast);
  return {
    ...podcast,
    audioLayoutVersion: 2,
    audioUnits,
    audioStatus: "idle",
    pendingAudioCleanupAssetIds: Array.from(new Set(generatedAssetIds(podcast))),
  };
};

const cleanupReplacedAudio = async (podcast: KnowledgePodcast): Promise<KnowledgePodcast> => {
  const activeIds = new Set((podcast.audioUnits ?? []).flatMap((unit) => unit.audioAssetId ? [unit.audioAssetId] : []));
  for (const id of podcast.pendingAudioCleanupAssetIds ?? []) {
    if (activeIds.has(id)) continue;
    const asset = await storage.getAsset(id);
    if (asset?.generatedBy === "knowledge-podcast") await storage.deleteAsset?.(id);
  }
  return { ...podcast, pendingAudioCleanupAssetIds: undefined };
};

const progress = (
  kind: PodcastJobKind,
  stage: KnowledgePodcastGenerationProgress["stage"],
  message: string,
  startedAt: string,
  patch: Partial<KnowledgePodcastGenerationProgress> = {},
): KnowledgePodcastGenerationProgress => ({
  kind,
  status: "running",
  stage,
  message,
  startedAt,
  updatedAt: now(),
  ...patch,
});

export const subscribeKnowledgePodcastJobs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isKnowledgePodcastJobRunning = (podcastId: string, kind: PodcastJobKind): boolean =>
  controllers.has(jobKey(podcastId, kind));

export const cancelKnowledgePodcastJob = (podcastId: string, kind: PodcastJobKind): void => {
  controllers.get(jobKey(podcastId, kind))?.abort();
};

export const cancelAllKnowledgePodcastJobs = (podcastId: string): void => {
  cancelKnowledgePodcastJob(podcastId, "script");
  cancelKnowledgePodcastJob(podcastId, "audio");
};

export const startKnowledgePodcastScriptJob = async (podcastId: string): Promise<void> => {
  const key = jobKey(podcastId, "script");
  if (controllers.has(key)) throw new Error("这期播客正在生成脚本，请勿重复提交。");
  const podcast = await storage.getKnowledgePodcast?.(podcastId);
  if (!podcast) throw new Error("知识播客不存在或已被删除。");
  const settings = await storage.getSettings();
  const provider = getCurrentAiProvider(settings.ai);
  const startedAt = now();
  const controller = new AbortController();
  controllers.set(key, controller);
  await savePodcast({
    ...podcast,
    scriptStatus: "generating",
    audioStatus: "idle",
    lastError: undefined,
    generation: progress("script", "preparing", "正在准备播客脚本任务…", startedAt, {
      providerName: provider?.providerName,
      model: provider?.model,
      attempt: 1,
    }),
  });

  void (async () => {
    let current = await storage.getKnowledgePodcast?.(podcastId) ?? podcast;
    try {
      const [blocks, assets, currentSettings] = await Promise.all([
        storage.listBlocks(),
        storage.listAssets(),
        storage.getSettings(),
      ]);
      const result = await generatePodcastScript({
        podcast: current,
        blocks,
        assets,
        settings: currentSettings,
        signal: controller.signal,
        onProgress: async (stage, message, attempt) => {
          current = await savePodcast({
            ...current,
            generation: progress("script", stage, message, startedAt, {
              providerName: provider?.providerName,
              model: provider?.model,
              attempt,
            }),
          });
        },
      });
      current = await savePodcast({
        ...current,
        generation: progress("script", "saving-script", "脚本已返回，正在保存播客草稿…", startedAt, {
          providerName: provider?.providerName,
          model: provider?.model,
          attempt: result.diagnostic.attempts,
        }),
      });
      const previousAudioIds = generatedAssetIds(current);
      const audioUnits = await createPodcastAudioUnits(result.script);
      current = await savePodcast({
        ...current,
        ...result.script,
        audioLayoutVersion: 2,
        audioUnits,
        pendingAudioCleanupAssetIds: Array.from(new Set(previousAudioIds)),
        contextHash: result.context.contextHash,
        sourceRecordIds: result.context.recordIds,
        scriptStatus: "ready",
        audioStatus: "idle",
        lastError: undefined,
        scriptDiagnostic: result.diagnostic,
        generation: {
          ...progress("script", "completed", "脚本已生成并永久保存。", startedAt),
          status: "completed",
        },
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = aborted ? "脚本生成已取消。" : error instanceof Error ? error.message : "脚本生成失败。";
      await savePodcast({
        ...current,
        scriptStatus: "failed",
        lastError: message,
        scriptDiagnostic: error instanceof KnowledgePodcastScriptError ? error.diagnostic : current.scriptDiagnostic,
        generation: {
          ...progress("script", aborted ? "cancelled" : "failed", message, startedAt),
          status: aborted ? "cancelled" : "failed",
        },
      });
    } finally {
      controllers.delete(key);
      emit();
    }
  })();
};

export const startKnowledgePodcastAudioJob = async (podcastId: string, onlyUnitId?: string): Promise<void> => {
  const key = jobKey(podcastId, "audio");
  if (controllers.has(key)) throw new Error("这期播客正在生成音频，请勿重复提交。");
  const storedPodcast = await storage.getKnowledgePodcast?.(podcastId);
  const podcast = storedPodcast ? await ensureAudioLayout(storedPodcast) : undefined;
  if (!podcast) throw new Error("知识播客不存在或已被删除。");
  if (!podcast?.segments.length || !podcast.audioUnits?.length) throw new Error("请先生成脚本。");
  const settings = await storage.getSettings();
  const apiKey = (await storage.getAiSecret?.("fish-audio"))?.apiKey;
  const voiceId = podcast.ttsConfig.voiceId.trim() || settings.tts?.voiceId?.trim();
  if (!apiKey) throw new Error("请先在 AI 工具设置中填写 Fish Audio API Key。");
  if (!voiceId) throw new Error("请先在 AI 工具设置中填写 Voice ID。");

  const startedAt = now();
  const controller = new AbortController();
  controllers.set(key, controller);
  let current = await savePodcast({
    ...podcast,
    audioStatus: "generating",
    lastError: undefined,
    ttsConfig: { ...podcast.ttsConfig, voiceId },
    generation: progress("audio", "preparing-audio", "正在准备播客音频…", startedAt, {
      providerName: "Fish Audio",
      model: podcast.ttsConfig.model,
      current: 0,
      total: podcast.audioUnits.length,
    }),
  });

  void (async () => {
    const provider = new FishAudioTtsProvider(apiKey);
    try {
      for (const unit of current.audioUnits ?? []) {
        if (onlyUnitId && unit.id !== onlyUnitId) continue;
        if (controller.signal.aborted) break;
        const existing = unit.audioAssetId ? await storage.getAsset(unit.audioAssetId) : undefined;
        if (unit.audioStatus === "ready" && existing) continue;
        const text = unitText(current, unit);
        if (!text) continue;
        const parts = splitTtsText(text);
        current = await savePodcast(updateUnit({
          ...current,
          generation: progress("audio", "generating-segment", `正在生成${unit.title}音频…`, startedAt, {
            providerName: "Fish Audio",
            model: current.ttsConfig.model,
            current: unit.order + 1,
            total: current.audioUnits?.length ?? 0,
          }),
        }, unit.id, { audioStatus: "generating", error: undefined }));
        try {
          const blobs: Blob[] = [];
          for (const [partIndex, part] of parts.entries()) {
            current = await savePodcast({
              ...current,
              generation: progress("audio", "generating-segment", `${unit.title}语音片段 ${partIndex + 1}/${parts.length}`, startedAt, {
                providerName: "Fish Audio",
                model: current.ttsConfig.model,
                current: unit.order + 1,
                total: current.audioUnits?.length ?? 0,
                partCurrent: partIndex + 1,
                partTotal: parts.length,
              }),
            });
            blobs.push(await provider.synthesize(part, {
              model: current.ttsConfig.model,
              voiceId,
              format: "mp3",
              signal: controller.signal,
            }));
          }
          current = await savePodcast({
            ...current,
            generation: progress("audio", "saving-audio", `正在保存${unit.title}音频…`, startedAt, {
              providerName: "Fish Audio",
              model: current.ttsConfig.model,
              current: unit.order + 1,
              total: current.audioUnits?.length ?? 0,
            }),
          });
          const blob = new Blob(blobs, { type: "audio/mpeg" });
          const file = new File([blob], `${current.title}-${String(unit.order + 1).padStart(2, "0")}-${unit.title}.mp3`, { type: "audio/mpeg" });
          const asset = await storage.saveAsset(file, "audio", unit.title);
          await storage.patchAsset?.(asset.id, { generatedBy: "knowledge-podcast" });
          if (unit.audioAssetId && unit.audioAssetId !== asset.id) {
            const previous = await storage.getAsset(unit.audioAssetId);
            if (previous?.generatedBy === "knowledge-podcast") await storage.deleteAsset?.(unit.audioAssetId);
          }
          const textHash = await hashText(text);
          current = await savePodcast(updateUnit(current, unit.id, { textHash, audioAssetId: asset.id, audioStatus: "ready", error: undefined }));
        } catch (error) {
          if (controller.signal.aborted) {
            current = await savePodcast(updateUnit({
              ...current,
              audioStatus: "partial",
            }, unit.id, { audioStatus: "pending", error: undefined }));
            break;
          }
          const message = error instanceof Error ? error.message : `${unit.title}音频生成失败。`;
          current = await savePodcast(updateUnit({
            ...current,
            audioStatus: "partial",
            lastError: message,
          }, unit.id, { audioStatus: "failed", error: message }));
        }
      }
      const allReady = (current.audioUnits?.length ?? 0) > 0 && current.audioUnits!.every((unit) => unit.audioStatus === "ready" && unit.audioAssetId);
      const cancelled = controller.signal.aborted;
      if (allReady) current = await cleanupReplacedAudio(current);
      await savePodcast({
        ...current,
        audioStatus: allReady ? "ready" : audioStatusForUnits(current.audioUnits ?? []),
        generation: {
          ...progress("audio", cancelled ? "cancelled" : "completed", cancelled ? "音频生成已取消，已完成章节仍然保留。" : allReady ? "全部章节音频已生成。" : "音频生成完成，部分章节需要重试。", startedAt),
          status: cancelled ? "cancelled" : "completed",
        },
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = aborted ? "音频生成已取消。" : error instanceof Error ? error.message : "音频生成失败。";
      await savePodcast({
        ...current,
        audioStatus: "partial",
        lastError: message,
        generation: {
          ...progress("audio", aborted ? "cancelled" : "failed", message, startedAt),
          status: aborted ? "cancelled" : "failed",
        },
      });
    } finally {
      controllers.delete(key);
      emit();
    }
  })();
};
