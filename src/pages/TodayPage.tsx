import { ArrowLeft, CalendarCheck, CalendarClock, Plus, Star } from "lucide-react";
import { useEffect, useState } from "react";

import type { Block, ContentTemplate, DayEntry, KnowledgePoint, KnowledgePointCoachSnapshot, KnowledgeRelation, LearningCoachAiRun, LearningCoachSettings, LearningCoachSkipReason, LearningCoachSnapshot, LearningCoachTask, LearningCoachEvidenceRef, LearningEvidence, RecordBlock, RecordReviewLog, RecordReviewState, Subject, SubjectConfig } from "../types";
import { daysUntil, formatChineseDate, todayISO } from "../lib/date";
import { SubjectPicker } from "../components/SubjectPicker";
import { RecordCard } from "../components/RecordCard";
import { CloudSyncButton } from "../components/CloudSyncButton";
import { fallbackSubjectName } from "../lib/subjects";
import { PageHeader, SurfaceCard } from "../components/ui";
import { getDailyMotto } from "../lib/dailyMotto";
import { LearningCoachDashboard } from "../components/LearningCoachDashboard";

interface TodayPageProps {
  entry: DayEntry | null;
  blocks: Block[];
  examDate: string;
  subjects: SubjectConfig[];
  templates?: readonly ContentTemplate[];
  onSaveEntry: (entry: DayEntry) => void;
  onCreateRecord: (date: string, subject: Subject, contentHtml?: string) => Promise<RecordBlock>;
  onOpenFavorites: () => void;
  onOpenRecord: (record: RecordBlock) => void;
  onOpenReview?: () => void;
  onAskAi?: (date: string) => void;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => void;
  reviewStatesByRecord?: Record<string, RecordReviewState>;
  reviewLogsByRecord?: Record<string, RecordReviewLog[]>;
  dueReviewStates?: RecordReviewState[];
  reviewTitlesByRecord?: Record<string, string>;
  onAddToReview?: (recordId: string) => void;
  onOpenCloudSyncSettings?: () => void;
  onCloudSyncRestored?: () => Promise<void> | void;
  learningCoachSettings?: LearningCoachSettings | null;
  learningCoachSnapshot?: LearningCoachSnapshot;
  learningCoachTasks?: LearningCoachTask[];
  learningCoachRecords?: RecordBlock[];
  learningCoachAiRuns?: LearningCoachAiRun[];
  learningCoachEvidence?: LearningEvidence[];
  knowledgePoints?: KnowledgePoint[];
  knowledgeRelations?: KnowledgeRelation[];
  onConfirmKnowledgeRelation?: (fromKnowledgePointId: string, toKnowledgePointId: string, sourceRefs: LearningCoachEvidenceRef[]) => void;
  onRetireKnowledgeRelation?: (relationId: string) => void;
  knowledgePointSnapshot?: KnowledgePointCoachSnapshot;
  coachAiAvailability?: "checking" | "available" | "unavailable";
  onEnsureLearningCoach?: () => Promise<unknown>;
  onSkipLearningCoachTask?: (taskId: string, reason: LearningCoachSkipReason, note?: string) => void;
  onAskCoachAi?: () => void;
  onAcceptCoachCandidate?: (runId: string, index: number) => void;
  onDecideRelationProposal?: (runId: string, proposalId: string, decision: "accepted" | "rejected") => void;
  onStartCoachTask?: (task: LearningCoachTask) => void;
  onOpenCoachTaskRecord?: (task: LearningCoachTask) => void;
}

