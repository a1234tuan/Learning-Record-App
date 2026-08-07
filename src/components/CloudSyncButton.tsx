import { RefreshCw } from "lucide-react";

import { getCurrentCloudUser, synchronizeCloudChanges } from "../services/cloudSyncService";
import { cloudSyncStore, useCloudSyncStore } from "../services/cloudSyncStore";

interface CloudSyncButtonProps {
  /** Called when the button is pressed while signed out — should route the user to cloud sync setup. */
  onSignedOut: () => void;
  /** Called after a sync that restored/replaced local data, so the caller can refresh its view. */
  onRestored: () => Promise<void> | void;
  className?: string;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "云同步操作失败。");

export const CloudSyncButton = ({ onSignedOut, onRestored, className = "" }: CloudSyncButtonProps) => {
  const { busy, conflict } = useCloudSyncStore();
  const spinning = busy === "sync" || busy === "resolve";

  const handleClick = async () => {
    const user = getCurrentCloudUser();
    if (!user) {
      onSignedOut();
      return;
    }
    if (busy !== null || conflict) return;
    cloudSyncStore.setBusy("sync");
    const token = cloudSyncStore.currentToken();
    cloudSyncStore.setConflict(undefined);
    cloudSyncStore.setMessage("正在检查本机和云端的更改。");
    try {
      const result = await synchronizeCloudChanges(user, {
        onProgress: (event) => {
          if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setMessage(event.message);
        },
      });
      // The watchdog or a background/foreground transition may have already cleared this
      // operation (e.g. the OS suspended the request mid-flight) — don't resurrect stale state.
      if (!cloudSyncStore.isCurrent(token)) return;
      if (result.kind === "conflict") {
        cloudSyncStore.setConflict(result.conflict);
        cloudSyncStore.setMessage("检测到本机和云端都存在未同步的数据，请选择保留哪一侧。");
      } else {
        cloudSyncStore.setMessage(`同步完成：上传 ${result.uploaded} 项，下载 ${result.downloaded} 项。`);
        if (result.restored) await onRestored();
      }
    } catch (error) {
      if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setMessage(errorMessage(error));
    } finally {
      if (cloudSyncStore.isCurrent(token)) cloudSyncStore.setBusy(null);
    }
  };

  return (
    <button
      type="button"
      className={`icon-button cloud-sync-button${spinning ? " spinning" : ""} ${className}`.trim()}
      onClick={() => void handleClick()}
      disabled={busy !== null}
      title="云同步"
      aria-label="云同步"
    >
      <RefreshCw size={18} />
    </button>
  );
};
