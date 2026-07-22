import { describe, expect, it, vi } from "vitest";

import type { Asset, RecordBlock, StreamableBackupSnapshot } from "../types";

type StoredRow = object;

class MemoryTable<T extends StoredRow> {
  private rows = new Map<string, T>();

  constructor(rows: T[] = [], private readonly key = "id") {
    for (const row of rows) {
      this.rows.set(String((row as Record<string, unknown>)[this.key]), row);
    }
  }

  async get(id: string): Promise<T | undefined> {
    return this.rows.get(id);
  }

  async put(row: T): Promise<string> {
    const id = String((row as Record<string, unknown>)[this.key]);
    this.rows.set(id, row);
    return id;
  }

  async bulkPut(rows: T[]): Promise<void> {
    for (const row of rows) {
      await this.put(row);
    }
  }

  async clear(): Promise<void> {
    this.rows.clear();
  }

  async toArray(): Promise<T[]> {
    return Array.from(this.rows.values());
  }

  where(index: string) {
    return {
      equals: (value: string) => ({
        toArray: async () => Array.from(this.rows.values()).filter((row) => (row as Record<string, unknown>)[index] === value),
        delete: async () => {
          for (const [id, row] of this.rows.entries()) {
            if ((row as Record<string, unknown>)[index] === value) {
              this.rows.delete(id);
            }
          }
        },
      }),
    };
  }
}

const stamp = "2026-06-21T00:00:00.000Z";

const oldRecord: RecordBlock = {
  id: "old-record",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "数学",
  title: "恢复前记录",
  contentHtml: "<p>保留的旧数据</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
};

const oldAsset: Asset = {
  id: "old-asset",
  createdAt: stamp,
  updatedAt: stamp,
  fileName: "old.png",
  title: "旧图片",
  mimeType: "image/png",
  size: 1,
  kind: "image",
  data: new Blob(["old"], { type: "image/png" }),
};

const snapshot: StreamableBackupSnapshot = {
  payload: {
    manifest: {
      format: "study-journal",
      version: 4,
      exportedAt: stamp,
      appVersion: "0.1.0",
      counts: { entries: 0, blocks: 1, mistakes: 0, assets: 2, tags: 0, reviews: 0, studySessions: 0 },
    },
    entries: [],
    blocks: [{
      ...oldRecord,
      id: "new-record",
      title: "恢复中的新记录",
      contentHtml: '<record-asset data-asset-id="new-asset-1" data-kind="image" data-title="one.png"></record-asset>',
    }],
    mistakes: [],
    tags: [],
    reviews: [],
    studySessions: [],
    settings: {
      id: "settings",
      examDate: "2026-12-27",
      theme: "system",
      accentColor: "#2f6f5e",
      backupReminderDays: 7,
      fontScale: 1,
      lineHeight: 1.7,
      schemaVersion: 4,
    },
  },
  assets: [
    { ...oldAsset, id: "new-asset-1", fileName: "one.png", title: "one", data: undefined as never },
    { ...oldAsset, id: "new-asset-2", fileName: "two.png", title: "two", data: undefined as never },
  ].map(({ data: _data, ...asset }) => asset),
};

describe("DexieStorageAdapter stream restore", () => {
  it("keeps current data when resource staging fails and removes staged assets", async () => {
    vi.resetModules();
    const fakeDb = {
      entries: new MemoryTable(),
      blocks: new MemoryTable<StoredRow>([oldRecord]),
      recordDrafts: new MemoryTable(),
      recordReviews: new MemoryTable(),
      recordReviewLogs: new MemoryTable(),
      recordReviewDayStats: new MemoryTable(),
      mistakes: new MemoryTable(),
      tags: new MemoryTable(),
      reviews: new MemoryTable(),
      studySessions: new MemoryTable(),
      settings: new MemoryTable(),
      assets: new MemoryTable<StoredRow>([oldAsset]),
      restoreStagingAssets: new MemoryTable<StoredRow>([], "stagingId"),
      transaction: async (_mode: string, ...args: unknown[]) => {
        const callback = args.at(-1) as () => Promise<unknown>;
        return callback();
      },
    };
    vi.doMock("../db/database", () => ({ db: fakeDb }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();

    await expect(adapter.restoreStreamableSnapshot(snapshot, async (meta) => {
      if (meta.id === "new-asset-2") {
        return undefined;
      }
      return { ...oldAsset, id: meta.id, fileName: meta.fileName, title: meta.title };
    })).rejects.toThrow("无法读取资源 two.png");

    expect(await fakeDb.blocks.get("old-record")).toEqual(oldRecord);
    expect(await fakeDb.assets.get("old-asset")).toEqual(oldAsset);
    expect(await fakeDb.restoreStagingAssets.toArray()).toEqual([]);
  });

  it("appends imported records with a conflict-safe title and no review state", async () => {
    vi.resetModules();
    const settings = {
      id: "settings",
      examDate: "2026-12-27",
      theme: "system",
      accentColor: "#2f6f5e",
      backupReminderDays: 7,
      fontScale: 1,
      lineHeight: 1.7,
      schemaVersion: 4,
    };
    const imported: RecordBlock = {
      ...oldRecord,
      id: "imported-record",
      title: oldRecord.title,
      contentHtml: '<p><record-asset data-asset-id="imported-asset" data-kind="image" data-title="one.png"></record-asset></p>',
    };
    const importedAsset = { ...oldAsset, id: "imported-asset", fileName: "one.png" };
    const fakeDb = {
      entries: new MemoryTable(),
      blocks: new MemoryTable<StoredRow>([oldRecord]),
      assets: new MemoryTable<StoredRow>([oldAsset]),
      settings: new MemoryTable<StoredRow>([settings]),
      restoreStagingAssets: new MemoryTable<StoredRow>([], "stagingId"),
      transaction: async (_mode: string, ...args: unknown[]) => {
        const callback = args.at(-1) as () => Promise<unknown>;
        return callback();
      },
    };
    vi.doMock("../db/database", () => ({ db: fakeDb }));
    const { DexieStorageAdapter } = await import("./storageAdapter");
    const adapter = new DexieStorageAdapter();

    await adapter.stageRecordTransferAsset("transfer", importedAsset);
    const summary = await adapter.commitRecordTransfer("transfer", [imported]);
    const blocks = await fakeDb.blocks.toArray() as RecordBlock[];
    const inserted = blocks.find((block) => block.id === imported.id);
    const nextSettings = await fakeDb.settings.get("settings") as typeof settings & { subjects?: Array<{ name: string }> };

    expect(summary).toMatchObject({ records: 1, assets: 1, images: 1 });
    expect(inserted).toMatchObject({ title: "恢复前记录（导入副本）", order: 1, assets: [{ id: "imported-asset", kind: "image", title: "one.png" }] });
    expect(nextSettings.schemaVersion).toBe(4);
    expect(nextSettings.subjects?.some((subject) => subject.name === "数学")).toBe(true);
    expect(await fakeDb.restoreStagingAssets.toArray()).toEqual([]);
  });
});
