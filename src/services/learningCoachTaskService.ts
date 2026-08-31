import type {
  LearningCoachSkipReason,
  LearningCoachTask,
  LearningCoachTaskCandidate,
  LearningEvidence,
  RecordBlock,
  RecordKnowledgePointLink,
  RecordReviewLog,
} from "../types";
import { addDaysISO } from "../lib/date";
import { createBaseEntity } from "../lib/entity";
import { isMeaningfulLearningRecord } from "../lib/learningFacts";
import { inferLearningCoachTaskAction, learningCoachIssueKey } from "./learningCoachService";

export const normalizeLearningCoachTask = (task: LearningCoachTask): LearningCoachTask => {
  const inferred = inferLearningCoachTaskAction(task);
  const issueKey = task.issueKey ?? learningCoachIssueKey({ code: task.reasonCode, subject: task.subject, recordIds: task.recordIds });
  const active = task.status === "pending" || task.status === "in-progress";
  return {
    ...task,
    issueKey,
    activeSlotKey: active ? issueKey : undefined,
    action: task.action ?? inferred.action,
    completionPolicy: task.completionPolicy ?? inferred.completionPolicy,
    progress: task.progress ?? { current: task.status === "completed" ? 1 : 0, total: Math.max(1, task.recordIds.length) },
    completionEvidenceIds: task.completionEvidenceIds ?? (task.completedEvidenceId ? [task.completedEvidenceId] : []),
  };
};

export const learningCoachInterventionKey = (task: Pick<LearningCoachTask, "issueKey" | "reasonCode" | "subject" | "action" | "recordIds">) => {
  const issueKey = task.issueKey ?? learningCoachIssueKey({ code: task.reasonCode, subject: task.subject, recordIds: task.recordIds });
  const actionType = task.action?.type ?? inferLearningCoachTaskAction(task).action.type;
  return `${issueKey}:${actionType}:${[...task.recordIds].sort().join(",")}`;
};

export const cleanDuplicateLearningCoachTasks = (options: {
  tasks: LearningCoachTask[];
  evidence: LearningEvidence[];
  reviewLogs: RecordReviewLog[];
  records: RecordBlock[];
  cleanedAt: string;
}) => {
  const evidenceByTask = new Set(options.evidence.flatMap((item) => [item.source.type === "coach-task" ? item.source.id : "", typeof item.payload.taskId === "string" ? item.payload.taskId : ""]).filter(Boolean));
  const normalized = options.tasks.map(normalizeLearningCoachTask);
  const groups = new Map<string, LearningCoachTask[]>();
  for (const task of normalized.filter((item) => item.status === "pending" || item.status === "in-progress")) {
    const group = groups.get(task.issueKey!) ?? [];
    group.push(task);
    groups.set(task.issueKey!, group);
  }
  const changed: LearningCoachTask[] = [];
  let duplicateGroups = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    duplicateGroups += 1;
    const hasExecution = (task: LearningCoachTask) => Boolean(
      task.startedAt || evidenceByTask.has(task.id) || task.action?.createdRecordId ||
      options.reviewLogs.some((log) => task.recordIds.includes(log.recordId) && (!task.startedAt || log.reviewedAt >= task.startedAt)) ||
      options.records.some((record) => record.id === task.action?.createdRecordId && isMeaningfulLearningRecord(record)),
    );
    const keeper = [...group].sort((left, right) => {
      const execution = Number(hasExecution(right)) - Number(hasExecution(left));
      if (execution) return execution;
      const acceptedAi = Number(right.source === "ai-proposal" && right.proposalStatus === "accepted") - Number(left.source === "ai-proposal" && left.proposalStatus === "accepted");
      if (acceptedAi) return acceptedAi;
      return left.createdAt.localeCompare(right.createdAt);
    })[0];
    changed.push({ ...keeper, activeSlotKey: keeper.issueKey, interventionKey: keeper.interventionKey ?? learningCoachInterventionKey(keeper) });
    for (const duplicate of group.filter((item) => item.id !== keeper.id)) {
      changed.push({
        ...duplicate,
        status: "cancelled",
        activeSlotKey: undefined,
        cancelledAt: duplicate.cancelledAt ?? options.cleanedAt,
        cancellationReason: "duplicate-active-task",
        duplicateOfTaskId: keeper.id,
        cleanedAt: options.cleanedAt,
        cleanupVersion: 1,
      });
    }
  }
  for (const group of groups.values()) {
    if (group.length !== 1) continue;
    const task = group[0];
    changed.push({ ...task, activeSlotKey: task.issueKey, interventionKey: task.interventionKey ?? learningCoachInterventionKey(task) });
  }
  return { tasks: changed, duplicateGroups, cancelled: changed.filter((item) => item.cancellationReason === "duplicate-active-task").length };
};

export const resolveLearningCoachCandidateWorkflow = (candidate: LearningCoachTaskCandidate) => {
  const actionType = candidate.action?.type ?? (candidate.recordIds.length > 0 ? "ai-quiz" : "create-record");
  const action = { type: actionType, subject: candidate.subject, recordIds: candidate.recordIds } as const;
  if (actionType === "review-queue") {
    return {
      kind: "review" as const,
      actionLabel: candidate.actionLabel ?? "开始复习",
      action,
      completionPolicy: { type: "review-logs" as const, targetRecordIds: candidate.recordIds },
    };
  }
  if (actionType === "ai-quiz") {
    return {
      kind: candidate.kind === "revisit-record" ? "revisit-record" as const : "practice" as const,
      actionLabel: candidate.actionLabel ?? "开始测验",
      action,
      completionPolicy: { type: "confirmed-quiz" as const, targetRecordIds: candidate.recordIds },
    };
  }
  return {
    kind: "practice" as const,
    actionLabel: candidate.actionLabel ?? "新建学习记录",
    action,
    completionPolicy: { type: "meaningful-record" as const },
  };
};

