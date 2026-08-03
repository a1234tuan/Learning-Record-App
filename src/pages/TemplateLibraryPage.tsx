import { ArrowLeft, FilePlus, ImagePlus, LayoutTemplate, Pi, Plus, Save, Trash2, Volume2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";

import type { Asset, ContentTemplate } from "../types";
import { AudioRecorder } from "../components/AudioRecorder";
import { RichTextEditor } from "../components/RichTextEditor";
import { StructureInsertMenu } from "../components/StructureInsertMenu";
import { ActionButton, ListRow, PageHeader, SurfaceCard } from "../components/ui";
import { createBaseEntity, newId } from "../lib/entity";
import { createDefaultComparisonTable, createDefaultStructureDiagram, createDefaultStickyBoard, serializeStructureData, type StructureBlockKind } from "../lib/recordStructureBlocks";

interface TemplateLibraryPageProps {
  templates: readonly ContentTemplate[];
  onBack: () => void;
  onSaveTemplate: (template: ContentTemplate) => Promise<ContentTemplate>;
  onDeleteTemplate: (templateId: string) => Promise<void>;
  onSaveAsset: (file: File, kind: Asset["kind"], title?: string) => Promise<Asset>;
  onRenameAsset: (assetId: string, title: string) => Promise<void> | void;
  onAssetChanged?: () => void;
}

const structureBlockNode = (kind: StructureBlockKind): Record<string, unknown> => {
  switch (kind) {
    case "diagram":
      return { type: "recordStructureDiagram", attrs: { data: serializeStructureData(createDefaultStructureDiagram()) } };
    case "comparison":
      return { type: "recordComparisonTable", attrs: { data: serializeStructureData(createDefaultComparisonTable()) } };
    case "sticky":
      return { type: "recordStickyBoard", attrs: { data: serializeStructureData(createDefaultStickyBoard()) } };
    case "collapse":
      return { type: "recordCollapseBlock", attrs: { title: "折叠块", summary: "", defaultOpen: false, autofocusSummary: true }, content: [{ type: "paragraph" }] };
  }
};

const insertAfterCurrentBlock = (editor: Editor, node: Record<string, unknown>) => {
  const { $from } = editor.state.selection;
  const insertPos = $from.end($from.depth);
  editor.chain().focus().insertContentAt(insertPos, [node, { type: "paragraph" }]).run();
};

const createEmptyTemplate = (): ContentTemplate => ({
  ...createBaseEntity(),
  title: "未命名模板",
  contentHtml: "<p></p>",
});

export const TemplateLibraryPage = ({
  templates,
  onBack,
  onSaveTemplate,
  onDeleteTemplate,
  onSaveAsset,
  onRenameAsset,
  onAssetChanged,
}: TemplateLibraryPageProps) => {
  const [draft, setDraft] = useState<ContentTemplate | null>(null);
  const [saving, setSaving] = useState(false);

  const saveDraft = async () => {
    if (!draft || saving) {
      return;
    }
    setSaving(true);
    try {
      const saved = await onSaveTemplate(draft);
      setDraft(saved);
    } finally {
      setSaving(false);
    }
  };

  const addAsset = useCallback(async (editor: Editor, file: File, kind: Asset["kind"], title = file.name) => {
    const asset = await onSaveAsset(file, kind, title);
    insertAfterCurrentBlock(editor, {
      type: "recordAsset",
      attrs: { assetId: asset.id, title: asset.title ?? title, kind },
    });
    onAssetChanged?.();
  }, [onAssetChanged, onSaveAsset]);

  if (draft) {
    return (
      <main className="page template-editor-page record-editor-page">
        <header className="record-editor-topbar">
          <button type="button" className="icon-button" title="返回模板列表" aria-label="返回模板列表" onClick={() => setDraft(null)}>
            <ArrowLeft size={19} />
          </button>
          <div className="record-action-row">
            <ActionButton variant="primary" onClick={() => void saveDraft()} disabled={saving}>
              <Save size={16} />
              {saving ? "保存中" : "保存"}
            </ActionButton>
          </div>
        </header>

        <section className="record-editor-head template-editor-head">
          <p className="eyebrow">Template</p>
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => current ? { ...current, title: event.target.value } : current)}
            placeholder="模板名称"
            aria-label="模板名称"
          />
        </section>

        <RichTextEditor
          value={draft.contentHtml}
          onChange={(contentHtml) => setDraft((current) => current ? { ...current, contentHtml } : current)}
          placeholder="组合文本、列表、引用、公式、折叠块和资料，建立可复用的学习流程..."
          onAssetTitleChange={onRenameAsset}
          onAssetChanged={onAssetChanged}
          onPasteImage={async (file) => {
            const asset = await onSaveAsset(file, "image", file.name || "剪贴板图片");
            onAssetChanged?.();
            return { id: asset.id, kind: "image", title: (asset.title ?? file.name) || "剪贴板图片" };
          }}
          renderInsertTools={(editor) => (
            <>
              <label className="editor-file-button" title="图片">
                <ImagePlus size={16} />
                <input type="file" accept="image/*" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void addAsset(editor, file, "image");
                  }
                  event.target.value = "";
                }} />
              </label>
              <label className="editor-file-button" title="音频">
                <Volume2 size={16} />
                <input type="file" accept="audio/*" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void addAsset(editor, file, "audio");
                  }
                  event.target.value = "";
                }} />
              </label>
              <AudioRecorder onRecorded={(file) => void addAsset(editor, file, "audio", "录音")} />
              <label className="editor-file-button" title="附件">
                <FilePlus size={16} />
                <input type="file" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void addAsset(editor, file, "attachment");
                  }
                  event.target.value = "";
                }} />
              </label>
              <button
                type="button"
                title="公式"
                onClick={() => insertAfterCurrentBlock(editor, {
                  type: "recordFormula",
                  attrs: { formulaId: newId(), title: "公式", latex: "T(n)=O(n\\log n)" },
                })}
              >
                <Pi size={16} />
              </button>
              <StructureInsertMenu compact onInsert={(kind) => insertAfterCurrentBlock(editor, structureBlockNode(kind))} />
            </>
          )}
        />
      </main>
    );
  }

  return (
    <main className="page template-library-page">
      <PageHeader
        eyebrow="Templates"
        title="模板"
        subtitle="把固定的记录步骤做成可复用的内容组合。"
        density="compact"
        actions={(
          <>
            <button type="button" className="icon-button" title="返回更多" aria-label="返回更多" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
            <ActionButton variant="primary" onClick={() => setDraft(createEmptyTemplate())}>
              <Plus size={16} />
              新建
            </ActionButton>
          </>
        )}
      />

      <section className="template-library-list">
        {templates.length === 0 ? (
          <SurfaceCard className="template-library-empty" variant="plain">
            <LayoutTemplate size={24} />
            <h2>还没有模板</h2>
            <p>新建一个模板，把常用的学习记录流程留在手边。</p>
          </SurfaceCard>
        ) : templates.map((template) => (
          <div key={template.id} className="template-library-row">
            <ListRow
              icon={<LayoutTemplate size={19} />}
              title={template.title}
              description={template.contentHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "空模板"}
              onClick={() => setDraft(template)}
            />
            <button
              type="button"
              className="icon-button danger"
              title={`删除 ${template.title}`}
              aria-label={`删除 ${template.title}`}
              onClick={async () => {
                if (!window.confirm(`删除模板“${template.title}”吗？已插入日志的内容不会受影响。`)) {
                  return;
                }
                await onDeleteTemplate(template.id);
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </section>
    </main>
  );
};
