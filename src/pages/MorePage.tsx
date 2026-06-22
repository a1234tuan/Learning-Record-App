import { BarChart3, BrainCircuit, Download, FileJson, FileText, MessageSquare, Settings, Upload } from "lucide-react";
import { useState } from "react";

import type { AppSettings, ExportKind } from "../types";
import { storage } from "../services/storageAdapter";
import { manualZipSyncAdapter } from "../services/syncAdapters";
import { nativeBackupAdapter } from "../services/nativeBackupAdapter";
import { isNativePlatform } from "../lib/platform";
import { exportKnowledge } from "../services/knowledgeExportService";
import { flushAutoBackupNow } from "../services/autoBackupService";
import { AutoBackupPanel } from "../components/AutoBackupPanel";
import { AiSettingsPanel } from "../components/AiSettingsPanel";

interface MorePageProps {
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenAi: () => void;
  onRestored: () => Promise<void> | void;
  settings: AppSettings;
}

const AI_EXPORT_OPTIONS: Array<{ kind: ExportKind; label: string; helper: string }> = [
  {
    kind: "subject-markdown",
    label: "按学科 Markdown",
    helper: "生成 subjects/计组.md、OS.md 等，适合直接喂给 AI 复习提问。",
  },
  {
    kind: "knowledge-json",
    label: "知识库 JSON",
    helper: "保留日期、学科、正文、公式、资源标题和图片 OCR 文本，方便后续接 AI 问答。",
  },
  {
    kind: "plain-text",
    label: "纯文本 TXT",
    helper: "一个可复制的纯文本总文件，适合快速发给 AI。",
  },
];

export const MorePage = ({ onOpenStats, onOpenSettings, onOpenAi, onRestored, settings }: MorePageProps) => {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<ExportKind | "import" | null>(null);
  const [aiKind, setAiKind] = useState<ExportKind>("subject-markdown");
  const native = isNativePlatform();

  const run = async (action: ExportKind | "import", task: () => Promise<string | void>) => {
    setBusy(action);
    setMessage("");
    try {
      const result = await task();
      if (result) {
        setMessage(result);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      setBusy(null);
    }
  };

  const exportFull = () =>
    run("full-backup", async () => {
      const result = await exportKnowledge("full-backup", await storage.createSnapshot());
      return `${result} 这是可导入恢复的完整备份。`;
    });

  const importZip = () =>
    run("import", async () => {
      const ok = window.confirm("导入完整备份会覆盖当前本地数据。建议先导出一份完整备份，再继续导入。");
      if (!ok) {
        return "已取消导入。";
      }
      const adapter = native ? nativeBackupAdapter : manualZipSyncAdapter;
      const snapshot = await adapter.importSnapshot?.();
      if (!snapshot) {
        return "未选择备份文件。";
      }
      await storage.restoreSnapshot(snapshot);
      await onRestored();
      await flushAutoBackupNow("restore");
      return "已从完整备份恢复。";
    });

  const exportAiMaterial = () =>
    run(aiKind, async () => {
      const result = await exportKnowledge(aiKind, await storage.createSnapshot());
      return `${result} AI 材料仅用于阅读和问答，不用于恢复。`;
    });

  const selectedOption = AI_EXPORT_OPTIONS.find((item) => item.kind === aiKind);

  return (
    <main className="page more-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">More</p>
          <h1>备份与更多</h1>
        </div>
      </section>

      <section className="more-grid">
        <article className="more-action-card">
          <div>
            <Download size={20} />
            <h2>完整备份</h2>
            <p>导出可在 Web 与 Android 互相恢复的 zip，包含日志、图片、音频、附件、OCR 和设置。</p>
          </div>
          <button type="button" className="primary-button" onClick={exportFull} disabled={busy !== null}>
            <Download size={18} />
            {native ? "导出并分享" : "导出 zip"}
          </button>
        </article>

        <article className="more-action-card">
          <div>
            <Upload size={20} />
            <h2>导入恢复</h2>
            <p>只接受完整备份 zip。导入会覆盖当前本地数据，导入前请先备份。</p>
          </div>
          <button type="button" className="secondary-button" onClick={importZip} disabled={busy !== null}>
            <Upload size={18} />
            从 zip 导入
          </button>
        </article>
      </section>

      <AutoBackupPanel settings={settings} onChanged={onRestored} />

      <AiSettingsPanel settings={settings} onChanged={onRestored} />

      <section className="ai-export-panel">
        <header>
          <div>
            <p className="eyebrow">AI Export</p>
            <h2>AI 材料导出</h2>
          </div>
          <BrainCircuit size={22} />
        </header>
        <label>
          导出格式
          <select value={aiKind} onChange={(event) => setAiKind(event.target.value as ExportKind)}>
            {AI_EXPORT_OPTIONS.map((item) => (
              <option key={item.kind} value={item.kind}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p className="helper-text">{selectedOption?.helper}</p>
        <button type="button" className="primary-button" onClick={exportAiMaterial} disabled={busy !== null}>
          {aiKind === "knowledge-json" ? <FileJson size={18} /> : <FileText size={18} />}
          导出 AI 材料
        </button>
      </section>

      <section className="more-grid">
        <button type="button" className="more-link-card" onClick={onOpenStats}>
          <BarChart3 size={20} />
          <span>
            <strong>统计</strong>
            <small>查看记录趋势和资源数量</small>
          </span>
        </button>
        <button type="button" className="more-link-card" onClick={onOpenSettings}>
          <Settings size={20} />
          <span>
            <strong>设置</strong>
            <small>目标日期、主题、字号和行距</small>
          </span>
        </button>
        <button type="button" className="more-link-card" onClick={onOpenAi}>
          <MessageSquare size={20} />
          <span>
            <strong>AI 聊天记录</strong>
            <small>查看或删除本机保存的 AI 对话</small>
          </span>
        </button>
      </section>

      {busy && <p className="status-message">正在处理，请稍等...</p>}
      {message && <p className="status-message">{message}</p>}
    </main>
  );
};
