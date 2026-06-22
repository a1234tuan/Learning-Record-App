import { CalendarClock, Plus } from "lucide-react";
import { useState } from "react";

import type { Block, DayEntry, RecordBlock, Subject, SubjectConfig } from "../types";
import { daysUntil, formatChineseDate, todayISO } from "../lib/date";
import { SubjectPicker } from "../components/SubjectPicker";
import { RecordCard } from "../components/RecordCard";
import { fallbackSubjectName } from "../lib/subjects";
import { PageHeader, SurfaceCard } from "../components/ui";

interface TodayPageProps {
  entry: DayEntry | null;
  blocks: Block[];
  examDate: string;
  subjects: SubjectConfig[];
  onSaveEntry: (entry: DayEntry) => void;
  onCreateRecord: (date: string, subject: Subject) => Promise<RecordBlock>;
  onAddSubject: (name: string) => Promise<void>;
  onOpenRecord: (record: RecordBlock) => void;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => void;
}

export const TodayPage = ({
  entry,
  blocks,
  examDate,
  subjects,
  onSaveEntry,
  onCreateRecord,
  onAddSubject,
  onOpenRecord,
  onToggleFavorite,
}: TodayPageProps) => {
  const [subject, setSubject] = useState<Subject>(() =>
    subjects.find((item) => !item.archivedAt)?.name ??
    fallbackSubjectName({ id: "settings", examDate, theme: "system", accentColor: "", backupReminderDays: 7, fontScale: 1, lineHeight: 1.7, subjects }),
  );
  const countdown = daysUntil(examDate);
  const records = blocks.filter((block): block is RecordBlock => block.type === "record");

  return (
    <main className="page today-page">
      <PageHeader
        eyebrow={formatChineseDate(todayISO())}
        title="今天"
        subtitle="把正在发生的学习留下来。文字、截图、公式和录音，都可以自然地放进同一个记录块。"
      />

      <section className="today-workbench">
        <SurfaceCard className="today-goal-card" variant="raised">
          <CalendarClock size={20} />
          <span>距离目标</span>
          <strong>{countdown >= 0 ? `${countdown} 天` : "已结束"}</strong>
        </SurfaceCard>

        <SurfaceCard className="new-record-panel" variant="raised">
          <div>
            <p className="eyebrow">New Record</p>
            <h2>新建学习记录</h2>
            <p>先选择学科，再进入像笔记页一样的线性编辑器。</p>
          </div>
          <SubjectPicker value={subject} subjects={subjects} onChange={setSubject} onAddSubject={onAddSubject} />
          <button
            type="button"
            className="primary-button"
            onClick={async () => onOpenRecord(await onCreateRecord(todayISO(), subject))}
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
              onToggleFavorite={(favorite) => onToggleFavorite(record, favorite)}
            />
          ))
        )}
      </section>
    </main>
  );
};
