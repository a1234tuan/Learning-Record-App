import { describe, expect, it } from "vitest";

import type { AdaptiveQuizTurn, DelayedVerification } from "./domain";
import { calculateDelayedVerificationSchedule, DELAYED_VERIFICATION_STRATEGY_VERSION } from "./verificationPolicy";

const completedAt = "2026-09-07T08:00:00.000Z";

const turn = (assessment: AdaptiveQuizTurn["assessment"] = "correct", hinted = false): AdaptiveQuizTurn => ({
  id: "turn-1", taskId: "task-1", decisionBlockId: "block-1", recordId: "record-1", contentVersion: 1,
  sequence: 1, status: "answered", practiceType: "variation", question: "Explain the invariant.", displayedAt: completedAt,
  sourceEvidence: [], answerCriteria: ["states invariant"], hintsUsed: hinted ? [{ level: 1, requestedAt: completedAt }] : [],
  answerText: "The invariant.", answeredAt: completedAt, assessment, qualityChecked: false, generationModel: "test",
  promptVersion: "quiz-v1", policyVersion: "policy-v1", idempotencyKey: "turn-1", createdAt: completedAt, updatedAt: completedAt,
});

const schedule = (subjectiveOutcome: "mastered" | "needs-consolidation", answeredTurns = [turn()], priorVerifications: DelayedVerification[] = []) =>
  calculateDelayedVerificationSchedule({ completedAt, subjectiveOutcome, answeredTurns, priorVerifications });

describe("delayed verification policy", () => {
  it("uses the long mastery window and the shorter consolidation window", () => {
    expect(schedule("mastered")).toEqual({
      verificationEligibleAt: "2026-09-08T08:00:00.000Z",
      verificationDueAt: "2026-09-10T08:00:00.000Z",
      strategyVersion: DELAYED_VERIFICATION_STRATEGY_VERSION,
    });
    expect(schedule("needs-consolidation")).toMatchObject({
      verificationEligibleAt: "2026-09-07T16:00:00.000Z",
      verificationDueAt: "2026-09-08T08:00:00.000Z",
    });
  });

  it("shortens the window after hints, partial evidence, or an incorrect answer", () => {
    expect(schedule("mastered", [turn("correct", true)])).toMatchObject({
      verificationEligibleAt: "2026-09-07T20:00:00.000Z",
      verificationDueAt: "2026-09-08T20:00:00.000Z",
    });
    expect(schedule("mastered", [turn("partial")])).toMatchObject({
      verificationEligibleAt: "2026-09-07T20:00:00.000Z",
      verificationDueAt: "2026-09-08T20:00:00.000Z",
    });
    expect(schedule("mastered", [turn("incorrect")])).toMatchObject({
      verificationEligibleAt: "2026-09-07T14:00:00.000Z",
      verificationDueAt: "2026-09-08T02:00:00.000Z",
    });
  });

  it("uses the shortest window when an earlier verification decayed", () => {
    const prior = [{ verificationOutcome: "decayed" }] as DelayedVerification[];
    expect(schedule("mastered", [turn()], prior)).toMatchObject({
      verificationEligibleAt: "2026-09-07T14:00:00.000Z",
      verificationDueAt: "2026-09-08T02:00:00.000Z",
    });
  });
});
