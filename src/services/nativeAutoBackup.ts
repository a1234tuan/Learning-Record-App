import { Capacitor, registerPlugin } from "@capacitor/core";

import type { ExportOptions } from "../types";
import { blobToBase64Chunks } from "./nativeFileWriter";

interface NativeAutoBackupPlugin {
  bindFolder(): Promise<{ folderName: string }>;
  isBound(): Promise<{ bound: boolean; folderName?: string }>;
  writeLatest(options: {
    data: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ folderName?: string; size: number; uri?: string }>;
  beginWriteLatest(options: {
    fileName: string;
    mimeType: string;
  }): Promise<{ sessionId: string; folderName?: string; uri?: string }>;
  appendWriteLatest(options: {
    sessionId: string;
    data: string;
  }): Promise<{ size: number }>;
  finishWriteLatest(options: {
    sessionId: string;
  }): Promise<{ folderName?: string; size: number; uri?: string }>;
  cancelWriteLatest(options: {
    sessionId: string;
  }): Promise<void>;
  beginZipLatest(options: {
    fileName: string;
    mimeType: string;
  }): Promise<{ sessionId: string; folderName?: string; uri?: string }>;
  beginZipEntry(options: {
    sessionId: string;
    path: string;
  }): Promise<void>;
  appendZipEntry(options: {
    sessionId: string;
    data: string;
  }): Promise<void>;
  finishZipEntry(options: {
    sessionId: string;
  }): Promise<void>;
  finishZipLatest(options: {
    sessionId: string;
  }): Promise<{ folderName?: string; size: number; uri?: string }>;
  cancelZipLatest(options: {
    sessionId: string;
  }): Promise<void>;
}

const NativeAutoBackup = registerPlugin<NativeAutoBackupPlugin>("NativeAutoBackup");

export const canUseNativeAutoBackup = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const bindNativeAutoBackupFolder = async (): Promise<{ folderName: string }> =>
  NativeAutoBackup.bindFolder();

export const getNativeAutoBackupStatus = async (): Promise<{ bound: boolean; folderName?: string }> =>
  NativeAutoBackup.isBound();

export const writeNativeLatestBackup = async (
  blob: Blob,
  options: ExportOptions = {},
): Promise<{ folderName?: string; size: number; uri?: string }> => {
  const session = await NativeAutoBackup.beginWriteLatest({
    fileName: "study-journal-latest.zip",
    mimeType: "application/zip",
  });

  let written = 0;
  try {
    for await (const chunk of blobToBase64Chunks(blob)) {
      const result = await NativeAutoBackup.appendWriteLatest({
        sessionId: session.sessionId,
        data: chunk.data,
      });
      written = result.size;
      options.onProgress?.({
        stage: "writing",
        message: `正在更新自动备份 ${blob.size > 0 ? Math.min(100, Math.round((written / blob.size) * 100)) : 100}% 。`,
        current: written,
        total: blob.size,
      });
    }

    return NativeAutoBackup.finishWriteLatest({ sessionId: session.sessionId });
  } catch (error) {
    await NativeAutoBackup.cancelWriteLatest({ sessionId: session.sessionId }).catch(() => undefined);
    throw error;
  }
};

export const beginNativeAutoBackupZip = async (): Promise<{ sessionId: string; folderName?: string; uri?: string }> =>
  NativeAutoBackup.beginZipLatest({
    fileName: "study-journal-latest.zip",
    mimeType: "application/zip",
  });

export const beginNativeAutoBackupZipEntry = async (sessionId: string, path: string): Promise<void> =>
  NativeAutoBackup.beginZipEntry({ sessionId, path });

export const appendNativeAutoBackupZipEntry = async (sessionId: string, data: string): Promise<void> =>
  NativeAutoBackup.appendZipEntry({ sessionId, data });

export const finishNativeAutoBackupZipEntry = async (sessionId: string): Promise<void> =>
  NativeAutoBackup.finishZipEntry({ sessionId });

export const finishNativeAutoBackupZip = async (
  sessionId: string,
): Promise<{ folderName?: string; size: number; uri?: string }> =>
  NativeAutoBackup.finishZipLatest({ sessionId });

export const cancelNativeAutoBackupZip = async (sessionId: string): Promise<void> =>
  NativeAutoBackup.cancelZipLatest({ sessionId });
