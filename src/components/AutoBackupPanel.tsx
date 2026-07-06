import { CheckCircle2, FolderOpen, RefreshCw, ShieldCheck, ToggleLeft, ToggleRight } from "lucide-react";
import { useState } from "react";

import type { AppSettings } from "../types";
import { formatBytes } from "../lib/format";
import {
  bindAutoBackupFolder,
  flushAutoBackupNow,
  getAutoBackupSettings,
  setAutoBackupEnabled,
} from "../services/autoBackupService";

interface AutoBackupPanelProps {
  settings: AppSettings;
  onChanged: () => Promise<void> | void;
}

const formatDateTime = (value?: string): string =>
  value ? new Date(value).toLocaleString() : "尚未备份";

const formatBackupFileName = (settings: AppSettings): string => {
  const autoBackup = getAutoBackupSettings(settings);
  if (!autoBackup?.lastBackupAt) {
    return "-";
  }
  return autoBackup.lastBackupFileName ?? "study-journal-latest.zip";
};

const formatBackupKind = (settings: AppSettings): string => {
  const format = getAutoBackupSettings(settings)?.backupFormat;
  return format === "folder-repository-v1" ? "增量文件夹备份" : "latest zip";
};

const formatBackupSize = (settings: AppSettings): string => {
  const autoBackup = getAutoBackupSettings(settings);
  const size = autoBackup?.backupFormat === "folder-repository-v1"
    ? autoBackup.lastBackupRepositorySize ?? autoBackup.lastBackupSize
    : autoBackup?.lastBackupSize;
  return size ? formatBytes(size) : "-";
};

const formatBytesValue = (value?: number): string =>
  value ? formatBytes(value) : "-";

const backupSuccessMessage = (settings: AppSettings, message: string): string => {
  const lastError = getAutoBackupSettings(settings)?.lastError;
  if (lastError) {
    throw new Error(lastError);
  }
  return message;
};

const backupActionMessage = (settings: AppSettings): string => {
  const repository = getAutoBackupSettings(settings)?.backupFormat === "folder-repository-v1";
  return repository
    ? "已立即同步到增量备份仓库。"
    : "已立即同步到 study-journal-latest.zip。";
};

export const AutoBackupPanel = ({ settings, onChanged }: AutoBackupPanelProps) => {
  const autoBackup = getAutoBackupSettings(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await task();
      setMessage(result);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "自动备份操作失败。");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auto-backup-panel">
      <header>
        <div>
          <p className="eyebrow">Auto Backup</p>
          <h2>自动备份</h2>
        </div>
        <ShieldCheck size={22} />
      </header>
      <div className="auto-backup-status">
        <div>
          <span>状态</span>
          <strong>{autoBackup?.enabled ? "已开启" : "未开启"}</strong>
        </div>
        <div>
          <span>备份位置</span>
          <strong>{autoBackup?.folderName ?? "未绑定文件夹"}</strong>
        </div>
        <div>
          <span>最近备份</span>
          <strong>{formatDateTime(autoBackup?.lastBackupAt)}</strong>
        </div>
        <div>
          <span>备份文件</span>
          <strong>{formatBackupFileName(settings)}</strong>
        </div>
        <div>
          <span>备份格式</span>
          <strong>{formatBackupKind(settings)}</strong>
        </div>
        <div>
          <span>{autoBackup?.backupFormat === "folder-repository-v1" ? "仓库总大小" : "备份大小"}</span>
          <strong>{formatBackupSize(settings)}</strong>
        </div>
        {autoBackup?.backupFormat === "folder-repository-v1" && (
          <>
            <div>
              <span>本次写入</span>
              <strong>{formatBytesValue(autoBackup.lastBackupBytesWritten)}</strong>
            </div>
            <div>
              <span>资源数量</span>
              <strong>{autoBackup.lastBackupAssetCount ?? "-"}</strong>
            </div>
            <div>
              <span>最新快照</span>
              <strong>{autoBackup.lastBackupSnapshotId ?? "-"}</strong>
            </div>
          </>
        )}
      </div>
      <div className="card-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await bindAutoBackupFolder();
              return "已绑定备份文件夹。若要恢复旧仓库，请使用“从自动备份文件夹恢复”；若要推送当前本地数据，请先开启自动备份再点击“立即同步”。";
            })
          }
        >
          <FolderOpen size={18} />
          绑定备份文件夹
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await setAutoBackupEnabled(!autoBackup?.enabled);
              return autoBackup?.enabled ? "已关闭自动备份。" : "已开启自动备份。";
            })
          }
        >
          {autoBackup?.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          {autoBackup?.enabled ? "关闭自动备份" : "开启自动备份"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || !autoBackup?.enabled}
          onClick={() =>
            void run(async () => {
              const nextSettings = await flushAutoBackupNow("manual");
              return backupSuccessMessage(nextSettings, backupActionMessage(nextSettings));
            })
          }
        >
          <RefreshCw size={18} />
          立即同步
        </button>
      </div>
      {autoBackup?.lastError && <p className="status-message">{autoBackup.lastError}</p>}
      {autoBackup?.lastBackupWarning && <p className="status-message">{autoBackup.lastBackupWarning}</p>}
      {message && (
        <p className="status-message">
          <CheckCircle2 size={15} />
          {message}
        </p>
      )}
      <details className="auto-backup-help">
        <summary>备份说明</summary>
        <p className="helper-text">
          建议选择网盘同步目录或手机公共文档目录。断网不影响本地记录，但卸载 App、清理应用数据或浏览器站点数据会删除本地库；Web 端自动备份会覆盖同一份 latest zip。
          Android 端会写入 study-journal-backup 增量文件夹仓库，只同步新增或缺失资源，并保留最近 5 个快照。绑定只授予文件夹权限；从旧仓库拉取请使用“从自动备份文件夹恢复”，推送当前本地数据请使用“立即同步”。
        </p>
      </details>
    </section>
  );
};
