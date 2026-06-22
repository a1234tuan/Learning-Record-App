import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, Edit3, Plus, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { Block, RecordBlock, Subject, SubjectConfig } from "../types";
import { formatChineseDate, nowISO } from "../lib/date";
import {
  getRecordBlocks,
  getRecordsBySubject,
  getSubjectCounts,
} from "../lib/journalSelectors";
import { RecordCard } from "../components/RecordCard";

interface CategoriesPageProps {
  blocks: Block[];
  subjects: SubjectConfig[];
  onOpenRecord: (record: RecordBlock) => void;
  onAddSubject: (name: string) => Promise<void>;
  onRenameSubject: (oldName: Subject, newName: Subject) => Promise<void>;
  onSaveSubjects: (subjects: SubjectConfig[]) => Promise<void>;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => void;
}

export const CategoriesPage = ({
  blocks,
  subjects,
  onOpenRecord,
  onAddSubject,
  onRenameSubject,
  onSaveSubjects,
  onToggleFavorite,
}: CategoriesPageProps) => {
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [managing, setManaging] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);
  const [editingName, setEditingName] = useState("");
  const [message, setMessage] = useState("");
  const records = useMemo(() => getRecordBlocks(blocks), [blocks]);
  const subjectCounts = useMemo(() => getSubjectCounts(records, subjects), [records, subjects]);
  const activeRecords = useMemo(
    () => (activeSubject ? getRecordsBySubject(records, activeSubject) : []),
    [activeSubject, records],
  );

  const addSubject = async () => {
    const name = newSubject.trim();
    if (!name) {
      return;
    }
    try {
      await onAddSubject(name);
      setNewSubject("");
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
        setActiveSubject(name);
      }
      setEditingSubject(null);
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
    await updateSubjects(next);
  };

  const toggleArchive = async (subject: SubjectConfig) => {
    await updateSubjects(
      subjects.map((item) =>
        item.id === subject.id
          ? { ...item, archivedAt: item.archivedAt ? undefined : nowISO(), updatedAt: nowISO() }
          : item,
      ),
    );
  };

  const categoryList = subjectCounts.filter((item) => !item.config?.archivedAt || item.count > 0);

  return (
    <main className="page categories-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Categories</p>
          <h1>{managing ? "学科管理" : activeSubject ?? "学科分类"}</h1>
        </div>
        {activeSubject ? (
          <button type="button" className="secondary-button" onClick={() => setActiveSubject(null)}>
            <ArrowLeft size={18} />
            返回分类
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={() => setManaging((value) => !value)}>
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
                </div>
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
              onClick={() => setActiveSubject(subject)}
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
              {activeRecords.map((record) => (
                <div key={record.id} className="dated-record-row">
                  <small>{formatChineseDate(record.date)}</small>
                  <RecordCard
                    record={record}
                    onOpen={onOpenRecord}
                    onToggleFavorite={(favorite) => onToggleFavorite(record, favorite)}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
};
