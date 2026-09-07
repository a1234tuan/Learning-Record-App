import type { AdaptiveQuizTurn, DelayedVerification, SubjectiveOutcome } from "./domain";

export const DELAYED_VERIFICATION_STRATEGY_VERSION = "delayed-verification-v1";

const HOUR_MS = 60 * 60 * 1000;

const addHours = (stamp: string, hours: number) => new Date(Date.parse(stamp) + hours * HOUR_MS).toISOString();

export interface DelayedVerificationSchedule {
  verificationEligibleAt: string;
  verificationDueAt: string;
  strategyVersion: string;
}

export const calculateDelayedVerificationSchedule = (input: {
  completedAt: string;
  subjectiveOutcome: Extract<SubjectiveOutcome, "mastered" | "needs-consolidation">;
  answeredTurns: readonly AdaptiveQuizTurn[];
  priorVerifications: readonly DelayedVerification[];
}): DelayedVerificationSchedule => {
  const latestAnswer = [...input.answeredTurns]
    .filter((turn) => turn.status === "answered" && turn.answerText !== "[skipped]")
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  const hinted = input.answeredTurns.some((turn) => turn.hintsUsed.length > 0);
  const previouslyDecayed = input.priorVerifications.some((item) => item.verificationOutcome === "decayed");

  let eligibleHours = input.subjectiveOutcome === "needs-consolidation" ? 8 : 24;
  let dueHours = input.subjectiveOutcome === "needs-consolidation" ? 24 : 72;
  if (latestAnswer?.assessment === "incorrect") {
    eligibleHours = 6;
    dueHours = 18;
  } else if (hinted || latestAnswer?.assessment === "partial" || latestAnswer?.assessment === "unreliable") {
    eligibleHours = Math.min(eligibleHours, 12);
    dueHours = Math.min(dueHours, 36);
  }
  if (previouslyDecayed) {
    eligibleHours = Math.min(eligibleHours, 6);
    dueHours = Math.min(dueHours, 18);
  }

  return {
    verificationEligibleAt: addHours(input.completedAt, eligibleHours),
    verificationDueAt: addHours(input.completedAt, dueHours),
    strategyVersion: DELAYED_VERIFICATION_STRATEGY_VERSION,
  };
};

export const isVerificationEligible = (verification: DelayedVerification, now: string) =>
  verification.status === "scheduled" && verification.verificationEligibleAt <= now;

export const isVerificationDue = (verification: DelayedVerification, now: string) =>
  ["eligible", "missed"].includes(verification.status) && verification.verificationDueAt <= now;
