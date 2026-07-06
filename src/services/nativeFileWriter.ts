import { Directory, Filesystem } from "@capacitor/filesystem";

import type { ExportOptions } from "../types";

export interface Base64Chunk {
  data: string;
  index: number;
  total: number;
  start: number;
  end: number;
}

interface NativeShareCacheOptions extends ExportOptions {
  blob: Blob;
  fileName: string;
  mimeType?: string;
  chunkSize?: number;
}

export interface NativeWriteResult {
  uri: string;
  path: string;
  size: number;
}

const DEFAULT_CHUNK_SIZE = 768 * 1024;
const SHARE_CACHE_DIR = "shared-exports";

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.includes(",") ? result.split(",").pop() ?? "" : result);
    };
    reader.readAsDataURL(blob);
  });

export async function* blobToBase64Chunks(
  blob: Blob,
  chunkSize = DEFAULT_CHUNK_SIZE,
): AsyncGenerator<Base64Chunk> {
  const total = Math.max(1, Math.ceil(blob.size / chunkSize));
  for (let index = 0; index < total; index += 1) {
    const start = index * chunkSize;
    const end = Math.min(blob.size, start + chunkSize);
    yield {
      data: await blobToBase64(blob.slice(start, end, blob.type)),
      index,
      total,
      start,
      end,
    };
  }
}

const sanitizeNativeName = (fileName: string): string => {
  const cleaned = fileName.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || `export-${Date.now()}`;
};

const assertShareableFileUri = (uri: string): string => {
  if (!uri.startsWith("file://")) {
    throw new Error("导出临时文件无法交给系统分享面板，请重试。");
  }
  return uri;
};

export const normalizeNativeShareError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/cancel/i.test(message)) {
    return new Error("已取消分享。");
  }
  if (/EACCES|Permission denied/i.test(message)) {
    return new Error("系统拒绝写入导出文件，请重新尝试导出分享。");
  }
  return new Error(message || "导出分享失败，请重试。");
};

export const writeBlobToNativeShareCache = async ({
  blob,
  fileName,
  mimeType,
  chunkSize = DEFAULT_CHUNK_SIZE,
  onProgress,
}: NativeShareCacheOptions): Promise<NativeWriteResult> => {
  const safeName = sanitizeNativeName(fileName);
  const path = `${SHARE_CACHE_DIR}/${safeName}`;
  let wroteFirstChunk = false;
  let uri: string | undefined;

  try {
    for await (const chunk of blobToBase64Chunks(blob, chunkSize)) {
      if (!wroteFirstChunk) {
        const result = await Filesystem.writeFile({
          path,
          directory: Directory.Cache,
          data: chunk.data,
          recursive: true,
        });
        uri = result.uri;
        wroteFirstChunk = true;
      } else {
        await Filesystem.appendFile({
          path,
          directory: Directory.Cache,
          data: chunk.data,
        });
      }
      onProgress?.({
        stage: "writing",
        message: `正在写入临时分享文件 ${blob.size > 0 ? Math.round((chunk.end / blob.size) * 100) : 100}%。`,
        current: chunk.end,
        total: blob.size,
      });
    }

    if (!uri || !uri.startsWith("file://")) {
      const resolved = await Filesystem.getUri({ path, directory: Directory.Cache });
      uri = resolved.uri;
    }

    return {
      uri: assertShareableFileUri(uri),
      path,
      size: blob.size,
    };
  } catch (error) {
    await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`导出临时文件失败：${String(error)}`);
  }
};
