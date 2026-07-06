import type { Asset, RecordBlock } from "../types";
import { nowISO } from "../lib/date";
import { runPaddleOcr } from "./ocrService";
import { storage } from "./storageAdapter";
import { markAutoBackupDirty } from "./autoBackupService";

const runningJobs = new Set<string>();

const shouldAutoOcr = (asset: Asset): boolean =>
  asset.kind === "image" && (!asset.ocrStatus || asset.ocrStatus === "idle");

const patchOcrAsset = async (assetId: string, patch: Partial<Omit<Asset, "id" | "data">>) => {
  const updated = await storage.patchAsset(assetId, {
    ...patch,
    ocrUpdatedAt: nowISO(),
  });
  await markAutoBackupDirty("ocr");
  return updated;
};

export const runOcrForAsset = async (
  assetId: string,
  options: {
    force?: boolean;
    onAssetChanged?: () => void;
  } = {},
): Promise<Asset | undefined> => {
  if (runningJobs.has(assetId)) {
    return storage.getAsset(assetId);
  }

  const asset = await storage.getAsset(assetId);
  if (!asset) {
    return undefined;
  }
  if (asset.kind !== "image") {
    throw new Error("OCR 只支持图片资源。");
  }
  if (!options.force && !shouldAutoOcr(asset)) {
    return asset;
  }

  runningJobs.add(assetId);
  try {
    await patchOcrAsset(assetId, {
      ocrStatus: "queued",
      ocrError: undefined,
    });
    options.onAssetChanged?.();

    const updateAsset = async (patch: Partial<Asset>) => {
      await patchOcrAsset(assetId, patch);
      options.onAssetChanged?.();
    };
    const text = (await runPaddleOcr(asset, updateAsset)).trim();
    if (!text) {
      throw new Error("上游返回空 OCR 文本。");
    }
    const updated = await patchOcrAsset(assetId, {
      ocrStatus: "done",
      ocrText: text,
      ocrError: undefined,
      ocrResultSummary: {
        textLength: text.length,
        includedInAi: true,
        parserVersion: "paddle-ocr-v2",
      },
    });
    options.onAssetChanged?.();
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "OCR 识别失败。";
    const status = message.includes("超时") ? "timeout" : "failed";
    const updated = await patchOcrAsset(assetId, {
      ocrStatus: status,
      ocrError: message,
      ocrResultSummary: {
        textLength: 0,
        includedInAi: false,
        parserVersion: "paddle-ocr-v2",
      },
    });
    options.onAssetChanged?.();
    throw error;
  } finally {
    runningJobs.delete(assetId);
  }
};

export const enqueueAutoOcrForRecord = (
  record: RecordBlock,
  options: {
    onAssetChanged?: () => void;
  } = {},
): void => {
  for (const assetRef of record.assets) {
    if (assetRef.kind !== "image") {
      continue;
    }
    void runOcrForAsset(assetRef.id, {
      force: false,
      onAssetChanged: options.onAssetChanged,
    }).catch(() => {
      // The asset card shows the persisted OCR error state.
    });
  }
};
