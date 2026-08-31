import type {
  KnowledgePoint,
  KnowledgeRelation,
  LearningCoachDecision,
  LearningCoachDecisionFactor,
  LearningCoachDiagnosis,
  LearningCoachTask,
  LearningEvidence,
  RecordReviewState,
} from "../types";

export const LEARNING_COACH_DECISION_POLICY_VERSION = 1;

const hashValue = (value: unknown): string => {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `decision-v${LEARNING_COACH_DECISION_POLICY_VERSION}-${(hash >>> 0).toString(36)}`;
};

const activeTaskFor = (tasks: LearningCoachTask[], issueKey: string | undefined) =>
  tasks.find((task) => task.issueKey === issueKey && (task.status === "pending" || task.status === "in-progress") && Boolean(task.action));

const diagnosisHasNewStrongEvidence = (diagnosis: LearningCoachDiagnosis, evidence: LearningEvidence[]) => {
  const after = diagnosis.latestIntervention?.occurredAt ?? diagnosis.lastEvaluatedAt ?? "";
  return evidence.some((item) =>
    item.target?.type === "knowledge-point" && item.target.id === diagnosis.knowledgePointId && item.occurredAt > after &&
    (item.kind === "quiz-assessment-confirmed" || (item.kind === "task-outcome" && Array.isArray(item.payload.supportingEvidenceRefs))),
  );
};

const compareFactors = (left: LearningCoachDecisionFactor, right: LearningCoachDecisionFactor) =>
  left.tier - right.tier ||
  right.activeChildIssueCount - left.activeChildIssueCount ||
  right.overdueReviewCount - left.overdueReviewCount ||
  (left.firstDetectedAt ?? "").localeCompare(right.firstDetectedAt ?? "") ||
  Number(right.hasExecutableTask) - Number(left.hasExecutableTask) ||
  (left.issueKey ?? "").localeCompare(right.issueKey ?? "");

