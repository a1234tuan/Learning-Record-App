import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "../types";
import { autoBackupAdapter } from "./autoBackupAdapter";
import { writeNativeAutoBackupStream } from "./nativeAutoBackupStreamService";

vi.mock("./nativeAutoBackup", () => ({
  bindNativeAutoBackupFolder: vi.fn(async () => ({ folderName: "backup" })),
  canUseNativeAutoBackup: vi.fn(() => true),
  getNativeAutoBackupStatus: vi.fn(async () => ({ bound: true, folderName: "backup" })),
}));

vi.mock("./nativeAutoBackupStreamService", () => ({
  writeNativeAutoBackupStream: vi.fn(async () => ({ folderName: "backup", size: 9876 })),
}));

describe("autoBackupAdapter", () => {
  it("uses the dedicated native auto backup stream writer on Android", async () => {
    const store = {} as StorageAdapter;

    const result = await autoBackupAdapter.writeLatest(store);

    expect(writeNativeAutoBackupStream).toHaveBeenCalledWith(store);
    expect(result).toEqual({ folderName: "backup", size: 9876 });
  });
});
