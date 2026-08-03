import { BrainCircuit, ChevronDown, Eye, EyeOff, FileJson, FileText, Headphones, MessageSquare, Save } from "lucide-react";
import { useEffect, useState } from "react";

import type { AppSettings, ExportKind } from "../types";
import { exportKnowledge } from "../services/knowledgeExportService";
import { storage } from "../services/storageAdapter";
import { AiSettingsPanel } from "../components/AiSettingsPanel";
import { ListRow, PageHeader } from "../components/ui";

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
  const [fishKey, setFishKey] = useState("");
  const [showFishKey, setShowFishKey] = useState(false);
  const [fishModel, setFishModel] = useState(settings.tts?.model ?? "s2.1-pro-free");
  const [fishVoiceId, setFishVoiceId] = useState(settings.tts?.voiceId ?? "");
  const selectedOption = AI_EXPORT_OPTIONS.find((item) => item.kind === aiKind);

  useEffect(() => {
    setFishModel(settings.tts?.model ?? "s2.1-pro-free");
    setFishVoiceId(settings.tts?.voiceId ?? "");
    void storage.getAiSecret?.("fish-audio").then((secret) => setFishKey(secret?.apiKey ?? "")).catch(() => setFishKey(""));
  }, [settings]);

  const saveFishSettings = async () => {
    if (fishKey.trim()) await storage.saveAiSecret?.(fishKey.trim(), "fish-audio");
    else await storage.clearAiSecret?.("fish-audio");
    await storage.saveSettings({ ...settings, tts: { model: fishModel.trim() || "s2.1-pro-free", voiceId: fishVoiceId.trim(), format: "mp3" } });
    await onChanged();
    setMessage("Fish Audio 设置已保存。API Key 只保存在本机，不进入备份。");
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

      <section className="ai-settings-panel fish-audio-settings">
        <div className="ai-settings-body">
          <header className="inline-section-header"><div><h3>Fish Audio 文本转语音</h3><p>用于知识播客音频生成。适合个人自用；公开发布时应改为后端代理。</p></div></header>
          <div className="settings-grid">
            <label>模型<input value={fishModel} onChange={(event) => setFishModel(event.target.value)} placeholder="s2.1-pro-free" /></label>
            <label>Voice ID<input value={fishVoiceId} onChange={(event) => setFishVoiceId(event.target.value)} placeholder="Fish Audio reference_id" /></label>
            <label>API Key<span className="secret-input"><input type={showFishKey ? "text" : "password"} value={fishKey} onChange={(event) => setFishKey(event.target.value)} placeholder="sk-..." /><button type="button" onClick={() => setShowFishKey((value) => !value)} aria-label="切换 Fish 密钥显示">{showFishKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
            <label>输出格式<input value="MP3" readOnly /></label>
          </div>
          <button type="button" className="primary-button" onClick={() => void saveFishSettings()}><Save size={17} />保存 Fish Audio 设置</button>
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
