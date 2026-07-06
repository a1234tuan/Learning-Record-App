import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, Edit3, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Block, RecordBlock, RecordReviewState, Subject, SubjectConfig } from "../types";
import { formatChineseDate, nowISO } from "../lib/date";
import {
  getRecordBlocks,
  getRecordsBySubject,
  getSubjectCounts,
} from "../lib/journalSelectors";
import { RecordCard } from "../components/RecordCard";

const MONTH_RECORD_STEP = 50;

interface CategoriesPageProps {
  blocks: Block[];
  subjects: SubjectConfig[];
  activeSubject: Subject | null;
  managing: boolean;
  onActiveSubjectChange: (subject: Subject | null) => void;
  onManagingChange: (managing: boolean) => void;
  onOpenRecord: (record: RecordBlock) => void;
  onAskAi?: (date: string) => void;
  onAddSubject: (name: string) => Promise<void>;
  onRenameSubject: (oldName: Subject, newName: Subject) => Promise<void>;
  onSaveSubjects: (subjects: SubjectConfig[]) => Promise<void>;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => void;
  reviewStatesByRecord?: Record<string, RecordReviewState>;
  onAddToReview?: (recordId: string) => void;
}

type MonthRecordGroup = {
  month: string;
  records: RecordBlock[];
};

const monthKey = (date: string) => date.slice(0, 7);

const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split("-");
  return `${year}年${monthNumber}月`;
};

