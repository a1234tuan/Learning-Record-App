import type {
  AdaptiveQuizTurn,
  AdaptiveReviewTask,
  AnalysisQueueItem,
  DecisionBlock,
  DecisionBlockFeedback,
  DecisionBlockState,
  DelayedVerification,
  FeedbackInterpretation,
  InterventionEffectSummary,
  ReviewCoachFormalSnapshot,
  SessionBlueprint,
  TaskOutcomeEvent,
} from "./domain";

export const REVIEW_COACH_REPLAY_VERSION = "review-coach-replay-v1";

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const next = (value as Record<string, unknown>)[key];
        if (next !== undefined) result[key] = canonicalize(next);
        return result;
      }, {});
  }
  return value;
};

export const coachReplayFingerprint = (value: unknown): string => {
  const source = JSON.stringify(canonicalize(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `replay-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const compareEvents = <T extends { id: string }>(left: T, right: T, getTime: (value: T) => string) =>
  getTime(left).localeCompare(getTime(right)) || left.id.localeCompare(right.id);

export interface DecisionBlockReplayInput {
  block: DecisionBlock;
  feedback: DecisionBlockFeedback[];
  queueItems: AnalysisQueueItem[];
  blueprints: SessionBlueprint[];
  tasks: AdaptiveReviewTask[];
  turns: AdaptiveQuizTurn[];
  outcomes: TaskOutcomeEvent[];
  verifications: DelayedVerification[];
  replayedAt?: string;
}

export const replayDecisionBlockState = (input: DecisionBlockReplayInput): DecisionBlockState => {
  const version = input.block.contentVersion;
  const activeFeedback = input.feedback
    .filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt)
    .sort((a, b) => compareEvents(a, b, (value) => value.occurredAt));
  const queueItems = input.queueItems.filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt);
  const blueprints = input.blueprints.filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt && item.status === "accepted");
  const tasks = input.tasks.filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt);
  const turns = input.turns.filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt);
  const outcomes = input.outcomes
    .filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt)
    .sort((a, b) => compareEvents(a, b, (value) => value.occurredAt));
  const verifications = input.verifications
    .filter((item) => item.decisionBlockId === input.block.id && item.contentVersion === version && !item.deletedAt)
    .sort((a, b) => compareEvents(a, b, (value) => value.lastVerifiedAt ?? value.verificationDueAt));

  let status: DecisionBlockState["status"] = "unassessed";
  if (input.block.deletedAt) status = "stale";
  else if (activeFeedback.length > 0) status = "needs-analysis";
  if (blueprints.length > 0 || tasks.some((task) => ["waiting", "deferred"].includes(task.status))) status = "planned";

  const currentTask = tasks.find((task) => task.status === "current" || task.status === "in-progress");
  if (currentTask) status = "learning";

  for (const outcome of outcomes) {
    if (outcome.kind !== "self-assessment") continue;
    if (outcome.subjectiveOutcome === "mastered") status = "improved-pending-verification";
    if (outcome.subjectiveOutcome === "needs-consolidation") status = "needs-consolidation";
    if (outcome.subjectiveOutcome === "not-mastered") status = "not-mastered";
  }

  for (const verification of verifications) {
    if (verification.status !== "completed") continue;
    if (verification.verificationOutcome === "retained") status = "retained";
    if (verification.verificationOutcome === "decayed") status = "needs-consolidation";
  }

  const pendingVerification = [...verifications]
    .reverse()
    .find((item) => ["scheduled", "eligible", "queued", "in-progress", "missed"].includes(item.status));
  const replayedAt = input.replayedAt ?? input.block.updatedAt;
  const replayFacts = {
    block: input.block,
    feedback: activeFeedback,
    queueItems,
    blueprints,
    tasks,
    turns,
    outcomes,
    verifications,
  };
  return {
    id: input.block.id,
    decisionBlockId: input.block.id,
    recordId: input.block.recordId,
    contentVersion: version,
    createdAt: input.block.createdAt,
    updatedAt: replayedAt,
    status,
    lastFeedbackAt: activeFeedback.at(-1)?.occurredAt,
    lastOutcomeAt: outcomes.at(-1)?.occurredAt,
    lastVerifiedAt: verifications.filter((item) => item.lastVerifiedAt).at(-1)?.lastVerifiedAt,
    currentTaskId: currentTask?.id,
    pendingVerificationId: pendingVerification?.id,
    replayFingerprint: coachReplayFingerprint(replayFacts),
    replayVersion: REVIEW_COACH_REPLAY_VERSION,
  };
};

export const replayAllDecisionBlockStates = (
  snapshot: ReviewCoachFormalSnapshot,
  replayedAt?: string,
): DecisionBlockState[] => snapshot.decisionBlocks.map((block) => replayDecisionBlockState({
  block,
  feedback: snapshot.decisionBlockFeedback,
  queueItems: snapshot.analysisQueueItems,
  blueprints: snapshot.sessionBlueprints,
  tasks: snapshot.adaptiveReviewTasks,
  turns: snapshot.adaptiveQuizTurns,
  outcomes: snapshot.taskOutcomeEvents,
  verifications: snapshot.delayedVerifications,
  replayedAt,
}));

export interface InterventionReplayInput {
  interpretations: FeedbackInterpretation[];
  blueprints: SessionBlueprint[];
  tasks: AdaptiveReviewTask[];
  turns: AdaptiveQuizTurn[];
  outcomes: TaskOutcomeEvent[];
  verifications: DelayedVerification[];
  replayedAt: string;
}

export const replayInterventionEffectSummaries = (input: InterventionReplayInput): InterventionEffectSummary[] => {
  const interpretationById = new Map(input.interpretations.map((item) => [item.id, item]));
  const tasksByBlueprint = new Map<string, AdaptiveReviewTask[]>();
  for (const task of input.tasks) {
    const current = tasksByBlueprint.get(task.blueprintId) ?? [];
    current.push(task);
    tasksByBlueprint.set(task.blueprintId, current);
  }

  const groups = new Map<string, {
    problemType: NonNullable<FeedbackInterpretation["difficultyType"]>;
    practiceType: SessionBlueprint["initialPracticeType"];
    blueprints: SessionBlueprint[];
    tasks: AdaptiveReviewTask[];
  }>();
  for (const blueprint of input.blueprints.filter((item) => item.status === "accepted" && !item.deletedAt)) {
    const interpretation = blueprint.interpretationIds.map((id) => interpretationById.get(id)).find((item) => item?.difficultyType);
    const problemType = interpretation?.difficultyType ?? "other";
    const key = `${problemType}:${blueprint.initialPracticeType}:${blueprint.policyVersion}`;
    const group = groups.get(key) ?? { problemType, practiceType: blueprint.initialPracticeType, blueprints: [], tasks: [] };
    group.blueprints.push(blueprint);
    group.tasks.push(...(tasksByBlueprint.get(blueprint.id) ?? []));
    groups.set(key, group);
  }

  return [...groups.entries()].map(([strategyKey, group]) => {
    const taskIds = new Set(group.tasks.map((task) => task.id));
    const outcomes = input.outcomes.filter((event) => taskIds.has(event.taskId) && !event.deletedAt);
    const outcomeIds = new Set(outcomes.map((event) => event.id));
    const verifications = input.verifications.filter((item) => outcomeIds.has(item.sourceOutcomeEventId) && !item.deletedAt);
    const turns = input.turns.filter((turn) => taskIds.has(turn.taskId) && !turn.deletedAt);
    const mastered = outcomes.filter((event) => event.subjectiveOutcome === "mastered").length;
    const completedVerifications = verifications.filter((item) => item.status === "completed");
    const stamps = [
      ...group.blueprints.map((item) => item.createdAt),
      ...outcomes.map((item) => item.occurredAt),
      ...completedVerifications.map((item) => item.lastVerifiedAt ?? item.updatedAt),
    ].sort();
    const masteredTaskIds = new Set(outcomes.filter((event) => event.subjectiveOutcome === "mastered").map((event) => event.taskId));
    const turnsToMastery = [...masteredTaskIds].map((taskId) => turns.filter((turn) => turn.taskId === taskId).length);
    const hints = turns.flatMap((turn) => turn.hintsUsed).length;
    const sampleCount = group.tasks.length;
    const confidence = Math.min(1, sampleCount / 10);
    return {
      id: strategyKey,
      createdAt: stamps[0] ?? input.replayedAt,
      updatedAt: input.replayedAt,
      problemType: group.problemType,
      practiceType: group.practiceType,
      strategyKey,
      sampleFrom: stamps[0] ?? input.replayedAt,
      sampleTo: stamps.at(-1) ?? input.replayedAt,
      sampleCount,
      immediateMasteredCount: mastered,
      delayedRetainedCount: completedVerifications.filter((item) => item.verificationOutcome === "retained").length,
      delayedDecayedCount: completedVerifications.filter((item) => item.verificationOutcome === "decayed").length,
      averageTurnsToMastery: turnsToMastery.length ? turnsToMastery.reduce((total, value) => total + value, 0) / turnsToMastery.length : undefined,
      averageHintsUsed: turns.length ? hints / turns.length : undefined,
      deferredCount: outcomes.filter((event) => event.disposition === "deferred").length,
      abandonedCount: outcomes.filter((event) => event.disposition === "abandoned").length,
      invalidQuestionCount: outcomes.filter((event) => event.disposition === "question-invalid").length,
      replanCount: group.tasks.filter((task) => task.status === "not-achieved").length,
      deletedCount: group.tasks.filter((task) => task.deletedAt || task.status === "deleted").length,
      confidence,
      evidenceStatus: sampleCount >= 3 ? "usable" as const : "insufficient" as const,
      modelVersions: [...new Set(group.blueprints.map((item) => item.model))].sort(),
      promptVersions: [...new Set(group.blueprints.map((item) => item.promptVersion))].sort(),
      policyVersions: [...new Set(group.blueprints.map((item) => item.policyVersion))].sort(),
      replayFingerprint: coachReplayFingerprint({ group, outcomes, verifications, turns }),
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
};
