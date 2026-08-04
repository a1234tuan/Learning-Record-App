import { ChevronDown, ChevronUp, Copy, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AppSettings, KnowledgePodcastModeTemplate } from "../types";
import { storage } from "../services/storageAdapter";
import { PageHeader } from "../components/ui";
import { createBaseEntity } from "../lib/entity";
import {
  buildPodcastPromptPreview,
  getPodcastCreativeBriefDefaults,
  PODCAST_TEMPLATE_VARIABLES,
  validatePodcastModeTemplate,
} from "../services/knowledgePodcastService";

interface PodcastTemplatesPageProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
}

export const PodcastTemplatesPage = ({ settings, onChanged }: PodcastTemplatesPageProps) => {
  const [podcastModes, setPodcastModes] = useState<KnowledgePodcastModeTemplate[]>(
    settings.knowledgePodcastModeTemplates ?? [],
  );
  const [message, setMessage] = useState("");
  const modePromptRefs = useRef(new Map<string, HTMLTextAreaElement>());

  useEffect(() => {
    setPodcastModes(settings.knowledgePodcastModeTemplates ?? []);
  }, [settings]);

  const updatePodcastMode = (id: string, patch: Partial<KnowledgePodcastModeTemplate>) => {
    setPodcastModes((current) => current.map((mode) => (mode.id === id ? { ...mode, ...patch } : mode)));
  };

  const addPodcastMode = () => {
    setPodcastModes((current) => [
      ...current,
      { ...createBaseEntity(), title: "新播客模式", prompt: "请围绕来源记录，用自然、清晰的方式组织讲解。", order: current.length },
    ]);
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
    setPodcastModes((current) =>
      current.map((mode) =>
        mode.id !== id ? mode : { ...mode, prompt: `${mode.prompt.slice(0, start)}${token}${mode.prompt.slice(end)}` },
      ),
    );
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
      setMessage(
        unsupported.length
          ? `"${invalidMode.title || "未命名模式"}"包含不支持的变量：${unsupported.join("、")}。`
          : "每个播客模式都需要标题和 Prompt。",
      );
      return;
    }
    await storage.saveSettings({ ...settings, knowledgePodcastModeTemplates: normalized });
    await onChanged();
    setMessage("知识播客自定义模式已保存。已有播客会继续使用创建时的模式快照。");
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
    <main className="page podcast-templates-page">
      <PageHeader eyebrow="Knowledge Podcast" title="播客高级模板" density="compact" />
      <section className="ai-settings-panel podcast-mode-settings">
        <div className="ai-settings-body">
          <p className="helper-text">
            创建可复用的创作指令。模板只控制角色、讲解角度、叙事方式和章节侧重点；知识范围、来源追溯和固定 JSON 结构由系统强制追加。
          </p>
          <div className="podcast-template-variable-list" aria-label="可用播客模板变量">
            {PODCAST_TEMPLATE_VARIABLES.map((variable) => (
              <span key={variable.token} title={variable.description}>
                {variable.label} <code>{variable.token}</code>
              </span>
            ))}
          </div>
          <div className="podcast-template-workbench">
            {podcastModes.map((mode, index) => {
              const preview = previewPodcastMode(mode);
              const invalidVariables = validatePodcastModeTemplate(mode.prompt);
              return (
                <article className="provider-profile-card podcast-template-card" key={mode.id}>
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
                    <label className="settings-grid-full">高级创作指令
                      <textarea
                        ref={(element) => { if (element) modePromptRefs.current.set(mode.id, element); else modePromptRefs.current.delete(mode.id); }}
                        value={mode.prompt}
                        onChange={(event) => updatePodcastMode(mode.id, { prompt: event.target.value })}
                        rows={6}
                        placeholder="例如：你是一位复习教练。围绕 {{必须覆盖}} 组织讲解，并在每章最后提出一个自测问题。"
                      />
                    </label>
                  </div>
                  <div className="podcast-template-insert-row">
                    {PODCAST_TEMPLATE_VARIABLES.map((variable) => (
                      <button type="button" className="subtle-button" key={variable.token} onClick={() => insertPodcastTemplateVariable(mode.id, variable.token)} title={variable.description}>
                        插入 {variable.label}
                      </button>
                    ))}
                  </div>
                  {invalidVariables.length > 0 && <p className="error-text">不支持的变量：{invalidVariables.join("、")}</p>}
                  <details className="podcast-template-preview">
                    <summary>查看示例合并预览</summary>
                    {preview.error ? <p className="error-text">{preview.error}</p> : <pre>{preview.value}</pre>}
                  </details>
                </article>
              );
            })}
          </div>
          <div className="provider-template-row">
            <button type="button" className="secondary-button" onClick={addPodcastMode}><Plus size={16} />新增高级模板</button>
            <button type="button" className="primary-button" onClick={() => void savePodcastModes()}><Save size={17} />保存播客模式</button>
          </div>
          {message && <p className="status-message">{message}</p>}
        </div>
      </section>
    </main>
  );
};
