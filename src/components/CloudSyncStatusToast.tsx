import { AlertTriangle, Check, CheckCircle2, HelpCircle, RefreshCw, X } from "lucide-react";

import { cloudSyncStore, useCloudSyncStore } from "../services/cloudSyncStore";

const ICONS = {
  success: CheckCircle2,
  "no-change": Check,
  error: AlertTriangle,
  uncertain: HelpCircle,
} as const;

const BUSY_MESSAGES = {
  "sign-in": "正在登录云同步。",
  "sign-out": "正在退出云同步。",
  sync: "正在同步。",
  restore: "正在恢复云端快照。",
  resolve: "正在处理同步冲突。",
} as const;

/**
 * Global feedback toast for cloud sync. Small floating card (Anki-style), not a full modal:
 * shows progress while a sync/resolve is running, then the final result (uploaded/downloaded
 * counts, "no changes", or the failure reason) once it finishes. Mounted once at the app shell
 * root alongside CloudSyncConflictDialog, so every trigger (home button, sidebar button, sync
 * panel, conflict dialog) produces the same visible feedback instead of a spinner that can stop
 * silently.
 */
export const CloudSyncStatusToast = () => {
  const { busy, message, conflict, outcome } = useCloudSyncStore();

  // The conflict dialog already covers this operation with its own status line — avoid stacking
  // two overlays for the same sync.
  if (conflict) return null;

  if (busy !== null) {
    return (
      <div className="cloud-sync-status-toast cloud-sync-status-progress" role="status" aria-live="polite">
        <RefreshCw size={16} className="cloud-sync-status-spinner" />
        <span>{message || BUSY_MESSAGES[busy]}</span>
      </div>
    );
  }

  if (!outcome) return null;

  const Icon = ICONS[outcome.status];
  // Success and "no change" auto-dismiss (see cloudSyncStore) so a close button would just be
  // noise. Errors and unresolved network states stay until the user acknowledges them — that's
  // the whole point of this toast, so they don't keep editing on top of a sync that didn't land.
  const dismissible = outcome.status === "error" || outcome.status === "uncertain";

  return (
    <div
      className={`cloud-sync-status-toast cloud-sync-status-${outcome.status}`}
      role={dismissible ? "alert" : "status"}
      aria-live={dismissible ? "assertive" : "polite"}
    >
      <Icon size={16} />
      <span>{outcome.message}</span>
      {dismissible && (
        <button
          type="button"
          className="cloud-sync-status-dismiss"
          onClick={cloudSyncStore.dismissOutcome}
          aria-label="关闭同步提示"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
