import { useMemo } from "react";
import { Layers } from "lucide-react";

import type { Block, RecordBlock, Subject, SubjectConfig } from "../types";
import { MonthlyHeatmap } from "../components/MonthlyHeatmap";
import { DayLogCard } from "../components/DayLogCard";
import { RecordCard } from "../components/RecordCard";
import { getRecentRecordDates, getRecordBlocks, getRecordsForDateSubject } from "../lib/journalSelectors";
import { PageHeader } from "../components/ui";

interface JournalPageProps {
  blocks: Block[];
  subjects: SubjectConfig[];
  month: Date;
  selectedDate?: string;
  selectedSubject?: Subject;
  onMonthChange: (month: Date) => void;
  onSelectedDateChange: (date: string | undefined) => void;
  onSelectedSubjectChange: (subject: Subject | undefined) => void;
  onOpenRecord: (record: RecordBlock) => void;
  onOpenCategories: () => void;
  onAskAi: (date: string) => void;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => void;
}

export const JournalPage = ({
  blocks,
  subjects,
  month,
  selectedDate,
  selectedSubject,
  onMonthChange,
  onSelectedDateChange,
  onSelectedSubjectChange,
  onOpenRecord,
  onOpenCategories,
  onAskAi,
  onToggleFavorite,
}: JournalPageProps) => {
  const records = useMemo(() => getRecordBlocks(blocks), [blocks]);
  const dates = useMemo(() => getRecentRecordDates(records, 5), [records]);

  const subjectRecords = selectedDate && selectedSubject
    ? getRecordsForDateSubject(records, selectedDate, selectedSubject)
    : [];

  return (
    <main className="page journal-page">
      <PageHeader
        eyebrow="Journal"
        title="日志回看"
        subtitle="用热力图找节奏，用日期和学科回到具体的学习现场。"
      />

      <MonthlyHeatmap
        month={month}
        blocks={blocks}
        selectedDate={selectedDate}
        onMonthChange={onMonthChange}
        onSelectDate={(date) => {
          onSelectedDateChange(date);
          onSelectedSubjectChange(undefined);
        }}
      />

      {selectedDate && selectedSubject ? (
        <section className="record-list-panel page-section-transition">
          <button type="button" className="subtle-button" onClick={() => onSelectedSubjectChange(undefined)}>
            返回学科列表
          </button>
          <h2>{selectedDate} / {selectedSubject}</h2>
          <div className="record-list">
            {subjectRecords.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                onOpen={onOpenRecord}
                onToggleFavorite={(favorite) => onToggleFavorite(record, favorite)}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          <button type="button" className="category-entry-card" onClick={onOpenCategories}>
            <div>
              <span className="eyebrow">Subjects</span>
              <strong>学科分类</strong>
              <small>按学科查看所有历史记录</small>
            </div>
            <Layers size={22} />
          </button>
          <section className="day-log-list">
            {dates.length === 0 ? (
              <div className="empty-state">
                <h2>还没有日志记录。</h2>
                <p>从今天页新建记录后，最近 5 天会显示在这里。</p>
              </div>
            ) : (
              dates.map((date) => (
                <DayLogCard
                  key={date}
                  date={date}
                  records={records.filter((record) => record.date === date)}
                  subjects={subjects}
                  onAskAi={onAskAi}
                  open={selectedDate === date && !selectedSubject}
                  onOpenChange={(open) => onSelectedDateChange(open ? date : undefined)}
                  onOpenSubject={(nextDate, subject) => {
                    onSelectedDateChange(nextDate);
                    onSelectedSubjectChange(subject);
                  }}
                />
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
};
