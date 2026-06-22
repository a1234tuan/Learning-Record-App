import { ArrowLeft, Edit3, FilePlus, ImagePlus, Pi, Save, Star, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import type { Editor } from "@tiptap/react";

import type { Asset, RecordBlock, Subject, SubjectConfig } from "../types";
import { RichTextEditor } from "../components/RichTextEditor";
import { SubjectPicker } from "../components/SubjectPicker";
import { AudioRecorder } from "../components/AudioRecorder";
import { newId } from "../lib/entity";
import { normalizeRecordContent, syncRecordRefsFromContent } from "../lib/recordContent";

interface RecordEditorPageProps {
  record: RecordBlock;
  onBack: () => void;
  onSave: (record: RecordBlock) => Promise<void>;
  onDelete: (recordId: string) => Promise<void>;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => Promise<void> | void;
  onAddAsset: (file: File, kind: Asset["kind"], title?: string) => Promise<Asset>;
  onAssetChanged?: () => void;
  highlightedAssetId?: string;
  subjects: SubjectConfig[];
  onAddSubject: (name: string) => Promise<void>;
}

export const RecordEditorPage = ({
  record,
  onBack,
  onSave,
  onDelete,
  onToggleFavorite,
  onAddAsset,
  onAssetChanged,
  highlightedAssetId,
  subjects,
  onAddSubject,
}: RecordEditorPageProps) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RecordBlock>(() => syncRecordRefsFromContent({ ...record, mistakeRefs: [] }));
  const [saving, setSaving] = useState(false);
  const recordIdRef = useRef(record.id);

  useEffect(() => {
    if (recordIdRef.current !== record.id) {
      recordIdRef.current = record.id;
      setDraft(syncRecordRefsFromContent({ ...record, mistakeRefs: [] }));
      setEditing(false);
    }
  }, [record]);

  const update = (patch: Partial<RecordBlock>) => setDraft((current) => ({ ...current, ...patch, mistakeRefs: [] }));

  const insertAfterCurrentBlock = (editor: Editor, node: Record<string, unknown>) => {
    const { $from } = editor.state.selection;
    const insertPos = $from.end($from.depth);
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, [node, { type: "paragraph" }])
      .run();
  };

  const addAsset = async (editor: Editor, file: File, kind: Asset["kind"], title = file.name) => {
    const asset = await onAddAsset(file, kind, title);
    insertAfterCurrentBlock(editor, {
      type: "recordAsset",
      attrs: { assetId: asset.id, title: asset.title ?? title, kind },
    });
  };

  const save = async () => {
    setSaving(true);
    const savedDraft = syncRecordRefsFromContent({ ...draft, mistakeRefs: [] });
    await onSave(savedDraft);
    setSaving(false);
  };

  const remove = async () => {
    const ok = window.confirm(`确定删除“${record.title}”吗？\n\n删除后会进入回收站，30 天内可以恢复。`);
    if (!ok) {
      return;
    }
    setSaving(true);
    await onDelete(record.id);
    setSaving(false);
  };

  const toggleFavorite = async () => {
    await onToggleFavorite(record, !record.favorite);
  };

  return (
    <main className="page record-editor-page">
      <section className="record-editor-topbar">
        <button type="button" className="secondary-button" onClick={onBack}>
          <ArrowLeft size={18} />
          返回
        </button>
        {editing ? (
          <div className="record-action-row">
            <button
              type="button"
              className={`icon-button ${record.favorite ? "active" : ""}`}
              onClick={() => void toggleFavorite()}
              disabled={saving}
              aria-label={record.favorite ? "取消收藏" : "收藏记录"}
            >
              <Star size={18} fill={record.favorite ? "currentColor" : "none"} />
            </button>
            <button type="button" className="icon-button danger" onClick={() => void remove()} disabled={saving} aria-label="删除记录">
              <Trash2 size={18} />
            </button>
            <button type="button" className="primary-button" onClick={() => void save()} disabled={saving}>
              <Save size={17} />
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        ) : (
          <div className="record-action-row">
            <button
              type="button"
              className={`icon-button ${record.favorite ? "active" : ""}`}
              onClick={() => void toggleFavorite()}
              aria-label={record.favorite ? "取消收藏" : "收藏记录"}
            >
              <Star size={18} fill={record.favorite ? "currentColor" : "none"} />
            </button>
            <button type="button" className="primary-button" onClick={() => setEditing(true)}>
              <Edit3 size={17} />
              编辑
            </button>
          </div>
        )}
      </section>

      {editing ? (
        <>
          <section className="record-editor-head">
            <input
              value={draft.title}
              onChange={(event) => update({ title: event.target.value })}
              aria-label="记录标题"
            />
            <SubjectPicker value={draft.subject} subjects={subjects} onChange={(subject: Subject) => update({ subject })} onAddSubject={onAddSubject} />
          </section>
          <RichTextEditor
            value={draft.contentHtml}
            onChange={(contentHtml) => update({ contentHtml })}
            placeholder="像笔记页一样，把文字、思路、截图、公式和录音放进同一个记录块..."
            renderInsertTools={(editor) => (
              <>
                <label className="editor-file-button" title="图片">
                  <ImagePlus size={16} />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void addAsset(editor, file, "image");
                      event.target.value = "";
                    }}
                  />
                </label>
                <label className="editor-file-button" title="音频">
                  <Volume2 size={16} />
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void addAsset(editor, file, "audio");
                      event.target.value = "";
                    }}
                  />
                </label>
                <AudioRecorder onRecorded={(file) => void addAsset(editor, file, "audio", "录音")} />
                <label className="editor-file-button" title="附件">
                  <FilePlus size={16} />
                  <input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void addAsset(editor, file, "attachment");
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  title="公式"
                  onClick={() =>
                    insertAfterCurrentBlock(editor, {
                      type: "recordFormula",
                      attrs: { formulaId: newId(), title: "公式", latex: "T(n)=O(n\\log n)" },
                    })
                  }
                >
                  <Pi size={16} />
                </button>
              </>
            )}
          />
        </>
      ) : (
        <article className="record-view-page">
          <header className="record-view-header">
            <p className="eyebrow">{record.date}</p>
            <h1>{record.title}</h1>
            <span>{record.subject}</span>
          </header>
          <RichTextEditor
            value={normalizeRecordContent(record)}
            onChange={() => undefined}
            placeholder=""
            readOnly
            highlightedAssetId={highlightedAssetId}
            onAssetChanged={onAssetChanged}
          />
        </article>
      )}
    </main>
  );
};
