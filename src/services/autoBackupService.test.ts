import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, StorageAdapter, StorageSnapshot } from "../types";
import type { AutoBackupAdapter, AutoBackupWriteResult } from "./autoBackupAdapter";
import {
  bindAutoBackupFolder,
  flushAutoBackupNow,
  markAutoBackupDirty,
  setAutoBackupEnabled,
} from "./autoBackupService";

const stamp = "2026-06-21T00:00:00.000Z";

const settings = (
  enabled = true,
  autoBackup: Partial<NonNullable<AppSettings["autoBackup"]>> = {},
): AppSettings => ({
  id: "settings",
  examDate: "2026-12-27",
  theme: "system",
  accentColor: "#2f6f5e",
  backupReminderDays: 7,
  fontScale: 1,
  lineHeight: 1.7,
  subjects: [],
  autoBackup: {
    enabled,
    folderName: "backup",
    debounceMs: 45_000,
    ...autoBackup,
  },
  schemaVersion: 3,
});

const snapshot: StorageSnapshot = {
  payload: {
    manifest: {
      format: "study-journal",
      version: 3,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: { entries: 0, blocks: 0, mistakes: 0, assets: 0, tags: 0, reviews: 0, studySessions: 0 },
    },
    entries: [],
    blocks: [],
    mistakes: [],
    tags: [],
    reviews: [],
    studySessions: [],
    settings: settings(),
  },
  assets: [],
};

const makeStore = (initial = settings()): StorageAdapter => {
  let current = initial;
  return {
    initialize: vi.fn(),
    getSettings: vi.fn(async () => current),
    saveSettings: vi.fn(async (next: AppSettings) => {
      current = next;
    }),
    getOrCreateEntry: vi.fn(),
    listEntries: vi.fn(),
    saveEntry: vi.fn(),
    listBlocks: vi.fn(),
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    reorderBlocks: vi.fn(),
    listMistakes: vi.fn(),
    saveMistake: vi.fn(),
    listDueMistakes: vi.fn(),
    listReviews: vi.fn(),
    saveReview: vi.fn(),
    listTags: vi.fn(),
    upsertTag: vi.fn(),
    listStudySessions: vi.fn(),
    saveStudySession: vi.fn(),
    saveAsset: vi.fn(),
    patchAsset: vi.fn(),
    listAssets: vi.fn(),
    getAsset: vi.fn(),
    createSnapshot: vi.fn(async () => snapshot),
    restoreSnapshot: vi.fn(),
    clearAll: vi.fn(),
  } as unknown as StorageAdapter;
};

const makeAdapter = (
  bound = true,
  writeResult: AutoBackupWriteResult = { folderName: "backup", size: 1234 },
): AutoBackupAdapter => ({
  isAvailable: vi.fn(() => true),
  bindFolder: vi.fn(async () => ({ folderName: "backup" })),
  isBound: vi.fn(async () => ({ bound, folderName: bound ? "backup" : undefined })),
  writeLatest: vi.fn(async () => writeResult),
});

