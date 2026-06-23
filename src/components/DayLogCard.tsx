import { useState } from "react";
import { BrainCircuit, ChevronDown } from "lucide-react";

import type { RecordBlock, Subject, SubjectConfig } from "../types";
import { formatChineseDate } from "../lib/date";
import { getSubjectsForRecords } from "../lib/journalSelectors";

interface DayLogCardProps {
  date: string;
  records: RecordBlock[];
  subjects: SubjectConfig[];
  onOpenSubject: (date: string, subject: Subject) => void;
  onAskAi?: (date: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const DayLogCard = ({ date, records, subjects, onOpenSubject, onAskAi, open, onOpenChange }: DayLogCardProps) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const subjectCounts = getSubjectsForRecords(records, subjects);
  const toggleOpen = () => {
    const nextOpen = !isOpen;
    if (open === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  return (
    <article className={`day-log-card ${isOpen ? "open" : ""}`}>
      <div className="day-log-main">
        <button type="button" className="day-log-toggle" onClick={toggleOpen}>
          <span className="day-log-date">{formatChineseDate(date)}</span>
          <strong>{date} 学习日志</strong>
          <small>{subjectCounts.length} 个学科 · {records.length} 条记录</small>
        </button>
        <span className="day-log-actions">
          {onAskAi && (
            <button type="button" className="ai-day-button" onClick={() => onAskAi(date)}>
              <BrainCircuit size={16} />
              AI问答
            </button>
          )}
          <b>{records.length}</b>
          <ChevronDown size={17} />
        </span>
      </div>
      {isOpen && (
        <div className="subject-log-list">
          {subjectCounts.map(({ subject, count }) => (
            <button key={subject} type="button" onClick={() => onOpenSubject(date, subject)}>
              <span>{subject}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>
      )}
    </article>
  );
};
