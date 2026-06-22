import JSZip from "jszip";
import { saveAs } from "file-saver";

import type { Asset, BackupPayload, StorageSnapshot } from "../types";
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

export const zipToSnapshot = async (file: File): Promise<StorageSnapshot> => {
  const looksLikeZip = file.name.toLocaleLowerCase().endsWith(".zip") || file.type.includes("zip");
  if (!looksLikeZip) {
    throw new Error("只支持导入完整备份 zip 文件。Markdown、JSON 和 TXT 仅用于 AI 阅读，不能恢复数据。");
  }

  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file("data.json");
  if (!dataFile) {
    throw new Error("备份包缺少 data.json");
  }

  const data = JSON.parse(await dataFile.async("string")) as BackupPayload & {
    assets?: Array<Omit<Asset, "data">>;
  };

  if (
    !data.manifest ||
    !["408-study-journal", "study-journal"].includes(data.manifest.format) ||
    ![1, 2, 3].includes(data.manifest.version)
  ) {
    throw new Error("备份格式不兼容");
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
      mistakes: [],
      tags: data.tags ?? [],
      reviews: [],
      studySessions: data.studySessions ?? [],
      settings: ensureSettingsSubjects({ ...data.settings, schemaVersion: 3 }, recordBlocks),
    },
    assets,
  };
};

export const downloadSnapshot = async (snapshot: StorageSnapshot): Promise<void> => {
  const zip = await snapshotToZip(snapshot);
  const date = snapshot.payload.manifest.exportedAt.slice(0, 10);
  saveAs(zip, `study-journal-${date}.zip`);
};
