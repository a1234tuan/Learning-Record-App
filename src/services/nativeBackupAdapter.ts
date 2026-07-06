import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FilePicker } from "@capawesome/capacitor-file-picker";

import type { BackupAssetMeta, ExportOptions, ImportOptions, ImportSummary, StorageAdapter, StorageSnapshot, SyncAdapter } from "../types";
import { base64ToBlob, summarizeSnapshot, zipToSnapshot } from "./backup";
import { isNativePlatform } from "../lib/platform";
import { normalizeNativeShareError } from "./nativeFileWriter";
import { importNativeStreamableBackupAndRestore, writeNativeStreamableBackupSnapshot } from "./streamingBackupService";

type PickedBackupFile = {
  blob?: Blob;
  data?: string;
  path?: string;
  uri?: string;
  webPath?: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

const SMALL_BASE64_FALLBACK_BYTES = 5 * 1024 * 1024;
const FILESYSTEM_CHUNK_BYTES = 1024 * 1024;

const normalizeBase64 = (data: string) => (data.includes(",") ? data.split(",").pop() ?? "" : data);

const base64DataToBlob = (data: string, mimeType: string): Blob =>
  base64ToBlob(normalizeBase64(data), mimeType);

const uniquePaths = (paths: Array<string | undefined>) =>
  Array.from(new Set(paths.filter((path): path is string => Boolean(path))));

const readFetchBlob = async (path: string): Promise<Blob> => {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.blob();
};

const readFilesystemChunkedBlob = (
  path: string,
  mimeType: string,
  options: ImportOptions,
  totalBytes?: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const parts: Blob[] = [];
    let settled = false;
    let bytesRead = 0;

    const finish = (value: Blob) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    Filesystem.readFileInChunks({ path, chunkSize: FILESYSTEM_CHUNK_BYTES }, (chunk, error) => {
      if (error) {
        fail(error);
        return;
      }
      if (!chunk) {
        return;
      }

      const { data } = chunk;
      if (data === "") {
        finish(new Blob(parts, { type: mimeType }));
        return;
      }

      const part = data instanceof Blob ? data : base64DataToBlob(data, mimeType);
      parts.push(part);
      bytesRead += part.size;

      if (totalBytes && totalBytes > 0) {
        options.onProgress?.({
          stage: "reading",
          message: `正在读取备份文件 ${Math.min(100, Math.round((bytesRead / totalBytes) * 100))}% 。`,
          current: Math.min(bytesRead, totalBytes),
          total: totalBytes,
        });
      }
    }).catch(fail);
  });

const readFilesystemBlob = async (
  path: string,
  mimeType: string,
  options: ImportOptions,
  size?: number,
): Promise<Blob> => {
  if (typeof Filesystem.readFileInChunks === "function") {
    try {
      return await readFilesystemChunkedBlob(path, mimeType, options, size);
    } catch {
      // Some providers expose a URI that cannot be streamed by the chunk API but can still be read normally.
    }
  }

  const result = await Filesystem.readFile({ path });
  return result.data instanceof Blob ? result.data : base64DataToBlob(result.data, mimeType);
};

const readPathBlob = async (
  path: string,
  mimeType: string,
  options: ImportOptions,
  size?: number,
): Promise<Blob> => {
  const preferFilesystem = path.startsWith("content://");
  const readers = preferFilesystem
    ? [() => readFilesystemBlob(path, mimeType, options, size), () => readFetchBlob(path)]
    : [() => readFetchBlob(path), () => readFilesystemBlob(path, mimeType, options, size)];

  let lastError: unknown;
  for (const read of readers) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("unknown path read error");
};

