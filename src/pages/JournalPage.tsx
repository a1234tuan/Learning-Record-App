import { useMemo } from "react";
import { Search } from "lucide-react";

import type { Block, RecordBlock, Subject, SubjectConfig } from "../types";
import { MonthlyHeatmap } from "../components/MonthlyHeatmap";
import { DayLogCard } from "../components/DayLogCard";
import { RecordCard } from "../components/RecordCard";
import { getRecordBlocks, getRecordDatesForMonth, getRecordsForDateSubject } from "../lib/journalSelectors";
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
  onOpenSearch: () => void;
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
  onOpenSearch,
  onAskAi,
  onToggleFavorite,
}: JournalPageProps) => {
  const records = useMemo(() => getRecordBlocks(blocks), [blocks]);
  const dates = useMemo(() => getRecordDatesForMonth(records, month), [month, records]);

  const subjectRecords = selectedDate && selectedSubject
    ? getRecordsForDateSubject(records, selectedDate, selectedSubject)
    : [];

  return (
    <main className="page journal-page">
      <PageHeader
        eyebrow="Journal"
        title="日志回看"
        subtitle="用热力图找节奏，用日期和学科回到具体的学习现场。"
        actions={(
          <button type="button" className="secondary-button journal-search-button" onClick={onOpenSearch} title="全局搜索" aria-label="全局搜索">
            <Search size={18} />
            <span>全局搜索</span>
          </button>
        )}
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
                onAskAi={onAskAi}
                onToggleFavorite={(favorite) => onToggleFavorite(record, favorite)}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="journal-day-summary">
            <div>
              <p className="eyebrow">Month Logs</p>
              <h2>本月有记录日期</h2>
            </div>
            <p>仅显示当前月份中有日志记录的日期；切换月份可以回看更早的学习现场。</p>
          </section>
          <section className="day-log-list">
            {dates.length === 0 ? (
              <div className="empty-state">
                <h2>本月还没有日志记录。</h2>
                <p>切换月份查看历史，或者从今天页新建一条记录。</p>
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
