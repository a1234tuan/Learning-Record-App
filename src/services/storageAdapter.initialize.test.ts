import { afterEach, describe, expect, it, vi } from "vitest";

describe("DexieStorageAdapter initialization", () => {
  afterEach(() => {
    vi.doUnmock("../db/database");
    vi.resetModules();
  });

  it("does not create today's entry as a startup side effect", async () => {
    vi.resetModules();
    const db = {
      open: vi.fn(async () => undefined),
      restoreStagingAssets: { clear: vi.fn(async () => undefined) },
      settings: {
        get: vi.fn(async () => ({ id: "settings" })),
        put: vi.fn(async () => undefined),
      },
    };
    vi.doMock("../db/database", () => ({ db }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();
    const methods = [
      "upsertTag",
      "migrateLegacyBlocks",
      "migrateRecordsToLinearContent",
      "migrateRecordTags",
      "migrateSettingsToDynamicSubjects",
      "migrateAiSettings",
      "migrateTtsSettings",
      "migrateAutoBackupToLocalTable",
      "purgeMistakeAndReviewData",
      "migrateRecordReviewsToMixedSystem",
      "rebuildReviewProjectionFromEvents",
      "compactOldReviewLogs",
      "resetStaleOcrJobs",
      "getOrCreateEntry",
    ] as const;
    const spies = methods.map((method) => vi.spyOn(adapter as never, method).mockResolvedValue(undefined));

    await adapter.initialize();

    expect(spies[spies.length - 1]).not.toHaveBeenCalled();
    expect(db.open).toHaveBeenCalledOnce();
    expect(spies[spies.length - 2]).toHaveBeenCalledWith(10 * 60 * 1000);
  });
});
