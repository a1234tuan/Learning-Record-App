import type {
  KnowledgePoint,
  KnowledgePointCoachSnapshot,
  KnowledgePointDerivedState,
  LearningCoachDiagnosis,
  LearningCoachTask,
  LearningEvidence,
  RecordBlock,
  RecordKnowledgePointLink,
  RecordReviewLog,
  RecordReviewState,
  Subject,
} from "../types";
import { canonicalStudySubject } from "../lib/subjects";
import { knowledgePointHash } from "../lib/knowledgePointIdentity";

export const KNOWLEDGE_POINT_RULE_VERSION = 1;

const hashValue = (value: unknown): string => knowledgePointHash(value, `kp-v${KNOWLEDGE_POINT_RULE_VERSION}`);

export const knowledgePointIssueKey = (knowledgePointId: string, code: "kp-assessment-needs-review" | "kp-linked-review-overdue") =>
  `kp:${knowledgePointId}:${code}`;

const pointParentIssue = (
  code: "kp-assessment-needs-review" | "kp-linked-review-overdue",
  linkedRecordIds: string[],
  recordDiagnoses: LearningCoachDiagnosis[],
): string | undefined => {
  const preferredCodes = code === "kp-linked-review-overdue"
    ? new Set(["review-overdue", "review-due"])
    : new Set(["quiz-follow-up"]);
  return recordDiagnoses.find((diagnosis) =>
    diagnosis.status !== "resolved" &&
    preferredCodes.has(diagnosis.code) &&
    diagnosis.recordIds.some((recordId) => linkedRecordIds.includes(recordId)),
  )?.issueKey;
};

export interface KnowledgePointProjection {
  inputFingerprint: string;
  states: KnowledgePointDerivedState[];
  diagnoses: LearningCoachDiagnosis[];
  tasks: Array<Pick<LearningCoachTask, "subject" | "kind" | "priority" | "reasonCode" | "title" | "recordIds" | "actionLabel" | "reason" | "issueKey" | "action" | "completionPolicy" | "scope" | "knowledgePointId" | "parentIssueKey">>;
}

