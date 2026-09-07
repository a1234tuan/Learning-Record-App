import { describe, expect, it } from "vitest";

import { replayAllDecisionBlockStates, replayDecisionBlockState, replayInterventionEffectSummaries } from "./replay";
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

  it("projects delayed decay back to consolidation without rewriting record scheduling", () => {
    const snapshot = completeCoachTestSnapshot();
    snapshot.delayedVerifications[0] = { ...snapshot.delayedVerifications[0], verificationOutcome: "decayed" };

    expect(replayAllDecisionBlockStates(snapshot, "2026-09-07T08:00:00.000Z")[0]).toMatchObject({
      status: "needs-consolidation",
      lastVerifiedAt: snapshot.delayedVerifications[0].lastVerifiedAt,
    });
  });

  it("keeps effect evidence separated by provider model and prompt version", () => {
    const snapshot = completeCoachTestSnapshot();
    const secondBlueprint = {
      ...snapshot.sessionBlueprints[0],
      id: "blueprint-2",
      model: "deep-model-v2",
      promptVersion: "session-blueprint-v2",
      idempotencyKey: "blueprint-2",
    };
    const secondTask = {
      ...snapshot.adaptiveReviewTasks[0],
      id: "task-2",
      blueprintId: secondBlueprint.id,
      idempotencyKey: "task-2",
    };
    snapshot.sessionBlueprints.push(secondBlueprint);
    snapshot.adaptiveReviewTasks.push(secondTask);

    const effects = replayInterventionEffectSummaries({
      interpretations: snapshot.feedbackInterpretations,
      blueprints: snapshot.sessionBlueprints,
      tasks: snapshot.adaptiveReviewTasks,
      turns: snapshot.adaptiveQuizTurns,
      outcomes: snapshot.taskOutcomeEvents,
      verifications: snapshot.delayedVerifications,
      replayedAt: "2026-09-07T08:00:00.000Z",
    });

    expect(effects).toHaveLength(2);
    expect(effects.flatMap((effect) => effect.modelVersions).sort()).toEqual(["deep-model", "deep-model-v2"]);
    expect(effects.find((effect) => effect.modelVersions[0] === "deep-model")).toMatchObject({ sampleCount: 1, recentSampleCount: 1, recencyWeight: 1, evidenceStatus: "insufficient" });
  });
});
