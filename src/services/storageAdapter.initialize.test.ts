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
      "restoreKnowledgePodcastAudioReferences",
      "resetStaleOcrJobs",
      "cleanupDuplicateLearningCoachTasks",
      "getOrCreateEntry",
    ] as const;
    const spies = methods.map((method) => vi.spyOn(adapter as never, method).mockResolvedValue(undefined));

    await adapter.initialize();

    expect(spies[spies.length - 1]).not.toHaveBeenCalled();
    expect(db.open).toHaveBeenCalledOnce();
    expect(spies[spies.length - 3]).toHaveBeenCalledWith(10 * 60 * 1000);
    expect(spies[spies.length - 2]).toHaveBeenCalledOnce();
  });

  it("writes the formal eight subjects for a fresh database", async () => {
    vi.resetModules();
    const db = {
      open: vi.fn(async () => undefined),
      restoreStagingAssets: { clear: vi.fn(async () => undefined) },
      settings: {
        get: vi.fn(async () => undefined),
        put: vi.fn(async (_settings: unknown) => undefined),
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
      "restoreKnowledgePodcastAudioReferences",
      "resetStaleOcrJobs",
      "cleanupDuplicateLearningCoachTasks",
    ] as const;
    methods.forEach((method) => vi.spyOn(adapter as never, method).mockResolvedValue(undefined));

    await adapter.initialize();

    expect(db.settings.put).toHaveBeenCalledWith(expect.objectContaining({
      subjects: expect.arrayContaining([
        expect.objectContaining({ name: "OS" }),
        expect.objectContaining({ name: "计组" }),
        expect.objectContaining({ name: "计网" }),
        expect.objectContaining({ name: "数据结构" }),
        expect.objectContaining({ name: "数学" }),
        expect.objectContaining({ name: "英语" }),
        expect.objectContaining({ name: "政治" }),
        expect.objectContaining({ name: "CS" }),
      ]),
    }));
    const initialSettings = db.settings.put.mock.calls[0]?.[0] as { subjects: Array<{ name: string }> } | undefined;
    expect(initialSettings).toBeDefined();
    const subjectNames = initialSettings?.subjects.map((subject) => subject.name) ?? [];
    expect(subjectNames).toHaveLength(8);
    expect(subjectNames).not.toEqual(expect.arrayContaining(["读书笔记", "其他"]));
  });
});
