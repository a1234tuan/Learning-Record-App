import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FilePicker } from "@capawesome/capacitor-file-picker";

import type { StorageSnapshot, SyncAdapter } from "../types";
import { base64ToBlob, blobToBase64, snapshotToZip, zipToSnapshot } from "./backup";
import { isNativePlatform } from "../lib/platform";

export class NativeBackupAdapter implements SyncAdapter {
  readonly kind = "manual-zip" as const;

  isAvailable(): boolean {
    return isNativePlatform();
  }

  async exportSnapshot(snapshot: StorageSnapshot): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("原生备份只在 Android App 内可用。");
    }

    const zip = await snapshotToZip(snapshot);
    const fileName = `study-journal-${snapshot.payload.manifest.exportedAt.slice(0, 10)}.zip`;
    const base64 = await blobToBase64(zip);

    const writeResult = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    await Share.share({
      title: "学习日志备份",
      text: "这是学习日志的完整 zip 备份。",
      url: writeResult.uri,
      dialogTitle: "导出或分享备份",
    });
  }

  async importSnapshot(): Promise<StorageSnapshot | undefined> {
    if (!this.isAvailable()) {
      throw new Error("原生导入只在 Android App 内可用。");
    }

    const result = await FilePicker.pickFiles({
      types: ["application/zip", "application/x-zip-compressed"],
      readData: true,
    });
    const picked = result.files[0];
    if (!picked?.data) {
      return undefined;
    }

    const blob = base64ToBlob(picked.data, picked.mimeType ?? "application/zip");
    const file = new File([blob], picked.name ?? "backup.zip", {
      type: picked.mimeType ?? "application/zip",
    });
    return zipToSnapshot(file);
  }
}

export const nativeBackupAdapter = new NativeBackupAdapter();
