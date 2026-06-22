import { Capacitor, registerPlugin } from "@capacitor/core";

import { blobToBase64 } from "./backup";

interface NativeAutoBackupPlugin {
  bindFolder(): Promise<{ folderName: string }>;
  isBound(): Promise<{ bound: boolean; folderName?: string }>;
  writeLatest(options: {
    data: string;
    fileName: string;
    mimeType: string;
  }): Promise<{ folderName?: string; size: number; uri?: string }>;
}

const NativeAutoBackup = registerPlugin<NativeAutoBackupPlugin>("NativeAutoBackup");

export const canUseNativeAutoBackup = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const bindNativeAutoBackupFolder = async (): Promise<{ folderName: string }> =>
  NativeAutoBackup.bindFolder();

export const getNativeAutoBackupStatus = async (): Promise<{ bound: boolean; folderName?: string }> =>
  NativeAutoBackup.isBound();

export const writeNativeLatestBackup = async (blob: Blob): Promise<{ folderName?: string; size: number; uri?: string }> => {
  const data = await blobToBase64(blob);
  return NativeAutoBackup.writeLatest({
    data,
    fileName: "study-journal-latest.zip",
    mimeType: "application/zip",
  });
};
