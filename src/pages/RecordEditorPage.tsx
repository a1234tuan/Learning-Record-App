import { ArrowLeft, CalendarCheck, Edit3, FilePlus, ImagePlus, Pi, RotateCcw, Save, Star, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import type { Editor } from "@tiptap/react";

import type { Asset, RecordBlock, RecordDraft, RecordReviewLog, RecordReviewState, Subject, SubjectConfig } from "../types";
import { RichTextEditor } from "../components/RichTextEditor";
import { SubjectPicker } from "../components/SubjectPicker";
import { AudioRecorder, type AudioRecorderHandle } from "../components/AudioRecorder";
import { StructureInsertMenu } from "../components/StructureInsertMenu";
import { newId } from "../lib/entity";
import { nowISO } from "../lib/date";
import { isNativePlatform } from "../lib/platform";
import { pickNativeGalleryImageFile } from "../lib/nativeImagePicker";
import { normalizeRecordContent, syncRecordRefsFromContent } from "../lib/recordContent";
import {
  createDefaultComparisonTable,
  createDefaultStickyBoard,
  createDefaultStructureDiagram,
  serializeStructureData,
  type StructureBlockKind,
} from "../lib/recordStructureBlocks";
import {
  canUseNativeAudioRecorder,
  getNativeAudioRecordingStatus,
  stopNativeAudioRecording,
} from "../services/nativeAudioRecorder";

interface RecordEditorPageProps {
  record: RecordBlock;
  initialEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onBack: () => void;
  onSave: (record: RecordBlock) => Promise<RecordBlock | void>;
  onDelete: (recordId: string) => Promise<void>;
  onToggleFavorite: (record: RecordBlock, favorite: boolean) => Promise<void> | void;
  onAddAsset: (file: File, kind: Asset["kind"], title?: string) => Promise<Asset>;
  onAssetTitleChange?: (assetId: string, title: string) => Promise<void> | void;
  onAssetChanged?: () => void;
  highlightedAssetId?: string;
  subjects: SubjectConfig[];
  onGetDraft: (recordId: string) => Promise<RecordDraft | undefined>;
  onSaveDraft: (draft: RecordDraft) => Promise<RecordDraft>;
  onDeleteDraft: (recordId: string) => Promise<void>;
  reviewState?: RecordReviewState;
  reviewLogs?: RecordReviewLog[];
  onAddToReview?: (recordId: string) => Promise<void> | void;
  onResetReview?: (recordId: string) => Promise<void> | void;
  onRemoveReview?: (recordId: string) => Promise<void> | void;
}

const cloneRecord = (record: RecordBlock): RecordBlock =>
  syncRecordRefsFromContent({ ...record, mistakeRefs: [] });

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const recordAssetHtml = (asset: Asset, kind: Asset["kind"], title: string): string =>
  `<record-asset data-asset-id="${escapeAttribute(asset.id)}" data-kind="${escapeAttribute(kind)}" data-title="${escapeAttribute(asset.title ?? title)}"></record-asset><p></p>`;

const structureBlockNode = (kind: StructureBlockKind): Record<string, unknown> => {
  switch (kind) {
    case "diagram":
      return {
        type: "recordStructureDiagram",
        attrs: { data: serializeStructureData(createDefaultStructureDiagram()) },
      };
    case "comparison":
      return {
        type: "recordComparisonTable",
        attrs: { data: serializeStructureData(createDefaultComparisonTable()) },
      };
    case "sticky":
      return {
        type: "recordStickyBoard",
        attrs: { data: serializeStructureData(createDefaultStickyBoard()) },
      };
    case "collapse":
      return {
        type: "recordCollapseBlock",
        attrs: { title: "折叠块", summary: "", defaultOpen: false },
        content: [{ type: "paragraph" }],
      };
  }
};

const hasDraftChanges = (draft: RecordBlock, record: RecordBlock) =>
  draft.title !== record.title ||
  draft.subject !== record.subject ||
  draft.contentHtml !== record.contentHtml ||
  JSON.stringify(draft.assets) !== JSON.stringify(record.assets) ||
  JSON.stringify(draft.formulas) !== JSON.stringify(record.formulas);

export const RecordEditorPage = ({
  record,
  initialEditing = false,
  onEditingChange,
  onBack,
  onSave,
  onDelete,
  onToggleFavorite,
  onAddAsset,
  onAssetTitleChange,
  onAssetChanged,
  highlightedAssetId,
  subjects,
  onGetDraft,
  onSaveDraft,
  onDeleteDraft,
  reviewState,
  reviewLogs = [],
  onAddToReview,
  onResetReview,
  onRemoveReview,
}: RecordEditorPageProps) => {
  const native = isNativePlatform();
  const [editing, setEditingState] = useState(initialEditing);
  const [draft, setDraft] = useState<RecordBlock>(() => cloneRecord(record));
  const [saving, setSaving] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const recordIdRef = useRef(record.id);
  const draftRef = useRef<RecordBlock>(cloneRecord(record));
  const initialEditingRef = useRef(initialEditing);
  const editorRef = useRef<Editor | null>(null);
  const audioRecorderRef = useRef<AudioRecorderHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const flushingRef = useRef(false);
  const leavingRef = useRef(false);
  const stoppingRecordingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    initialEditingRef.current = initialEditing;
  }, [initialEditing]);

  const setEditing = useCallback(
    (nextEditing: boolean) => {
      setEditingState(nextEditing);
      onEditingChange?.(nextEditing);
    },
    [onEditingChange],
  );

  const flushDraft = useCallback(
    async (nextDraft = draftRef.current) => {
      if (flushingRef.current || !hasDraftChanges(nextDraft, record)) {
        return;
      }
      flushingRef.current = true;
      try {
        await onSaveDraft({
          id: record.id,
          recordId: record.id,
          baseUpdatedAt: record.updatedAt,
          draft: cloneRecord(nextDraft),
          updatedAt: nowISO(),
        });
      } finally {
        flushingRef.current = false;
      }
    },
    [onSaveDraft, record],
  );

  const scheduleDraftSave = useCallback(
    (nextDraft: RecordBlock) => {
      draftRef.current = nextDraft;
      if (!hasDraftChanges(nextDraft, record)) {
        return;
      }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushDraft(nextDraft);
      }, 350);
    },
    [flushDraft, record],
  );

  useEffect(() => {
    let cancelled = false;
    const loadDraft = async () => {
      if (recordIdRef.current !== record.id) {
        recordIdRef.current = record.id;
        setDraftRestored(false);
      }
      const storedDraft = await onGetDraft(record.id);
      if (cancelled) {
        return;
      }
      if (storedDraft && storedDraft.updatedAt > record.updatedAt) {
        const restored = cloneRecord(storedDraft.draft);
        setDraft(restored);
        draftRef.current = restored;
        setEditing(true);
        setDraftRestored(true);
        return;
      }
      const clean = cloneRecord(record);
      setDraft(clean);
      draftRef.current = clean;
      setEditing(initialEditingRef.current);
      setDraftRestored(false);
    };

    void loadDraft();

    return () => {
      cancelled = true;
    };
  }, [onGetDraft, record, setEditing]);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") {
        void flushDraft();
      }
    };
    const flushOnPageHide = () => {
      void flushDraft();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnPageHide);
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushDraft();
    };
  }, [flushDraft]);

  const update = (patch: Partial<RecordBlock>) => {
    setDraft((current) => {
      const next = { ...current, ...patch, mistakeRefs: [] };
      scheduleDraftSave(next);
      return next;
    });
  };

  const insertAfterCurrentBlock = useCallback((editor: Editor, node: Record<string, unknown>) => {
    const { $from } = editor.state.selection;
    const insertPos = $from.end($from.depth);
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, [node, { type: "paragraph" }])
      .run();
  }, []);

  const addAsset = useCallback(async (editor: Editor, file: File, kind: Asset["kind"], title = file.name) => {
    const asset = await onAddAsset(file, kind, title);
    insertAfterCurrentBlock(editor, {
      type: "recordAsset",
      attrs: { assetId: asset.id, title: asset.title ?? title, kind },
    });
    const nextDraft = cloneRecord({ ...draftRef.current, contentHtml: editor.getHTML() });
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    scheduleDraftSave(nextDraft);
  }, [insertAfterCurrentBlock, onAddAsset, scheduleDraftSave]);

  const pickNativeEditorImage = useCallback(async (editor: Editor) => {
    try {
      const file = await pickNativeGalleryImageFile("record-gallery-image");
      if (file) {
        await addAsset(editor, file, "image");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      window.alert(`图片选择失败：${message}`);
    }
  }, [addAsset]);

  const stopRecordingIntoDraft = useCallback(async () => {
    if (stoppingRecordingRef.current) {
      return stoppingRecordingRef.current;
    }

    const task = (async () => {
      let file = await audioRecorderRef.current?.stopAndGetFile();
      if (!file && canUseNativeAudioRecorder()) {
        const nativeStatus = await getNativeAudioRecordingStatus().catch(() => ({ recording: false }));
        if (nativeStatus.recording) {
          file = await stopNativeAudioRecording().catch(() => null);
        }
      }
      if (!file) {
        return;
      }

      const editor = editorRef.current;
      if (editor && !editor.isDestroyed) {
        await addAsset(editor, file, "audio", "录音");
        await flushDraft();
        return;
      }

      const asset = await onAddAsset(file, "audio", "录音");
      const nextDraft = cloneRecord({
        ...draftRef.current,
        contentHtml: `${draftRef.current.contentHtml || "<p></p>"}${recordAssetHtml(asset, "audio", "录音")}`,
      });
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      scheduleDraftSave(nextDraft);
      await flushDraft(nextDraft);
    })();

    stoppingRecordingRef.current = task;
    try {
      await task;
    } finally {
      stoppingRecordingRef.current = null;
    }
  }, [addAsset, flushDraft, onAddAsset, scheduleDraftSave]);

  const back = async () => {
    if (leavingRef.current) {
      return;
    }
    leavingRef.current = true;
    try {
      await stopRecordingIntoDraft();
      await flushDraft();
      onBack();
    } finally {
      leavingRef.current = false;
    }
  };

  useEffect(() => () => {
    void stopRecordingIntoDraft();
  }, [stopRecordingIntoDraft]);

  const save = async () => {
    setSaving(true);
    try {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      await flushDraft();
      const savedDraft = cloneRecord(draftRef.current);
      initialEditingRef.current = false;
      setEditing(false);
      await onSave(savedDraft);
      await onDeleteDraft(record.id);
      setDraftRestored(false);
    } finally {
      setSaving(false);
    }
  };

  const discardDraft = async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await onDeleteDraft(record.id);
    const clean = cloneRecord(record);
    setDraft(clean);
    draftRef.current = clean;
    setDraftRestored(false);
    setEditing(false);
  };

  const remove = async () => {
    const ok = window.confirm(`确定删除“${record.title}”吗？\n\n删除后会进入回收站，30 天内可以恢复。`);
    if (!ok) {
      return;
    }
    setSaving(true);
    await onDeleteDraft(record.id);
    await onDelete(record.id);
    setSaving(false);
  };

  const toggleFavorite = async () => {
    await onToggleFavorite(record, !record.favorite);
  };

  const reviewButtonText = reviewState?.status === "active"
    ? `连续记住 ${reviewState.consecutiveRemembered}/5`
    : reviewState?.status === "mastered"
      ? "已掌握"
      : "加入复习";

  const addReview = async () => {
    await onAddToReview?.(record.id);
  };

  return (
    <main className="page record-editor-page">
      <section className="record-editor-topbar">
        <button type="button" className="secondary-button" onClick={() => void back()}>
          <ArrowLeft size={18} />
          返回
        </button>
        {editing ? (
          <div className="record-action-row">
            {draftRestored && (
              <button type="button" className="secondary-button" onClick={() => void discardDraft()} disabled={saving}>
                <RotateCcw size={17} />
                丢弃草稿
              </button>
            )}
            {onAddToReview && (
              <button
                type="button"
                className={`secondary-button review-inline-button ${reviewState?.status === "active" ? "active" : ""}`}
                onClick={() => {
                  if (reviewState?.status !== "active") {
                    void addReview();
                  }
                }}
                disabled={saving}
              >
                <CalendarCheck size={17} />
                {reviewButtonText}
              </button>
            )}
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
            {onAddToReview && (
              <button
                type="button"
                className={`secondary-button review-inline-button ${reviewState?.status === "active" ? "active" : ""}`}
                onClick={() => {
                  if (reviewState?.status !== "active") {
                    void addReview();
                  }
                }}
              >
                <CalendarCheck size={17} />
                {reviewButtonText}
              </button>
            )}
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
          {draftRestored && <p className="status-message draft-status">已恢复未保存草稿，点击保存后才会写入正式记录。</p>}
          <section className="record-editor-head">
            <input value={draft.title} onChange={(event) => update({ title: event.target.value })} aria-label="记录标题" />
            <SubjectPicker value={draft.subject} subjects={subjects} onChange={(subject: Subject) => update({ subject })} />
          </section>
          <RichTextEditor
            value={draft.contentHtml}
            onChange={(contentHtml) => update({ contentHtml })}
            placeholder="像笔记页一样，把文字、思路、截图、公式和录音放进同一个记录块..."
            onAssetTitleChange={onAssetTitleChange}
            renderInsertTools={(editor) => {
              editorRef.current = editor;
              return (
              <>
                {native ? (
                  <button type="button" className="editor-file-button" title="图片" onClick={() => void pickNativeEditorImage(editor)}>
                    <ImagePlus size={16} />
                  </button>
                ) : (
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
                )}
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
                <AudioRecorder ref={audioRecorderRef} onRecorded={(file) => void addAsset(editor, file, "audio", "录音")} />
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
                <StructureInsertMenu
                  compact
                  onInsert={(kind) => insertAfterCurrentBlock(editor, structureBlockNode(kind))}
                />
              </>
              );
            }}
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
            onAssetTitleChange={onAssetTitleChange}
          />
          {(reviewState || reviewLogs.length > 0) && (
            <section className="record-review-panel">
              <details open>
                <summary>复习进度</summary>
                <div className="record-review-summary">
                  <span>{reviewState?.status === "mastered" ? "已掌握" : reviewState?.status === "active" ? "复习中" : "未在队列中"}</span>
                  <strong>连续记住 {reviewState?.consecutiveRemembered ?? 0}/5</strong>
                  <small>累计复习 {reviewState?.totalReviews ?? reviewLogs.length} 次</small>
                  {reviewState?.nextReviewDate && <small>下次复习：{reviewState.nextReviewDate}</small>}
                </div>
                <div className="record-review-actions">
                  {onResetReview && (
                    <button type="button" className="secondary-button" onClick={() => void onResetReview(record.id)}>
                      <RotateCcw size={16} />
                      重置复习
                    </button>
                  )}
                  {onRemoveReview && reviewState?.status === "active" && (
                    <button type="button" className="secondary-button danger" onClick={() => void onRemoveReview(record.id)}>
                      移出复习队列
                    </button>
                  )}
                </div>
                {reviewLogs.length > 0 && (
                  <div className="record-review-history">
                    {reviewLogs.slice(0, 12).map((log) => (
                      <article key={log.id}>
                        <strong>{log.reviewedAt.slice(0, 10)} · {log.rating === "remembered" ? "记住了" : log.rating === "fuzzy" ? "模糊" : "忘了"}</strong>
                        <small>间隔 {log.previousIntervalDays} 天 → {log.nextIntervalDays} 天</small>
                      </article>
                    ))}
                  </div>
                )}
              </details>
            </section>
          )}
        </article>
      )}
    </main>
  );
};
