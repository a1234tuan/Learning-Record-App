import { describe, expect, it, vi } from "vitest";

import type { Block, RecordBlock, RecordReviewDayStat, RecordReviewLog, RecordReviewState } from "../types";

class MemoryTable<T extends { id: string }> {
  private rows = new Map<string, T>();

  constructor(items: T[] = []) {
    for (const item of items) {
      this.rows.set(item.id, item);
    }
  }

  async get(id: string): Promise<T | undefined> {
    return this.rows.get(id);
  }

  async put(item: T): Promise<string> {
    this.rows.set(item.id, item);
    return item.id;
  }

  async toArray(): Promise<T[]> {
    return Array.from(this.rows.values());
  }

  where(index: string) {
    return {
      equals: (value: string) => ({
        first: async () => Array.from(this.rows.values()).find((item) => String((item as Record<string, unknown>)[index]) === value),
        toArray: async () => Array.from(this.rows.values()).filter((item) => String((item as Record<string, unknown>)[index]) === value),
      }),
      between: (_lower: [string, unknown], upper: [string, string]) => ({
        toArray: async () => Array.from(this.rows.values()).filter((item) => {
          const review = item as unknown as RecordReviewState;
          return review.status === upper[0] && typeof review.nextReviewDate === "string" && review.nextReviewDate <= upper[1];
        }),
      }),
    };
  }
}

const stamp = "2026-06-20T00:00:00.000Z";

const record = (patch: Partial<RecordBlock> = {}): RecordBlock => ({
  id: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-20",
  order: 0,
  subject: "数据结构",
  title: "BFS 队列",
  contentHtml: "<p>content</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
  ...patch,
});

const review = (patch: Partial<RecordReviewState> = {}): RecordReviewState => ({
  id: "record-1",
  recordId: "record-1",
  createdAt: stamp,
  updatedAt: stamp,
  status: "active",
  easeFactor: 2.5,
  repetition: 1,
  intervalDays: 1,
  nextReviewDate: "2026-07-02",
  consecutiveRemembered: 1,
  totalReviews: 2,
  ...patch,
});

const loadAdapter = async (blocks: Block[], reviews: RecordReviewState[]) => {
  vi.resetModules();
  const fakeDb = {
    blocks: new MemoryTable<Block>(blocks),
    recordReviews: new MemoryTable<RecordReviewState>(reviews),
    recordReviewLogs: new MemoryTable<RecordReviewLog>(),
    recordReviewDayStats: new MemoryTable<RecordReviewDayStat>(),
    transaction: async (_mode: string, ...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>;
      return callback();
    },
  };
  vi.doMock("../db/database", () => ({ db: fakeDb }));
  const { DexieStorageAdapter } = await import("./storageAdapter");
  return { adapter: new DexieStorageAdapter(), fakeDb };
};

describe("DexieStorageAdapter record review invariants", () => {
  it("removes an overdue card from today's due list after rating it", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    const saved = await adapter.rateRecordReview("record-1", "remembered", "2026-07-02T16:30:00.000Z");

    expect(saved?.lastReviewDate).toBe("2026-07-03");
    expect(saved?.nextReviewDate).toBe("2026-07-09");
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      reviewedCount: 1,
      rememberedCount: 1,
    });
  });

  it("does not write duplicate logs or stats for same-day repeat ratings", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.rateRecordReview("record-1", "remembered", "2026-07-02T16:30:00.000Z");
    const secondResult = await adapter.rateRecordReview("record-1", "fuzzy", "2026-07-03T02:00:00.000Z");

    expect(secondResult?.lastReviewDate).toBe("2026-07-03");
    expect(secondResult?.totalReviews).toBe(3);
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      reviewedCount: 1,
      fuzzyCount: 0,
      rememberedCount: 1,
    });
  });

  it("keeps forgot reviews out of today's queue and schedules them for tomorrow", async () => {
    const { adapter } = await loadAdapter([
      record(),
    ], [
      review({
        repetition: 3,
        intervalDays: 15,
        consecutiveRemembered: 3,
        totalReviews: 7,
      }),
    ]);

    const saved = await adapter.rateRecordReview("record-1", "forgot", "2026-07-03T01:30:00.000Z");

    expect(saved).toMatchObject({
      status: "active",
      repetition: 0,
      intervalDays: 1,
      nextReviewDate: "2026-07-04",
      lastReviewDate: "2026-07-03",
      totalReviews: 8,
    });
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
  });

  it("marks a card mastered and removes its due date after the fifth consecutive remembered rating", async () => {
    const { adapter } = await loadAdapter([
      record(),
    ], [
      review({
        repetition: 4,
        intervalDays: 20,
        consecutiveRemembered: 4,
      }),
    ]);

    const saved = await adapter.rateRecordReview("record-1", "remembered", "2026-07-03T01:30:00.000Z");

    expect(saved?.status).toBe("mastered");
    expect(saved?.nextReviewDate).toBeUndefined();
    expect(saved?.consecutiveRemembered).toBe(5);
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
  });
});
