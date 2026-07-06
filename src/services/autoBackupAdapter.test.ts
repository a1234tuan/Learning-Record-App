import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "../types";
import { autoBackupAdapter } from "./autoBackupAdapter";
import { writeNativeRepositoryBackup } from "./nativeRepositoryBackupService";

vi.mock("./nativeAutoBackup", () => ({
  bindNativeAutoBackupFolder: vi.fn(async () => ({ folderName: "backup" })),
  canUseNativeAutoBackup: vi.fn(() => true),
  getNativeAutoBackupStatus: vi.fn(async () => ({ bound: true, folderName: "backup" })),
}));

vi.mock("./nativeRepositoryBackupService", () => ({
  writeNativeRepositoryBackup: vi.fn(async () => ({
    folderName: "backup",
    size: 9876,
    format: "folder-repository-v1",
  })),
}));

describe("autoBackupAdapter", () => {
  it("uses the native repository writer on Android", async () => {
    const store = {} as StorageAdapter;

    const result = await autoBackupAdapter.writeLatest(store);

    expect(writeNativeRepositoryBackup).toHaveBeenCalledWith(store);
    expect(result).toEqual({ folderName: "backup", size: 9876, format: "folder-repository-v1" });
  });
});
