import { useState } from "react";
import { BrainCircuit } from "lucide-react";

import type { RecordBlock, Subject, SubjectConfig } from "../types";
import { formatChineseDate } from "../lib/date";
import { getSubjectsForRecords } from "../lib/journalSelectors";

interface DayLogCardProps {
  date: string;
  records: RecordBlock[];
  subjects: SubjectConfig[];
  onOpenSubject: (date: string, subject: Subject) => void;
  onAskAi?: (date: string) => void;
}

export const DayLogCard = ({ date, records, subjects, onOpenSubject, onAskAi }: DayLogCardProps) => {
  const [open, setOpen] = useState(false);
  const subjectCounts = getSubjectsForRecords(records, subjects);

  return (
    <article className="day-log-card">
      <div className="day-log-main">
        <button type="button" className="day-log-toggle" onClick={() => setOpen((value) => !value)}>
          <div>
            <span>{formatChineseDate(date)}</span>
            <strong>{date} 学习日志</strong>
          </div>
        </button>
        <span className="day-log-actions">
          {onAskAi && (
            <button
              type="button"
              className="ai-day-button"
              onClick={() => onAskAi(date)}
            >
              <BrainCircuit size={16} />
              AI问答
            </button>
          )}
          <b>{records.length}</b>
        </span>
      </div>
      {open && (
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
