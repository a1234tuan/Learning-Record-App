import { describe, expect, it } from "vitest";

import { replayAllDecisionBlockStates, replayDecisionBlockState } from "./replay";
import { completeCoachTestSnapshot } from "./reviewCoachTestFixtures";
import { ReviewCoachValidationError, validateReviewCoachFormalSnapshot } from "./validation";

describe("review coach event validation and replay", () => {
  it("rebuilds the same retained projection regardless of event input order", () => {
    const snapshot = completeCoachTestSnapshot();
    validateReviewCoachFormalSnapshot(snapshot, new Set(["record-1"]));

    const first = replayAllDecisionBlockStates(snapshot, "2026-09-06T08:00:00.000Z");
    const reversed = replayDecisionBlockState({
      block: snapshot.decisionBlocks[0],
      feedback: [...snapshot.decisionBlockFeedback].reverse(),
      queueItems: [...snapshot.analysisQueueItems].reverse(),
      blueprints: [...snapshot.sessionBlueprints].reverse(),
      tasks: [...snapshot.adaptiveReviewTasks].reverse(),
      turns: [...snapshot.adaptiveQuizTurns].reverse(),
      outcomes: [...snapshot.taskOutcomeEvents].reverse(),
      verifications: [...snapshot.delayedVerifications].reverse(),
      replayedAt: "2026-09-06T08:00:00.000Z",
    });

    expect(first).toEqual([reversed]);
    expect(first[0]).toMatchObject({ status: "retained", currentTaskId: undefined, pendingVerificationId: undefined });
  });

  it("rejects duplicate immutable events", () => {
    const snapshot = completeCoachTestSnapshot();
    snapshot.taskOutcomeEvents.push({
      ...snapshot.taskOutcomeEvents[0],
      id: "another-outcome-id",
    });

    expect(() => validateReviewCoachFormalSnapshot(snapshot, new Set(["record-1"]))).toThrowError(
      expect.objectContaining<Partial<ReviewCoachValidationError>>({ code: "duplicate-idempotency-key" }),
    );
  });

  it("rejects dangling references and non-stale old content versions", () => {
    const dangling = completeCoachTestSnapshot();
    dangling.adaptiveQuizTurns[0].taskId = "missing-task";
    expect(() => validateReviewCoachFormalSnapshot(dangling, new Set(["record-1"]))).toThrowError(
      expect.objectContaining<Partial<ReviewCoachValidationError>>({ code: "dangling-task" }),
    );

    const stale = completeCoachTestSnapshot();
    stale.decisionBlocks[0].contentVersion = 2;
    stale.analysisQueueItems[0].status = "eligible";
    expect(() => validateReviewCoachFormalSnapshot(stale, new Set(["record-1"]))).toThrowError(
      expect.objectContaining<Partial<ReviewCoachValidationError>>({ code: "stale-content-version" }),
    );
  });
});
