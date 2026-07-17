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

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async bulkPut(items: T[]): Promise<void> {
    for (const item of items) {
      this.rows.set(item.id, item);
    }
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

const loadAdapter = async (blocks: Block[], reviews: RecordReviewState[], reviewLogs: RecordReviewLog[] = []) => {
  vi.resetModules();
  const fakeDb = {
    blocks: new MemoryTable<Block>(blocks),
    recordReviews: new MemoryTable<RecordReviewState>(reviews),
    recordReviewLogs: new MemoryTable<RecordReviewLog>(reviewLogs),
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
  it("stores trimmed evaluation text with the review log", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z", "  - 新理解\n- 掌握更稳  ");

    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].evaluationText).toBe("- 新理解\n- 掌握更稳");
  });

  it("omits blank evaluation text from the review log", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z", " \n ");

    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs[0].evaluationText).toBeUndefined();
  });

  it("atomically restores the card, evaluation, log, and day stats when undoing a rating", async () => {
    const originalReview = review();
    const { adapter, fakeDb } = await loadAdapter([record()], [originalReview]);
    await adapter.ensureRecordReviewDay("2026-07-03", 1);

    const result = await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z", "重新梳理了队列边界");
    const restored = await adapter.undoRecordReview(result!.undoToken);

    expect(restored).toEqual(originalReview);
    expect(await fakeDb.recordReviewLogs.toArray()).toEqual([]);
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      dueCountAtFirstOpen: 1,
      reviewedCount: 0,
      rememberedCount: 0,
      goodCount: 0,
      easyCount: 0,
      fuzzyCount: 0,
      forgotCount: 0,
    });
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([originalReview]);
  });

  it("restores the prior same-day log when undoing a rating correction", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);
    await adapter.ensureRecordReviewDay("2026-07-03", 1);
    await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z", "第一次评价");
    const correction = await adapter.rateRecordReview("record-1", "forgot", "2026-07-03T02:00:00.000Z", "更正后的评价");

    await adapter.undoRecordReview(correction!.undoToken);

    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ rating: "good", evaluationText: "第一次评价" });
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      reviewedCount: 1,
      goodCount: 1,
      forgotCount: 0,
    });
  });

  it("removes an overdue card from today's due list after rating it", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    const result = await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z");

    expect(result?.review.lastReviewDate).toBe("2026-07-03");
    expect(result?.review.reviewKind).toBe("overview");
    expect(result?.review.nextReviewDate).toBe("2026-07-13");
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      reviewedCount: 1,
      rememberedCount: 1,
      goodCount: 1,
    });
  });

  it("updates the same-day rating without duplicating logs or stats", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.rateRecordReview("record-1", "remembered", "2026-07-02T16:30:00.000Z", "旧评价");
    const secondResult = await adapter.rateRecordReview("record-1", "forgot", "2026-07-03T02:00:00.000Z", "更新评价");

    expect(secondResult?.review.lastReviewDate).toBe("2026-07-03");
    expect(secondResult?.review.totalReviews).toBe(3);
    expect(secondResult?.review.nextReviewDate).toBe("2026-07-04");
    expect(secondResult?.review.intervalDays).toBe(1);
    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      rating: "forgot",
      normalizedRating: "forgot",
      evaluationText: "更新评价",
      previousTotalReviews: 2,
      nextReviewDate: "2026-07-04",
    });
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      reviewedCount: 1,
      fuzzyCount: 0,
      forgotCount: 1,
      rememberedCount: 0,
      goodCount: 0,
    });
  });

  it("keeps same-day evaluation text when correcting a rating without a new evaluation", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z", "第一次评价");
    await adapter.rateRecordReview("record-1", "forgot", "2026-07-03T02:00:00.000Z");

    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      rating: "forgot",
      evaluationText: "第一次评价",
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

    expect(saved?.review).toMatchObject({
      status: "active",
      repetition: 0,
      intervalDays: 1,
      nextReviewDate: "2026-07-04",
      lastReviewDate: "2026-07-03",
      totalReviews: 8,
    });
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
  });

  it("keeps successful overview reviews active instead of auto-mastering them", async () => {
    const { adapter } = await loadAdapter([
      record(),
    ], [
      review({
        repetition: 4,
        intervalDays: 20,
        consecutiveRemembered: 4,
      }),
    ]);

    const saved = await adapter.rateRecordReview("record-1", "good", "2026-07-03T01:30:00.000Z");

    expect(saved?.review.status).toBe("active");
    expect(saved?.review.nextReviewDate).toBe("2026-07-24");
    expect(saved?.review.consecutiveRemembered).toBe(5);
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
  });

  it("switches review kind, resets the schedule, and keeps review logs", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);
    await adapter.rateRecordReview("record-1", "good", "2026-07-02T16:30:00.000Z");

    const saved = await adapter.setRecordReviewKind("record-1", "memory");

    expect(saved).toMatchObject({
      reviewKind: "memory",
      scheduler: "fsrs-v6",
      status: "active",
      intervalDays: 1,
    });
    expect(saved?.nextReviewDate).toBeDefined();
    expect(saved?.fsrsCard).toBeDefined();
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);

    const overview = await adapter.setRecordReviewKind("record-1", "overview");
    expect(overview).toMatchObject({
      reviewKind: "overview",
      scheduler: "overview-v1",
      status: "active",
      intervalDays: 1,
    });
    expect(overview?.fsrsCard).toBeUndefined();
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
  });

  it("uses FSRS state for memory reviews", async () => {
    const { adapter } = await loadAdapter([
      record(),
    ], [
      review({
        reviewKind: "memory",
        scheduler: "fsrs-v6",
      }),
    ]);

    const saved = await adapter.rateRecordReview("record-1", "good", "2026-07-03T01:30:00.000Z");

    expect(saved?.review.reviewKind).toBe("memory");
    expect(saved?.review.scheduler).toBe("fsrs-v6");
    expect(saved?.review.fsrsCard).toBeDefined();
    expect(Boolean(saved?.review.nextReviewDate && saved.review.nextReviewDate > "2026-07-03")).toBe(true);
  });

  it("self-heals restored review states during mixed-system migration", async () => {
    const { adapter, fakeDb } = await loadAdapter([
      record(),
      record({ id: "memory-record" }),
    ], [
      review({ reviewKind: undefined, scheduler: undefined }),
      review({
        id: "memory-record",
        recordId: "memory-record",
        reviewKind: "memory",
        scheduler: "fsrs-v6",
        fsrsCard: undefined,
        nextReviewDate: "2026-08-01",
      }),
    ]);

    await (adapter as unknown as { migrateRecordReviewsToMixedSystem(): Promise<void> }).migrateRecordReviewsToMixedSystem();

    expect(await fakeDb.recordReviews.get("record-1")).toMatchObject({
      reviewKind: "overview",
      scheduler: "overview-v1",
      fsrsCard: undefined,
    });
    const memory = await fakeDb.recordReviews.get("memory-record");
    expect(memory).toMatchObject({
      reviewKind: "memory",
      scheduler: "fsrs-v6",
      nextReviewDate: "2026-08-01",
    });
    expect(memory?.fsrsCard).toMatchObject({
      dueDate: "2026-08-01",
      reps: 0,
      lapses: 0,
    });
  });
});