export const TodayPage = ({
  entry,
  blocks,
  examDate,
  subjects,
  templates = [],
  onSaveEntry,
  onCreateRecord,
  onOpenFavorites,
  onOpenRecord,
  onOpenReview = () => undefined,
  onAskAi,
  onToggleFavorite,
  reviewStatesByRecord = {},
  reviewLogsByRecord = {},
  dueReviewStates = [],
  reviewTitlesByRecord = {},
  onAddToReview = () => undefined,
  onOpenCloudSyncSettings = () => undefined,
  onCloudSyncRestored = () => undefined,
  learningCoachSettings,
  learningCoachSnapshot,
  learningCoachTasks = [],
  learningCoachRecords = [],
  learningCoachAiRuns = [],
  learningCoachEvidence = [],
  knowledgePoints = [],
  knowledgeRelations = [],
  onConfirmKnowledgeRelation,
  onRetireKnowledgeRelation,
  knowledgePointSnapshot,
  coachAiAvailability = "checking",
  onEnsureLearningCoach,
  onSkipLearningCoachTask,
  onAskCoachAi,
  onAcceptCoachCandidate,
  onDecideRelationProposal,
  onStartCoachTask,
  onOpenCoachTaskRecord,
}: TodayPageProps) => {
  const [coachDetailOpen, setCoachDetailOpen] = useState(false);
  const [subject, setSubject] = useState<Subject>(() =>
    subjects.find((item) => !item.archivedAt)?.name ??
    fallbackSubjectName({ id: "settings", examDate, theme: "system", accentColor: "", backupReminderDays: 7, fontScale: 1, lineHeight: 1.7, subjects }),
  );
  const [templateId, setTemplateId] = useState("");
  const countdown = daysUntil(examDate);
  const today = todayISO();
  const records = blocks.filter((block): block is RecordBlock => block.type === "record");
  const todayDue = dueReviewStates.filter((review) => review.nextReviewDate === today);
  const overdue = dueReviewStates.filter((review) => review.nextReviewDate && review.nextReviewDate < today);
  const previewDue = dueReviewStates.slice(0, 3).map((review) => reviewTitlesByRecord[review.recordId]).filter(Boolean);
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const [coachLoading, setCoachLoading] = useState(false);
  const refreshCoach = async () => {
    if (!onEnsureLearningCoach) return;
    setCoachLoading(true);
    try { await onEnsureLearningCoach(); } finally { setCoachLoading(false); }
  };
  useEffect(() => {
    if (learningCoachSettings?.dashboardEnabled) void refreshCoach();
  }, [learningCoachSettings?.dashboardEnabled]);

  if (learningCoachSettings?.dashboardEnabled && coachDetailOpen) {
    return <main className="page today-page today-coach-page">
      <PageHeader
        eyebrow="学习辅助"
        title="学习驾驶舱"
        subtitle="先看当前最值得处理的一件事，需要时再展开依据。"
        density="compact"
        actions={<button type="button" className="secondary-button" onClick={() => setCoachDetailOpen(false)}><ArrowLeft size={17} />返回今天</button>}
      />
      <LearningCoachDashboard
        variant="detail"
        snapshot={learningCoachSnapshot}
        tasks={learningCoachTasks}
        aiRuns={learningCoachAiRuns}
        aiAvailability={coachAiAvailability}
        loading={coachLoading}
        onRefresh={() => void refreshCoach()}
        onSkip={(taskId, reason, note) => onSkipLearningCoachTask?.(taskId, reason, note)}
        onAskAi={onAskCoachAi}
        onAcceptCandidate={onAcceptCoachCandidate}
        onDecideRelationProposal={onDecideRelationProposal}
        onStartTask={onStartCoachTask}
        onOpenTaskRecord={onOpenCoachTaskRecord}
        records={learningCoachRecords}
        evidence={learningCoachEvidence}
        reviewLogs={Object.values(reviewLogsByRecord).flat()}
        knowledgePoints={knowledgePoints}
        knowledgeRelations={knowledgeRelations}
        onConfirmKnowledgeRelation={onConfirmKnowledgeRelation}
        onRetireKnowledgeRelation={onRetireKnowledgeRelation}
        knowledgePointSnapshot={knowledgePointSnapshot}
      />
    </main>;
  }

  return (
    <main className="page today-page">
      <PageHeader
        eyebrow={formatChineseDate(today)}
        title="今天"
        subtitle={getDailyMotto(today)}
        density="compact"
        actions={(
          <>
            <div className="today-goal-pill" title="距离目标" aria-label={`距离目标 ${countdown >= 0 ? `${countdown} 天` : "已结束"}`}>
              <CalendarClock size={16} />
              <span>距离目标</span>
              <strong>{countdown >= 0 ? `${countdown} 天` : "已结束"}</strong>
            </div>
            <CloudSyncButton onSignedOut={onOpenCloudSyncSettings} onRestored={onCloudSyncRestored} />
            <button type="button" className="icon-button" onClick={onOpenFavorites} title="收藏夹" aria-label="打开收藏夹">
              <Star size={18} />
            </button>
          </>
        )}
      />

      <section className="today-workbench">
        <SurfaceCard className="new-record-panel" variant="raised">
          <div className="new-record-copy">
            <p className="eyebrow">New Record</p>
            <h2>新建学习记录</h2>
          </div>
          <SubjectPicker value={subject} subjects={subjects} onChange={setSubject} />
          <select
            className="new-record-template-select"
            aria-label="新记录模板"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">无模板</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
          </select>
          <button
            type="button"
            className="primary-button"
            onClick={async () => onOpenRecord(await onCreateRecord(today, subject, selectedTemplate?.contentHtml))}
          >
            <Plus size={18} />
            新建 {subject} 记录
          </button>
        </SurfaceCard>
      </section>

      {entry && (
        <section className="entry-meta-panel">
          <input
            value={entry.title}
            onChange={(event) => onSaveEntry({ ...entry, title: event.target.value })}
            aria-label="今日日志标题"
          />
        </section>
      )}

      <section className="record-list">
        {records.length === 0 ? (
          <div className="empty-state">
            <h2>今天还很干净。</h2>
            <p>新建第一条记录，把刚学到的东西先放下来。</p>
          </div>
        ) : (
          records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              onOpen={onOpenRecord}
              onAskAi={onAskAi}
              onToggleFavorite={(favorite) => onToggleFavorite(record, favorite)}
              reviewState={reviewStatesByRecord[record.id]}
              reviewLogs={reviewLogsByRecord[record.id]}
              onAddReview={() => onAddToReview(record.id)}
            />
          ))
        )}
      </section>

      {dueReviewStates.length > 0 && (
        <section className="review-due-banner">
          <div>
            <CalendarCheck size={22} />
            <span>
              <strong>今天有 {todayDue.length} 条待复习</strong>
              {overdue.length > 0 && <small>另有 {overdue.length} 条已过期</small>}
            </span>
          </div>
          {previewDue.length > 0 && <p>{previewDue.join("、")}</p>}
          <button type="button" className="secondary-button" onClick={onOpenReview}>打开复习队列</button>
        </section>
      )}

      {learningCoachSettings?.dashboardEnabled && !coachDetailOpen && (
        <LearningCoachDashboard
          variant="summary"
          snapshot={learningCoachSnapshot}
          tasks={learningCoachTasks}
          onOpenDetail={() => setCoachDetailOpen(true)}
          onRefresh={() => void refreshCoach()}
          onSkip={() => undefined}
        />
      )}

    </main>
  );
};
