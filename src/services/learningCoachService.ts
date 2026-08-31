import type {
  LearningCoachDiagnosis,
  LearningCoachLocalSummary,
  LearningCoachSettings,
  LearningCoachSubjectState,
  LearningCoachTask,
  LearningEvidence,
  RecordBlock,
  RecordReviewState,
  StudySession,
} from "../types";
import { CANONICAL_STUDY_SUBJECTS, canonicalStudySubject, subjectDisplayName } from "../lib/subjects";
import { isMeaningfulLearningRecord } from "../lib/learningFacts";

export const COACH_RULE_VERSION = 1;
const POSTGRADUATE_SUBJECTS = [...CANONICAL_STUDY_SUBJECTS] as const;

export interface LearningCoachProjection {
  inputFingerprint: string;
  summary: LearningCoachLocalSummary;
  diagnoses: LearningCoachDiagnosis[];
  subjectStates: LearningCoachSubjectState[];
  changes: NonNullable<import("../types").LearningCoachSnapshot["changes"]>;
  tasks: Array<Pick<LearningCoachTask, "subject" | "kind" | "priority" | "reasonCode" | "title" | "recordIds" | "actionLabel" | "reason" | "issueKey" | "action" | "completionPolicy">>;
}

export const learningCoachIssueKey = (diagnosis: Pick<LearningCoachDiagnosis, "code" | "subject" | "recordIds">) =>
  diagnosis.code === "quiz-follow-up" ? `${diagnosis.code}:${diagnosis.recordIds[0] ?? "unknown"}`
    : diagnosis.subject ? `${diagnosis.code}:${canonicalStudySubject(diagnosis.subject)}`
      : diagnosis.code;

export const inferLearningCoachTaskAction = (task: Pick<LearningCoachTask, "reasonCode" | "recordIds" | "subject">) => {
  if (task.reasonCode === "review-overdue" || task.reasonCode === "review-due") {
    return { action: { type: "review-queue" as const, recordIds: task.recordIds, subject: task.subject }, completionPolicy: { type: "review-logs" as const, targetRecordIds: task.recordIds } };
  }
  if (task.recordIds.length > 0) {
    return { action: { type: "ai-quiz" as const, recordIds: task.recordIds, subject: task.subject }, completionPolicy: { type: "confirmed-quiz" as const, targetRecordIds: task.recordIds } };
  }
  return { action: { type: "create-record" as const, recordIds: [], subject: task.subject }, completionPolicy: { type: "meaningful-record" as const } };
};

