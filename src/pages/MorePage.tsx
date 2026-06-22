import { BarChart3, BrainCircuit, Download, FileJson, FileText, MessageSquare, Settings, Star, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import type { AppSettings, ExportKind, ImportSummary } from "../types";
import { storage } from "../services/storageAdapter";
import { manualZipSyncAdapter } from "../services/syncAdapters";
import { nativeBackupAdapter } from "../services/nativeBackupAdapter";
import { isNativePlatform } from "../lib/platform";
import { exportKnowledge } from "../services/knowledgeExportService";
import { flushAutoBackupNow } from "../services/autoBackupService";
import { summarizeSnapshot } from "../services/backup";
import { AutoBackupPanel } from "../components/AutoBackupPanel";
import { AiSettingsPanel } from "../components/AiSettingsPanel";
import { ListRow, PageHeader, SurfaceCard } from "../components/ui";

interface MorePageProps {
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenAi: () => void;
  onOpenFavorites: () => void;
  onOpenTrash: () => void;
  onRestored: () => Promise<void> | void;
  settings: AppSettings;
}

const AI_EXPORT_OPTIONS: Array<{ kind: ExportKind; label: string; helper: string }> = [
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

type ImportStatus =
  | { state: "idle" }
  | { state: "choosing"; title: string; detail: string }
  | { state: "parsing"; title: string; detail: string }
  | { state: "restoring"; title: string; detail: string; summary: ImportSummary }
  | { state: "success"; title: string; detail: string; summary: ImportSummary }
  | { state: "cancelled"; title: string; detail: string }
  | { state: "error"; title: string; detail: string };

const formatImportSummary = (summary: ImportSummary) =>
  `导入 ${summary.records} 条日志，覆盖 ${summary.days} 天；资源 ${summary.assets} 个（图片 ${summary.images}、音频 ${summary.audio}、附件 ${summary.attachments}）。`;

const ImportStatusCard = ({ status }: { status: ImportStatus }) => {
  if (status.state === "idle") {
    return null;
  }

  const className = `import-status-card import-status-${status.state}`;
  const summary = "summary" in status ? status.summary : undefined;

  return (
    <section className={className} role="status" aria-live="polite">
      <div>
        <strong>{status.title}</strong>
        <p>{status.detail}</p>
      </div>
      {summary && (
        <dl>
          <div>
            <dt>日志</dt>
            <dd>{summary.records}</dd>
          </div>
          <div>
            <dt>天数</dt>
            <dd>{summary.days}</dd>
          </div>
          <div>
            <dt>回收站</dt>
            <dd>{summary.deletedRecords}</dd>
          </div>
          <div>
            <dt>资源</dt>
            <dd>{summary.assets}</dd>
          </div>
        </dl>
      )}
      {summary?.missingAssets ? (
        <p className="import-warning">有 {summary.missingAssets} 个资源文件未在备份包中找到，相关记录会保留资源缺失占位。</p>
      ) : null}
    </section>
  );
};

export const MorePage = ({
  onOpenStats,
  onOpenSettings,
  onOpenAi,
  onOpenFavorites,
  onOpenTrash,
  onRestored,
  settings,
}: MorePageProps) => {
  const [message, setMessage] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus>({ state: "idle" });
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
      setImportStatus({ state: "idle" });
      const ok = window.confirm("导入完整备份会覆盖当前本地数据。建议先导出一份完整备份，再继续导入。");
      if (!ok) {
        setImportStatus({ state: "cancelled", title: "已取消导入", detail: "没有修改当前本地数据。" });
        return;
      }
      const adapter = native ? nativeBackupAdapter : manualZipSyncAdapter;
      setImportStatus({ state: "choosing", title: "选择备份文件", detail: "请在文件选择器中选择完整备份 zip。" });
      let snapshot;
      try {
        setImportStatus({ state: "parsing", title: "正在解析备份", detail: "正在检查 zip 格式、manifest 和 data.json。" });
        snapshot = await adapter.importSnapshot?.();
      } catch (error) {
        const detail = error instanceof Error ? error.message : "导入失败，无法读取所选文件。";
        setImportStatus({ state: "error", title: "导入失败", detail });
        throw error;
      }
      if (!snapshot) {
        setImportStatus({ state: "cancelled", title: "已取消导入", detail: "未选择备份文件，没有修改当前本地数据。" });
        return;
      }
      const summary = summarizeSnapshot(snapshot);
      setImportStatus({ state: "restoring", title: "正在恢复数据", detail: "备份已通过校验，正在覆盖当前本地数据。", summary });
      await storage.restoreSnapshot(snapshot);
      await onRestored();
      await flushAutoBackupNow("restore");
      setImportStatus({
        state: "success",
        title: "导入成功",
        detail: `${formatImportSummary(summary)} 备份版本 v${summary.version}。`,
        summary,
      });
    });

  const exportAiMaterial = () =>
    run(aiKind, async () => {
      const result = await exportKnowledge(aiKind, await storage.createSnapshot());
      return `${result} AI 材料仅用于阅读和问答，不用于恢复。`;
    });

  const selectedOption = AI_EXPORT_OPTIONS.find((item) => item.kind === aiKind);

  return (
    <main className="page more-page">
      <PageHeader
        eyebrow="More"
        title="更多"
        subtitle="备份、AI、收藏、回收站、统计和应用设置都集中在这里。"
      />

      <section className="more-section">
        <h2>备份与恢复</h2>
        <div className="more-grid">
          <SurfaceCard className="more-action-card" variant="raised">
            <div>
              <Download size={20} />
              <h3>完整备份</h3>
              <p>导出可在 Web 和 Android 互相恢复的 zip，包含日志、图片、音频、附件、OCR 和设置。</p>
            </div>
            <button type="button" className="primary-button" onClick={exportFull} disabled={busy !== null}>
              <Download size={18} />
              {native ? "导出并分享" : "导出 zip"}
            </button>
          </SurfaceCard>

          <SurfaceCard className="more-action-card" variant="raised">
            <div>
              <Upload size={20} />
              <h3>导入恢复</h3>
              <p>只接受完整备份 zip。导入会覆盖当前本地数据，导入前请先备份。</p>
            </div>
            <button type="button" className="secondary-button" onClick={importZip} disabled={busy !== null}>
              <Upload size={18} />
              {busy === "import" ? "导入中..." : "从 zip 导入"}
            </button>
          </SurfaceCard>
        </div>
        <ImportStatusCard status={importStatus} />
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

      <section className="more-section">
        <h2>应用</h2>
        <div className="more-list">
          <ListRow icon={<Star size={19} />} title="收藏夹" description="查看你标星的学习记录" onClick={onOpenFavorites} />
          <ListRow icon={<Trash2 size={19} />} title="回收站" description="恢复或永久删除 30 天内的记录" onClick={onOpenTrash} />
          <ListRow icon={<BarChart3 size={19} />} title="统计" description="查看记录趋势和资源数量" onClick={onOpenStats} />
          <ListRow icon={<Settings size={19} />} title="设置" description="目标日期、主题、字号和行距" onClick={onOpenSettings} />
          <ListRow icon={<MessageSquare size={19} />} title="AI 聊天记录" description="查看或删除本机保存的 AI 对话" onClick={onOpenAi} />
        </div>
      </section>

      {busy && <p className="status-message">正在处理，请稍等...</p>}
      {message && <p className="status-message">{message}</p>}
    </main>
  );
};