export const startLearningCoachTask = (task: LearningCoachTask, startedAt: string, createdRecordId?: string): LearningCoachTask => {
  const normalized = normalizeLearningCoachTask(task);
  if (normalized.status !== "pending") return normalized;
  const action = createdRecordId
    ? { ...normalized.action!, createdRecordId, recordIds: [createdRecordId] }
    : normalized.action!;
  return { ...normalized, status: "in-progress", startedAt, action, recordIds: action.recordIds };
};

export const skipLearningCoachTask = (
  task: LearningCoachTask,
  reason: LearningCoachSkipReason,
  skippedAt: string,
  note?: string,
): LearningCoachTask => ({
  ...normalizeLearningCoachTask(task),
  status: "skipped",
  skippedAt,
  skipReason: reason,
  skipNote: note?.trim() || undefined,
  deferredUntil: reason === "not-relevant" ? addDaysISO(skippedAt.slice(0, 10), 7) : reason === "too-large" ? skippedAt.slice(0, 10) : addDaysISO(skippedAt.slice(0, 10), 1),
});

export const evaluateLearningCoachTask = (options: {
  task: LearningCoachTask;
  records: RecordBlock[];
  reviewLogs: RecordReviewLog[];
  evidence: LearningEvidence[];
  knowledgePointLinks?: RecordKnowledgePointLink[];
}) => {
  const task = normalizeLearningCoachTask(options.task);
  if (task.status !== "in-progress" || !task.startedAt) return { task, complete: false, evidenceIds: [] as string[], supportingEvidenceRefs: [] };
  const action = task.action!;
  if (action.type === "review-queue") {
    const targetIds = task.completionPolicy?.targetRecordIds ?? action.recordIds;
    const matchingLogs = options.reviewLogs.filter((log) => log.reviewedAt >= task.startedAt! && targetIds.includes(log.recordId));
    const completedIds = new Set(matchingLogs.map((log) => log.recordId));
    const current = targetIds.filter((id) => completedIds.has(id)).length;
    return { task: { ...task, progress: { current, total: Math.max(1, targetIds.length) } }, complete: targetIds.length > 0 && current === targetIds.length, evidenceIds: [] as string[], supportingEvidenceRefs: matchingLogs.map((log) => ({ type: "review-log" as const, id: log.id })) };
  }
  if (action.type === "ai-quiz") {
    const matches = options.evidence.filter((item) => item.kind === "quiz-assessment-confirmed" && item.payload.taskId === task.id && item.occurredAt >= task.startedAt!);
    return { task: { ...task, progress: { current: matches.length > 0 ? 1 : 0, total: 1 } }, complete: matches.length > 0, evidenceIds: matches.map((item) => item.id), supportingEvidenceRefs: matches.map((item) => ({ type: "learning-evidence" as const, id: item.id })) };
  }
  const recordId = action.createdRecordId ?? action.recordIds[0];
  const record = options.records.find((item) => item.id === recordId && item.updatedAt >= task.startedAt!);
  const meaningful = isMeaningfulLearningRecord(record);
  const requiredPointId = task.completionPolicy?.type === "meaningful-record-with-knowledge-point-link"
    ? task.completionPolicy.knowledgePointId ?? task.knowledgePointId ?? action.knowledgePointId
    : undefined;
  const formalLink = meaningful && record && requiredPointId
    ? options.knowledgePointLinks?.find((link) => link.status === "active" && link.recordId === record.id && link.knowledgePointId === requiredPointId && link.confirmedAt >= task.startedAt!)
    : undefined;
  const complete = Boolean(meaningful && (!requiredPointId || formalLink));
  return {
    task: { ...task, progress: { current: complete ? 1 : 0, total: 1 } },
    complete,
    evidenceIds: [] as string[],
    supportingEvidenceRefs: complete && record ? [
      { type: "record" as const, id: record.id },
      ...(formalLink ? [{ type: "record-knowledge-point-link" as const, id: formalLink.id }] : []),
    ] : [],
  };
};

export const createTaskLifecycleEvidence = (
  task: LearningCoachTask,
  kind: "task-started" | "task-outcome" | "task-skipped",
  occurredAt: string,
): LearningEvidence => ({
  ...createBaseEntity(),
  date: occurredAt.slice(0, 10),
  occurredAt,
  subject: task.subject,
  kind,
  origin: "local",
  source: { type: "coach-task", id: task.id },
  ...(task.knowledgePointId || task.action?.knowledgePointId
    ? { target: { type: "knowledge-point" as const, id: task.knowledgePointId ?? task.action!.knowledgePointId! } }
    : task.action?.recordIds[0] ? { target: { type: "record" as const, id: task.action.recordIds[0] } } : {}),
  payload: {
    taskId: task.id,
    issueKey: task.issueKey,
    actionType: task.action?.type,
    skipReason: task.skipReason,
    skipNote: task.skipNote,
  },
});
