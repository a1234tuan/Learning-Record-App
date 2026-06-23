import { Eye, EyeOff, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AiProviderConfig, AiPromptPreset, AppSettings } from "../types";
import { createBaseEntity } from "../lib/entity";
import { createDefaultAiPresets, DEFAULT_SETTINGS } from "../db/defaults";
import { storage } from "../services/storageAdapter";

interface AiSettingsPanelProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
}

const withAiDefaults = (settings: AppSettings): AiProviderConfig => ({
  ...(DEFAULT_SETTINGS.ai ?? {
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    temperature: 0.7,
    maxTokens: 4096,
    memoryTurns: 12,
    presets: createDefaultAiPresets(),
  }),
  ...settings.ai,
  memoryTurns: settings.ai?.memoryTurns ?? DEFAULT_SETTINGS.ai?.memoryTurns ?? 12,
  presets: settings.ai?.presets?.length ? settings.ai.presets : createDefaultAiPresets(),
});

const sortedPresets = (presets: AiPromptPreset[]) =>
  [...presets].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

export const AiSettingsPanel = ({ settings, onChanged }: AiSettingsPanelProps) => {
  const [config, setConfig] = useState<AiProviderConfig>(() => withAiDefaults(settings));
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const presets = useMemo(() => sortedPresets(config.presets), [config.presets]);

  useEffect(() => {
    setConfig(withAiDefaults(settings));
    void storage.getAiSecret?.().then((secret) => setApiKey(secret?.apiKey ?? ""));
  }, [settings]);

  const save = async () => {
    setMessage("");
    const nextConfig = {
      ...config,
      providerName: config.providerName.trim() || "DeepSeek",
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      temperature: Number(config.temperature) || 0.7,
      maxTokens: Number(config.maxTokens) || 4096,
      memoryTurns: Number(config.memoryTurns) || 12,
      presets: sortedPresets(config.presets).map((preset, order) => ({ ...preset, order })),
    };
    await storage.saveSettings({ ...settings, ai: nextConfig });
    if (apiKey.trim()) {
      await storage.saveAiSecret?.(apiKey.trim());
    } else {
      await storage.clearAiSecret?.();
    }
    await onChanged();
    setMessage("AI 设置已保存。API Key 只保存在本机，不进入备份。");
  };

  const updatePreset = (id: string, patch: Partial<AiPromptPreset>) => {
    setConfig((current) => ({
      ...current,
      presets: current.presets.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset)),
    }));
  };

  const addPreset = () => {
    const preset: AiPromptPreset = {
      ...createBaseEntity(),
      title: "新预设",
      prompt: "请根据今天日志...",
      order: config.presets.length,
    };
    setConfig((current) => ({ ...current, presets: [...current.presets, preset] }));
  };

  const removePreset = (id: string) => {
    setConfig((current) => ({ ...current, presets: current.presets.filter((preset) => preset.id !== id) }));
  };

  return (
    <section className="ai-settings-panel">
      <button type="button" className="more-link-card" onClick={() => setOpen((value) => !value)}>
        <span>
          <strong>AI 设置</strong>
          <small>配置第三方 OpenAI 兼容接口和预设提示词</small>
        </span>
      </button>

      {open && (
        <div className="ai-settings-body">
          <div className="settings-grid">
            <label>
              供应商名称
              <input
                value={config.providerName}
                onChange={(event) => setConfig({ ...config, providerName: event.target.value })}
                placeholder="DeepSeek / 硅基流动 / 智谱"
              />
            </label>
            <label>
              Base URL
              <input
                value={config.baseUrl}
                onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
                placeholder="https://api.deepseek.com"
              />
            </label>
            <label>
              模型
              <input
                value={config.model}
                onChange={(event) => setConfig({ ...config, model: event.target.value })}
                placeholder="deepseek-v4-pro"
              />
            </label>
            <label>
              API Key
              <span className="secret-input">
                <input
                  value={apiKey}
                  type={showKey ? "text" : "password"}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-..."
                />
                <button type="button" onClick={() => setShowKey((value) => !value)} aria-label="切换密钥显示">
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <label>
              Temperature
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={config.temperature}
                onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })}
              />
            </label>
            <label>
              Max Tokens
              <input
                type="number"
                min="256"
                step="256"
                value={config.maxTokens}
                onChange={(event) => setConfig({ ...config, maxTokens: Number(event.target.value) })}
              />
            </label>
            <label>
              上下文记忆
              <input value={`最近 ${config.memoryTurns ?? 12} 轮问答`} readOnly />
            </label>
          </div>

          <header className="inline-section-header">
            <div>
              <h3>预设提示词</h3>
              <p>聊天页可一键填入，发送前还能继续修改。</p>
            </div>
            <button type="button" className="secondary-button" onClick={addPreset}>
              <Plus size={16} />
              新增
            </button>
          </header>

          <div className="preset-editor-list">
            {presets.map((preset) => (
              <article key={preset.id} className="preset-editor-card">
                <input
                  value={preset.title}
                  onChange={(event) => updatePreset(preset.id, { title: event.target.value })}
                  aria-label="预设标题"
                />
                <textarea
                  value={preset.prompt}
                  onChange={(event) => updatePreset(preset.id, { prompt: event.target.value })}
                  aria-label="预设提示词"
                  rows={3}
                />
                <button type="button" className="icon-button danger" onClick={() => removePreset(preset.id)}>
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>

          <button type="button" className="primary-button" onClick={save}>
            <Save size={18} />
            保存 AI 设置
          </button>
          {message && <p className="status-message">{message}</p>}
        </div>
      )}
    </section>
  );
};
