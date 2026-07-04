import { CalendarCheck, CalendarClock, Plus, Star } from "lucide-react";
import { useState } from "react";

import type { Block, DayEntry, RecordBlock, RecordReviewState, Subject, SubjectConfig } from "../types";
import { daysUntil, formatChineseDate, todayISO } from "../lib/date";
import { SubjectPicker } from "../components/SubjectPicker";
import { RecordCard } from "../components/RecordCard";
import { fallbackSubjectName } from "../lib/subjects";
import { PageHeader, SurfaceCard } from "../components/ui";
import { getDailyMotto } from "../lib/dailyMotto";

interface TodayPageProps {
  entry: DayEntry | null;
  blocks: Block[];
  examDate: string;
  subjects: SubjectConfig[];
  onSaveEntry: (entry: DayEntry) => void;
  onCreateRecord: (date: string, subject: Subject) => Promise<RecordBlock>;
  onOpenFavorites: () => void;
  onOpenRecord: (record: RecordBlock) => void;
  onOpenReview?: () => void;
  onAskAi?: (date: string) => void;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => void;
  reviewStatesByRecord?: Record<string, RecordReviewState>;
  dueReviewStates?: RecordReviewState[];
  reviewTitlesByRecord?: Record<string, string>;
  onAddToReview?: (recordId: string) => void;
}

export const TodayPage = ({
  entry,
  blocks,
  examDate,
  subjects,
  onSaveEntry,
  onCreateRecord,
  onOpenFavorites,
  onOpenRecord,
  onOpenReview = () => undefined,
  onAskAi,
  onToggleFavorite,
  reviewStatesByRecord = {},
  dueReviewStates = [],
  reviewTitlesByRecord = {},
  onAddToReview = () => undefined,
}: TodayPageProps) => {
  const [subject, setSubject] = useState<Subject>(() =>
    subjects.find((item) => !item.archivedAt)?.name ??
    fallbackSubjectName({ id: "settings", examDate, theme: "system", accentColor: "", backupReminderDays: 7, fontScale: 1, lineHeight: 1.7, subjects }),
  );
  const countdown = daysUntil(examDate);
  const today = todayISO();
  const records = blocks.filter((block): block is RecordBlock => block.type === "record");
  const todayDue = dueReviewStates.filter((review) => review.nextReviewDate === today);
  const overdue = dueReviewStates.filter((review) => review.nextReviewDate && review.nextReviewDate < today);
  const previewDue = dueReviewStates.slice(0, 3).map((review) => reviewTitlesByRecord[review.recordId]).filter(Boolean);

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
            <p>先选择学科，再进入像笔记页一样的线性编辑器。</p>
            <p className="helper-text">更多学科可到“分类 / 学科管理”中新建。</p>
          </div>
          <SubjectPicker value={subject} subjects={subjects} onChange={setSubject} />
          <button
            type="button"
            className="primary-button"
            onClick={async () => onOpenRecord(await onCreateRecord(today, subject))}
          >
            <Plus size={18} />
            新建 {subject} 记录
          </button>
        </SurfaceCard>
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
          <button type="button" className="primary-button" onClick={onOpenReview}>
            开始复习
          </button>
        </section>
      )}

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
              onAddReview={() => onAddToReview(record.id)}
            />
          ))
        )}
      </section>
    </main>
  );
};
