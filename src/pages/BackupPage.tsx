import { Download, Upload } from "lucide-react";
import { useState } from "react";

import type { AppSettings, ExportKind, ExportProgress, ImportProgress, ImportSummary } from "../types";
import { exportFullBackupFromStorage } from "../services/knowledgeExportService";
import { importAndRestoreSnapshot } from "../services/importRestoreService";
import { nativeBackupAdapter } from "../services/nativeBackupAdapter";
import { storage } from "../services/storageAdapter";
import { manualZipSyncAdapter } from "../services/syncAdapters";
import { isNativePlatform } from "../lib/platform";
import { AutoBackupPanel } from "../components/AutoBackupPanel";
import { PageHeader, SurfaceCard } from "../components/ui";

interface BackupPageProps {
  settings: AppSettings;
  onRestored: () => Promise<void> | void;
}

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

const progressDetail = (progress: ImportProgress | ExportProgress) =>
  progress.total ? `${progress.message}（${progress.current ?? 0}/${progress.total}）` : progress.message;

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

export const BackupPage = ({ settings, onRestored }: BackupPageProps) => {
  const [message, setMessage] = useState("");
  const [importStatus, setImportStatus] = useState<ImportStatus>({ state: "idle" });
  const [busy, setBusy] = useState<ExportKind | "import" | null>(null);
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
      const result = await exportFullBackupFromStorage(storage, {
        onProgress: (progress) => setMessage(progressDetail(progress)),
      });
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
      let activeSummary: ImportSummary | undefined;
      try {
        const summary = await importAndRestoreSnapshot({
          adapter,
          onRestored,
          onSummary: (summary) => {
            activeSummary = summary;
            setImportStatus({
              state: "restoring",
              title: "正在恢复数据",
              detail: "备份已通过校验，正在覆盖当前本地数据。",
              summary,
            });
          },
          onProgress: (progress) => {
            if (progress.stage === "choosing") {
              setImportStatus({ state: "choosing", title: "选择备份文件", detail: progressDetail(progress) });
              return;
            }
            if (progress.stage === "restoring" && activeSummary) {
              setImportStatus({
                state: "restoring",
                title: "正在恢复数据",
                detail: progressDetail(progress),
                summary: activeSummary,
              });
              return;
            }
            setImportStatus({
              state: "parsing",
              title: progress.stage === "reading" ? "正在读取备份" : "正在解析备份",
              detail: progressDetail(progress),
            });
          },
          onAutoBackupError: (detail) => setMessage(`导入已完成，但后台自动备份更新失败：${detail}`),
        });
        if (!summary) {
          setImportStatus({ state: "cancelled", title: "已取消导入", detail: "未选择备份文件，没有修改当前本地数据。" });
          return;
        }
        setImportStatus({
          state: "success",
          title: "导入成功",
          detail: `${formatImportSummary(summary)} 备份版本 v${summary.version}。自动备份会在后台更新。`,
          summary,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "导入失败，无法读取所选文件。";
        setImportStatus({ state: "error", title: "导入失败", detail });
        throw error;
      }
    });

  return (
    <main className="page backup-page">
      <PageHeader
        eyebrow="Backup"
        title="备份与恢复"
        subtitle="完整备份、导入恢复和自动备份都在这里管理。"
        density="compact"
      />

      <section className="more-section backup-actions-section">
        <h2>完整备份</h2>
        <div className="more-grid backup-action-grid">
          <SurfaceCard className="more-action-card backup-action-card" variant="raised">
            <div>
              <Download size={20} />
              <h3>导出完整备份</h3>
              <p>生成可在 Web 和 Android 互相恢复的 zip，包含日志、图片、音频、附件、OCR 和设置。</p>
            </div>
            <button type="button" className="primary-button" onClick={exportFull} disabled={busy !== null}>
              <Download size={18} />
              {native ? "导出并分享" : "导出 zip"}
            </button>
          </SurfaceCard>

          <SurfaceCard className="more-action-card backup-action-card" variant="raised">
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

      {busy && <p className="status-message">正在处理，请稍等...</p>}
      {message && <p className="status-message">{message}</p>}
    </main>
  );
};
