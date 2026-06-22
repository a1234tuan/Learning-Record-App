import { Download, FolderSync, Upload } from "lucide-react";
import { useState } from "react";

import type { AppSettings } from "../types";
import { storage } from "../services/storageAdapter";
import { fileSystemFolderSyncAdapter, manualZipSyncAdapter } from "../services/syncAdapters";
import { nativeBackupAdapter } from "../services/nativeBackupAdapter";
import { isNativePlatform } from "../lib/platform";
import { exportFullBackup } from "../services/knowledgeExportService";
import { flushAutoBackupNow } from "../services/autoBackupService";
import { AutoBackupPanel } from "../components/AutoBackupPanel";

interface SettingsPageProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onRestored: () => void;
}

export const SettingsPage = ({ settings, onSaveSettings, onRestored }: SettingsPageProps) => {
  const [message, setMessage] = useState("");
  const native = isNativePlatform();
  const folderAvailable = fileSystemFolderSyncAdapter.isAvailable();

  const exportZip = async () => {
    const result = await exportFullBackup(await storage.createSnapshot());
    setMessage(`${result} 这是可导入恢复的完整备份。`);
  };

  const importZip = async () => {
    const ok = window.confirm("导入完整备份会覆盖当前本地数据。建议先导出一份完整备份，再继续导入。");
    if (!ok) {
      setMessage("已取消导入。");
      return;
    }
    const adapter = native ? nativeBackupAdapter : manualZipSyncAdapter;
    const snapshot = await adapter.importSnapshot?.();
    if (!snapshot) {
      return;
    }
    await storage.restoreSnapshot(snapshot);
    await onRestored();
    await flushAutoBackupNow("restore");
    setMessage("已从备份恢复。");
  };

  const exportFolderSnapshot = async () => {
    await fileSystemFolderSyncAdapter.exportSnapshot(await storage.createSnapshot());
    setMessage("已写入同步文件夹快照。");
  };

  return (
    <main className="page settings-page">
      <section className="section-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>数据与偏好</h1>
        </div>
      </section>
      <section className="settings-panel">
        <label>
          目标日期
          <input
            type="date"
            value={settings.examDate}
            onChange={(event) => onSaveSettings({ ...settings, examDate: event.target.value })}
          />
        </label>
        <label>
          主题
          <select
            value={settings.theme}
            onChange={(event) => onSaveSettings({ ...settings, theme: event.target.value as AppSettings["theme"] })}
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <label>
          字号
          <input
            type="range"
            min={0.9}
            max={1.25}
            step={0.05}
            value={settings.fontScale}
            onChange={(event) => onSaveSettings({ ...settings, fontScale: Number(event.target.value) })}
          />
        </label>
        <label>
          行距
          <input
            type="range"
            min={1.4}
            max={2}
            step={0.05}
            value={settings.lineHeight}
            onChange={(event) => onSaveSettings({ ...settings, lineHeight: Number(event.target.value) })}
          />
        </label>
      </section>
      <AutoBackupPanel settings={settings} onChanged={onRestored} />
      <section className="backup-panel">
        <button type="button" className="primary-button" onClick={exportZip}>
          <Download size={18} />
          {native ? "导出并分享备份" : "导出完整备份"}
        </button>
        <button type="button" className="secondary-button" onClick={importZip}>
          <Upload size={18} />
          {native ? "从文件导入" : "导入恢复"}
        </button>
        {!native && (
          <button type="button" className="secondary-button" onClick={exportFolderSnapshot} disabled={!folderAvailable}>
            <FolderSync size={18} />
            写入同步文件夹
          </button>
        )}
        {!native && !folderAvailable && (
          <p className="helper-text">当前浏览器不支持目录授权，仍可使用手动 zip 备份与恢复。</p>
        )}
        {native && <p className="helper-text">Android 版会把备份写入应用文档目录，并通过系统分享面板发送到网盘、微信或文件管理器。</p>}
        {message && <p className="status-message">{message}</p>}
      </section>
    </main>
  );
};
