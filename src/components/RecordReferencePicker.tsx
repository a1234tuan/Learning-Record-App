import { ChevronDown, Paperclip, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { RecordBlock, Subject, SubjectConfig } from "../types";

type MonthGroup = {
  month: string;
  records: RecordBlock[];
};

interface RecordReferencePickerProps {
  currentRecordId: string;
  records: readonly RecordBlock[];
  subjects: readonly SubjectConfig[];
  onSelect: (record: RecordBlock) => void;
  onClose: () => void;
}

const monthKey = (date: string): string => date.slice(0, 7);

const monthLabel = (month: string): string => {
  const [year, monthNumber] = month.split("-");
  return `${year}年${monthNumber}月`;
};

const sortRecords = (records: readonly RecordBlock[]): RecordBlock[] =>
  [...records].sort((left, right) => right.date.localeCompare(left.date) || right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title));

const groupRecordsByMonth = (records: readonly RecordBlock[]): MonthGroup[] => {
  const groups = new Map<string, RecordBlock[]>();
  for (const record of records) {
    const month = monthKey(record.date);
    groups.set(month, [...(groups.get(month) ?? []), record]);
  }
  return Array.from(groups, ([month, monthRecords]) => ({ month, records: sortRecords(monthRecords) }))
    .sort((left, right) => right.month.localeCompare(left.month));
};

const subjectLabel = (subject: SubjectConfig | undefined, name: Subject): string =>
  subject?.archivedAt ? `${name}（已归档）` : name;

export const RecordReferencePicker = ({
  currentRecordId,
  records,
  subjects,
  onSelect,
  onClose,
}: RecordReferencePickerProps) => {
  const [query, setQuery] = useState("");
  const [selectedSubject, setSelectedSubject] = useState<Subject | undefined>();
  const [expandedMonth, setExpandedMonth] = useState<string | undefined>();

  const selectableRecords = useMemo(
    () => records.filter((record) => !record.deletedAt && record.id !== currentRecordId),
    [currentRecordId, records],
  );
  const subjectsByName = useMemo(() => new Map(subjects.map((subject) => [subject.name, subject])), [subjects]);
  const subjectNames = useMemo(() => {
    const known = [...subjects]
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .map((subject) => subject.name)
      .filter((name) => selectableRecords.some((record) => record.subject === name));
    const unknown = Array.from(new Set(selectableRecords.map((record) => record.subject)))
      .filter((name) => !subjectsByName.has(name))
      .sort((left, right) => left.localeCompare(right));
    return [...known, ...unknown];
  }, [selectableRecords, subjects, subjectsByName]);
  const monthGroups = useMemo(
    () => selectedSubject ? groupRecordsByMonth(selectableRecords.filter((record) => record.subject === selectedSubject)) : [],
    [selectableRecords, selectedSubject],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchResults = useMemo(
    () => normalizedQuery ? sortRecords(selectableRecords.filter((record) => record.title.toLocaleLowerCase().includes(normalizedQuery))) : [],
    [normalizedQuery, selectableRecords],
  );

  const selectSubject = (subject: Subject) => {
    setSelectedSubject(subject);
    setExpandedMonth(undefined);
  };

  return (
    <div
      className="record-reference-picker-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="record-reference-picker" role="dialog" aria-modal="true" aria-label="引用日志">
        <header>
          <div>
            <p className="eyebrow">Reference</p>
            <h2>引用日志</h2>
          </div>
          <button type="button" className="icon-button" title="关闭" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <label className="record-reference-search">
          <Search size={17} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索日志标题"
            aria-label="搜索日志标题"
          />
        </label>

        {normalizedQuery ? (
          <div className="record-reference-results" aria-label="搜索结果">
            {searchResults.length > 0 ? searchResults.map((record) => (
              <button key={record.id} type="button" className="record-reference-record" onClick={() => onSelect(record)}>
                <Paperclip size={15} aria-hidden="true" />
                <span>
                  <strong>{record.title || "未命名日志"}</strong>
                  <small>{record.subject} · {record.date}</small>
                </span>
              </button>
            )) : <p className="record-reference-empty">没有匹配的日志标题。</p>}
          </div>
        ) : (
          <div className="record-reference-browser">
            <aside className="record-reference-subjects" aria-label="按学科筛选">
              {subjectNames.length > 0 ? subjectNames.map((subject) => (
                <button
                  key={subject}
                  type="button"
                  className={selectedSubject === subject ? "active" : ""}
                  onClick={() => selectSubject(subject)}
                >
                  {subjectLabel(subjectsByName.get(subject), subject)}
                </button>
              )) : <p className="record-reference-empty">暂无可引用的日志。</p>}
            </aside>
            <section className="record-reference-months" aria-label="按月份筛选">
              {selectedSubject ? monthGroups.map((group) => {
                const expanded = expandedMonth === group.month;
                return (
                  <div key={group.month} className="record-reference-month">
                    <button
                      type="button"
                      className="record-reference-month-toggle"
                      aria-expanded={expanded}
                      onClick={() => setExpandedMonth(expanded ? undefined : group.month)}
                    >
                      <span>{monthLabel(group.month)}</span>
                      <small>{group.records.length} 条</small>
                      <ChevronDown size={16} className={expanded ? "expanded" : ""} />
                    </button>
                    {expanded && (
                      <div className="record-reference-results">
                        {group.records.map((record) => (
                          <button key={record.id} type="button" className="record-reference-record" onClick={() => onSelect(record)}>
                            <Paperclip size={15} aria-hidden="true" />
                            <span>
                              <strong>{record.title || "未命名日志"}</strong>
                              <small>{record.date}</small>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }) : <p className="record-reference-empty">选择一个学科后，按月份查找日志。</p>}
            </section>
          </div>
        )}
      </section>
    </div>
  );
};