export const buildLearningCoachDecision = (options: {
  diagnoses: LearningCoachDiagnosis[];
  tasks: LearningCoachTask[];
  relations: KnowledgeRelation[];
  knowledgePoints: KnowledgePoint[];
  reviews?: RecordReviewState[];
  evidence?: LearningEvidence[];
  evaluatedAt: string;
}): LearningCoachDecision => {
  const points = new Map(options.knowledgePoints.filter((point) => point.status === "active").map((point) => [point.id, point]));
  const active = options.diagnoses.filter((diagnosis) => diagnosis.status !== "resolved" && diagnosis.level === "knowledge-point" && diagnosis.knowledgePointId && diagnosis.issueKey).sort((left, right) => left.issueKey!.localeCompare(right.issueKey!));
  const activeByPoint = new Map(active.map((diagnosis) => [diagnosis.knowledgePointId!, diagnosis]));
  const relations = options.relations.filter((relation) =>
    relation.type === "prerequisite-of" && relation.status === "confirmed" && points.has(relation.fromKnowledgePointId) && points.has(relation.toKnowledgePointId),
  ).sort((left, right) => left.id.localeCompare(right.id));
  const evidence = options.evidence ?? [];
  const consideredIssueKeys = active.map((diagnosis) => diagnosis.issueKey!).sort();
  const inputFingerprint = hashValue({
    diagnoses: active.map(({ issueKey, code, status, knowledgePointId, interventionState, firstDetectedAt, metric, latestIntervention }) => [issueKey, code, status, knowledgePointId, interventionState, firstDetectedAt, metric, latestIntervention]),
    tasks: options.tasks.filter((task) => task.scope === "knowledge-point" && (task.status === "pending" || task.status === "in-progress")).map(({ id, issueKey, status, knowledgePointId, kind, reasonCode, action, completionPolicy, recordIds }) => [id, issueKey, status, knowledgePointId, kind, reasonCode, action, completionPolicy, recordIds]),
    relations: relations.map(({ id, fromKnowledgePointId, toKnowledgePointId, type, status }) => [id, fromKnowledgePointId, toKnowledgePointId, type, status]),
    evidence: evidence.filter((item) => item.target?.type === "knowledge-point").map(({ id, kind, occurredAt, target, payload, supportingEvidenceRefs }) => [id, kind, occurredAt, target, payload.outcome, payload.supportingEvidenceRefs, supportingEvidenceRefs]),
    reviews: (options.reviews ?? []).map(({ id, status, nextReviewDate, lastReviewDate, consecutiveRemembered, totalReviews }) => [id, status, nextReviewDate, lastReviewDate, consecutiveRemembered, totalReviews]),
  });

  const factors: LearningCoachDecisionFactor[] = [];
  const relationSupport = new Map<string, { childIssueKeys: string[]; relationIds: string[] }>();
  for (const relation of relations) {
    const root = activeByPoint.get(relation.fromKnowledgePointId);
    const child = activeByPoint.get(relation.toKnowledgePointId);
    if (!root || !child || root.issueKey === child.issueKey) continue;
    const current = relationSupport.get(root.issueKey!) ?? { childIssueKeys: [], relationIds: [] };
    if (!current.childIssueKeys.includes(child.issueKey!)) current.childIssueKeys.push(child.issueKey!);
    current.relationIds.push(relation.id);
    relationSupport.set(root.issueKey!, current);
  }

  for (const diagnosis of active) {
    const task = activeTaskFor(options.tasks, diagnosis.issueKey);
    const support = relationSupport.get(diagnosis.issueKey!);
    const overdueReviewCount = diagnosis.code === "kp-linked-review-overdue" ? diagnosis.metric?.current ?? 0 : 0;
    const hasNewStrongEvidence = diagnosisHasNewStrongEvidence(diagnosis, evidence);
    const awaiting = diagnosis.interventionState === "awaiting-new-evidence" && !hasNewStrongEvidence;
    const tier: LearningCoachDecisionFactor["tier"] = awaiting
      ? 6
      : support && support.childIssueKeys.length >= 2
        ? 1
        : diagnosis.code === "kp-linked-review-overdue"
          ? 2
          : diagnosis.status === "new"
            ? 3
            : diagnosis.status === "improved"
              ? 4
                : hasNewStrongEvidence
                ? 5
                : 5;
    factors.push({
      issueKey: diagnosis.issueKey!,
      knowledgePointId: diagnosis.knowledgePointId,
      tier,
      activeChildIssueCount: support?.childIssueKeys.length ?? 0,
      overdueReviewCount,
      firstDetectedAt: diagnosis.firstDetectedAt,
      interventionState: diagnosis.interventionState,
      hasNewStrongEvidence,
      hasExecutableTask: Boolean(task),
    });
  }

  const actionable = factors.filter((factor) => factor.tier < 6 && factor.hasExecutableTask).sort(compareFactors);
  const selected = actionable[0];
  if (!selected) {
    return {
      status: "no-action",
      priorityRationale: active.length === 0 ? "当前没有未解决的知识点问题。" : "当前问题都在等待新的相关学习证据，暂不重复安排行动。",
      supportingIssueKeys: [],
      supportingRelationIds: [],
      decisionInputsFingerprint: inputFingerprint,
      policyVersion: LEARNING_COACH_DECISION_POLICY_VERSION,
      evaluatedAt: options.evaluatedAt,
      consideredIssueKeys,
      factors,
    };
  }

  const support = relationSupport.get(selected.issueKey);
  const selectedTask = activeTaskFor(options.tasks, selected.issueKey);
  const selectedPoint = selected.knowledgePointId ? points.get(selected.knowledgePointId) : undefined;
  const childNames = (support?.childIssueKeys ?? []).map((issueKey) => active.find((item) => item.issueKey === issueKey)?.knowledgePointId).map((id) => id ? points.get(id)?.name : undefined).filter(Boolean);
  const rationale = support && support.childIssueKeys.length >= 2
    ? `建议先处理“${selectedPoint?.name ?? "该前置知识点"}”：它是${childNames.join("、")}的已确认前置知识点${selected.overdueReviewCount > 0 ? "，且关联复习已逾期" : ""}。`
    : selected.overdueReviewCount > 0
      ? `建议先处理“${selectedPoint?.name ?? "该知识点"}”：关联正式复习已逾期。`
      : `建议先处理“${selectedPoint?.name ?? "该知识点"}”：它是当前最早出现且已有可执行行动的问题。`;
  return {
    status: "recommended",
    recommendedKnowledgePointId: selected.knowledgePointId,
    recommendedTaskId: selectedTask?.id,
    priorityRationale: rationale,
    supportingIssueKeys: [selected.issueKey, ...(support?.childIssueKeys ?? [])],
    supportingRelationIds: support?.relationIds ?? [],
    decisionInputsFingerprint: inputFingerprint,
    policyVersion: LEARNING_COACH_DECISION_POLICY_VERSION,
    evaluatedAt: options.evaluatedAt,
    consideredIssueKeys,
    factors,
  };
};
