import { BrainCircuit, ChevronDown, ChevronUp, Copy, FileJson, FileText, Headphones, MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AppSettings, ExportKind, KnowledgePodcastModeTemplate } from "../types";
import { exportKnowledge } from "../services/knowledgeExportService";
import { storage } from "../services/storageAdapter";
import { AiSettingsPanel } from "../components/AiSettingsPanel";
import { TtsSettingsPanel } from "../components/TtsSettingsPanel";
import { ListRow, PageHeader } from "../components/ui";
import { createBaseEntity } from "../lib/entity";
import { buildPodcastPromptPreview, getPodcastCreativeBriefDefaults, PODCAST_TEMPLATE_VARIABLES, validatePodcastModeTemplate } from "../services/knowledgePodcastService";

interface AiToolsPageProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
  onOpenAi: () => void;
  onOpenPodcasts: () => void;
}

type AiExportKind = Exclude<ExportKind, "full-backup">;

const AI_EXPORT_OPTIONS: Array<{ kind: AiExportKind; label: string; helper: string }> = [
  {
    kind: "subject-markdown",
    label: "按学科 Markdown",
    helper: "生成 subjects/学科.md，适合直接喂给 AI 做复习提问。",
  },
  {
    kind: "knowledge-json",
    label: "知识库 JSON",
    helper: "保留日期、学科、正文、公式、资源标题和图片 OCR 文本，方便后续接本地知识库问答。",
  },
  {
    kind: "plain-text",
    label: "纯文本 TXT",
    helper: "生成一个可复制的纯文本总文件，适合快速发给 AI。",
  },
];