describe("autoBackupService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("debounces multiple dirty writes into one latest backup", async () => {
    const store = makeStore();
    const adapter = makeAdapter();

    await markAutoBackupDirty("one", adapter, store);
    await markAutoBackupDirty("two", adapter, store);
    await vi.advanceTimersByTimeAsync(45_000);

    expect(adapter.writeLatest).toHaveBeenCalledTimes(1);
  });

  it("manual flush writes immediately", async () => {
    const store = makeStore();
    const adapter = makeAdapter(true, {
      folderName: "backup",
      size: 1234,
      displayName: "study-journal-latest.zip",
      uri: "content://backup/latest",
      verifiedAt: new Date("2026-06-21T01:00:00.000Z").getTime(),
      lastModified: new Date("2026-06-21T00:59:00.000Z").getTime(),
    });

    const nextSettings = await flushAutoBackupNow("manual", adapter, store);

    expect(adapter.writeLatest).toHaveBeenCalledTimes(1);
    expect(nextSettings.autoBackup?.lastBackupSize).toBe(1234);
    expect(nextSettings.autoBackup?.lastBackupFileName).toBe("study-journal-latest.zip");
    expect(nextSettings.autoBackup?.lastBackupUri).toBe("content://backup/latest");
    expect(nextSettings.autoBackup?.lastBackupVerifiedAt).toBe("2026-06-21T01:00:00.000Z");
    expect(nextSettings.autoBackup?.lastBackupFileModifiedAt).toBe("2026-06-21T00:59:00.000Z");
    expect(store.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoBackup: expect.objectContaining({ lastBackupSize: 1234 }),
    }));
  });

  it("records the provider's actual file name and warning when native verification reports a renamed file", async () => {
    const store = makeStore();
    const adapter = makeAdapter(true, {
      folderName: "backup",
      size: 1234,
      displayName: "study-journal-latest (1).zip",
      warning: "系统文件提供器返回的实际文件名不是 study-journal-latest.zip，请在备份文件夹中查找：study-journal-latest (1).zip",
    });

    const nextSettings = await flushAutoBackupNow("manual", adapter, store);

    expect(nextSettings.autoBackup?.lastBackupFileName).toBe("study-journal-latest (1).zip");
    expect(nextSettings.autoBackup?.lastBackupWarning).toContain("study-journal-latest (1).zip");
    expect(nextSettings.autoBackup?.lastError).toBeUndefined();
  });

  it("persists repository backup metadata from Android incremental sync", async () => {
    const store = makeStore();
    const adapter = makeAdapter(true, {
      folderName: "backup",
      size: 12_345,
      format: "folder-repository-v1",
      bytesWritten: 456,
      repositorySize: 12_345,
      assetCount: 7,
      snapshotId: "20260621T010000000Z",
      displayName: "study-journal-backup",
    });

    const nextSettings = await flushAutoBackupNow("manual", adapter, store);

    expect(nextSettings.autoBackup).toEqual(expect.objectContaining({
      backupFormat: "folder-repository-v1",
      lastBackupSize: 12_345,
      lastBackupBytesWritten: 456,
      lastBackupRepositorySize: 12_345,
      lastBackupAssetCount: 7,
      lastBackupSnapshotId: "20260621T010000000Z",
      lastBackupFileName: "study-journal-backup",
      lastError: undefined,
    }));
  });

  it("does not advance last backup time when the write result is empty", async () => {
    const previousBackupAt = "2026-06-20T00:00:00.000Z";
    const store = makeStore(settings(true, { lastBackupAt: previousBackupAt, lastBackupSize: 999 }));
    const adapter = makeAdapter(true, { folderName: "backup", size: 0 });

    const nextSettings = await flushAutoBackupNow("manual", adapter, store);

    expect(nextSettings.autoBackup?.lastBackupAt).toBe(previousBackupAt);
    expect(nextSettings.autoBackup?.lastBackupSize).toBe(999);
    expect(nextSettings.autoBackup?.lastError).toBe("自动备份写入结果为空。");
  });

  it("waits for an in-flight flush instead of returning stale settings", async () => {
    let resolveWrite: (value: AutoBackupWriteResult) => void = () => undefined;
    const writePromise = new Promise<AutoBackupWriteResult>((resolve) => {
      resolveWrite = resolve;
    });
    const store = makeStore();
    const adapter = makeAdapter();
    vi.mocked(adapter.writeLatest).mockImplementation(async () => writePromise);

    const first = flushAutoBackupNow("manual", adapter, store);
    const second = flushAutoBackupNow("manual", adapter, store);

    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.writeLatest).toHaveBeenCalledTimes(1);

    resolveWrite({ folderName: "backup", size: 2222 });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.autoBackup?.lastBackupSize).toBe(2222);
    expect(secondResult.autoBackup?.lastBackupSize).toBe(2222);
    expect(adapter.writeLatest).toHaveBeenCalledTimes(1);
  });

  it("does not write when folder is not bound and records an error", async () => {
    const store = makeStore();
    const adapter = makeAdapter(false);

    await flushAutoBackupNow("manual", adapter, store);

    expect(adapter.writeLatest).not.toHaveBeenCalled();
    expect(store.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoBackup: expect.objectContaining({ lastError: "尚未绑定自动备份文件夹。" }),
    }));
  });

  it("binds a folder without forcing automatic writes on for a fresh install", async () => {
    const store = makeStore(settings(false));
    const adapter = makeAdapter();

    const nextSettings = await bindAutoBackupFolder(adapter, store);

    expect(store.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoBackup: expect.objectContaining({ enabled: false, folderName: "backup" }),
    }));
    expect(nextSettings.autoBackup?.enabled).toBe(false);
  });

  it("keeps automatic writes enabled when rebinding an already enabled folder", async () => {
    const store = makeStore(settings(true));
    const adapter = makeAdapter();

    const nextSettings = await bindAutoBackupFolder(adapter, store);

    expect(nextSettings.autoBackup?.enabled).toBe(true);
    expect(nextSettings.autoBackup?.folderName).toBe("backup");
  });

  it("rejects enabling when no adapter is available", async () => {
    const store = makeStore(settings(false));
    const adapter = { ...makeAdapter(), isAvailable: vi.fn(() => false) };

    await expect(setAutoBackupEnabled(true, adapter, store)).rejects.toThrow("不支持自动备份");
  });
});