export const buildKnowledgePointProjection = (options: {
  today: string;
  points: KnowledgePoint[];
  links: RecordKnowledgePointLink[];
  records: RecordBlock[];
  reviews: RecordReviewState[];
  reviewLogs: RecordReviewLog[];
  evidence: LearningEvidence[];
  tasks: LearningCoachTask[];
  recordDiagnoses: LearningCoachDiagnosis[];
  previousDiagnoses?: LearningCoachDiagnosis[];
  evaluatedAt?: string;
}): KnowledgePointProjection => {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const records = new Map(options.records.filter((record) => !record.deletedAt).map((record) => [record.id, record]));
  const reviews = new Map(options.reviews.map((review) => [review.recordId, review]));
  const activeLinks = options.links.filter((link) => link.status === "active" && records.has(link.recordId));
  const previous = new Map((options.previousDiagnoses ?? []).filter((item) => item.issueKey).map((item) => [item.issueKey!, item]));
  const activeTaskIssueKeys = new Set(options.tasks.filter((task) => task.status === "pending" || task.status === "in-progress").map((task) => task.issueKey));
  const diagnoses: LearningCoachDiagnosis[] = [];
  const tasks: KnowledgePointProjection["tasks"] = [];
  const states: KnowledgePointDerivedState[] = [];

  const addDiagnosis = (
    point: KnowledgePoint,
    state: KnowledgePointDerivedState,
    code: "kp-assessment-needs-review" | "kp-linked-review-overdue",
    draft: Omit<KnowledgePointProjection["tasks"][number], "issueKey" | "scope" | "knowledgePointId" | "parentIssueKey">,
    reason: string,
    metric: LearningCoachDiagnosis["metric"],
    evidenceRefs: NonNullable<LearningCoachDiagnosis["evidenceRefs"]>,
  ) => {
    const issueKey = knowledgePointIssueKey(point.id, code);
    const parentIssueKey = pointParentIssue(code, state.linkedRecordIds, options.recordDiagnoses);
    const prior = previous.get(issueKey);
    const activeTask = options.tasks.find((task) => task.issueKey === issueKey && (task.status === "pending" || task.status === "in-progress"));
    const outcome = options.evidence.filter((item) => item.kind === "task-outcome" && item.payload.issueKey === issueKey).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const nextStatus: "new" | "improved" | "ongoing" = !prior || prior.status === "resolved"
      ? "new"
      : prior.metric && metric && metric.current < prior.metric.current ? "improved" : "ongoing";
    const statusChanged = prior?.status !== nextStatus;
    diagnoses.push({
      issueKey,
      code,
      level: "knowledge-point",
      knowledgePointId: point.id,
      parentIssueKey,
      status: nextStatus,
      priority: code === "kp-linked-review-overdue" ? 1 : 2,
      subject: point.subject,
      recordIds: state.linkedRecordIds,
      message: code === "kp-linked-review-overdue" ? `“${point.name}”有关联复习已逾期。` : `“${point.name}”最近一次确认验证需要再次验证。`,
      reason,
      metric,
      evidenceRefs,
      firstDetectedAt: prior?.firstDetectedAt ?? evaluatedAt,
      lastEvaluatedAt: evaluatedAt,
      lastStatusChangedAt: statusChanged ? evaluatedAt : prior?.lastStatusChangedAt ?? evaluatedAt,
      interventionState: activeTask ? (activeTask.status === "in-progress" ? "in-progress" : "actionable") : outcome ? "awaiting-new-evidence" : "actionable",
      latestIntervention: outcome ? { taskId: outcome.source.id, outcomeEvidenceId: outcome.id, outcome: "completed", occurredAt: outcome.occurredAt } : prior?.latestIntervention,
      statusHistory: statusChanged
        ? [...(prior?.statusHistory ?? []), { status: nextStatus, occurredAt: evaluatedAt, evidenceRefs }].slice(-20)
        : prior?.statusHistory ?? [{ status: nextStatus, occurredAt: evaluatedAt, evidenceRefs }],
    });
    if (!activeTaskIssueKeys.has(issueKey) && !parentIssueKey) {
      tasks.push({ ...draft, issueKey, scope: "knowledge-point", knowledgePointId: point.id, parentIssueKey });
    }
  };

  for (const point of options.points.filter((item) => item.status === "active")) {
    const pointLinks = activeLinks.filter((link) => link.knowledgePointId === point.id);
    if (pointLinks.length === 0) continue;
    const linkedRecords = pointLinks.map((link) => records.get(link.recordId)!).sort((a, b) => b.date.localeCompare(a.date));
    const linkedRecordIds = linkedRecords.map((record) => record.id);
    const dueReviewRecordIds = linkedRecordIds.filter((recordId) => reviews.get(recordId)?.status === "active" && reviews.get(recordId)?.nextReviewDate === options.today);
    const overdueReviewRecordIds = linkedRecordIds.filter((recordId) => reviews.get(recordId)?.status === "active" && reviews.get(recordId)?.nextReviewDate && reviews.get(recordId)!.nextReviewDate! < options.today);
    const assessments = options.evidence
      .filter((item) => item.kind === "quiz-assessment-confirmed" && item.target?.type === "knowledge-point" && item.target.id === point.id && (item.payload.outcome === "needs-review" || item.payload.outcome === "satisfactory"))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const latestAssessment = assessments[0];
    const latestPointTask = options.tasks.filter((task) => task.knowledgePointId === point.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const latestPointOutcome = latestPointTask
      ? options.evidence.filter((item) => item.kind === "task-outcome" && item.source.type === "coach-task" && item.source.id === latestPointTask.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
      : undefined;
    const state: KnowledgePointDerivedState = {
      knowledgePointId: point.id,
      subject: point.subject,
      linkedRecordIds,
      latestCoveredDate: linkedRecords[0]?.date,
      dueReviewRecordIds,
      overdueReviewRecordIds,
      ...(latestAssessment ? { latestAssessment: { outcome: latestAssessment.payload.outcome as "needs-review" | "satisfactory", evidenceId: latestAssessment.id, occurredAt: latestAssessment.occurredAt } } : {}),
      latestInterventionTaskId: latestPointTask?.id,
      latestInterventionEvidenceId: latestPointOutcome?.id,
    };
    states.push(state);

    if (overdueReviewRecordIds.length > 0) {
      addDiagnosis(point, state, "kp-linked-review-overdue", {
        subject: point.subject,
        kind: "review",
        priority: 1,
        reasonCode: "kp-linked-review-overdue",
        title: `复习与“${point.name}”相关的逾期记录`,
        actionLabel: "开始复习",
        reason: `该知识点关联的 ${overdueReviewRecordIds.length} 条正式复习已超过计划日期。`,
        recordIds: overdueReviewRecordIds,
        action: { type: "review-queue", subject: point.subject, recordIds: overdueReviewRecordIds, knowledgePointId: point.id },
        completionPolicy: { type: "review-logs", targetRecordIds: overdueReviewRecordIds },
      }, `该知识点关联的 ${overdueReviewRecordIds.length} 条正式 Review 已逾期；这只表示复习计划逾期。`, { current: overdueReviewRecordIds.length, threshold: 0, unit: "条", direction: "above" }, overdueReviewRecordIds.map((id) => ({ type: "review-state", id })));
      continue;
    }

    if (latestAssessment?.payload.outcome === "needs-review") {
      const correctiveLinks = pointLinks.filter((link) => {
        const linkedRecord = records.get(link.recordId);
        return Boolean(linkedRecord && link.confirmedAt > latestAssessment.occurredAt && linkedRecord.createdAt > latestAssessment.occurredAt);
      });
      const latestCorrectiveRecords = correctiveLinks.map((link) => records.get(link.recordId)).filter((record): record is RecordBlock => Boolean(record));
      const needsCorrectiveRecord = latestCorrectiveRecords.length === 0;
      addDiagnosis(point, state, "kp-assessment-needs-review", needsCorrectiveRecord ? {
        subject: point.subject,
        kind: "revisit-record",
        priority: 2,
        reasonCode: "kp-assessment-needs-review",
        title: `补充“${point.name}”纠错记录`,
        actionLabel: "开始纠错记录",
        reason: "最近一次确认验证提示需要再次验证，且之后还没有新的正式纠错记录。",
        recordIds: linkedRecordIds.slice(0, 3),
        action: { type: "create-record", subject: point.subject, recordIds: [], knowledgePointId: point.id },
        completionPolicy: { type: "meaningful-record-with-knowledge-point-link", knowledgePointId: point.id },
      } : {
        subject: point.subject,
        kind: "practice",
        priority: 2,
        reasonCode: "kp-assessment-needs-review",
        title: `验证“${point.name}”的纠错结果`,
        actionLabel: "开始验证测验",
        reason: "已经有后续纠错记录，现在需要一次新的确认验证来决定是否还需处理。",
        recordIds: latestCorrectiveRecords.slice(0, 3).map((record) => record.id),
        action: { type: "ai-quiz", subject: point.subject, recordIds: latestCorrectiveRecords.slice(0, 3).map((record) => record.id), knowledgePointId: point.id },
        completionPolicy: { type: "confirmed-quiz", targetRecordIds: latestCorrectiveRecords.slice(0, 3).map((record) => record.id), knowledgePointId: point.id },
      }, "最近一次由你确认的验证结果为“需要再次验证”；这不表示你不会这个知识点。", { current: 1, threshold: 0, unit: "次待验证结果", direction: "above" }, [{ type: "learning-evidence", id: latestAssessment.id }]);
    }
  }

  const activeKeys = new Set(diagnoses.map((diagnosis) => diagnosis.issueKey));
  for (const prior of previous.values()) {
    if (activeKeys.has(prior.issueKey)) continue;
    const pointId = prior.knowledgePointId;
    // Assessment issues resolve only from an explicitly confirmed satisfactory
    // quiz result. Other KnowledgePoint evidence (answers, task outcomes, or
    // corrective records) remains supporting history but cannot resolve the
    // validation issue on its own.
    const resolutionEvidence = options.evidence
      .filter((item) => item.target?.type === "knowledge-point" && item.target.id === pointId && item.occurredAt > (prior.firstDetectedAt ?? "") && (
        prior.code === "kp-assessment-needs-review"
          ? item.kind === "quiz-assessment-confirmed" && item.payload.outcome === "satisfactory"
          : true
      ))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const reviewEvidence = options.reviewLogs
      .filter((log) => prior.recordIds.includes(log.recordId) && log.reviewedAt > (prior.firstDetectedAt ?? ""))
      .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))[0];
    const refs = [
      ...(resolutionEvidence ? [{ type: "learning-evidence" as const, id: resolutionEvidence.id }] : []),
      ...(reviewEvidence ? [{ type: "review-log" as const, id: reviewEvidence.id }] : []),
    ];
    const canResolve = prior.code === "kp-assessment-needs-review"
      ? resolutionEvidence?.payload.outcome === "satisfactory"
      : Boolean(reviewEvidence);
    diagnoses.push(canResolve ? {
      ...prior,
      status: "resolved",
      interventionState: "satisfied",
      resolvedAt: evaluatedAt,
      lastEvaluatedAt: evaluatedAt,
      lastStatusChangedAt: evaluatedAt,
      resolutionEvidenceRefs: refs,
      statusHistory: [...(prior.statusHistory ?? []), { status: "resolved" as const, occurredAt: evaluatedAt, evidenceRefs: refs }].slice(-20),
    } : { ...prior, status: "ongoing", interventionState: "awaiting-new-evidence", lastEvaluatedAt: evaluatedAt });
  }

  const inputFingerprint = hashValue({
    points: options.points.map(({ id, updatedAt, status, mergedIntoId }) => [id, updatedAt, status, mergedIntoId]),
    links: options.links.map(({ id, updatedAt, status, recordId, knowledgePointId }) => [id, updatedAt, status, recordId, knowledgePointId]),
    records: options.records.map(({ id, updatedAt, deletedAt }) => [id, updatedAt, deletedAt]),
    reviews: options.reviews.map(({ id, updatedAt, status, nextReviewDate }) => [id, updatedAt, status, nextReviewDate]),
    evidence: options.evidence.filter((item) => item.target?.type === "knowledge-point").map(({ id, updatedAt }) => [id, updatedAt]),
    tasks: options.tasks.filter((task) => task.scope === "knowledge-point").map(({ id, updatedAt, status }) => [id, updatedAt, status]),
  });
  return { inputFingerprint, states, diagnoses, tasks };
};

export const emptyKnowledgePointSnapshot = (date: string, evaluatedAt: string): KnowledgePointCoachSnapshot => ({
  id: crypto.randomUUID(),
  createdAt: evaluatedAt,
  updatedAt: evaluatedAt,
  date,
  evaluatedAt,
  inputFingerprint: hashValue([]),
  states: [],
  diagnoses: [],
  taskIds: [],
});

export const canonicalKnowledgePointSubject = (subject: Subject): Subject => canonicalStudySubject(subject);
