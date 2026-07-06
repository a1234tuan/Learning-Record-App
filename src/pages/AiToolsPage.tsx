import { BrainCircuit, ChevronDown, FileJson, FileText, MessageSquare } from "lucide-react";
import { useState } from "react";

import type { AppSettings, ExportKind } from "../types";
import { exportKnowledge } from "../services/knowledgeExportService";
import { storage } from "../services/storageAdapter";
import { AiSettingsPanel } from "../components/AiSettingsPanel";
import { ListRow, PageHeader } from "../components/ui";

interface AiToolsPageProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
  onOpenAi: () => void;
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

export const AiToolsPage = ({ settings, onChanged, onOpenAi }: AiToolsPageProps) => {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<AiExportKind | null>(null);
  const [aiKind, setAiKind] = useState<AiExportKind>("subject-markdown");
  const [exportOpen, setExportOpen] = useState(false);
  const selectedOption = AI_EXPORT_OPTIONS.find((item) => item.kind === aiKind);

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
        </div>
      </section>

      <AiSettingsPanel settings={settings} onChanged={onChanged} />

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
