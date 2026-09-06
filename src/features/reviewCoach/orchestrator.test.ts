import { describe, expect, it, vi } from "vitest";

import type { AdaptiveReviewTask, AnalysisBatch, AnalysisInputRef } from "./domain";
import { ReviewCoachOrchestrator, rankWaitingTasks } from "./orchestrator";
import type { ReviewCoachRepository } from "./repository";

const stamp = "2026-09-04T08:00:00.000Z";

const inputRef = (block: string, suffix: string): AnalysisInputRef => ({
  queueItemId: `queue-${suffix}`,
  feedbackId: `feedback-${suffix}`,
  decisionBlockId: block,
  recordId: `record-${block}`,
  contentVersion: 1,
});

describe("ReviewCoachOrchestrator", () => {
  it("keeps all pending feedback for one block together and batches at most three blocks", async () => {
    const createAnalysisBatch = vi.fn(async (batch: AnalysisBatch) => batch);
    let nextId = 0;
    const orchestrator = new ReviewCoachOrchestrator({
      repository: { createAnalysisBatch } as unknown as ReviewCoachRepository,
      ids: { next: () => `generated-${++nextId}` },
      clock: { now: () => stamp },
    });
    const refs = [
      inputRef("block-1", "1a"),
      inputRef("block-1", "1b"),
      inputRef("block-2", "2"),
      inputRef("block-3", "3"),
      inputRef("block-4", "4"),
    ];

    const batch = await orchestrator.prepareAnalysisBatch({
      inputRefs: refs,
      provider: "test",
      model: "deep-model",
      promptVersion: "session-blueprint-v1",
      policyVersion: "review-coach-policy-v1",
      schemaVersion: 1,
      inputFingerprint: "input",
      operationId: "operation",
    });

    expect(batch.subBatches).toHaveLength(2);
    expect(batch.subBatches[0].inputRefs.map((ref) => ref.decisionBlockId)).toEqual(["block-1", "block-1", "block-2", "block-3"]);
    expect(new Set(batch.subBatches[0].inputRefs.map((ref) => ref.decisionBlockId)).size).toBe(3);
    expect(batch.subBatches[1].inputRefs.map((ref) => ref.decisionBlockId)).toEqual(["block-4"]);
  });

  it("uses deterministic local priority tiers and FIFO waiting age", () => {
    const task = (id: string, priorityTier: AdaptiveReviewTask["priorityTier"], queuedAt: string): AdaptiveReviewTask => ({
      id,
      blueprintId: `blueprint-${id}`,
      decisionBlockId: `block-${id}`,
      recordId: `record-${id}`,
      contentVersion: 1,
      status: "waiting",
      priorityTier,
      queuedAt,
      idempotencyKey: `operation-${id}`,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    const ranked = rankWaitingTasks([
      task("new", "first-difficulty", "2026-09-04T09:00:00.000Z"),
      task("old", "first-difficulty", "2026-09-04T08:00:00.000Z"),
      task("verification", "due-verification", "2026-09-04T10:00:00.000Z"),
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["verification", "old", "new"]);
  });
});
