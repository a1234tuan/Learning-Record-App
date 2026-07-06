import type {
  Asset,
  BackupAssetMeta,
  ExportOptions,
  StorageAdapter,
  StreamableBackupSnapshot,
} from "../types";
import { entryToMarkdown } from "../lib/markdown";
import { blobToBase64Chunks } from "./nativeFileWriter";
import {
  appendNativeAutoBackupZipEntry,
  beginNativeAutoBackupZip,
  beginNativeAutoBackupZipEntry,
  cancelNativeAutoBackupZip,
  canUseNativeAutoBackup,
  finishNativeAutoBackupZip,
  finishNativeAutoBackupZipEntry,
} from "./nativeAutoBackup";

const ENTRY_CHUNK_BYTES = 768 * 1024;

const textToBase64 = (text: string): string => btoa(unescape(encodeURIComponent(text)));

const assetPath = (asset: BackupAssetMeta): string => `assets/${asset.id}-${asset.fileName}`;

const metaToAsset = (meta: BackupAssetMeta, blob: Blob): Asset =>
  ({
    ...meta,
    data: new File([blob], meta.fileName, { type: meta.mimeType }),
  });

const writeTextEntry = async (sessionId: string, path: string, text: string) => {
  await beginNativeAutoBackupZipEntry(sessionId, path);
  await appendNativeAutoBackupZipEntry(sessionId, textToBase64(text));
  await finishNativeAutoBackupZipEntry(sessionId);
};

export const writeNativeAutoBackupStreamSnapshot = async (
  snapshot: StreamableBackupSnapshot,
  getAsset: (assetId: string) => Promise<Asset | undefined>,
  options: ExportOptions = {},
) => {
  if (!canUseNativeAutoBackup()) {
    throw new Error("Android 自动备份只在 Android App 内可用。");
  }

  options.onProgress?.({ stage: "preparing", message: "正在准备自动备份数据。" });
  const session = await beginNativeAutoBackupZip();

  try {
    const payload = {
      ...snapshot.payload,
      blocks: snapshot.payload.blocks.map((block) =>
        block.type === "record" ? { ...block, mistakeRefs: [] } : block,
      ),
      mistakes: [],
      reviews: [],
      recordDrafts: snapshot.payload.recordDrafts ?? snapshot.recordDrafts ?? [],
    };

    await writeTextEntry(session.sessionId, "manifest.json", JSON.stringify(payload.manifest, null, 2));
    await writeTextEntry(
      session.sessionId,
      "data.json",
      JSON.stringify({ ...payload, assets: snapshot.assets }, null, 2),
    );

    const markdownAssets = snapshot.assets.map((meta) => metaToAsset(meta, new Blob()));
    for (const entry of payload.entries) {
      const blocks = payload.blocks.filter((block) => block.date === entry.date);
      await writeTextEntry(
        session.sessionId,
        `entries/${entry.date}.md`,
        entryToMarkdown(entry, blocks, markdownAssets),
      );
    }

    for (const [index, meta] of snapshot.assets.entries()) {
      options.onProgress?.({
        stage: "asset",
        message: `正在写入自动备份资源 ${index + 1}/${snapshot.assets.length}。`,
        current: index + 1,
        total: snapshot.assets.length,
      });
      const asset = await getAsset(meta.id);
      if (!asset) {
        continue;
      }
      await beginNativeAutoBackupZipEntry(session.sessionId, assetPath(meta));
      for await (const chunk of blobToBase64Chunks(asset.data, ENTRY_CHUNK_BYTES)) {
        await appendNativeAutoBackupZipEntry(session.sessionId, chunk.data);
      }
      await finishNativeAutoBackupZipEntry(session.sessionId);
    }

    options.onProgress?.({ stage: "writing", message: "正在写入自动备份 zip。" });
    const result = await finishNativeAutoBackupZip(session.sessionId);
    if (!Number.isFinite(result.size) || result.size <= 0) {
      throw new Error("自动备份写入结果为空。");
    }
    options.onProgress?.({ stage: "done", message: "自动备份 zip 已写入。" });
    return result;
  } catch (error) {
    await cancelNativeAutoBackupZip(session.sessionId).catch(() => undefined);
    throw error;
  }
};

export const writeNativeAutoBackupStream = async (
  store: StorageAdapter,
  options: ExportOptions = {},
) => {
  const snapshot = await store.createStreamableSnapshot();
  return writeNativeAutoBackupStreamSnapshot(snapshot, (id) => store.getAsset(id), options);
};
