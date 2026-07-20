import { Plus } from "lucide-react";
import { useState } from "react";

import type { Subject, SubjectConfig } from "../types";

interface SubjectPickerProps {
  value?: Subject;
  subjects: SubjectConfig[];
  onChange: (subject: Subject) => void;
  onAddSubject?: (name: string) => Promise<void>;
  disabled?: boolean;
}

export const SubjectPicker = ({ value, subjects, onChange, onAddSubject, disabled = false }: SubjectPickerProps) => {
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const activeSubjects = subjects.filter((subject) => !subject.archivedAt).sort((a, b) => a.order - b.order);

  const add = async () => {
    const name = draft.trim();
    if (!name || !onAddSubject) {
      return;
    }
    try {
      await onAddSubject(name);
      onChange(name);
      setDraft("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加学科失败。");
    }
  };

  return (
    <div className="subject-picker-wrap">
      <div className="subject-picker" aria-label="选择学科">
        {activeSubjects.map((subject) => (
          <button
            key={subject.id}
            type="button"
            className={value === subject.name ? "active" : ""}
            onClick={() => onChange(subject.name)}
            disabled={disabled}
          >
            {subject.name}
          </button>
        ))}
      </div>
      {onAddSubject && (
        <div className="subject-add-row">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="新增学科"
            aria-label="新增学科"
            disabled={disabled}
          />
          <button type="button" className="secondary-button" onClick={() => void add()} disabled={disabled || !draft.trim()}>
            <Plus size={16} />
            添加
          </button>
        </div>
      )}
      {message && <small className="status-message">{message}</small>}
    </div>
  );
};
