import { describe, expect, it, vi } from "vitest";

import type { RecordReviewDayStat, RecordReviewLog } from "../types";

class MemoryTable<T extends { id: string }> {
  private rows = new Map<string, T>();

  constructor(items: T[] = []) {
    for (const item of items) this.rows.set(item.id, item);
  }

  async get(id: string) { return this.rows.get(id); }
  async put(item: T) { this.rows.set(item.id, item); return item.id; }
  async delete(id: string) { this.rows.delete(id); }
  async bulkPut(items: T[]) { for (const item of items) this.rows.set(item.id, item); }
  async toArray() { return Array.from(this.rows.values()); }

  filter(predicate: (item: T) => boolean) {
    return {
      delete: async () => {
        const ids = Array.from(this.rows.values()).filter(predicate).map((item) => item.id);
        for (const id of ids) this.rows.delete(id);
        return ids.length;
      },
    };
  }

  where(index: string) {
    return {
      equals: (value: string) => ({
        first: async () => Array.from(this.rows.values()).find((item) => String((item as Record<string, unknown>)[index]) === value),
        toArray: async () => Array.from(this.rows.values()).filter((item) => String((item as Record<string, unknown>)[index]) === value),
      }),
      between: (_lower: unknown, upper: [string, string]) => ({
        toArray: async () => Array.from(this.rows.values()).filter((item) => {
          const r = item as unknown as { status: string; nextReviewDate?: string };
          return r.status === upper[0] && typeof r.nextReviewDate === "string" && r.nextReviewDate <= upper[1];
        }),
      }),
    };
  }
}

const OLD = "2020-01-15T10:00:00.000Z";
const RECENT = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

const ratingLog = (id: string, reviewedAt: string): RecordReviewLog => ({
  id,
  createdAt: reviewedAt,
  updatedAt: reviewedAt,
  reviewedAt,
  recordId: "record-1",
  rating: "good",
  normalizedRating: "good",
  previousEaseFactor: 2.5,
  nextEaseFactor: 2.5,
  previousRepetition: 1,
  nextRepetition: 2,
  previousIntervalDays: 1,
  nextIntervalDays: 2,
});

const actionLog = (id: string, reviewedAt: string): RecordReviewLog => ({
  ...ratingLog(id, reviewedAt),
  eventType: "reset",
});

const dayStat = (date: string, reviewedCount: number): RecordReviewDayStat => ({
  id: date,
  date,
  createdAt: `${date}T00:00:00.000Z`,
  updatedAt: `${date}T00:00:00.000Z`,
  reviewedCount,
  rememberedCount: reviewedCount,
  dueCountAtFirstOpen: 0,
  fuzzyCount: 0,
  forgotCount: 0,
});

const loadAdapter = async (logs: RecordReviewLog[], dayStats: RecordReviewDayStat[] = []) => {
  vi.resetModules();
  const fakeDb = {
    recordReviewLogs: new MemoryTable<RecordReviewLog>(logs),
    recordReviewDayStats: new MemoryTable<RecordReviewDayStat>(dayStats),
    recordReviews: new MemoryTable(),
    blocks: new MemoryTable(),
    transaction: async (_mode: string, ...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>;
      return callback();
    },
  };
  vi.doMock("../db/database", () => ({ db: fakeDb }));
  const { DexieStorageAdapter } = await import("./storageAdapter");
  const adapter = new DexieStorageAdapter();
  return { adapter, fakeDb };
};

type PrivateCompact = { compactOldReviewLogs(days?: number): Promise<void> };
type PrivateStats = { getRecordReviewStats(date?: string): Promise<{ totalReviews: number }> };

describe("compactOldReviewLogs", () => {
  it("deletes rating logs older than the retention window", async () => {
    const { adapter, fakeDb } = await loadAdapter([
      ratingLog("old-1", OLD),
      ratingLog("old-2", OLD),
      ratingLog("recent-1", RECENT),
    ]);

    await (adapter as unknown as PrivateCompact).compactOldReviewLogs(90);

    const remaining = await fakeDb.recordReviewLogs.toArray();
    expect(remaining.map((l) => l.id)).toEqual(["recent-1"]);
  });

  it("also deletes non-rating action logs older than the retention window", async () => {
    const { adapter, fakeDb } = await loadAdapter([
      actionLog("old-action", OLD),
      ratingLog("recent-rating", RECENT),
    ]);

    await (adapter as unknown as PrivateCompact).compactOldReviewLogs(90);

    const remaining = await fakeDb.recordReviewLogs.toArray();
    expect(remaining.map((l) => l.id)).toEqual(["recent-rating"]);
  });

  it("preserves all logs when everything is within the retention window", async () => {
    const { adapter, fakeDb } = await loadAdapter([
      ratingLog("r1", RECENT),
      ratingLog("r2", RECENT),
    ]);

    await (adapter as unknown as PrivateCompact).compactOldReviewLogs(90);

    expect((await fakeDb.recordReviewLogs.toArray()).length).toBe(2);
  });
});

describe("getRecordReviewStats totalReviews", () => {
  it("derives totalReviews from dayStats so compacted logs do not undercount", async () => {
    const stats = [
      dayStat("2020-01-15", 5),
      dayStat("2020-01-16", 3),
    ];
    const { adapter } = await loadAdapter([], stats);

    const result = await (adapter as unknown as PrivateStats).getRecordReviewStats("2020-01-16");

    expect(result.totalReviews).toBe(8);
  });

  it("returns 0 when there are no dayStats even if raw logs exist", async () => {
    const { adapter } = await loadAdapter([ratingLog("r1", OLD)], []);

    const result = await (adapter as unknown as PrivateStats).getRecordReviewStats("2020-01-15");

    expect(result.totalReviews).toBe(0);
  });
});
