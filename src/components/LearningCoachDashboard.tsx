import { BrainCircuit, Clock3, RefreshCw, SkipForward } from "lucide-react";
import { useState } from "react";

import type { KnowledgePoint, KnowledgePointCoachSnapshot, KnowledgeRelation, LearningCoachAiRun, LearningCoachDiagnosis, LearningCoachEvidenceRef, LearningCoachSkipReason, LearningCoachSnapshot, LearningCoachTask, LearningEvidence, RecordBlock, RecordReviewLog } from "../types";
import { subjectDisplayName } from "../lib/subjects";
import { learningCoachIssueKey } from "../services/learningCoachService";

type CoachAiAvailability = "checking" | "available" | "unavailable";

interface LearningCoachDashboardProps {
  variant?: "summary" | "detail";
  snapshot?: LearningCoachSnapshot;
  tasks: LearningCoachTask[];
  aiRuns?: LearningCoachAiRun[];
  aiAvailability?: CoachAiAvailability;
  loading?: boolean;
  onRefresh: () => void;
  onSkip: (taskId: string, reason: LearningCoachSkipReason, note?: string) => void;
  onAskAi?: () => void;
  onAcceptCandidate?: (runId: string, index: number) => void;
  onDecideRelationProposal?: (runId: string, proposalId: string, decision: "accepted" | "rejected") => void;
  onStartTask?: (task: LearningCoachTask) => void;
  onOpenTaskRecord?: (task: LearningCoachTask) => void;
  records?: RecordBlock[];
  evidence?: LearningEvidence[];
  reviewLogs?: RecordReviewLog[];
  knowledgePoints?: KnowledgePoint[];
  knowledgeRelations?: KnowledgeRelation[];
  onConfirmKnowledgeRelation?: (fromKnowledgePointId: string, toKnowledgePointId: string, sourceRefs: LearningCoachEvidenceRef[]) => void;
  onRetireKnowledgeRelation?: (relationId: string) => void;
  knowledgePointSnapshot?: KnowledgePointCoachSnapshot;
  onOpenDetail?: () => void;
}

const issueStatus = (diagnosis: LearningCoachDiagnosis) => {
  if (diagnosis.interventionState === "awaiting-new-evidence") return { key: "waiting", label: "等待新证据" };
  if (diagnosis.status === "resolved") return { key: "resolved", label: "规则已解除" };
  return {
    key: diagnosis.status ?? "ongoing",
    label: ({ new: "新发现", ongoing: "持续中", improved: "有所改善" } as const)[diagnosis.status as "new" | "ongoing" | "improved"] ?? "持续中",
  };
};

const actionDescription = (task: LearningCoachTask) => {
  if (task.action?.type === "review-queue") return "进入正式复习队列；完成全部目标日志的评级后，系统才会记录完成结果。";
  if (task.action?.type === "create-record") return "打开一条新学习记录；只有保存有效学习内容后，系统才会把它作为新事实。";
  return "根据关联学习记录进行一道 AI 测验；作答并确认批改后，系统才会记录测验结果。";
};

const taskStatusText = (task: LearningCoachTask) => ({
  pending: "尚未开始",
  "in-progress": "正在执行",
  completed: "已完成并取得结果",
  skipped: "已按你的选择调整",
  cancelled: "原行动已取消",
}[task.status]);

const skipReasonText = (reason?: LearningCoachSkipReason) => ({
  "no-time": "今天没有时间",
  "too-large": "原行动范围太大",
  "not-relevant": "当前与你的学习重点不相关",
  other: "你选择暂不执行",
}[reason ?? "other"]);

const reviewRatingText = (rating: string) => ({
  again: "需要重学",
  hard: "比较困难",
  good: "基本记得",
  easy: "掌握轻松",
  forgot: "未记住",
  remembered: "已记住",
}[rating] ?? rating);

