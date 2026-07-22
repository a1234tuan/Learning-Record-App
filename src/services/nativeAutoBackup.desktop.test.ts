import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindNativeAutoBackupFolder,
  canUseNativeAutoBackup,
  ensureNativeBackupRepository,
  listNativeBackupRepositoryFiles,
} from "./nativeAutoBackup";

const desktopBackup = {
  bindFolder: vi.fn(async () => ({ folderName: "D:/Backups/study-journal-backup" })),
  getStatus: vi.fn(async () => ({ bound: true, folderName: "D:/Backups/study-journal-backup" })),
  ensureRepository: vi.fn(async () => ({ folderName: "D:/Backups/study-journal-backup", repositoryName: "study-journal-backup" })),
  listFiles: vi.fn(async () => [{ path: "snapshots/latest.json", displayName: "latest.json", size: 42 }]),
  beginWrite: vi.fn(),
  appendWrite: vi.fn(),
  finishWrite: vi.fn(),
  cancelWrite: vi.fn(),
  readText: vi.fn(),
  readChunk: vi.fn(),
  deleteFile: vi.fn(),
};

describe("desktop native auto backup adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses the Electron backup bridge for repository operations", async () => {
    vi.stubGlobal("window", {
      studyJournalDesktop: {
        isDesktop: true,
        backup: desktopBackup,
        onBackupFlushRequested: vi.fn(() => vi.fn()),
      },
    });

    expect(canUseNativeAutoBackup()).toBe(true);
    await expect(bindNativeAutoBackupFolder()).resolves.toEqual({ folderName: "D:/Backups/study-journal-backup" });
    await expect(ensureNativeBackupRepository("ignored-by-desktop")).resolves.toMatchObject({
      repositoryName: "study-journal-backup",
    });
    await expect(listNativeBackupRepositoryFiles("ignored-by-desktop", "snapshots")).resolves.toEqual([
      { path: "snapshots/latest.json", displayName: "latest.json", size: 42 },
    ]);

    expect(desktopBackup.bindFolder).toHaveBeenCalledOnce();
    expect(desktopBackup.ensureRepository).toHaveBeenCalledOnce();
    expect(desktopBackup.listFiles).toHaveBeenCalledWith("snapshots");
  });
});
