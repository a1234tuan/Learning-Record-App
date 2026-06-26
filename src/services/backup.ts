import JSZip from "jszip";
import { saveAs } from "file-saver";

import type { Asset, BackupPayload, ImportSummary, RecordBlock, StorageSnapshot } from "../types";
import { entryToMarkdown } from "../lib/markdown";
import { migrateBlocksToRecords } from "../lib/recordMigration";
import { ensureSettingsSubjects } from "../lib/subjects";

const blobToFile = (blob: Blob, fileName: string, mimeType: string): File =>
  new File([blob], fileName, { type: mimeType });

const serializeAssetMeta = (asset: Asset) => {
  const { data: _data, ...meta } = asset;
  return meta;
};

export const snapshotToZip = async (snapshot: StorageSnapshot): Promise<Blob> => {
  const zip = new JSZip();
  const payload = {
    ...snapshot.payload,
    blocks: snapshot.payload.blocks.map((block) =>
      block.type === "record" ? { ...block, mistakeRefs: [] } : block,
    ),
    mistakes: [],
    reviews: [],
    manifest: {
      ...snapshot.payload.manifest,
      counts: {
        ...snapshot.payload.manifest.counts,
        mistakes: 0,
        reviews: 0,
      },
    },
  };

  zip.file("manifest.json", JSON.stringify(payload.manifest, null, 2));
  zip.file(
    "data.json",
    JSON.stringify(
      {
        ...payload,
        recordDrafts: snapshot.payload.recordDrafts ?? snapshot.recordDrafts ?? [],
        assets: snapshot.assets.map(serializeAssetMeta),
      },
      null,
      2,
    ),
  );

  const entriesFolder = zip.folder("entries");
  for (const entry of payload.entries) {
    const blocks = payload.blocks.filter((block) => block.date === entry.date);
    entriesFolder?.file(`${entry.date}.md`, entryToMarkdown(entry, blocks, snapshot.assets));
  }

  const assetsFolder = zip.folder("assets");
  for (const asset of snapshot.assets) {
    assetsFolder?.file(`${asset.id}-${asset.fileName}`, asset.data);
  }

  return zip.generateAsync({ type: "blob" });
};

export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.includes(",") ? result.split(",")[1] : result);
    };
    reader.readAsDataURL(blob);
  });

export const base64ToBlob = (base64: string, mimeType = "application/zip"): Blob => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
};

const isRecordBlock = (block: StorageSnapshot["payload"]["blocks"][number]): block is RecordBlock =>
  block.type === "record";

export const summarizeSnapshot = (snapshot: StorageSnapshot): ImportSummary => {
  const records = snapshot.payload.blocks.filter(isRecordBlock);
  const activeRecords = records.filter((record) => !record.deletedAt);
  const deletedRecords = records.filter((record) => record.deletedAt);
  const days = new Set(activeRecords.map((record) => record.date)).size;
  const assetIds = new Set(snapshot.assets.map((asset) => asset.id));
  const referencedAssetIds = new Set(records.flatMap((record) => record.assets.map((asset) => asset.id)));
  const missingAssets = Array.from(referencedAssetIds).filter((id) => !assetIds.has(id)).length;
  const images = snapshot.assets.filter((asset) => asset.kind === "image").length;
  const audio = snapshot.assets.filter((asset) => asset.kind === "audio").length;
  const attachments = snapshot.assets.filter((asset) => asset.kind === "attachment").length;

  return {
    records: activeRecords.length,
    days,
    deletedRecords: deletedRecords.length,
    assets: snapshot.assets.length,
    images,
    audio,
    attachments,
    version: snapshot.payload.manifest.version,
    missingAssets,
  };
};

export const zipToSnapshot = async (file: File): Promise<StorageSnapshot> => {
  const looksLikeZip = file.name.toLocaleLowerCase().endsWith(".zip") || file.type.includes("zip");
  if (!looksLikeZip) {
    throw new Error("不支持的文件格式：只支持完整备份 zip。Markdown、JSON 和 TXT 仅用于 AI 阅读，不能恢复数据。");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("文件不是有效 zip 或已损坏，请重新选择完整备份文件。");
  }

  const dataFile = zip.file("data.json");
  if (!dataFile) {
    throw new Error("不是学习日志完整备份：备份包缺少 data.json。");
  }

  let data: BackupPayload & {
    assets?: Array<Omit<Asset, "data">>;
  };
  try {
    data = JSON.parse(await dataFile.async("string")) as BackupPayload & {
      assets?: Array<Omit<Asset, "data">>;
    };
  } catch {
    throw new Error("备份数据损坏：data.json 不是有效 JSON。");
  }

  if (
    !data.manifest ||
    !["408-study-journal", "study-journal"].includes(data.manifest.format) ||
    ![1, 2, 3, 4].includes(data.manifest.version)
  ) {
    const format = data.manifest?.format ?? "未知";
    const version = data.manifest?.version ?? "未知";
    throw new Error(`备份格式不兼容：format=${format}，version=${version}。`);
  }

  const migratedBlocks = migrateBlocksToRecords(data.blocks ?? []);
  const recordBlocks = migratedBlocks.filter((block) => block.type === "record");

  const assets: Asset[] = [];
  for (const assetMeta of data.assets ?? []) {
    const path = Object.keys(zip.files).find((name) => name.startsWith(`assets/${assetMeta.id}-`));
    if (!path) {
      continue;
    }
    const blob = await zip.file(path)?.async("blob");
    if (!blob) {
      continue;
    }
    assets.push({
      ...assetMeta,
      data: blobToFile(blob, assetMeta.fileName, assetMeta.mimeType),
    });
  }

  return {
    payload: {
      manifest: data.manifest,
      entries: data.entries ?? [],
      blocks: migratedBlocks,
      recordDrafts: data.recordDrafts ?? [],
      mistakes: [],
      tags: data.tags ?? [],
      reviews: [],
      recordReviews: data.recordReviews ?? [],
      recordReviewLogs: data.recordReviewLogs ?? [],
      recordReviewDayStats: data.recordReviewDayStats ?? [],
      studySessions: data.studySessions ?? [],
      settings: ensureSettingsSubjects({ ...data.settings, schemaVersion: 4 }, recordBlocks),
    },
    assets,
  };
};

export const downloadSnapshot = async (snapshot: StorageSnapshot): Promise<void> => {
  const zip = await snapshotToZip(snapshot);
  const date = snapshot.payload.manifest.exportedAt.slice(0, 10);
  saveAs(zip, `study-journal-${date}.zip`);
};