const pickedToFile = async (picked: PickedBackupFile, options: ImportOptions): Promise<File> => {
  const name = picked.name ?? "backup.zip";
  const mimeType = picked.mimeType ?? "application/zip";

  if (picked.blob) {
    options.onProgress?.({ stage: "reading", message: "正在读取所选备份文件。" });
    return new File([picked.blob], name, { type: mimeType });
  }

  const paths = uniquePaths([picked.path, picked.webPath, picked.uri]);
  if (paths.length > 0) {
    options.onProgress?.({ stage: "reading", message: "正在从系统文件路径读取备份。" });
    let lastError: unknown;
    for (const path of paths) {
      try {
        const blob = await readPathBlob(path, mimeType, options, picked.size);
        return new File([blob], name, { type: mimeType });
      } catch (error) {
        lastError = error;
      }
    }

    if ((picked.size ?? Number.POSITIVE_INFINITY) > SMALL_BASE64_FALLBACK_BYTES || !picked.data) {
      const detail = lastError instanceof Error ? `（${lastError.message}）` : "";
      throw new Error(`无法读取所选备份文件${detail}。请把备份 zip 移到系统“下载”或“文档”目录后重试。`);
    }

    const message = lastError instanceof Error ? lastError.message : "未知错误";
    options.onProgress?.({ stage: "reading", message: `路径读取失败，改用小文件兼容模式：${message}` });
  }

  if (!picked.data) {
    throw new Error("未能读取所选备份文件。");
  }
  if ((picked.size ?? 0) > SMALL_BASE64_FALLBACK_BYTES) {
    throw new Error("备份文件过大，不能使用 base64 兼容模式导入。请重新选择原始 zip 文件。");
  }
  options.onProgress?.({ stage: "reading", message: "正在以兼容模式读取小型备份。" });
  return new File([base64DataToBlob(picked.data, mimeType)], name, { type: mimeType });
};

const assetToMeta = (asset: StorageSnapshot["assets"][number]): BackupAssetMeta => {
  const { data: _data, ...meta } = asset;
  return meta;
};

const pickNativeBackupFile = async (options: ImportOptions): Promise<PickedBackupFile | undefined> => {
  options.onProgress?.({ stage: "choosing", message: "请在系统文件选择器中选择备份 zip。" });
  const result = await FilePicker.pickFiles({
    types: ["application/zip", "application/x-zip-compressed"],
    limit: 1,
    readData: false,
  });
  return result.files[0];
};

export class NativeBackupAdapter implements SyncAdapter {
  readonly kind = "manual-zip" as const;

  isAvailable(): boolean {
    return isNativePlatform();
  }

  async exportSnapshot(snapshot: StorageSnapshot, options: ExportOptions = {}): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("原生备份只在 Android App 内可用。");
    }

    const assetMap = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
    const writeResult = await writeNativeStreamableBackupSnapshot(
      {
        payload: snapshot.payload,
        assets: snapshot.assets.map(assetToMeta),
        recordDrafts: snapshot.recordDrafts,
      },
      "cache-share",
      async (id) => assetMap.get(id),
      options,
    );

    options.onProgress?.({ stage: "sharing", message: "正在打开系统分享面板。" });
    try {
      await Share.share({
        title: "学习日志备份",
        text: "这是学习日志的完整 zip 备份。",
        files: [writeResult.uri],
        dialogTitle: "导出或分享备份",
      });
    } catch (error) {
      throw normalizeNativeShareError(error);
    }
    options.onProgress?.({ stage: "done", message: "备份已交给系统分享面板。" });
  }

  async importSnapshot(options: ImportOptions = {}): Promise<StorageSnapshot | undefined> {
    if (!this.isAvailable()) {
      throw new Error("原生导入只在 Android App 内可用。");
    }

    const picked = await pickNativeBackupFile(options);
    if (!picked) {
      return undefined;
    }

    const file = await pickedToFile(picked, options);
    return zipToSnapshot(file, options);
  }

  async importAndRestoreSnapshot(
    store: StorageAdapter,
    options: ImportOptions = {},
  ): Promise<ImportSummary | undefined> {
    if (!this.isAvailable()) {
      throw new Error("原生导入只在 Android App 内可用。");
    }

    const picked = await pickNativeBackupFile(options);
    if (!picked) {
      return undefined;
    }

    const paths = uniquePaths([picked.path, picked.webPath, picked.uri]);
    if (paths.length > 0) {
      return importNativeStreamableBackupAndRestore(paths[0], store, options);
    }

    const file = await pickedToFile(picked, options);
    const snapshot = await zipToSnapshot(file, options);
    const summary = summarizeSnapshot(snapshot);
    options.onProgress?.({ stage: "restoring", message: "备份已通过校验，正在覆盖当前本地数据。" });
    await store.restoreSnapshot(snapshot);
    return summary;
  }
}

export const nativeBackupAdapter = new NativeBackupAdapter();
