import { AlertTriangle } from "lucide-react";

import { getCurrentCloudUser, resolveCloudSyncConflict, synchronizeCloudChanges } from "../services/cloudSyncService";
import { cloudSyncStore, useCloudSyncStore } from "../services/cloudSyncStore";

interface CloudSyncConflictDialogProps {
  /** Called after a sync that restored/replaced local data, so the caller can refresh its view. */
  onRestored: () => Promise<void> | void;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "云同步操作失败。");

/**
 * Global modal for resolving cloud sync conflicts. Mounted once at the app shell root so it can
 * interrupt the user regardless of which tab/page triggered the sync (home button, sidebar button,
 * or the sync panel under 更多 → 云同步).
 */
export const CloudSyncConflictDialog = ({ onRestored }: CloudSyncConflictDialogProps) => {
  const { busy, conflict, message } = useCloudSyncStore();

  if (!conflict) return null;

  const resolve = async (choice: "local" | "cloud") => {
    const user = getCurrentCloudUser();
    if (!user) return;
    cloudSyncStore.setBusy("resolve");
    const token = cloudSyncStore.currentToken();
    cloudSyncStore.setMessage(choice === "local" ? "正在以本机数据更新云端。" : "正在保存本机恢复点并恢复云端数据。");
    try {
      const result = await resolveCloudSyncConflict(user, choice, {
        onProgress: (event) => {
          if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setMessage(event.message);
        },
      });
      // A watchdog timeout or background/foreground transition may have already cleared this
      // operation (e.g. the OS suspended the request mid-flight) — don't resurrect stale state,
      // and don't keep going with a second network round-trip the user no longer expects.
      if (!cloudSyncStore.isCurrent(token)) return;
      if (result.kind === "conflict") {
        cloudSyncStore.setConflict(result.conflict);
        cloudSyncStore.setMessage("云端状态已变化，请重新选择同步策略。");
        return;
      }
      cloudSyncStore.setConflict(undefined);
      if (choice === "cloud") {
        await onRestored();
        cloudSyncStore.setMessage("正在上传本机剩余更改。");
        const finalResult = await synchronizeCloudChanges(user, {
          onProgress: (event) => {
            if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setMessage(event.message);
          },
        });
        if (!cloudSyncStore.isCurrent(token)) return;
        if (finalResult.kind === "synced") {
          cloudSyncStore.setMessage(
            `同步完成：上传 ${result.uploaded + finalResult.uploaded} 项，下载 ${result.downloaded + finalResult.downloaded} 项。`,
          );
        } else {
          cloudSyncStore.setConflict(finalResult.conflict);
          cloudSyncStore.setMessage("已恢复云端数据，但上传本机数据时再次遇到冲突，请重新选择策略。");
        }
      } else {
        cloudSyncStore.setMessage(`同步完成：上传 ${result.uploaded} 项，下载 ${result.downloaded} 项。`);
      }
    } catch (error) {
      if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setMessage(errorMessage(error));
    } finally {
      if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setBusy(null);
    }
  };

  const cancel = () => {
    cloudSyncStore.setConflict(undefined);
    cloudSyncStore.setMessage("已取消，本机和云端数据均未修改。");
  };

  return (
    <div className="cloud-sync-conflict-backdrop" role="presentation">
      <section
        className="cloud-sync-conflict-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-conflict-title"
      >
        <p className="eyebrow">
          <AlertTriangle size={16} />
          云同步冲突
        </p>
        <h2 id="cloud-sync-conflict-title">
          {conflict.reason === "legacy-snapshot" ? "检测到旧版完整云端备份" : "检测到双端并发编辑"}
        </h2>
        <p>本机 {conflict.localChanges} 项，云端 {conflict.remoteChanges} 项。选择前会自动保留恢复点。</p>
        {message ? <p className="cloud-sync-conflict-status" role="status">{message}</p> : null}
        <div className="cloud-sync-conflict-actions">
          <button type="button" className="primary-button" onClick={() => void resolve("local")} disabled={busy !== null}>
            以本机为准
          </button>
          <button type="button" className="secondary-button" onClick={() => void resolve("cloud")} disabled={busy !== null}>
            以云端为准
          </button>
          <button type="button" className="secondary-button" onClick={cancel} disabled={busy !== null}>
            取消
          </button>
        </div>
      </section>
    </div>
  );
};
