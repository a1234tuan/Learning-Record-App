import type { StorageSnapshot, SyncAdapter } from "../types";
import { downloadSnapshot, snapshotToZip, zipToSnapshot } from "./backup";

interface WindowWithFilePicker extends Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<FileSystemFileHandle[]>;
}

export class ManualZipSyncAdapter implements SyncAdapter {
  readonly kind = "manual-zip" as const;

  isAvailable(): boolean {
    return true;
  }

  async exportSnapshot(snapshot: StorageSnapshot): Promise<void> {
    await downloadSnapshot(snapshot);
  }

  async importSnapshot(): Promise<StorageSnapshot | undefined> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".zip,application/zip";
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            resolve(undefined);
            return;
          }
          resolve(await zipToSnapshot(file));
        } catch (error) {
          reject(error);
        }
      };
      input.click();
    });
  }
}

export class FileSystemFolderSyncAdapter implements SyncAdapter {
  readonly kind = "file-system-folder" as const;

  isAvailable(): boolean {
    return typeof (window as WindowWithFilePicker).showDirectoryPicker === "function";
  }

  async exportSnapshot(snapshot: StorageSnapshot): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("当前浏览器不支持文件夹授权，请使用手动 zip 备份。");
    }

    const picker = (window as WindowWithFilePicker).showDirectoryPicker;
    if (!picker) {
      throw new Error("当前浏览器不支持文件夹授权。");
    }
    const directory = await picker();
    const fileName = `study-journal-snapshot.zip`;
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(await snapshotToZip(snapshot));
    await writable.close();
  }
}

export const manualZipSyncAdapter = new ManualZipSyncAdapter();
export const fileSystemFolderSyncAdapter = new FileSystemFolderSyncAdapter();
