import type { StorageSnapshot } from "../types";
import { snapshotToZip } from "./backup";
import {
  bindNativeAutoBackupFolder,
  canUseNativeAutoBackup,
  getNativeAutoBackupStatus,
  writeNativeLatestBackup,
} from "./nativeAutoBackup";

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

const LATEST_FILE_NAME = "study-journal-latest.zip";
let webDirectoryHandle: FileSystemDirectoryHandle | undefined;

export interface AutoBackupWriteResult {
  folderName?: string;
  size: number;
}

export interface AutoBackupAdapter {
  isAvailable(): boolean;
  bindFolder(): Promise<{ folderName: string }>;
  isBound(): Promise<{ bound: boolean; folderName?: string }>;
  writeLatest(snapshot: StorageSnapshot): Promise<AutoBackupWriteResult>;
}

const webFolderName = (handle: FileSystemDirectoryHandle | undefined): string | undefined =>
  handle?.name;

export const autoBackupAdapter: AutoBackupAdapter = {
  isAvailable(): boolean {
    return canUseNativeAutoBackup() || typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
  },

  async bindFolder(): Promise<{ folderName: string }> {
    if (canUseNativeAutoBackup()) {
      return bindNativeAutoBackupFolder();
    }
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      throw new Error("当前环境不支持绑定备份文件夹，请使用手动导出 zip。");
    }
    webDirectoryHandle = await picker();
    return { folderName: webDirectoryHandle.name };
  },

  async isBound(): Promise<{ bound: boolean; folderName?: string }> {
    if (canUseNativeAutoBackup()) {
      return getNativeAutoBackupStatus();
    }
    return { bound: Boolean(webDirectoryHandle), folderName: webFolderName(webDirectoryHandle) };
  },

  async writeLatest(snapshot: StorageSnapshot): Promise<AutoBackupWriteResult> {
    const zip = await snapshotToZip(snapshot);
    if (canUseNativeAutoBackup()) {
      return writeNativeLatestBackup(zip);
    }
    if (!webDirectoryHandle) {
      throw new Error("尚未绑定自动备份文件夹。");
    }
    const fileHandle = await webDirectoryHandle.getFileHandle(LATEST_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(zip);
    await writable.close();
    return { folderName: webDirectoryHandle.name, size: zip.size };
  },
};
