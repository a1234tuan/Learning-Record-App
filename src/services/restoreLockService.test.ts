import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, StorageAdapter } from "../types";
import type { AutoBackupAdapter } from "./autoBackupAdapter";
import { flushAutoBackupNow } from "./autoBackupService";
import { isRestoreInProgress, setRestoreInProgress, withRestoreLock } from "./restoreLockService";

const settings: AppSettings = {
  id: "settings",
  examDate: "2026-12-27",
  theme: "system",
  accentColor: "#2f6f5e",
  backupReminderDays: 7,
  fontScale: 1,
  lineHeight: 1.7,
  subjects: [],
  autoBackup: { enabled: true, debounceMs: 600_000, folderName: "backup" },
  schemaVersion: 4,
};

const store = {
  getSettings: vi.fn(async () => settings),
  saveSettings: vi.fn(async () => undefined),
} as unknown as StorageAdapter;

const adapter = {
  isAvailable: vi.fn(() => true),
  bindFolder: vi.fn(),
  isBound: vi.fn(async () => ({ bound: true, folderName: "backup" })),
  writeLatest: vi.fn(async () => ({ folderName: "backup", size: 1 })),
} as unknown as AutoBackupAdapter;

describe("restore lock", () => {
  afterEach(() => {
    setRestoreInProgress(false);
    vi.clearAllMocks();
  });

  it("suspends automatic backup work and always releases the lock after a failed restore", async () => {
    await expect(withRestoreLock(async () => {
      expect(isRestoreInProgress()).toBe(true);
      await flushAutoBackupNow("restore", adapter, store);
      expect(adapter.writeLatest).not.toHaveBeenCalled();
      throw new Error("staging failed");
    })).rejects.toThrow("staging failed");

    expect(isRestoreInProgress()).toBe(false);
    await flushAutoBackupNow("manual", adapter, store);
    expect(adapter.writeLatest).toHaveBeenCalledTimes(1);
  });

  it("rejects overlapping restore operations", async () => {
    let release: (() => void) | undefined;
    const active = withRestoreLock(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    await expect(withRestoreLock(async () => undefined)).rejects.toThrow("已有恢复任务正在进行");
    release?.();
    await active;
  });
});