const aiRunStatusText = (run: LearningCoachAiRun) => {
  if (run.status === "queued") return "等待开始分析";
  if (run.status === "running") {
    if (run.phase === "preparing-context") return "正在整理相关学习记录";
    if (run.phase === "validating-result") return "正在检查建议是否可执行";
    return "正在分析当前学习问题";
  }
  if (run.status === "succeeded") return "分析已完成";
  if (run.status === "stale") return "学习数据已变化，本次分析仅供回顾";
  return "分析未完成";
};

const newestFirst = (left: LearningCoachTask, right: LearningCoachTask) =>
  (right.completedAt ?? right.skippedAt ?? right.startedAt ?? right.createdAt).localeCompare(left.completedAt ?? left.skippedAt ?? left.startedAt ?? left.createdAt);

const humanizeRuleText = (text: string) => text
  .replace(/\s*\bStudySession\b\s*/g, "学习计时")
  .replace(/\s*\bRecord\b\s*/g, "学习记录");

export const LearningCoachDashboard = ({
  variant = "detail",
  snapshot,
  tasks,
  aiRuns = [],
  aiAvailability = "checking",
  loading,
  onRefresh,
  onSkip,
  onAskAi,
  onAcceptCandidate,
  onDecideRelationProposal,
  onStartTask,
  onOpenTaskRecord,
  records = [],
  evidence = [],
  reviewLogs = [],
  knowledgePoints = [],
  knowledgeRelations = [],
  onConfirmKnowledgeRelation,
  onRetireKnowledgeRelation,
  knowledgePointSnapshot,
  onOpenDetail,
}: LearningCoachDashboardProps) => {
  const [skipTask, setSkipTask] = useState<LearningCoachTask>();
  const [skipReason, setSkipReason] = useState<LearningCoachSkipReason>("no-time");
  const [skipNote, setSkipNote] = useState("");
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({});
  const [auditIssues, setAuditIssues] = useState<Record<string, boolean>>({});
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [relationFrom, setRelationFrom] = useState("");
  const [relationTo, setRelationTo] = useState("");
  const recordById = new Map(records.map((record) => [record.id, record]));
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const reviewLogById = new Map(reviewLogs.map((item) => [item.id, item]));
  const knowledgePointById = new Map(knowledgePoints.map((item) => [item.id, item]));

  const describeLearningEvidence = (item: LearningEvidence) => {
    if (item.kind === "quiz-assessment-confirmed") {
      return item.payload.outcome === "satisfactory" ? "单题测验反馈已确认：本次回答达到预期" : "单题测验反馈已确认：本次内容仍需回顾";
    }
    if (item.kind === "quiz-answer") return "已提交单题回答，尚未确认批改结果";
    if (item.kind === "task-outcome" || item.kind === "task-completed") return "建议行动已完成，系统已记录实际结果";
    if (item.kind === "task-skipped") return "你已跳过本次行动，系统已调整后续安排";
    return "建议行动已经开始";
  };

  const describeEvidenceRef = (ref: LearningCoachEvidenceRef) => {
    if (ref.type === "record") {
      const record = recordById.get(ref.id);
      return record ? `${record.date} 保存的《${record.title}》` : "一条已保存的学习记录";
    }
    if (ref.type === "review-log") {
      const log = reviewLogById.get(ref.id);
      const record = log ? recordById.get(log.recordId) : undefined;
      return log ? `完成《${record?.title ?? "学习记录"}》复习，反馈为“${reviewRatingText(log.normalizedRating ?? log.rating)}”` : "一次正式复习结果";
    }
    if (ref.type === "learning-evidence") {
      const item = evidenceById.get(ref.id);
      return item ? describeLearningEvidence(item) : "一项已确认的学习结果";
    }
    if (ref.type === "knowledge-point") return knowledgePointById.get(ref.id)?.name ?? "一个已确认知识点";
    if (ref.type === "record-knowledge-point-link") return "一条由你确认的记录与知识点关联";
    if (ref.type === "review-state") return "一项正式复习计划";
    return "一次真实学习活动";
  };

  const describeEvidenceRefs = (refs?: LearningCoachEvidenceRef[]) => (refs ?? []).map(describeEvidenceRef).join("；");
  const latestRun = aiRuns[0];
  const pointDiagnoses = knowledgePointSnapshot?.diagnoses ?? [];
  const refinedParentKeys = new Set(pointDiagnoses.filter((item) => item.status !== "resolved" && item.parentIssueKey).map((item) => item.parentIssueKey));
  const recordDiagnoses = (snapshot?.diagnoses ?? []).map((item) => ({ ...item, level: item.level ?? "record" as const }));
  const combinedDiagnoses = [...pointDiagnoses, ...recordDiagnoses.filter((item) => !refinedParentKeys.has(item.issueKey))];
  const activeDiagnoses = combinedDiagnoses.filter((item) => item.status !== "resolved")
    .sort((left, right) => left.priority - right.priority || (left.firstDetectedAt ?? "").localeCompare(right.firstDetectedAt ?? ""));
  const resolvedDiagnoses = combinedDiagnoses.filter((item) => item.status === "resolved")
    .sort((left, right) => (right.resolvedAt ?? "").localeCompare(left.resolvedAt ?? ""))
    .slice(0, 3);
  const issueKeyForTask = (task: LearningCoachTask) => task.issueKey ?? learningCoachIssueKey({ code: task.reasonCode, subject: task.subject, recordIds: task.recordIds });
  const tasksForIssue = (issueKey?: string, parentIssueKey?: string) => tasks.filter((task) => issueKeyForTask(task) === issueKey || Boolean(parentIssueKey && issueKeyForTask(task) === parentIssueKey)).sort(newestFirst);
  const decision = snapshot?.decision;
  const recommendedPoint = decision?.recommendedKnowledgePointId ? knowledgePointById.get(decision.recommendedKnowledgePointId) : undefined;
  const recommendedTask = decision?.recommendedTaskId ? tasks.find((task) => task.id === decision.recommendedTaskId) : undefined;
  const hasRecommendedDecision = decision?.status === "recommended" && Boolean(recommendedPoint);
  const primaryDiagnosis = activeDiagnoses[0];
  const primaryDiagnosisTask = primaryDiagnosis
    ? tasksForIssue(primaryDiagnosis.issueKey, primaryDiagnosis.parentIssueKey).find((task) => task.status === "pending" || task.status === "in-progress")
    : undefined;
  const primaryTask = recommendedTask ?? primaryDiagnosisTask;
  const primaryTaskUnavailable = primaryTask?.action?.type === "ai-quiz" && aiAvailability !== "available";
  const primarySubjectName = primaryDiagnosis?.subject ? subjectDisplayName(primaryDiagnosis.subject) : undefined;
  const primaryDiagnosisTitle = primaryDiagnosis
    ? primarySubjectName && !primaryDiagnosis.message.startsWith(primarySubjectName)
      ? `${primarySubjectName} · ${primaryDiagnosis.message}`
      : primaryDiagnosis.message
    : undefined;
  const latestResolvedDiagnosis = resolvedDiagnoses[0];
  const latestResolutionResult = describeEvidenceRefs(latestResolvedDiagnosis?.resolutionEvidenceRefs);
  const confirmedRelations = knowledgeRelations.filter((relation) => relation.status === "confirmed");
  const selectedRelationSourceRefs = [...pointDiagnoses.filter((item) => item.knowledgePointId === relationFrom || item.knowledgePointId === relationTo).flatMap((item) => item.evidenceRefs ?? [])].slice(0, 4);

  if (variant === "summary") {
    const issueCount = activeDiagnoses.length;
    const waitingCount = activeDiagnoses.filter((item) => item.interventionState === "awaiting-new-evidence").length;
    const hasPriorityAction = Boolean(recommendedTask ?? primaryDiagnosisTask);
    const summary = issueCount === 0
      ? "当前没有需要优先处理的问题。"
      : decision?.status === "recommended" && recommendedPoint
        ? `建议先处理：${recommendedPoint.name}`
        : waitingCount > 0
          ? `${waitingCount} 个问题正在等待新的学习证据。`
          : "当前有问题需要进一步查看。";
    return <section className="learning-coach-entry" aria-label="学习驾驶舱入口">
      <div>
        <p className="eyebrow">学习驾驶舱</p>
        <h2>{issueCount === 0 ? "暂时没有需要关注的问题" : `发现 ${issueCount} 个值得关注的问题`}</h2>
        <p>{hasPriorityAction ? "当前有 1 个优先行动。" : summary}</p>
      </div>
      <button type="button" className="secondary-button" onClick={onOpenDetail}>查看驾驶舱</button>
    </section>;
  }

  const renderDiagnosis = (diagnosis: LearningCoachDiagnosis, index: number) => {
    const issueTasks = tasksForIssue(diagnosis.issueKey, diagnosis.parentIssueKey);
    const task = issueTasks.find((item) => item.status === "pending" || item.status === "in-progress");
    const latestExecutedTask = issueTasks.find((item) => item.status === "in-progress" || item.status === "completed" || item.status === "skipped");
    const latestSkipped = issueTasks.find((item) => item.status === "skipped");
    const currentSkip = latestSkipped && (
      task?.parentTaskId === latestSkipped.id ||
      (!task && !issueTasks.some((item) => item.createdAt > (latestSkipped.skippedAt ?? latestSkipped.updatedAt) && item.status !== "skipped" && item.status !== "cancelled"))
    ) ? latestSkipped : undefined;
    const outcomeEvidence = diagnosis.latestIntervention?.outcomeEvidenceId
      ? evidenceById.get(diagnosis.latestIntervention.outcomeEvidenceId)
      : latestExecutedTask
        ? evidence.find((item) => item.kind === "task-outcome" && item.source.type === "coach-task" && item.source.id === latestExecutedTask.id)
        : undefined;
    const resultRefs = diagnosis.status === "resolved" && diagnosis.resolutionEvidenceRefs?.length
      ? diagnosis.resolutionEvidenceRefs
      : outcomeEvidence?.supportingEvidenceRefs ?? latestExecutedTask?.completionEvidenceRefs;
    const status = issueStatus(diagnosis);
    const quizUnavailable = task?.action?.type === "ai-quiz" && aiAvailability !== "available";
    const detectionEvidence = describeEvidenceRefs(diagnosis.evidenceRefs);
    const resultEvidence = describeEvidenceRefs(resultRefs);
    const subjectName = diagnosis.subject ? subjectDisplayName(diagnosis.subject) : undefined;
    const diagnosisTitle = subjectName && !diagnosis.message.startsWith(subjectName) ? `${subjectName} · ${diagnosis.message}` : diagnosis.message;
    const judgment = diagnosis.status === "resolved"
      ? "该具体规则条件已经解除；这不代表整个学科或知识掌握已经完成。"
      : currentSkip
        ? `规则条件仍然成立，但系统已按你的选择调整行动，并将在 ${currentSkip.deferredUntil ?? "相关事实变化后"} 重新评估。`
      : diagnosis.interventionState === "awaiting-new-evidence"
        ? "原问题仍在观察中。系统会等待新的相关学习事实，再判断是否改善或需要继续行动。"
        : diagnosis.status === "improved"
          ? "新的真实事实已让指标向规则界限靠近，但当前问题尚未解除。"
          : diagnosis.status === "new"
            ? "规则条件刚刚成立，建议先完成下面的行动，再依据真实结果重新判断。"
            : "规则条件仍然成立，当前建议行动需要继续执行或重新安排。";

    const issueKey = diagnosis.issueKey ?? `${diagnosis.code}:${diagnosis.subject ?? ""}`;
    const expanded = Boolean(expandedIssues[issueKey]);
    const auditOpen = Boolean(auditIssues[issueKey]);
    return <article className={`coach-issue${index === 0 && diagnosis.status !== "resolved" ? " is-primary" : ""}`} key={issueKey}>
      <header>
        <span className={`coach-issue-status is-${status.key}`}>{status.label}</span>
        <small>{diagnosis.level === "knowledge-point" ? "知识点级问题" : "学习记录级问题"} · 本地规则诊断</small>
      </header>
      {index === 0 && diagnosis.status !== "resolved" && <p className="coach-focus-label">当前最重要的学习问题</p>}
      <button type="button" className="coach-issue-toggle" aria-expanded={expanded} onClick={() => setExpandedIssues((current) => ({ ...current, [issueKey]: !expanded }))}><span><h3>{diagnosisTitle}</h3><small>{task ? `下一步：${task.title}` : "当前没有新的执行任务"}</small></span><span>{expanded ? "收起" : "查看详情"}</span></button>
      {expanded && <div className="coach-causal-chain">
        <section><b>为什么发现</b><p>{humanizeRuleText(diagnosis.reason ?? "当前本地学习事实满足了这项确定性规则。")}</p></section>
        <section><b>当前指标 / 事实</b><p>{diagnosis.metric ? `当前为 ${diagnosis.metric.current}${diagnosis.metric.unit}，规则界限为 ${diagnosis.metric.threshold}${diagnosis.metric.unit}。` : diagnosis.message}</p>{detectionEvidence && <small>发现依据：{detectionEvidence}</small>}{!detectionEvidence && <small>发现依据：近期学习活动、复习计划与本地任务的确定性统计。</small>}</section>
        <section><b>当前建议行动</b>{task ? <div className="coach-task-action"><strong>{task.title}</strong><p>{actionDescription(task)}</p>{task.status === "in-progress" && <p>执行进度：{task.progress?.current ?? 0}/{task.progress?.total ?? 1}，等待真实结果完成。</p>}{quizUnavailable ? <div className="coach-ai-unavailable"><p>{aiAvailability === "checking" ? "正在检查远程 AI 配置，暂不启动测验。" : "未检测到可用的远程 AI 配置，因此不能启动或伪造完成这次测验。"}</p><div className="coach-task-actions">{task.recordIds.length > 0 && <button type="button" className="secondary-button" onClick={() => onOpenTaskRecord?.(task)}>打开关联记录自行回顾</button>}<button type="button" className="secondary-button" onClick={() => setSkipTask(task)}><SkipForward size={16} />跳过并调整</button></div><small>替代回顾不会被记录为 AI 测验完成；新的有效学习事实仍会触发重新诊断。</small></div> : <div className="coach-task-actions"><button type="button" className="primary-button" onClick={() => onStartTask?.(task)}>{task.status === "in-progress" ? "继续行动" : task.actionLabel ?? "开始行动"}</button><button type="button" className="secondary-button" onClick={() => setSkipTask(task)}><SkipForward size={16} />跳过并调整</button></div>}</div> : <p>{diagnosis.interventionState === "awaiting-new-evidence" ? "暂不重复安排相同行动，等待新的相关学习事实。" : currentSkip ? "系统已按你的选择暂时撤下本次行动。" : diagnosis.status === "resolved" ? "当前不需要继续执行该规则下的行动。" : "当前没有新的执行任务，系统会在相关事实变化后重新评估。"}</p>}</section>
        {currentSkip && <section className="coach-skip-feedback"><b>上次调整</b><p>跳过原因：{skipReasonText(currentSkip.skipReason)}{currentSkip.skipNote ? `（${currentSkip.skipNote}）` : ""}。</p><p>系统调整：{currentSkip.skipReason === "too-large" ? task?.parentTaskId === currentSkip.id ? `已把行动缩小为“${task.title}”。` : "已请求缩小行动范围。" : currentSkip.skipReason === "not-relevant" ? `暂停到 ${currentSkip.deferredUntil ?? "后续日期"}。` : `延后到 ${currentSkip.deferredUntil ?? "下一次评估"}。`}</p><small>{task ? "缩小后的行动已可以执行。" : `在 ${currentSkip.deferredUntil ?? "后续事实变化时"} 重新出现或重新评估；当前因此暂时没有行动。`}</small></section>}
        <section><b>行动后的新判断</b><p>{judgment}</p></section>
        <button type="button" className="subtle-button coach-audit-toggle" aria-expanded={auditOpen} onClick={() => setAuditIssues((current) => ({ ...current, [issueKey]: !auditOpen }))}>{auditOpen ? "收起依据与历史" : "查看依据与历史"}</button>
        {auditOpen && <div className="coach-audit-details"><section><b>已执行的行动</b><p>{latestExecutedTask ? `${latestExecutedTask.title}：${taskStatusText(latestExecutedTask)}${latestExecutedTask.completedAt || latestExecutedTask.skippedAt || latestExecutedTask.startedAt ? `（${new Date(latestExecutedTask.completedAt ?? latestExecutedTask.skippedAt ?? latestExecutedTask.startedAt!).toLocaleString()}）` : ""}` : "尚未执行建议行动。"}</p></section><section><b>行动产生的真实结果</b><p>{resultEvidence || (latestExecutedTask?.status === "skipped" ? "跳过只调整安排，不会产生学习效果证据。" : latestExecutedTask?.status === "in-progress" ? "行动尚未完成，暂时没有可用于判断的新结果。" : "尚未产生新的学习结果。")}</p></section></div>}
      </div>}
    </article>;
  };

  return <section className="learning-coach-dashboard" aria-label="学习驾驶舱">
    <header>
      <div><p className="eyebrow">学习驾驶舱</p><h2>今天先处理什么</h2></div>
      <div className="coach-header-actions"><button type="button" className="icon-button" onClick={onRefresh} disabled={loading} aria-label="刷新本地学习状态" title="刷新本地学习状态"><RefreshCw size={18} /></button></div>
    </header>
    {loading && !snapshot ? <p className="settings-hint">正在根据本地学习事实计算当前问题...</p> : snapshot && <>
      {hasRecommendedDecision && recommendedPoint && <section className="coach-decision-card" aria-label="当前优先建议">
        <p className="coach-focus-label">当前最值得处理的问题</p>
        <h3>建议先处理：{recommendedPoint.name}</h3>
        <p><b>为什么现在处理：</b>{decision.priorityRationale}</p>
        {decision.supportingIssueKeys.length > 1 && <small>相关问题：{decision.supportingIssueKeys.slice(1).map((key) => pointDiagnoses.find((item) => item.issueKey === key)?.message ?? key).join("、")}</small>}
        {recommendedTask && <div className="coach-primary-action"><b>现在做什么</b><strong>{recommendedTask.title}</strong>{primaryTaskUnavailable ? <small>{aiAvailability === "checking" ? "正在检查远程 AI 配置，暂时不能开始测验。" : "远程 AI 当前不可用。请展开问题详情，选择关联记录回顾或调整行动。"}</small> : <button type="button" className="primary-button" onClick={() => onStartTask?.(recommendedTask)}>{recommendedTask.actionLabel ?? "开始行动"}</button>}</div>}
      </section>}
      {!hasRecommendedDecision && primaryDiagnosis && <section className="coach-decision-card" aria-label="当前优先建议">
        <p className="coach-focus-label">当前最值得处理的问题</p>
        <h3>{primaryDiagnosisTitle}</h3>
        <p><b>为什么现在处理：</b>{humanizeRuleText(primaryDiagnosis.reason ?? "当前本地学习事实满足了这项确定性规则。")}</p>
        <div className="coach-primary-action"><b>现在做什么</b>{primaryTask ? <><strong>{primaryTask.title}</strong>{primaryTaskUnavailable ? <small>{aiAvailability === "checking" ? "正在检查远程 AI 配置，暂时不能开始测验。" : "远程 AI 当前不可用。请展开问题详情，选择关联记录回顾或调整行动。"}</small> : <button type="button" className="primary-button" onClick={() => onStartTask?.(primaryTask)}>{primaryTask.actionLabel ?? "开始行动"}</button>}</> : <span>{primaryDiagnosis.interventionState === "awaiting-new-evidence" ? "等待新的相关学习事实，再决定是否继续行动。" : "当前没有明确可执行的行动，系统会在相关事实变化后重新判断。"}</span>}</div>
      </section>}
      {activeDiagnoses.length === 0 && <section className="coach-decision-card is-quiet" aria-label="当前优先建议">
        <p className="coach-focus-label">当前没有明确的优先行动</p>
        <h3>先继续正常记录与复习</h3>
        {latestResolvedDiagnosis ? <><p><b>最近行动的真实结果：</b>{latestResolutionResult || "系统已记录这次行动的正式结果。"}</p><p><b>行动后的新判断：</b>对应的具体规则条件已经解除；这不表示整个学科或知识掌握已经完成。</p></> : <p>当前本地规则没有发现需要优先处理的问题。这不代表所有知识都已掌握。</p>}
      </section>}
      {primaryDiagnosis && <details className="coach-collapsible coach-diagnosis-disclosure"><summary>查看当前问题的原因与结果</summary><div className="coach-issue-list">{activeDiagnoses.slice(0, 1).map(renderDiagnosis)}</div></details>}
      {activeDiagnoses.length > 1 && <details className="coach-collapsible coach-other-issues"><summary>还有 {activeDiagnoses.length - 1} 个问题需要关注</summary><div className="coach-issue-list">{activeDiagnoses.slice(1).map((diagnosis, index) => renderDiagnosis(diagnosis, index + 1))}</div></details>}
      {resolvedDiagnoses.length > 0 && <details className="coach-collapsible"><summary>最近解除的规则问题</summary><p>这里的“解除”只表示对应规则条件不再成立。</p>{resolvedDiagnoses.map((diagnosis, index) => renderDiagnosis(diagnosis, index + activeDiagnoses.length))}</details>}
      <details className="coach-collapsible"><summary>决策依据与学习概览</summary><section className="coach-summary-section"><div className="coach-summary"><span>待复习 <strong>{snapshot.localSummary.dueReviews}</strong></span><span>已逾期 <strong>{snapshot.localSummary.overdueReviews}</strong></span><span>近 7 天记录 <strong>{snapshot.localSummary.recordCountLast7Days}</strong></span>{snapshot.localSummary.examDaysRemaining !== undefined && <span>考试倒计时 <strong>{snapshot.localSummary.examDaysRemaining} 天</strong></span>}</div></section>{onConfirmKnowledgeRelation && knowledgePoints.length > 1 && <section className="coach-relations-section"><h3>知识点前置关系</h3><p className="settings-hint">关系只有在你确认后，才会影响“先处理什么”的本地决策。</p><div className="coach-relation-form"><select aria-label="前置知识点" value={relationFrom} onChange={(event) => setRelationFrom(event.target.value)}><option value="">选择前置知识点</option>{knowledgePoints.filter((point) => point.status === "active").map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select><span>先于</span><select aria-label="后续知识点" value={relationTo} onChange={(event) => setRelationTo(event.target.value)}><option value="">选择后续知识点</option>{knowledgePoints.filter((point) => point.status === "active" && point.id !== relationFrom).map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select><button type="button" className="secondary-button" disabled={!relationFrom || !relationTo || relationFrom === relationTo} onClick={() => { onConfirmKnowledgeRelation(relationFrom, relationTo, selectedRelationSourceRefs); setRelationFrom(""); setRelationTo(""); }}>确认关系</button></div>{confirmedRelations.length > 0 && <div className="coach-relation-list">{confirmedRelations.map((relation) => <div key={relation.id}><span>{knowledgePointById.get(relation.fromKnowledgePointId)?.name ?? "已归档知识点"} → {knowledgePointById.get(relation.toKnowledgePointId)?.name ?? "已归档知识点"}</span><button type="button" className="secondary-button" onClick={() => onRetireKnowledgeRelation?.(relation.id)}>撤销</button></div>)}</div>}</section>}</details>
      {activeDiagnoses.length > 0 && <details className="coach-collapsible coach-ai-disclosure" open={aiOpen} onToggle={(event) => setAiOpen((event.currentTarget as HTMLDetailsElement).open)}><summary>需要进一步解释？使用 AI</summary><section className="coach-ai-section"><p>本地规则已经发现问题。AI 可以基于相关学习记录补充解释或提出候选行动，但不会修改正式状态或优先级。</p>{onAskAi && <button type="button" className="secondary-button coach-ai-button" onClick={onAskAi} disabled={aiAvailability !== "available"}><BrainCircuit size={17} />{aiAvailability === "available" ? "让 AI 解释当前问题" : aiAvailability === "checking" ? "正在检查 AI 配置" : "AI 暂不可用"}</button>}{latestRun?.status === "running" && <p><Clock3 size={15} /> {aiRunStatusText(latestRun)}...</p>}{latestRun?.status === "stale" && <p className="settings-hint">学习数据已发生变化，这次分析仅供回顾。</p>}{latestRun?.status === "succeeded" && <><p className="coach-ai-advice">分析结论：{latestRun.analysis}</p><p className="settings-hint">本次分析了 {latestRun.issueKeys.length} 个问题，参考 {latestRun.sourceRecords.length} 条学习记录。</p>{latestRun.candidateTasks?.map((candidate, index) => <div className="coach-candidate" key={`${candidate.title}:${index}`}><span><strong>可选行动：{candidate.title}</strong><small>{candidate.reason}</small></span><button type="button" className="secondary-button" onClick={() => onAcceptCandidate?.(latestRun.id, index)}>采纳为正式行动</button></div>)}{latestRun.relationProposals?.map((proposal) => <div className="coach-candidate" key={proposal.id}><span><strong>关系候选：{knowledgePointById.get(proposal.fromKnowledgePointId)?.name ?? "知识点"} 是 {knowledgePointById.get(proposal.toKnowledgePointId)?.name ?? "知识点"} 的前置</strong><small>{proposal.rationale}</small></span><span className="coach-task-actions"><button type="button" className="secondary-button" onClick={() => onDecideRelationProposal?.(latestRun.id, proposal.id, "rejected")}>拒绝</button><button type="button" className="secondary-button" onClick={() => onDecideRelationProposal?.(latestRun.id, proposal.id, "accepted")}>确认关系</button></span></div>)}</>}</section></details>}
      {aiRuns.length > 0 && <details className="coach-collapsible coach-ai-history"><summary>查看 AI 分析历史</summary>{aiRuns.map((run) => <article key={run.id}><strong>{new Date(run.requestedAt).toLocaleString()} · {aiRunStatusText(run)}</strong><small>分析范围：{run.issueKeys.length} 个问题，参考 {run.sourceRecords.length} 条学习记录{run.analysis ? `；结论：${run.analysis}` : ""}</small></article>)}</details>}
    </>}
    {skipTask && <div className="modal-backdrop"><section className="dialog-card coach-skip-dialog" role="dialog" aria-modal="true" aria-label="调整学习行动"><h3>为什么暂不执行？</h3><select value={skipReason} onChange={(event) => setSkipReason(event.target.value as LearningCoachSkipReason)}><option value="no-time">今天没时间，延后一天</option><option value="too-large">行动太大，请缩小</option><option value="not-relevant">不相关，暂停 7 天</option><option value="other">其他原因，延后一天</option></select>{skipReason === "other" && <textarea value={skipNote} onChange={(event) => setSkipNote(event.target.value)} placeholder="填写原因" />}<p className="settings-hint">确认后，首页会说明系统做了什么调整以及何时重新评估。</p><div><button type="button" className="secondary-button" onClick={() => setSkipTask(undefined)}>取消</button><button type="button" className="primary-button" disabled={skipReason === "other" && !skipNote.trim()} onClick={() => { onSkip(skipTask.id, skipReason, skipNote); setSkipTask(undefined); setSkipNote(""); }}>确认调整</button></div></section></div>}
  </section>;
};
