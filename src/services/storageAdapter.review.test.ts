import { describe, expect, it, vi } from "vitest";

import type { Block, RecordBlock, RecordReviewDayStat, RecordReviewLog, RecordReviewState } from "../types";
import type { AnalysisQueueItem, DecisionBlock, DecisionBlockFeedback } from "../features/reviewCoach/domain";

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

  async add(item: T): Promise<string> {
    if (this.rows.has(item.id)) throw new Error(`Duplicate key ${item.id}`);
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

  async clear(): Promise<void> {
    this.rows.clear();
  }

  async toArray(): Promise<T[]> {
    return Array.from(this.rows.values());
  }

  snapshot(): T[] {
    return Array.from(this.rows.values());
  }

  restore(items: readonly T[]): void {
    this.rows.clear();
    for (const item of items) {
      this.rows.set(item.id, item);
    }
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
  tags: [],
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

const decisionBlock = (patch: Partial<DecisionBlock> = {}): DecisionBlock => ({
  id: "decision-1",
  recordId: "record-1",
  contentVersion: 1,
  position: 0,
  contentUpdatedAt: stamp,
  createdAt: stamp,
  updatedAt: stamp,
  ...patch,
});

const feedbackInput = (patch: Partial<{
  decisionBlockId: string;
  contentVersion: number;
  comment: string;
  includeInAnalysis: boolean;
  operationId: string;
}> = {}) => ({
  decisionBlockId: "decision-1",
  contentVersion: 1,
  comment: "入队时机仍然容易混淆",
  includeInAnalysis: true,
  operationId: "review-feedback-operation-1",
  ...patch,
});

const loadAdapter = async (
  blocks: Block[],
  reviews: RecordReviewState[],
  reviewLogs: RecordReviewLog[] = [],
  coach: {
    decisionBlocks?: DecisionBlock[];
    feedback?: DecisionBlockFeedback[];
    queueItems?: AnalysisQueueItem[];
  } = {},
) => {
  vi.resetModules();
  const emptyTable = () => new MemoryTable<any>();
  const fakeDb = {
    blocks: new MemoryTable<Block>(blocks),
    recordReviews: new MemoryTable<RecordReviewState>(reviews),
    recordReviewLogs: new MemoryTable<RecordReviewLog>(reviewLogs),
    recordReviewDayStats: new MemoryTable<RecordReviewDayStat>(),
    cloudSyncMutation: emptyTable(),
    decisionBlocks: new MemoryTable<DecisionBlock>(coach.decisionBlocks),
    decisionBlockArchives: emptyTable(),
    decisionBlockFeedback: new MemoryTable<DecisionBlockFeedback>(coach.feedback),
    feedbackInterpretations: emptyTable(),
    analysisQueueItems: new MemoryTable<AnalysisQueueItem>(coach.queueItems),
    analysisBatches: emptyTable(),
    sessionBlueprints: emptyTable(),
    adaptiveReviewTasks: emptyTable(),
    adaptiveQuizTurns: emptyTable(),
    taskOutcomeEvents: emptyTable(),
    delayedVerifications: emptyTable(),
    decisionBlockStates: emptyTable(),
    interventionEffectSummaries: emptyTable(),
    aiRoleConfigs: emptyTable(),
    learningEvidence: emptyTable(),
    knowledgePoints: emptyTable(),
    recordKnowledgePointLinks: emptyTable(),
    knowledgeRelations: emptyTable(),
    transaction: undefined as unknown as (_mode: string, ...args: unknown[]) => Promise<unknown>,
  };
  fakeDb.transaction = async (_mode: string, ...args: unknown[]) => {
    const callback = args.at(-1) as () => Promise<unknown>;
    const tables = args.slice(0, -1).flat().filter((item): item is MemoryTable<any> => item instanceof MemoryTable);
    const snapshots = tables.map((table) => [table, table.snapshot()] as const);
    try {
      return await callback();
    } catch (error) {
      for (const [table, snapshot] of snapshots) table.restore(snapshot);
      throw error;
    }
  };
  vi.doMock("../db/database", () => ({ db: fakeDb }));
  const { DexieStorageAdapter } = await import("./storageAdapter");
  return { adapter: new DexieStorageAdapter(), fakeDb };
};

describe("DexieStorageAdapter record review invariants", () => {
  it("commits rating, block feedback, and its queue item in one transaction", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()], [], { decisionBlocks: [decisionBlock()] });

    const saved = await adapter.rateRecordReview(
      "record-1",
      "good",
      "2026-07-03T01:30:00.000Z",
      undefined,
      [feedbackInput()],
    );

    const [feedback] = await fakeDb.decisionBlockFeedback.toArray();
    const [queueItem] = await fakeDb.analysisQueueItems.toArray();
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
    expect(feedback).toMatchObject({
      decisionBlockId: "decision-1",
      recordId: "record-1",
      contentVersion: 1,
      reviewLogId: saved?.undoToken.reviewLogId,
      comment: "入队时机仍然容易混淆",
      includeInAnalysis: true,
    });
    expect(queueItem).toMatchObject({ feedbackId: feedback.id, status: "eligible", eligibilityReason: "user-feedback" });
    expect(saved?.undoToken.decisionBlockFeedbackIds).toEqual([feedback.id]);
  });

  it("does not create feedback or queue facts for a blank block comment", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()], [], { decisionBlocks: [decisionBlock()] });

    await adapter.rateRecordReview(
      "record-1",
      "good",
      "2026-07-03T01:30:00.000Z",
      undefined,
      [feedbackInput({ comment: " \n " })],
    );

    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
    expect(await fakeDb.decisionBlockFeedback.toArray()).toEqual([]);
    expect(await fakeDb.analysisQueueItems.toArray()).toEqual([]);
  });

  it("stores opted-out block feedback without creating an analysis queue item", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()], [], { decisionBlocks: [decisionBlock()] });

    await adapter.rateRecordReview(
      "record-1",
      "good",
      "2026-07-03T01:30:00.000Z",
      undefined,
      [feedbackInput({ includeInAnalysis: false })],
    );

    expect(await fakeDb.decisionBlockFeedback.toArray()).toEqual([
      expect.objectContaining({ comment: "入队时机仍然容易混淆", includeInAnalysis: false }),
    ]);
    expect(await fakeDb.analysisQueueItems.toArray()).toEqual([]);
  });

  it("does not duplicate feedback or queue facts when an operation is retried", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()], [], { decisionBlocks: [decisionBlock()] });
    const input = feedbackInput();

    const first = await adapter.rateRecordReview("record-1", "good", "2026-07-03T01:30:00.000Z", undefined, [input]);
    const retried = await adapter.rateRecordReview("record-1", "good", "2026-07-03T01:31:00.000Z", undefined, [input]);

    expect(await fakeDb.decisionBlockFeedback.toArray()).toHaveLength(1);
    expect(await fakeDb.analysisQueueItems.toArray()).toHaveLength(1);
    expect(retried?.undoToken.decisionBlockFeedbackIds).toEqual(first?.undoToken.decisionBlockFeedbackIds);
  });

  it("tombstones feedback and its queue item when the linked rating is undone", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()], [], { decisionBlocks: [decisionBlock()] });
    const saved = await adapter.rateRecordReview(
      "record-1",
      "good",
      "2026-07-03T01:30:00.000Z",
      undefined,
      [feedbackInput()],
    );

    await adapter.undoRecordReview(saved!.undoToken);

    expect(await fakeDb.decisionBlockFeedback.toArray()).toEqual([
      expect.objectContaining({ deletedAt: expect.any(String) }),
    ]);
    expect(await fakeDb.analysisQueueItems.toArray()).toEqual([
      expect.objectContaining({ status: "deleted", deletedAt: expect.any(String) }),
    ]);
  });

  it("rolls back the entire rating when feedback targets an old content version", async () => {
    const originalReview = review();
    const { adapter, fakeDb } = await loadAdapter([record()], [originalReview], [], { decisionBlocks: [decisionBlock({ contentVersion: 2 })] });

    await expect(adapter.rateRecordReview(
      "record-1",
      "good",
      "2026-07-03T01:30:00.000Z",
      undefined,
      [feedbackInput({ contentVersion: 1 })],
    )).rejects.toMatchObject({ code: "stale-content-version" });

    expect(await fakeDb.recordReviews.get("record-1")).toEqual(originalReview);
    expect(await fakeDb.recordReviewLogs.toArray()).toEqual([]);
    expect(await fakeDb.recordReviewDayStats.toArray()).toEqual([]);
    expect(await fakeDb.decisionBlockFeedback.toArray()).toEqual([]);
    expect(await fakeDb.analysisQueueItems.toArray()).toEqual([]);
  });

  it("persists the strictly later easy interval for an overview card", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review({ intervalDays: 10 })]);

    const saved = await adapter.rateRecordReview("record-1", "easy", "2026-07-03T01:30:00.000Z");

    // The due date carries a deterministic +/-3 day fuzz on top of the exact 60-day ladder
    // step (see reviewScheduler.ts overviewFuzzOffset) so batches of cards rated the same
    // way don't all become due on the same day.
    expect(saved?.review).toMatchObject({ intervalDays: 60, nextReviewDate: "2026-08-20" });
    const [log] = await fakeDb.recordReviewLogs.toArray();
    expect(log).toMatchObject({ previousIntervalDays: 10, nextIntervalDays: 60, nextReviewDate: "2026-08-20" });
  });

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
    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.some((log) => log.eventType === "rating" && log.rating === "good")).toBe(true);
    expect(logs.some((log) => log.eventType === "rating-undone" && log.revertedEventId === result!.undoToken.reviewLogId)).toBe(true);
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
    expect(logs).toHaveLength(3);
    expect(logs.filter((log) => log.eventType === "rating")).toHaveLength(2);
    expect(logs.find((log) => log.eventType === "rating-undone")).toMatchObject({
      revertedEventId: correction!.undoToken.reviewLogId,
    });
    expect(await adapter.listRecordReviewLogs("record-1")).toHaveLength(1);
    expect((await adapter.listRecordReviewLogs("record-1"))[0]).toMatchObject({ rating: "good", evaluationText: "第一次评价" });
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
    // Fuzzed landing date on top of the exact 10-day ladder step.
    expect(result?.review.nextReviewDate).toBe("2026-07-14");
    expect(await adapter.listDueRecordReviews("2026-07-03")).toEqual([]);
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(1);
    expect(await fakeDb.recordReviewDayStats.get("2026-07-03")).toMatchObject({
      reviewedCount: 1,
      rememberedCount: 1,
      goodCount: 1,
    });
  });

  it("keeps same-day rating corrections as immutable events while projecting one daily stat", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.rateRecordReview("record-1", "remembered", "2026-07-02T16:30:00.000Z", "旧评价");
    const secondResult = await adapter.rateRecordReview("record-1", "forgot", "2026-07-03T02:00:00.000Z", "更新评价");

    expect(secondResult?.review.lastReviewDate).toBe("2026-07-03");
    expect(secondResult?.review.totalReviews).toBe(3);
    expect(secondResult?.review.nextReviewDate).toBe("2026-07-04");
    expect(secondResult?.review.intervalDays).toBe(1);
    const logs = await fakeDb.recordReviewLogs.toArray();
    expect(logs).toHaveLength(2);
    expect(logs.at(-1)).toMatchObject({
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
    expect(logs).toHaveLength(2);
    expect(logs.at(-1)).toMatchObject({
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

  it("masters an overview card after five consecutive successful reviews", async () => {
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

    expect(saved?.review.status).toBe("mastered");
    expect(saved?.review.nextReviewDate).toBeUndefined();
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
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(2);

    const overview = await adapter.setRecordReviewKind("record-1", "overview");
    expect(overview).toMatchObject({
      reviewKind: "overview",
      scheduler: "overview-v1",
      status: "active",
      intervalDays: 1,
    });
    expect(overview?.fsrsCard).toBeUndefined();
    expect(await fakeDb.recordReviewLogs.toArray()).toHaveLength(3);
  });

  it("records reset and removal as replayable sync events", async () => {
    const { adapter, fakeDb } = await loadAdapter([record()], [review()]);

    await adapter.resetRecordReview("record-1");
    await adapter.removeRecordFromReview("record-1");

    const events = await fakeDb.recordReviewLogs.toArray();
    expect(events.map((event) => event.eventType)).toEqual(["reset", "removed"]);
    expect(events.at(-1)?.stateAfter?.status).toBe("removed");
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
