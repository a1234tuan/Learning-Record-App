import { ArrowLeft, CalendarCheck, Edit3, FilePlus, ImagePlus, MoreHorizontal, Pi, RotateCcw, Save, Star, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import type { Editor } from "@tiptap/react";

import type { Asset, RecordBlock, RecordDraft, RecordReviewKind, RecordReviewLog, RecordReviewState, Subject, SubjectConfig } from "../types";
import { RichTextEditor } from "../components/RichTextEditor";
import { SubjectPicker } from "../components/SubjectPicker";
import { AudioRecorder, type AudioRecorderHandle } from "../components/AudioRecorder";
import { StructureInsertMenu } from "../components/StructureInsertMenu";
import { newId } from "../lib/entity";
import { isoDateTimeToLocalDate, nowISO } from "../lib/date";
import { isNativePlatform } from "../lib/platform";
import { pickNativeGalleryImageFile } from "../lib/nativeImagePicker";
import { normalizeRecordContent, syncRecordRefsFromContent } from "../lib/recordContent";
import { ratingLabel, reviewKindLabel } from "../lib/reviewScheduler";
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
  onSetReviewKind?: (recordId: string, kind: RecordReviewKind) => Promise<void> | void;
  onResetReview?: (recordId: string) => Promise<void> | void;
  onRemoveReview?: (recordId: string) => Promise<void> | void;
}

const cloneRecord = (record: RecordBlock): RecordBlock =>
  syncRecordRefsFromContent({ ...record, mistakeRefs: [] });