const dateOffset = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string) => Math.round(
  (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000,
);

const fingerprint = (value: unknown) => {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `coach-v${COACH_RULE_VERSION}-${(hash >>> 0).toString(36)}`;
};

const subjectOrder = (subject: string) => {
  const index = POSTGRADUATE_SUBJECTS.indexOf(subject as typeof POSTGRADUATE_SUBJECTS[number]);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

const activeSubjectsFor = (settings: LearningCoachSettings, records: RecordBlock[], sessions: StudySession[]) => {
  if (settings.scenario === "postgraduate-exam") return [...POSTGRADUATE_SUBJECTS];
  return Array.from(new Set([...records.map((record) => canonicalStudySubject(record.subject)), ...sessions.map((session) => canonicalStudySubject(session.subject))])).sort();
};

export const buildLearningCoachProjection = (options: {
  today: string;
  settings: LearningCoachSettings;
  records: RecordBlock[];
  studySessions: StudySession[];
  reviews: RecordReviewState[];
  evidence: LearningEvidence[];
  tasks: LearningCoachTask[];
  previousDiagnoses?: LearningCoachDiagnosis[];
  evaluatedAt?: string;
}): LearningCoachProjection => {
  const records = options.records.filter(isMeaningfulLearningRecord);
  const sessions = options.studySessions.filter((session) => !session.deletedAt);
  // Phase 2 projections are intentionally independent: point-only writes must not
  // invalidate Phase 1 AI runs or participate in Record-level task orchestration.
  const recordEvidence = options.evidence.filter((item) => item.target?.type !== "knowledge-point");
  const recordTasks = options.tasks.filter((task) => task.scope !== "knowledge-point");
  const start = dateOffset(options.today, -6);
  const inWindow = (date: string) => date >= start && date <= options.today;
  const subjects = activeSubjectsFor(options.settings, records, sessions);
  const perSubject = new Map(subjects.map((subject) => [subject, { records: 0, sessions: 0, minutes: 0, lastActivity: undefined as string | undefined }]));
  const ensure = (subject: string) => {
    const existing = perSubject.get(subject) ?? { records: 0, sessions: 0, minutes: 0, lastActivity: undefined as string | undefined };
    perSubject.set(subject, existing);
    return existing;
  };
  for (const record of records) {
    const state = ensure(canonicalStudySubject(record.subject));
    if (!state.lastActivity || record.date > state.lastActivity) state.lastActivity = record.date;
    if (inWindow(record.date)) state.records += 1;
  }
  for (const session of sessions) {
    const state = ensure(canonicalStudySubject(session.subject));
    if (!state.lastActivity || session.date > state.lastActivity) state.lastActivity = session.date;
    if (inWindow(session.date)) {
      state.sessions += 1;
      state.minutes += Math.max(0, session.minutes);
    }
  }

  const activeReviews = options.reviews.filter((review) => review.status === "active" && review.nextReviewDate);
  const overdue = activeReviews.filter((review) => review.nextReviewDate! < options.today)
    .sort((left, right) => left.nextReviewDate!.localeCompare(right.nextReviewDate!));
  const due = activeReviews.filter((review) => review.nextReviewDate === options.today)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const pending = recordTasks.filter((task) => task.status === "pending" && task.proposalStatus !== "proposed");
  const summary: LearningCoachLocalSummary = {
    dueReviews: due.length,
    overdueReviews: overdue.length,
    pendingTasks: pending.length,
    studyMinutesLast7Days: Array.from(perSubject.values()).reduce((sum, item) => sum + item.minutes, 0),
    recordCountLast7Days: Array.from(perSubject.values()).reduce((sum, item) => sum + item.records, 0),
    ...(options.settings.scenario === "postgraduate-exam" && options.settings.postgraduateExamProfile?.examDate
      ? { examDaysRemaining: daysBetween(options.today, options.settings.postgraduateExamProfile.examDate) }
      : {}),
  };
  const diagnoses: LearningCoachDiagnosis[] = [];
  const drafts: LearningCoachProjection["tasks"] = [];
  const push = (diagnosis: LearningCoachDiagnosis, task?: LearningCoachProjection["tasks"][number]) => {
    const issueKey = learningCoachIssueKey(diagnosis);
    diagnoses.push({ ...diagnosis, issueKey });
    if (task) drafts.push({ ...task, issueKey, ...inferLearningCoachTaskAction(task) });
  };

  if (options.settings.scenario === "postgraduate-exam") {
    const profile = options.settings.postgraduateExamProfile;
    const stages = profile?.stages;
    if (!profile?.examDate || !(profile.weeklyAvailableMinutes > 0) || !["数学", "政治", "英语", "408"].every((subject) => stages?.[subject as "数学"])) {
      push({ code: "profile-incomplete", priority: 1, recordIds: [], message: "请先完善考试日期、每周可用时间和四科阶段。", reason: "考研模式需要这些目标信息才能生成科目行动。" });
    }
  }
  if (overdue.length > 0) {
    const recordIds = overdue.slice(0, 10).map((review) => review.recordId);
    push(
      { code: "review-overdue", priority: 1, recordIds, message: `有 ${overdue.length} 条复习已逾期。`, reason: `这些日志的复习日期早于 ${options.today}。` },
      { kind: "review", priority: 1, reasonCode: "review-overdue", title: `回顾 ${Math.min(overdue.length, 10)} 条逾期日志`, actionLabel: "开始复习", reason: `这些日志的复习日期早于 ${options.today}。`, recordIds },
    );
  } else if (due.length > 0) {
    const recordIds = due.slice(0, 10).map((review) => review.recordId);
    push(
      { code: "review-due", priority: 1, recordIds, message: `今天有 ${due.length} 条待复习日志。`, reason: `这些日志的复习日期是 ${options.today}。` },
      { kind: "review", priority: 1, reasonCode: "review-due", title: `回顾 ${Math.min(due.length, 10)} 条今日复习`, actionLabel: "开始复习", reason: `这些日志的复习日期是 ${options.today}。`, recordIds },
    );
  }
  if (pending.some((task) => task.date < options.today)) {
    push({ code: "task-carryover", priority: 1, recordIds: [], message: "存在未完成的历史学习任务。" });
  }
  for (const subject of subjects) {
    const state = ensure(subject);
    if (!state.lastActivity || state.lastActivity < dateOffset(options.today, -3)) {
      const recent = records.filter((record) => canonicalStudySubject(record.subject) === subject).sort((left, right) => right.date.localeCompare(left.date))[0];
      push(
        { code: "subject-gap", priority: 2, subject, recordIds: recent ? [recent.id] : [], message: `${subjectDisplayName(subject)} 已连续 3 天没有学习记录。`, reason: "最近连续 3 个完整自然日没有 Record 或 StudySession。" },
        { subject, kind: "practice", priority: 2, reasonCode: "subject-gap", title: recent ? `回顾《${recent.title}》` : `开始一次 ${subjectDisplayName(subject)} 学习`, actionLabel: recent ? "开始测验" : "开始记录", reason: "最近连续 3 个完整自然日没有 Record 或 StudySession。", recordIds: recent ? [recent.id] : [] },
      );
    }
  }
  const activity = Array.from(perSubject, ([subject, state]) => ({ subject, value: state.records + state.sessions })).sort((left, right) => right.value - left.value || subjectOrder(left.subject) - subjectOrder(right.subject));
  const totalActivity = activity.reduce((sum, item) => sum + item.value, 0);
  const inactive = activity.filter((item) => item.value === 0).sort((left, right) => subjectOrder(left.subject) - subjectOrder(right.subject));
  if ((summary.recordCountLast7Days >= 6 || summary.studyMinutesLast7Days >= 180) && totalActivity > 0 && activity[0]?.value / totalActivity >= 0.7 && inactive.length > 0) {
    const subject = inactive[0].subject;
    const recent = records.filter((record) => canonicalStudySubject(record.subject) === subject).sort((left, right) => right.date.localeCompare(left.date))[0];
    push(
      { code: "subject-imbalance", priority: 3, subject, recordIds: recent ? [recent.id] : [], message: `最近 7 天学习活动集中在少数学科，${subjectDisplayName(subject)} 没有活动记录。`, reason: "最近 7 天最高活动科目占比至少 70%，且该科活动量为 0。" },
      { subject, kind: "practice", priority: 3, reasonCode: "subject-imbalance", title: recent ? `回顾《${recent.title}》` : `开始一次 ${subjectDisplayName(subject)} 学习`, actionLabel: recent ? "开始测验" : "开始记录", reason: "最近 7 天最高活动科目占比至少 70%，且该科活动量为 0。", recordIds: recent ? [recent.id] : [] },
    );
  }
  const confirmedWeak = recordEvidence
    .filter((item) => item.kind === "quiz-assessment-confirmed" && item.payload.outcome === "needs-review" && item.target?.type === "record" && item.date >= start)
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  for (const evidence of confirmedWeak) {
    const recordId = evidence.target!.id;
    const recovered = recordEvidence.some((item) => item.kind === "quiz-assessment-confirmed" && item.target?.id === recordId && item.payload.outcome === "satisfactory" && item.occurredAt > evidence.occurredAt);
    if (!recovered) {
      push(
        { code: "quiz-follow-up", priority: 2, subject: evidence.subject ? canonicalStudySubject(evidence.subject) : undefined, recordIds: [recordId], message: "最近一次已确认测验反馈建议回看该知识点。", reason: "该日志最近一次已确认测验结果为需要复习。" },
        { subject: evidence.subject ? canonicalStudySubject(evidence.subject) : undefined, kind: "revisit-record", priority: 2, reasonCode: "quiz-follow-up", title: "回顾测验薄弱日志", actionLabel: "开始测验", reason: "该日志最近一次已确认测验结果为需要复习。", recordIds: [recordId] },
      );
      break;
    }
  }
  const activeTaskIssueKeys = new Set(recordTasks
    .filter((task) => task.status === "pending" || task.status === "in-progress")
    .map((task) => task.issueKey ?? learningCoachIssueKey({ code: task.reasonCode, subject: task.subject, recordIds: task.recordIds })));
  const taskOutcomes = recordEvidence
    .filter((item) => item.kind === "task-outcome" && typeof item.payload.issueKey === "string")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const latestOutcomeFor = (issueKey: string) => taskOutcomes.find((item) => item.payload.issueKey === issueKey);
  const interventionKeyForDraft = (task: LearningCoachProjection["tasks"][number]) =>
    `${task.issueKey}:${task.action?.type ?? inferLearningCoachTaskAction(task).action.type}:${[...task.recordIds].sort().join(",")}`;
  const latestRelevantFactAt = (diagnosis: LearningCoachDiagnosis) => {
    const subject = diagnosis.subject ? canonicalStudySubject(diagnosis.subject) : undefined;
    const recordIds = new Set(diagnosis.recordIds);
    return [
      ...records.filter((item) => (subject && canonicalStudySubject(item.subject) === subject) || recordIds.has(item.id)).map((item) => item.updatedAt),
      ...sessions.filter((item) => subject && canonicalStudySubject(item.subject) === subject).map((item) => item.updatedAt),
      ...options.reviews.filter((item) => recordIds.has(item.recordId)).map((item) => item.updatedAt),
      ...recordEvidence.filter((item) => item.kind === "quiz-assessment-confirmed" && (item.target?.type === "record" && recordIds.has(item.target.id) || subject && item.subject && canonicalStudySubject(item.subject) === subject)).map((item) => item.occurredAt),
    ].sort().at(-1);
  };
  type InterventionProjectionState = {
    state: "actionable" | "in-progress" | "awaiting-new-evidence";
    task?: LearningCoachTask;
    outcome?: LearningEvidence;
  };
  const interventionState = new Map<string, InterventionProjectionState>(diagnoses.map((diagnosis): [string, InterventionProjectionState] => {
    const issueKey = diagnosis.issueKey!;
    const activeTask = recordTasks.find((task) => (task.status === "pending" || task.status === "in-progress") && (task.issueKey ?? learningCoachIssueKey({ code: task.reasonCode, subject: task.subject, recordIds: task.recordIds })) === issueKey);
    if (activeTask) return [issueKey, { state: activeTask.status === "in-progress" ? "in-progress" as const : "actionable" as const, task: activeTask }];
    const outcome = latestOutcomeFor(issueKey);
    const latestFactAt = latestRelevantFactAt(diagnosis);
    const completedTask = outcome ? recordTasks.find((task) => task.id === outcome.source.id) : undefined;
    const currentDraft = drafts.find((task) => task.issueKey === issueKey);
    const completedInterventionKey = completedTask?.interventionKey ?? (completedTask ? `${issueKey}:${completedTask.action?.type ?? inferLearningCoachTaskAction(completedTask).action.type}:${[...completedTask.recordIds].sort().join(",")}` : undefined);
    const sameIntervention = Boolean(currentDraft && completedInterventionKey === interventionKeyForDraft(currentDraft));
    const waiting = Boolean(outcome && sameIntervention && (!latestFactAt || latestFactAt <= outcome.occurredAt));
    return [issueKey, { state: waiting ? "awaiting-new-evidence" as const : "actionable" as const, outcome }];
  }));
  const tasks = drafts
    .filter((task) => !activeTaskIssueKeys.has(task.issueKey!) && interventionState.get(task.issueKey!)?.state !== "awaiting-new-evidence")
    .sort((left, right) => left.priority - right.priority || subjectOrder(left.subject ?? "" ) - subjectOrder(right.subject ?? ""))
    .slice(0, 3);
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const metricFor = (diagnosis: LearningCoachDiagnosis) => {
    if (diagnosis.code === "review-overdue") return { current: overdue.length, threshold: 0, unit: "条", direction: "above" as const };
    if (diagnosis.code === "review-due") return { current: due.length, threshold: 0, unit: "条", direction: "above" as const };
    if (diagnosis.code === "subject-gap") {
      const last = diagnosis.subject ? ensure(diagnosis.subject).lastActivity : undefined;
      return { current: last ? daysBetween(last, options.today) : 999, threshold: 3, unit: "天", direction: "above" as const };
    }
    if (diagnosis.code === "subject-imbalance") return { current: Math.round((activity[0]?.value ?? 0) / Math.max(1, totalActivity) * 100), threshold: 70, unit: "%", direction: "above" as const };
    return { current: 1, threshold: 0, unit: "项", direction: "above" as const };
  };
  const previous = new Map((options.previousDiagnoses ?? []).filter((item) => item.issueKey).map((item) => [item.issueKey!, item]));
  const activeDiagnoses = diagnoses.map((diagnosis) => {
    const metric = metricFor(diagnosis);
    const prior = previous.get(diagnosis.issueKey!);
    const improved = prior?.metric && (metric.direction === "above" ? metric.current < prior.metric.current : metric.current > prior.metric.current);
    const intervention = interventionState.get(diagnosis.issueKey!);
    const nextStatus = (!prior || prior.status === "resolved"
      ? "new"
      : improved
        ? "improved"
        : prior.status === "new" && intervention?.state === "actionable"
          ? "new"
          : "ongoing") as LearningCoachDiagnosis["status"];
    const statusChanged = prior?.status !== nextStatus;
    const outcome = intervention?.outcome;
    const activeTask = intervention?.task;
    const evidenceRefs = diagnosis.recordIds.map((id) => ({ type: "record" as const, id }));
    return {
      ...diagnosis,
      status: nextStatus,
      metric,
      evidenceRefs,
      firstDetectedAt: prior?.firstDetectedAt ?? evaluatedAt,
      lastEvaluatedAt: evaluatedAt,
      lastStatusChangedAt: statusChanged ? evaluatedAt : prior?.lastStatusChangedAt ?? prior?.firstDetectedAt ?? evaluatedAt,
      interventionState: intervention?.state ?? "actionable",
      latestIntervention: outcome ? {
        taskId: outcome.source.id,
        outcomeEvidenceId: outcome.id,
        outcome: "completed" as const,
        occurredAt: outcome.occurredAt,
      } : activeTask ? { taskId: activeTask.id, interventionKey: activeTask.interventionKey, occurredAt: activeTask.startedAt ?? activeTask.createdAt } : prior?.latestIntervention,
      statusHistory: statusChanged
        ? [...(prior?.statusHistory ?? []), { status: nextStatus!, occurredAt: evaluatedAt, evidenceRefs }].slice(-20)
        : prior?.statusHistory ?? [{ status: nextStatus!, occurredAt: prior?.firstDetectedAt ?? evaluatedAt, evidenceRefs }],
    };
  });
  const activeKeys = new Set(activeDiagnoses.map((item) => item.issueKey));
  const resolutionRefsFor = (item: LearningCoachDiagnosis) => {
    const recordIds = new Set(item.recordIds);
    const interventionRefs = recordEvidence
      .filter((evidence) => evidence.kind === "task-outcome" && evidence.payload.issueKey === item.issueKey)
      .flatMap((evidence) => evidence.supportingEvidenceRefs ?? []);
    const changedAfterDetection = item.lastStatusChangedAt ?? item.firstDetectedAt ?? item.lastEvaluatedAt ?? "";
    const newRecordRefs = records
      .filter((record) => record.updatedAt > changedAfterDetection && (recordIds.has(record.id) || item.subject && canonicalStudySubject(record.subject) === canonicalStudySubject(item.subject)))
      .map((record) => ({ type: "record" as const, id: record.id }));
    const newSessionRefs = sessions
      .filter((session) => session.updatedAt > changedAfterDetection && item.subject && canonicalStudySubject(session.subject) === canonicalStudySubject(item.subject))
      .map((session) => ({ type: "study-session" as const, id: session.id }));
    return Array.from(new Map([...interventionRefs, ...newRecordRefs, ...newSessionRefs].map((ref) => [`${ref.type}:${ref.id}`, ref])).values());
  };
  const resolved = [...previous.values()].filter((item) => !activeKeys.has(item.issueKey)).map((item) => {
    if (item.status === "resolved") return { ...item, lastEvaluatedAt: evaluatedAt };
    const refs = resolutionRefsFor(item);
    const strongResolution = refs.length > 0 || item.code === "profile-incomplete";
    const absenceConfirmedAcrossDays = Boolean(
      item.interventionState === "awaiting-new-evidence" &&
      item.lastEvaluatedAt &&
      item.lastEvaluatedAt.slice(0, 10) < options.today,
    );
    if (!strongResolution && !absenceConfirmedAcrossDays) {
      const waitingStatus = item.status === "improved" ? "improved" as const : "ongoing" as const;
      const statusChanged = item.status !== waitingStatus;
      return {
        ...item,
        status: waitingStatus,
        interventionState: "awaiting-new-evidence" as const,
        lastEvaluatedAt: evaluatedAt,
        lastStatusChangedAt: statusChanged ? evaluatedAt : item.lastStatusChangedAt,
        statusHistory: statusChanged
          ? [...(item.statusHistory ?? []), { status: waitingStatus, occurredAt: evaluatedAt }].slice(-20)
          : item.statusHistory,
      };
    }
    return {
      ...item,
      status: "resolved" as const,
      interventionState: "satisfied" as const,
      lastEvaluatedAt: evaluatedAt,
      resolvedAt: evaluatedAt,
      lastStatusChangedAt: evaluatedAt,
      resolutionEvidenceRefs: refs,
      statusHistory: [...(item.statusHistory ?? []), { status: "resolved" as const, occurredAt: evaluatedAt, evidenceRefs: refs }].slice(-20),
    };
  });
  const lifecycleDiagnoses = [...activeDiagnoses, ...resolved];
  const changes = {
    new: lifecycleDiagnoses.filter((item) => item.status === "new").map((item) => item.issueKey!),
    ongoing: lifecycleDiagnoses.filter((item) => item.status === "ongoing").map((item) => item.issueKey!),
    improved: lifecycleDiagnoses.filter((item) => item.status === "improved").map((item) => item.issueKey!),
    resolved: lifecycleDiagnoses.filter((item) => item.status === "resolved").map((item) => item.issueKey!),
  };
  const recordSubject = new Map(records.map((record) => [record.id, canonicalStudySubject(record.subject)]));
  const latestQuiz = new Map<string, "needs-review" | "satisfactory">();
  for (const item of recordEvidence.filter((entry) => entry.kind === "quiz-assessment-confirmed").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const subject = item.subject ? canonicalStudySubject(item.subject) : item.target?.type === "record" ? recordSubject.get(item.target.id) : undefined;
    const outcome = item.payload.outcome;
    if (subject && (outcome === "needs-review" || outcome === "satisfactory")) latestQuiz.set(subject, outcome);
  }
  const subjectStates = Array.from(perSubject, ([subject, state]) => ({
    subject,
    lastActivityDate: state.lastActivity,
    recordCountLast7Days: state.records,
    studyMinutesLast7Days: state.minutes,
    dueReviewCount: due.filter((item) => recordSubject.get(item.recordId) === subject).length,
    overdueReviewCount: overdue.filter((item) => recordSubject.get(item.recordId) === subject).length,
    latestConfirmedQuizOutcome: latestQuiz.get(subject),
  }));
  const inputFingerprint = fingerprint({
    settings: options.settings,
    records: records.map(({ id, updatedAt, date, subject, deletedAt }) => [id, updatedAt, date, subject, deletedAt]),
    sessions: sessions.map(({ id, updatedAt, date, subject, minutes }) => [id, updatedAt, date, subject, minutes]),
    reviews: options.reviews.map(({ id, updatedAt, status, nextReviewDate }) => [id, updatedAt, status, nextReviewDate]),
    evidence: recordEvidence.map(({ id, updatedAt }) => [id, updatedAt]),
    tasks: recordTasks.map(({ id, status, issueKey, interventionKey }) => [id, status, issueKey, interventionKey]),
  });
  return { inputFingerprint, summary, diagnoses: lifecycleDiagnoses, subjectStates, changes, tasks };
};