const groupRecordsByMonth = (records: RecordBlock[]): MonthRecordGroup[] => {
  const groups = new Map<string, RecordBlock[]>();
  for (const record of records) {
    const key = monthKey(record.date);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return Array.from(groups, ([month, monthRecords]) => ({ month, records: monthRecords }))
    .sort((a, b) => b.month.localeCompare(a.month));
};

export const CategoriesPage = ({
  blocks,
  subjects,
  activeSubject,
  managing,
  onActiveSubjectChange,
  onManagingChange,
  onOpenRecord,
  onAskAi,
  onAddSubject,
  onRenameSubject,
  onSaveSubjects,
  onToggleFavorite,
  reviewStatesByRecord = {},
  onAddToReview = () => undefined,
}: CategoriesPageProps) => {
  const [newSubject, setNewSubject] = useState("");
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [editingName, setEditingName] = useState("");
  const [message, setMessage] = useState("");
  const [pendingDeleteSubjectId, setPendingDeleteSubjectId] = useState<string | null>(null);
  const [subjectRowMessage, setSubjectRowMessage] = useState<{ subjectId: string; message: string } | null>(null);
  const records = useMemo(() => getRecordBlocks(blocks), [blocks]);
  const subjectCounts = useMemo(() => getSubjectCounts(records, subjects), [records, subjects]);
  const activeRecords = useMemo(
    () => (activeSubject ? getRecordsBySubject(records, activeSubject) : []),
    [activeSubject, records],
  );
  const monthGroups = useMemo(() => groupRecordsByMonth(activeRecords), [activeRecords]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const [monthVisibleCounts, setMonthVisibleCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setExpandedMonths(monthGroups[0] ? new Set([monthGroups[0].month]) : new Set());
    setMonthVisibleCounts({});
  }, [activeSubject, monthGroups]);

  const addSubject = async () => {
    const name = newSubject.trim();
    if (!name) {
      return;
    }
    try {
      await onAddSubject(name);
      setNewSubject("");
      setPendingDeleteSubjectId(null);
      setSubjectRowMessage(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加学科失败。");
    }
  };

  const rename = async (oldName: Subject) => {
    const name = editingName.trim();
    if (!name || name === oldName) {
      setEditingSubject(null);
      return;
    }
    try {
      await onRenameSubject(oldName, name);
      if (activeSubject === oldName) {
        onActiveSubjectChange(name);
      }
      setEditingSubject(null);
      setPendingDeleteSubjectId(null);
      setSubjectRowMessage(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重命名失败。");
    }
  };

  const updateSubjects = async (nextSubjects: SubjectConfig[]) => {
    await onSaveSubjects(nextSubjects.map((subject, index) => ({ ...subject, order: index, updatedAt: nowISO() })));
  };

  const moveSubject = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= subjects.length) {
      return;
    }
    const next = [...subjects];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setPendingDeleteSubjectId(null);
    setSubjectRowMessage(null);
    await updateSubjects(next);
  };

  const toggleArchive = async (subject: SubjectConfig) => {
    setPendingDeleteSubjectId(null);
    setSubjectRowMessage(null);
    await updateSubjects(
      subjects.map((item) =>
        item.id === subject.id
          ? { ...item, archivedAt: item.archivedAt ? undefined : nowISO(), updatedAt: nowISO() }
          : item,
      ),
    );
  };

  const deleteSubject = async (subject: SubjectConfig) => {
    const count = subjectCounts.find((item) => item.subject === subject.name)?.count ?? 0;
    if (count > 0) {
      setPendingDeleteSubjectId(null);
      setSubjectRowMessage({
        subjectId: subject.id,
        message: "该学科已有学习记录，不能直接删除。可以先归档、改名，或把记录迁移到其他学科。",
      });
      setMessage("");
      return;
    }
    if (pendingDeleteSubjectId !== subject.id) {
      setPendingDeleteSubjectId(subject.id);
      setSubjectRowMessage({
        subjectId: subject.id,
        message: `确认删除“${subject.name}”？这只会删除学科配置，不会删除记录。`,
      });
      setMessage("");
      return;
    }
    await updateSubjects(subjects.filter((item) => item.id !== subject.id));
    if (activeSubject === subject.name) {
      onActiveSubjectChange(null);
    }
    if (editingSubject === subject.name) {
      setEditingSubject(null);
    }
    setPendingDeleteSubjectId(null);
    setSubjectRowMessage(null);
    setMessage("");
  };

  const cancelDeleteSubject = () => {
    setPendingDeleteSubjectId(null);
    setSubjectRowMessage(null);
  };

  const categoryList = subjectCounts.filter((item) => !item.config?.archivedAt || item.count > 0);

  const toggleMonth = (month: string) => {
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  };

  const showMoreMonthRecords = (month: string) => {
    setMonthVisibleCounts((current) => ({
      ...current,
      [month]: (current[month] ?? MONTH_RECORD_STEP) + MONTH_RECORD_STEP,
    }));
  };

  return (
    <main className="page categories-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Categories</p>
          <h1>{managing ? "学科管理" : activeSubject ?? "学科分类"}</h1>
        </div>
        {activeSubject ? (
          <button type="button" className="secondary-button" onClick={() => onActiveSubjectChange(null)}>
            <ArrowLeft size={18} />
            返回分类
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={() => onManagingChange(!managing)}>
            {managing ? <X size={18} /> : <SlidersHorizontal size={18} />}
            {managing ? "完成" : "管理学科"}
          </button>
        )}
      </section>

      {managing && !activeSubject ? (
        <section className="subject-manager">
          <div className="subject-add-row">
            <input
              value={newSubject}
              onChange={(event) => setNewSubject(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addSubject();
                }
              }}
              placeholder="新增学科，例如：物理、法考、读书"
              aria-label="新增学科"
            />
            <button type="button" className="primary-button" onClick={() => void addSubject()} disabled={!newSubject.trim()}>
              <Plus size={17} />
              添加
            </button>
          </div>
          <div className="subject-manager-list">
            {subjects.map((subject, index) => (
              <article key={subject.id} className="subject-manager-row">
                {editingSubject === subject.name ? (
                  <input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void rename(subject.name);
                      }
                    }}
                    aria-label="编辑学科名称"
                  />
                ) : (
                  <div>
                    <strong>{subject.name}</strong>
                    {subject.archivedAt && <small>已归档，不会出现在新建记录选择器中</small>}
                  </div>
                )}
                <div className="subject-manager-actions">
                  <button type="button" className="icon-button" onClick={() => void moveSubject(index, -1)} disabled={index === 0}>
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" className="icon-button" onClick={() => void moveSubject(index, 1)} disabled={index === subjects.length - 1}>
                    <ArrowDown size={16} />
                  </button>
                  {editingSubject === subject.name ? (
                    <button type="button" className="icon-button" onClick={() => void rename(subject.name)}>
                      <Check size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => {
                        setPendingDeleteSubjectId(null);
                        setSubjectRowMessage(null);
                        setEditingSubject(subject.name);
                        setEditingName(subject.name);
                      }}
                    >
                      <Edit3 size={16} />
                    </button>
                  )}
                  <button type="button" className="icon-button" onClick={() => void toggleArchive(subject)}>
                    {subject.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}
                  </button>
                  <button
                    type="button"
                    className={`icon-button danger${pendingDeleteSubjectId === subject.id ? " active" : ""}`}
                    onClick={() => void deleteSubject(subject)}
                    aria-label={`删除学科 ${subject.name}`}
                    title={pendingDeleteSubjectId === subject.id ? "确认删除学科" : "删除学科"}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {subjectRowMessage?.subjectId === subject.id && (
                  <div className="subject-manager-row-message" role="status">
                    <span>{subjectRowMessage.message}</span>
                    {pendingDeleteSubjectId === subject.id && (
                      <span className="subject-delete-confirm-actions">
                        <button type="button" className="danger" onClick={() => void deleteSubject(subject)}>
                          确认删除
                        </button>
                        <button type="button" onClick={cancelDeleteSubject}>
                          取消
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
          {message && <p className="status-message">{message}</p>}
        </section>
      ) : !activeSubject ? (
        <section className="category-grid page-section-transition">
          {categoryList.map(({ subject, count }) => (
            <button
              key={subject}
              type="button"
              className="category-card"
              onClick={() => onActiveSubjectChange(subject)}
            >
              <span>{subject}</span>
              <b>{count}</b>
            </button>
          ))}
        </section>
      ) : (
        <section className="record-list-panel page-section-transition">
          {activeRecords.length === 0 ? (
            <div className="empty-state">
              <h2>这个学科还没有记录。</h2>
              <p>从今天页新建一个记录块后，它会出现在这里。</p>
            </div>
          ) : (
            <div className="subject-record-timeline">
              {monthGroups.map((group) => {
                const expanded = expandedMonths.has(group.month);
                const visibleCount = monthVisibleCounts[group.month] ?? MONTH_RECORD_STEP;
                const visibleRecords = group.records.slice(0, visibleCount);
                const hiddenCount = group.records.length - visibleRecords.length;
                return (
                  <section key={group.month} className="subject-month-group">
                    <button
                      type="button"
                      className="subject-month-toggle"
                      onClick={() => toggleMonth(group.month)}
                      aria-expanded={expanded}
                    >
                      <span>{monthLabel(group.month)}</span>
                      <small>{group.records.length} 条</small>
                    </button>
                    {expanded && (
                      <div className="subject-month-records">
                        {visibleRecords.map((record) => (
                          <div key={record.id} className="dated-record-row">
                            <small>{formatChineseDate(record.date)}</small>
                            <RecordCard
                              record={record}
                              onOpen={onOpenRecord}
                              onAskAi={onAskAi}
                              onToggleFavorite={(favorite) => onToggleFavorite(record, favorite)}
                              reviewState={reviewStatesByRecord[record.id]}
                              onAddReview={() => onAddToReview(record.id)}
                            />
                          </div>
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            type="button"
                            className="secondary-button subject-month-more"
                            onClick={() => showMoreMonthRecords(group.month)}
                          >
                            显示更多（剩余 {hiddenCount} 条）
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
};