export const AiToolsPage = ({ settings, onChanged, onOpenAi, onOpenPodcasts }: AiToolsPageProps) => {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<AiExportKind | null>(null);
  const [aiKind, setAiKind] = useState<AiExportKind>("subject-markdown");
  const [exportOpen, setExportOpen] = useState(false);
  const [podcastModes, setPodcastModes] = useState<KnowledgePodcastModeTemplate[]>(settings.knowledgePodcastModeTemplates ?? []);
  const modePromptRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const selectedOption = AI_EXPORT_OPTIONS.find((item) => item.kind === aiKind);

  useEffect(() => {
    setPodcastModes(settings.knowledgePodcastModeTemplates ?? []);
  }, [settings]);

  const updatePodcastMode = (id: string, patch: Partial<KnowledgePodcastModeTemplate>) => {
    setPodcastModes((current) => current.map((mode) => mode.id === id ? { ...mode, ...patch } : mode));
  };

  const addPodcastMode = () => {
    setPodcastModes((current) => [...current, {
      ...createBaseEntity(),
      title: "新播客模式",
      prompt: "请围绕来源记录，用自然、清晰的方式组织讲解。",
      order: current.length,
    }]);
  };

  const duplicatePodcastMode = (id: string) => {
    setPodcastModes((current) => {
      const source = current.find((mode) => mode.id === id);
      if (!source) return current;
      const index = current.indexOf(source);
      const copy: KnowledgePodcastModeTemplate = {
        ...source,
        ...createBaseEntity(),
        title: `${source.title || "自定义模式"} 副本`,
        order: index + 1,
      };
      return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)].map((mode, order) => ({ ...mode, order }));
    });
  };

  const movePodcastMode = (id: string, direction: -1 | 1) => {
    setPodcastModes((current) => {
      const index = current.findIndex((mode) => mode.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((mode, order) => ({ ...mode, order }));
    });
  };

  const insertPodcastTemplateVariable = (id: string, token: string) => {
    const textarea = modePromptRefs.current.get(id);
    const start = textarea?.selectionStart ?? podcastModes.find((mode) => mode.id === id)?.prompt.length ?? 0;
    const end = textarea?.selectionEnd ?? start;
    setPodcastModes((current) => current.map((mode) => mode.id !== id ? mode : {
      ...mode,
      prompt: `${mode.prompt.slice(0, start)}${token}${mode.prompt.slice(end)}`,
    }));
    window.requestAnimationFrame(() => {
      const input = modePromptRefs.current.get(id);
      if (!input) return;
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const savePodcastModes = async () => {
    const normalized = podcastModes.map((mode, order) => ({
      ...mode,
      title: mode.title.trim(),
      prompt: mode.prompt.trim(),
      order,
      updatedAt: new Date().toISOString(),
    }));
    const invalidMode = normalized.find((mode) => !mode.title || !mode.prompt || validatePodcastModeTemplate(mode.prompt).length);
    if (invalidMode) {
      const unsupported = validatePodcastModeTemplate(invalidMode.prompt);
      setMessage(unsupported.length ? `“${invalidMode.title || "未命名模式"}”包含不支持的变量：${unsupported.join("、")}。` : "每个播客模式都需要标题和 Prompt。");
      return;
    }
    await storage.saveSettings({ ...settings, knowledgePodcastModeTemplates: normalized });
    await onChanged();
    setMessage("知识播客自定义模式已保存。已有播客会继续使用创建时的模式快照。");
  };

  const exportAiMaterial = async () => {
    setBusy(aiKind);
    setMessage("");
    try {
      const result = await exportKnowledge(aiKind, await storage.createSnapshot());
      setMessage(`${result} AI 材料仅用于阅读和问答，不用于恢复。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 材料导出失败。");
    } finally {
      setBusy(null);
    }
  };

  const previewPodcastMode = (mode: KnowledgePodcastModeTemplate): { value?: string; error?: string } => {
    try {
      return {
        value: buildPodcastPromptPreview({
          mode: "custom",
          customMode: { templateId: mode.id, title: mode.title || "示例模式", prompt: mode.prompt },
          creativeBrief: {
            ...getPodcastCreativeBriefDefaults("explain"),
            mustCover: "概念联系和常见误区",
            supplementaryRequirements: "示例：重点说明适用条件。",
          },
          targetMinutes: 5,
          scopeTitle: "示例：最近 7 天的学习记录",
        }),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "无法预览该模板。" };
    }
  };

  return (
    <main className="page ai-tools-page">
      <PageHeader
        eyebrow="AI Tools"
        title="AI 工具"
        subtitle="聊天记录、供应商设置和材料导出集中在这里。"
        density="compact"
      />

      <section className="more-section">
        <h2>聊天</h2>
        <div className="more-list">
          <ListRow
            icon={<MessageSquare size={19} />}
            title="AI 问答与聊天记录"
            description="继续问答，或查看、删除本机保存的 AI 对话"
            onClick={onOpenAi}
          />
          <ListRow icon={<Headphones size={19} />} title="知识播客" description="把本地记录整理成可编辑、可回溯的知识音频" onClick={onOpenPodcasts} />
        </div>
      </section>

      <AiSettingsPanel settings={settings} onChanged={onChanged} />

      <TtsSettingsPanel settings={settings} onChanged={onChanged} />

      <section className="ai-settings-panel podcast-mode-settings">
        <div className="ai-settings-body">
          <header className="inline-section-header">
            <div><h3>知识播客高级模板工作台</h3><p>创建可复用的创作指令。可插入策划变量；知识范围、来源追溯和固定 JSON 结构始终由系统强制追加。</p></div>
          </header>
          <p className="helper-text">模板只控制角色、讲解角度、叙事方式和章节侧重点。没有插入“完整策划摘要”时，系统会在模板后自动追加本期策划，避免遗漏默认策划台的要求。</p>
          <div className="podcast-template-variable-list" aria-label="可用播客模板变量">
            {PODCAST_TEMPLATE_VARIABLES.map((variable) => <span key={variable.token} title={variable.description}>{variable.label} <code>{variable.token}</code></span>)}
          </div>
          <div className="podcast-template-workbench">
            {podcastModes.map((mode, index) => {
              const preview = previewPodcastMode(mode);
              const invalidVariables = validatePodcastModeTemplate(mode.prompt);
              return <article className="provider-profile-card podcast-template-card" key={mode.id}>
                <header>
                  <strong>高级模板 {index + 1}</strong>
                  <div className="podcast-template-card-actions">
                    <button type="button" className="icon-button" aria-label={`上移 ${mode.title || "自定义模式"}`} disabled={index === 0} onClick={() => movePodcastMode(mode.id, -1)}><ChevronUp size={16} /></button>
                    <button type="button" className="icon-button" aria-label={`下移 ${mode.title || "自定义模式"}`} disabled={index === podcastModes.length - 1} onClick={() => movePodcastMode(mode.id, 1)}><ChevronDown size={16} /></button>
                    <button type="button" className="icon-button" aria-label={`复制 ${mode.title || "自定义模式"}`} onClick={() => duplicatePodcastMode(mode.id)}><Copy size={16} /></button>
                    <button type="button" className="icon-button danger" aria-label={`删除 ${mode.title || "自定义模式"}`} onClick={() => setPodcastModes((current) => current.filter((item) => item.id !== mode.id))}><Trash2 size={16} /></button>
                  </div>
                </header>
                <div className="settings-grid">
                  <label>模板标题<input value={mode.title} onChange={(event) => updatePodcastMode(mode.id, { title: event.target.value })} placeholder="例如：错题抽测" /></label>
                  <label className="settings-grid-full">高级创作指令<textarea ref={(element) => { if (element) modePromptRefs.current.set(mode.id, element); else modePromptRefs.current.delete(mode.id); }} value={mode.prompt} onChange={(event) => updatePodcastMode(mode.id, { prompt: event.target.value })} rows={6} placeholder="例如：你是一位复习教练。围绕 {{必须覆盖}} 组织讲解，并在每章最后提出一个自测问题。" /></label>
                </div>
                <div className="podcast-template-insert-row">
                  {PODCAST_TEMPLATE_VARIABLES.map((variable) => <button type="button" className="subtle-button" key={variable.token} onClick={() => insertPodcastTemplateVariable(mode.id, variable.token)} title={variable.description}>插入 {variable.label}</button>)}
                </div>
                {invalidVariables.length > 0 && <p className="error-text">不支持的变量：{invalidVariables.join("、")}</p>}
                <details className="podcast-template-preview">
                  <summary>查看示例合并预览</summary>
                  {preview.error ? <p className="error-text">{preview.error}</p> : <pre>{preview.value}</pre>}
                </details>
              </article>;
            })}
          </div>
          <div className="provider-template-row">
            <button type="button" className="secondary-button" onClick={addPodcastMode}><Plus size={16} />新增高级模板</button>
            <button type="button" className="primary-button" onClick={() => void savePodcastModes()}><Save size={17} />保存播客模式</button>
          </div>
        </div>
      </section>

      <section className={`ai-export-panel ${exportOpen ? "open" : ""}`}>
        <header>
          <div>
            <p className="eyebrow">AI Export</p>
            <h2>AI 材料导出</h2>
            <p>当前格式：{selectedOption?.label}</p>
          </div>
          <button
            type="button"
            className="secondary-button ai-export-toggle"
            onClick={() => setExportOpen((value) => !value)}
            aria-expanded={exportOpen}
          >
            {exportOpen ? "收起" : "展开"}
            <ChevronDown size={16} />
          </button>
        </header>

        {exportOpen ? (
          <div className="ai-export-body">
            <label>
              导出格式
              <select value={aiKind} onChange={(event) => setAiKind(event.target.value as AiExportKind)}>
                {AI_EXPORT_OPTIONS.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="helper-text">{selectedOption?.helper}</p>
            <button type="button" className="primary-button" onClick={() => void exportAiMaterial()} disabled={busy !== null}>
              {aiKind === "knowledge-json" ? <FileJson size={18} /> : <FileText size={18} />}
              {busy ? "导出中..." : "导出 AI 材料"}
            </button>
          </div>
        ) : (
          <button type="button" className="subtle-button ai-export-quick-open" onClick={() => setExportOpen(true)}>
            <BrainCircuit size={17} />
            展开后选择格式并导出
          </button>
        )}
      </section>

      {message && <p className="status-message">{message}</p>}
    </main>
  );
};
