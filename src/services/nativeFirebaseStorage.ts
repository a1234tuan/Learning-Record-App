import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeFirebaseStoragePlugin {
  exists(options: { path: string; idToken: string }): Promise<{ exists: boolean }>;
  beginDownload(options: { path: string; idToken: string }): Promise<{ sessionId: string; size: number; contentType?: string }>;
  readDownloadChunk(options: { sessionId: string; offset: number; length: number }): Promise<{ base64: string; bytesRead: number; done: boolean }>;
  finishDownload(options: { sessionId: string }): Promise<void>;
  beginUpload(options: { path: string; idToken: string; contentType: string }): Promise<{ sessionId: string }>;
  appendUploadChunk(options: { sessionId: string; base64: string }): Promise<void>;
  finishUpload(options: { sessionId: string }): Promise<void>;
  cancelUpload(options: { sessionId: string }): Promise<void>;
}

const NativeFirebaseStorage = registerPlugin<NativeFirebaseStoragePlugin>("NativeFirebaseStorage");

const decodeBase64 = (base64: string): ArrayBuffer => {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  // This Uint8Array is allocated locally, so its backing store is always an ArrayBuffer.
  return bytes.buffer as ArrayBuffer;
};

const CHUNK_SIZE = 512 * 1024;

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return globalThis.btoa(binary);
};

/**
 * Android's WebView can fail to reach Firebase Storage even when the system browser works.
 * Use Android's own network stack for the authenticated download, then return the same Blob that
 * the web Firebase SDK normally provides to the sync layer.
 */
export const downloadNativeFirebaseStorageBlob = async (path: string, idToken: string): Promise<Blob> => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    throw new Error("当前平台不支持原生 Firebase Storage 下载。");
  }
  const session = await NativeFirebaseStorage.beginDownload({ path, idToken });
  try {
    const chunks: ArrayBuffer[] = [];
    let offset = 0;
    let done = false;
    while (!done) {
      const chunk = await NativeFirebaseStorage.readDownloadChunk({ sessionId: session.sessionId, offset, length: CHUNK_SIZE });
      if (chunk.bytesRead === 0 && !chunk.done) throw new Error("原生 Firebase Storage 下载未返回数据。");
      chunks.push(decodeBase64(chunk.base64));
      offset += chunk.bytesRead;
      done = chunk.done;
    }
    return new Blob(chunks, { type: session.contentType || "application/octet-stream" });
  } finally {
    await NativeFirebaseStorage.finishDownload({ sessionId: session.sessionId }).catch(() => undefined);
  }
};

export const nativeFirebaseStorageObjectExists = async (path: string, idToken: string): Promise<boolean> => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    throw new Error("当前平台不支持原生 Firebase Storage 检查。");
  }
  return (await NativeFirebaseStorage.exists({ path, idToken })).exists;
};

/** Stage data in Android's cache and upload it through the same system network stack as downloads. */
export const uploadNativeFirebaseStorageBlob = async (
  path: string,
  blob: Blob,
  idToken: string,
  onProgress?: (bytesTransferred: number, totalBytes: number) => void,
): Promise<void> => {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    throw new Error("当前平台不支持原生 Firebase Storage 上传。");
  }
  const session = await NativeFirebaseStorage.beginUpload({
    path,
    idToken,
    contentType: blob.type || "application/octet-stream",
  });
  try {
    let offset = 0;
    while (offset < blob.size) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + CHUNK_SIZE).arrayBuffer());
      await NativeFirebaseStorage.appendUploadChunk({ sessionId: session.sessionId, base64: encodeBase64(chunk) });
      offset += chunk.byteLength;
      onProgress?.(offset, blob.size);
    }
    await NativeFirebaseStorage.finishUpload({ sessionId: session.sessionId });
  } catch (error) {
    await NativeFirebaseStorage.cancelUpload({ sessionId: session.sessionId }).catch(() => undefined);
    throw error;
  }
};