const syncEditableRecord = (record: RecordBlock): RecordBlock =>
  syncRecordRefsFromContent({ ...record, mistakeRefs: [] }, { preserveLegacyRefs: false });

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
  onSetReviewKind,
  onResetReview,
  onRemoveReview,
}: RecordEditorPageProps) => {
  const native = isNativePlatform();
  const [editing, setEditingState] = useState(initialEditing);
  const [draft, setDraft] = useState<RecordBlock>(() => cloneRecord(record));
  const [saving, setSaving] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const recordIdRef = useRef(record.id);
  const draftRef = useRef<RecordBlock>(cloneRecord(record));
  const initialEditingRef = useRef(initialEditing);
  const editorRef = useRef<Editor | null>(null);
  const audioRecorderRef = useRef<AudioRecorderHandle | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const draftSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const committingRef = useRef(false);
  const ignoreEditorChangesRef = useRef(false);
  const pendingAssetTasksRef = useRef<Set<Promise<void>>>(new Set());
  const leavingRef = useRef(false);
  const stoppingRecordingRef = useRef<Promise<void> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    initialEditingRef.current = initialEditing;
  }, [initialEditing]);

  const setEditing = useCallback(
    (nextEditing: boolean) => {
      if (nextEditing) {
        ignoreEditorChangesRef.current = false;
        setSaveError(null);
      }
      setMoreActionsOpen(false);
      setEditingState(nextEditing);
      onEditingChange?.(nextEditing);
    },
    [onEditingChange],
  );

  const flushDraft = useCallback(
    async (nextDraft = draftRef.current, options: { force?: boolean } = {}) => {
      if ((!options.force && committingRef.current) || !hasDraftChanges(nextDraft, record)) {
        return;
      }

      const task = draftSaveQueueRef.current.then(async () => {
        if ((!options.force && committingRef.current) || !hasDraftChanges(nextDraft, record)) {
          return;
        }
        await onSaveDraft({
          id: record.id,
          recordId: record.id,
          baseUpdatedAt: record.updatedAt,
          draft: cloneRecord(nextDraft),
          updatedAt: nowISO(),
        });
      });

      draftSaveQueueRef.current = task.catch(() => undefined);
      await task;
    },
    [onSaveDraft, record],
  );

  const scheduleDraftSave = useCallback(
    (nextDraft: RecordBlock) => {
      draftRef.current = nextDraft;
      if (committingRef.current || ignoreEditorChangesRef.current || !hasDraftChanges(nextDraft, record)) {
        return;
      }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushDraft(nextDraft).catch(() => undefined);
      }, 350);
    },
    [flushDraft, record],
  );

  const cancelScheduledDraftSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const waitForDraftSaves = useCallback(async () => {
    await draftSaveQueueRef.current;
  }, []);

  const waitForPendingAssets = useCallback(async () => {
    while (pendingAssetTasksRef.current.size > 0) {
      await Promise.all(Array.from(pendingAssetTasksRef.current));
    }
  }, []);

  const trackAssetTask = useCallback(<T,>(task: Promise<T>): Promise<T> => {
    const tracked = task.then(() => undefined);
    pendingAssetTasksRef.current.add(tracked);
    void tracked.catch(() => undefined).finally(() => {
      pendingAssetTasksRef.current.delete(tracked);
    });
    return task;
  }, []);

  const setCurrentDraft = useCallback(
    (nextDraft: RecordBlock, options: { autosave?: boolean } = {}) => {
      const cleanDraft = syncEditableRecord(nextDraft);
      draftRef.current = cleanDraft;
      setDraft(cleanDraft);
      if (options.autosave !== false) {
        scheduleDraftSave(cleanDraft);
      }
      return cleanDraft;
    },
    [scheduleDraftSave],
  );

  useEffect(() => {
    let cancelled = false;
    const loadDraft = async () => {
      const loadStartedDuringCommit = committingRef.current;
      if (recordIdRef.current !== record.id) {
        recordIdRef.current = record.id;
        setDraftRestored(false);
      }
      const storedDraft = await onGetDraft(record.id);
      if (cancelled) {
        return;
      }
      if (!loadStartedDuringCommit && !committingRef.current && storedDraft && storedDraft.updatedAt > record.updatedAt) {
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
      if (loadStartedDuringCommit || committingRef.current) {
        setDraftRestored(false);
        return;
      }
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
        void flushDraft().catch(() => undefined);
      }
    };
    const flushOnPageHide = () => {
      void flushDraft().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnPageHide);
      cancelScheduledDraftSave();
      void flushDraft().catch(() => undefined);
    };
  }, [cancelScheduledDraftSave, flushDraft]);

  const update = (patch: Partial<RecordBlock>) => {
    if (ignoreEditorChangesRef.current) {
      return;
    }
    setCurrentDraft({ ...draftRef.current, ...patch, mistakeRefs: [] });
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

  const addAsset = useCallback((editor: Editor, file: File, kind: Asset["kind"], title = file.name) => {
    const task = (async () => {
      const asset = await onAddAsset(file, kind, title);
      insertAfterCurrentBlock(editor, {
        type: "recordAsset",
        attrs: { assetId: asset.id, title: asset.title ?? title, kind },
      });
      setCurrentDraft({ ...draftRef.current, contentHtml: editor.getHTML() });
    })();

    return trackAssetTask(task);
  }, [insertAfterCurrentBlock, onAddAsset, setCurrentDraft, trackAssetTask]);

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
      const nextDraft = setCurrentDraft({
        ...draftRef.current,
        contentHtml: `${draftRef.current.contentHtml || "<p></p>"}${recordAssetHtml(asset, "audio", "录音")}`,
      });
      await flushDraft(nextDraft);
    })();

    stoppingRecordingRef.current = task;
    try {
      await task;
    } finally {
      stoppingRecordingRef.current = null;
    }
  }, [addAsset, flushDraft, onAddAsset, setCurrentDraft]);

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
    if (saving) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    committingRef.current = true;
    ignoreEditorChangesRef.current = true;
    let draftToSave: RecordBlock | null = null;
    try {
      cancelScheduledDraftSave();
      await waitForPendingAssets();
      await waitForDraftSaves();

      const editor = editorRef.current;
      draftToSave = syncEditableRecord({
        ...draftRef.current,
        contentHtml: editor && !editor.isDestroyed ? editor.getHTML() : draftRef.current.contentHtml,
      });
      draftRef.current = draftToSave;
      setDraft(draftToSave);

      await onSave(draftToSave);
      await waitForDraftSaves();
      await onDeleteDraft(record.id);
      setDraftRestored(false);
      initialEditingRef.current = false;
      setEditing(false);
    } catch (error) {
      committingRef.current = false;
      ignoreEditorChangesRef.current = false;
      const fallbackDraft = draftToSave ?? draftRef.current;
      draftRef.current = fallbackDraft;
      setDraft(fallbackDraft);
      await flushDraft(fallbackDraft, { force: true }).catch(() => undefined);
      const message = error instanceof Error ? error.message : "未知错误";
      setSaveError(`保存失败，内容已留在草稿中。${message}`);
    } finally {
      committingRef.current = false;
      setSaving(false);
    }
  };

  const discardDraft = async () => {
    cancelScheduledDraftSave();
    await waitForDraftSaves();
    await onDeleteDraft(record.id);
    const clean = cloneRecord(record);
    setDraft(clean);
    draftRef.current = clean;
    setDraftRestored(false);
    setSaveError(null);
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

  const reviewKindText = reviewKindLabel(reviewState?.reviewKind);
  const reviewButtonText = reviewState?.status === "active"
    ? reviewState.nextReviewDate
      ? `${reviewKindText} ${reviewState.nextReviewDate.slice(5)}`
      : reviewKindText
    : reviewState?.status === "mastered"
      ? "已掌握"
      : "加入复习";

  const addReview = async () => {
    await onAddToReview?.(record.id);
  };

  const closeMoreActions = () => setMoreActionsOpen(false);

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
              <button type="button" className="secondary-button collapsible-action" onClick={() => void discardDraft()} disabled={saving}>
                <RotateCcw size={17} />
                丢弃草稿
              </button>
            )}
            {onAddToReview && (
              <button
                type="button"
                className={`secondary-button review-inline-button collapsible-action ${reviewState?.status === "active" ? "active" : ""}`}
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
              className={`icon-button collapsible-action ${record.favorite ? "active" : ""}`}
              onClick={() => void toggleFavorite()}
              disabled={saving}
              aria-label={record.favorite ? "取消收藏" : "收藏记录"}
            >
              <Star size={18} fill={record.favorite ? "currentColor" : "none"} />
            </button>
            <button type="button" className="icon-button danger collapsible-action" onClick={() => void remove()} disabled={saving} aria-label="删除记录">
              <Trash2 size={18} />
            </button>
            <div className="record-more-actions">
              <button
                type="button"
                className={`icon-button ${moreActionsOpen ? "active" : ""}`}
                aria-label={moreActionsOpen ? "收起更多操作" : "更多操作"}
                aria-expanded={moreActionsOpen}
                onClick={() => setMoreActionsOpen((open) => !open)}
                disabled={saving}
              >
                <MoreHorizontal size={18} />
              </button>
              {moreActionsOpen && (
                <div className="record-more-menu">
                  {draftRestored && (
                    <button type="button" onClick={() => void discardDraft().finally(closeMoreActions)} disabled={saving}>
                      <RotateCcw size={16} />
                      丢弃草稿
                    </button>
                  )}
                  {onAddToReview && (
                    <button
                      type="button"
                      onClick={() => {
                        if (reviewState?.status !== "active") {
                          void addReview().finally(closeMoreActions);
                        }
                      }}
                      disabled={saving || reviewState?.status === "active"}
                    >
                      <CalendarCheck size={16} />
                      {reviewButtonText}
                    </button>
                  )}
                  <button type="button" onClick={() => void Promise.resolve(toggleFavorite()).finally(closeMoreActions)} disabled={saving}>
                    <Star size={16} fill={record.favorite ? "currentColor" : "none"} />
                    {record.favorite ? "取消收藏" : "收藏记录"}
                  </button>
                  <button type="button" className="danger" onClick={() => void remove().finally(closeMoreActions)} disabled={saving}>
                    <Trash2 size={16} />
                    删除记录
                  </button>
                </div>
              )}
            </div>
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
                className={`secondary-button review-inline-button collapsible-action ${reviewState?.status === "active" ? "active" : ""}`}
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
              className={`icon-button collapsible-action ${record.favorite ? "active" : ""}`}
              onClick={() => void toggleFavorite()}
              aria-label={record.favorite ? "取消收藏" : "收藏记录"}
            >
              <Star size={18} fill={record.favorite ? "currentColor" : "none"} />
            </button>
            <div className="record-more-actions">
              <button
                type="button"
                className={`icon-button ${moreActionsOpen ? "active" : ""}`}
                aria-label={moreActionsOpen ? "收起更多操作" : "更多操作"}
                aria-expanded={moreActionsOpen}
                onClick={() => setMoreActionsOpen((open) => !open)}
              >
                <MoreHorizontal size={18} />
              </button>
              {moreActionsOpen && (
                <div className="record-more-menu">
                  {onAddToReview && (
                    <button
                      type="button"
                      onClick={() => {
                        if (reviewState?.status !== "active") {
                          void addReview().finally(closeMoreActions);
                        }
                      }}
                      disabled={reviewState?.status === "active"}
                    >
                      <CalendarCheck size={16} />
                      {reviewButtonText}
                    </button>
                  )}
                  <button type="button" onClick={() => void Promise.resolve(toggleFavorite()).finally(closeMoreActions)}>
                    <Star size={16} fill={record.favorite ? "currentColor" : "none"} />
                    {record.favorite ? "取消收藏" : "收藏记录"}
                  </button>
                </div>
              )}
            </div>
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
          {saveError && <p className="status-message draft-status">{saveError}</p>}
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
                  <strong>{reviewKindText}</strong>
                  <small>累计复习 {reviewState?.totalReviews ?? reviewLogs.length} 次</small>
                  {reviewState?.nextReviewDate && <small>下次复习：{reviewState.nextReviewDate}</small>}
                  {reviewLogs[0] && <small>最近评分：{ratingLabel(reviewLogs[0].rating)}</small>}
                </div>
                <div className="record-review-actions">
                  {onSetReviewKind && reviewState && (
                    <div className="review-kind-toggle" role="group" aria-label="复习类型">
                      {(["overview", "memory"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className={(reviewState.reviewKind ?? "overview") === kind ? "active" : ""}
                          onClick={() => {
                            if ((reviewState.reviewKind ?? "overview") !== kind) {
                              void onSetReviewKind(record.id, kind);
                            }
                          }}
                        >
                          {reviewKindLabel(kind)}
                        </button>
                      ))}
                    </div>
                  )}
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
                        <strong>{isoDateTimeToLocalDate(log.reviewedAt)} · {ratingLabel(log.rating)}</strong>
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
