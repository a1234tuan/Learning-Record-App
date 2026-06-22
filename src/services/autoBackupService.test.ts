import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettings, StorageAdapter, StorageSnapshot } from "../types";
import type { AutoBackupAdapter } from "./autoBackupAdapter";
import {
  bindAutoBackupFolder,
  flushAutoBackupNow,
  markAutoBackupDirty,
  setAutoBackupEnabled,
} from "./autoBackupService";

const stamp = "2026-06-21T00:00:00.000Z";

const settings = (enabled = true): AppSettings => ({
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

const makeAdapter = (bound = true): AutoBackupAdapter => ({
  isAvailable: vi.fn(() => true),
  bindFolder: vi.fn(async () => ({ folderName: "backup" })),
  isBound: vi.fn(async () => ({ bound, folderName: bound ? "backup" : undefined })),
  writeLatest: vi.fn(async () => ({ folderName: "backup", size: 1234 })),
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
    const adapter = makeAdapter();

    await flushAutoBackupNow("manual", adapter, store);

    expect(adapter.writeLatest).toHaveBeenCalledTimes(1);
    expect(store.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoBackup: expect.objectContaining({ lastBackupSize: 1234 }),
    }));
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

  it("binds a folder and enables auto backup", async () => {
    const store = makeStore(settings(false));
    const adapter = makeAdapter();

    await bindAutoBackupFolder(adapter, store);

    expect(store.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      autoBackup: expect.objectContaining({ enabled: true, folderName: "backup" }),
    }));
  });

  it("rejects enabling when no adapter is available", async () => {
    const store = makeStore(settings(false));
    const adapter = { ...makeAdapter(), isAvailable: vi.fn(() => false) };

    await expect(setAutoBackupEnabled(true, adapter, store)).rejects.toThrow("不支持自动备份");
  });
});
