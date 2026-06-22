import { CalendarClock } from "lucide-react";
import { useState } from "react";

import type { Block, DayEntry, RecordBlock, Subject, SubjectConfig } from "../types";
import { daysUntil, formatChineseDate, todayISO } from "../lib/date";
import { SubjectPicker } from "../components/SubjectPicker";
import { RecordCard } from "../components/RecordCard";
import { fallbackSubjectName } from "../lib/subjects";

interface TodayPageProps {
  entry: DayEntry | null;
  blocks: Block[];
  examDate: string;
  subjects: SubjectConfig[];
  onSaveEntry: (entry: DayEntry) => void;
  onCreateRecord: (date: string, subject: Subject) => Promise<RecordBlock>;
  onAddSubject: (name: string) => Promise<void>;
  onOpenRecord: (record: RecordBlock) => void;
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
}: TodayPageProps) => {
  const [subject, setSubject] = useState<Subject>(() => subjects.find((item) => !item.archivedAt)?.name ?? fallbackSubjectName({ id: "settings", examDate, theme: "system", accentColor: "", backupReminderDays: 7, fontScale: 1, lineHeight: 1.7, subjects }));
  const countdown = daysUntil(examDate);
  const records = blocks.filter((block): block is RecordBlock => block.type === "record");

  return (
    <main className="page today-page">
      <section className="today-hero compact-hero">
        <div>
          <p className="eyebrow">{formatChineseDate(todayISO())}</p>
          <h1>今天</h1>
          <p>先把正在发生的学习留下来，别让它散掉。</p>
        </div>
        <div className="hero-stats single-stat">
          <div>
            <CalendarClock size={18} />
            <span>距离目标</span>
            <strong>{countdown >= 0 ? `${countdown} 天` : "已结束"}</strong>
          </div>
        </div>
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

      <section className="new-record-panel">
        <div>
          <p className="eyebrow">New Record</p>
          <h2>新建记录块</h2>
        </div>
        <SubjectPicker value={subject} subjects={subjects} onChange={setSubject} onAddSubject={onAddSubject} />
        <button
          type="button"
          className="primary-button"
          onClick={async () => onOpenRecord(await onCreateRecord(todayISO(), subject))}
        >
          新建 {subject} 记录块
        </button>
      </section>

      <section className="record-list">
        {records.length === 0 ? (
          <div className="empty-state">
            <h2>今天还很干净。</h2>
            <p>先选学科，再新建一个可以同时放文字、图片、公式和音频的记录块。</p>
          </div>
        ) : (
          records.map((record) => <RecordCard key={record.id} record={record} onOpen={onOpenRecord} />)
        )}
      </section>
    </main>
  );
};
