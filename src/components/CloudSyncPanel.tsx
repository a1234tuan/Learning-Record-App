import { Cloud, CloudDownload, History, LogIn, LogOut, RefreshCw, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";

import {
  completeGoogleRedirect,
  cleanupCloudRecoverySnapshotsIfDue,
  getCurrentCloudUser,
  getCloudSyncStatus,
  listCloudRecoverySnapshots,
  listenToCloudUser,
  restoreCloudRecoverySnapshot,
  signInToCloudSync,
  signOutOfCloudSync,
  type CloudRecoverySnapshot,
  type CloudSyncStatus,
} from "../services/cloudSyncService";
import { cloudSyncStore, useCloudSyncStore } from "../services/cloudSyncStore";
import { CloudSyncButton } from "./CloudSyncButton";
import { SurfaceCard } from "./ui";

interface CloudSyncPanelProps {
  onRestored: () => Promise<void> | void;
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

  const errorMessage = (error: unknown) => error instanceof Error ? error.message : "云同步操作失败。";

// The sync trigger itself (button + conflict resolution) now lives in CloudSyncButton /
// CloudSyncConflictDialog, mounted globally (home page header on mobile, sidebar on desktop) so
// it's reachable from anywhere. This panel keeps account management, status display, and
// snapshot recovery — it still embeds CloudSyncButton so this page can also kick off a sync.
export const CloudSyncPanel = ({ onRestored }: CloudSyncPanelProps) => {
  const [user, setUser] = useState<User | null>(() => getCurrentCloudUser());
  const [status, setStatus] = useState<CloudSyncStatus>();
  const [snapshots, setSnapshots] = useState<CloudRecoverySnapshot[]>([]);
  const { busy, message } = useCloudSyncStore();
  const setBusy = cloudSyncStore.setBusy;
  const setMessage = cloudSyncStore.setMessage;
  const setConflict = cloudSyncStore.setConflict;
  const previousBusyRef = useRef(busy);
  // Auth callbacks and status reads can overlap. Keep a separate generation for account-scoped
  // reads so a late response from the previous account cannot repopulate the current panel.
  const refreshGenerationRef = useRef(0);

  const refresh = async (nextUser: User, expectedToken?: number, expectedGeneration = refreshGenerationRef.current) => {
    const [nextStatus, nextSnapshots] = await Promise.all([
      getCloudSyncStatus(nextUser),
      listCloudRecoverySnapshots(nextUser.uid),
    ]);
    if (expectedToken !== undefined && !cloudSyncStore.isCurrent(expectedToken)) return;
    if (refreshGenerationRef.current !== expectedGeneration) return;
    setStatus(nextStatus);
    setSnapshots(nextSnapshots);
  };

  const runExpensiveMaintenance = async () => {
    if (!user || busy !== null) return;
    const confirmed = window.confirm("恢复点和 Storage 对象数量较多。继续清理可能产生较多 Firebase 读取和删除操作，是否继续？");
    if (!confirmed) return;
    setMessage("正在执行云端恢复点和 Storage 维护，请不要关闭应用。");
    try {
      await cleanupCloudRecoverySnapshotsIfDue(user.uid, { force: true, allowExpensiveStorageGc: true });
      await refresh(user);
      setMessage("云端恢复点维护完成。");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  useEffect(() => {
    let mounted = true;
    void completeGoogleRedirect().catch((error: unknown) => {
      if (mounted) setMessage(errorMessage(error));
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () =>
      listenToCloudUser((nextUser) => {
        const refreshGeneration = ++refreshGenerationRef.current;
        setUser(nextUser);
        setStatus(undefined);
        setSnapshots([]);
        setConflict(undefined);
        if (!nextUser) setMessage("");
        if (nextUser) {
          const token = cloudSyncStore.currentToken();
          void refresh(nextUser, token, refreshGeneration).catch((error: unknown) => {
            if (cloudSyncStore.isCurrent(token) && refreshGenerationRef.current === refreshGeneration) {
              setMessage(errorMessage(error));
            }
          });
        }
      }),
    [],
  );

  // The sync/conflict-resolve buttons live outside this panel now, so pick up their completion
  // here to keep the status card and snapshot list fresh.
  useEffect(() => {
    if (previousBusyRef.current !== null && busy === null && user) {
      const token = cloudSyncStore.currentToken();
      const refreshGeneration = refreshGenerationRef.current;
      void refresh(user, token, refreshGeneration).catch((error: unknown) => {
        if (cloudSyncStore.isCurrent(token) && refreshGenerationRef.current === refreshGeneration) {
          setMessage(errorMessage(error));
        }
      });
    }
    previousBusyRef.current = busy;
  }, [busy, user]);

  const signIn = async () => {
    setBusy("sign-in");
    const token = cloudSyncStore.currentToken();
    setMessage("");
    try {
      const signedInUser = await signInToCloudSync();
      if (!cloudSyncStore.isCurrent(token)) return;
      const isCurrentSignIn = () =>
        cloudSyncStore.isCurrent(token) && getCurrentCloudUser()?.uid === signedInUser.uid;
      setUser(signedInUser);
      setStatus(undefined);
      setSnapshots([]);
      setConflict(undefined);
      const refreshGeneration = refreshGenerationRef.current;
      try {
        await Promise.race([
          refresh(signedInUser, token, refreshGeneration),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("读取云端状态超时，可点击「同步更改」重试。")), 15_000)
          ),
        ]);
      } catch (error) {
        if (isCurrentSignIn()) {
          const message = `已登录 ${signedInUser.email ?? "Google 账号"}，但暂时无法读取云端状态：${errorMessage(error)}`;
          setMessage(message);
          cloudSyncStore.setOutcome("error", message);
        }
        return;
      }
      if (!isCurrentSignIn()) return;
      const message = `已登录 ${signedInUser.email ?? "Google 账号"}。`;
      setMessage(message);
      cloudSyncStore.setOutcome("success", message);
    } catch (error) {
      if (cloudSyncStore.isCurrent(token)) {
        const message = errorMessage(error);
        setMessage(message);
        cloudSyncStore.setOutcome("error", message);
      }
    } finally {
      cloudSyncStore.finishBusy(token);
    }
  };

  const signOut = async () => {
    setBusy("sign-out");
    const token = cloudSyncStore.currentToken();
    setMessage("");
    try {
      await signOutOfCloudSync();
      if (!cloudSyncStore.isCurrent(token)) return;
      const message = "已退出登录。";
      setMessage(message);
      cloudSyncStore.setOutcome("success", message);
    } catch (error) {
      if (cloudSyncStore.isCurrent(token)) {
        const message = errorMessage(error);
        setMessage(message);
        cloudSyncStore.setOutcome("error", message);
      }
    } finally {
      cloudSyncStore.finishBusy(token);
    }
  };

  const restore = async (snapshot: CloudRecoverySnapshot) => {
    if (!user) return;
    const accepted = window.confirm(`恢复"${snapshot.label}"会覆盖当前设备上的同步数据。继续恢复？`);
    if (!accepted) return;
    setBusy("restore");
    const token = cloudSyncStore.currentToken();
    const isCurrentOperation = () =>
      cloudSyncStore.isCurrent(token) && getCurrentCloudUser()?.uid === user.uid;
    setMessage("正在恢复云端快照。");
    try {
      await restoreCloudRecoverySnapshot(user, snapshot.id, {
        onProgress: (event) => {
          if (isCurrentOperation()) setMessage(event.message);
        },
      });
      if (!isCurrentOperation()) return;
      await onRestored();
      if (!isCurrentOperation()) return;
      setMessage("已恢复云端快照。");
      await refresh(user, token, refreshGenerationRef.current);
      if (!isCurrentOperation()) return;
      cloudSyncStore.setOutcome("success", "已恢复云端快照。");
    } catch (error) {
      if (isCurrentOperation()) {
        const message = errorMessage(error);
        setMessage(message);
        cloudSyncStore.setOutcome("error", message);
      }
    } finally {
      cloudSyncStore.finishBusy(token);
    }
  };

  return (
    <section className="more-section backup-actions-section">
      <h2>云同步</h2>
      <div className="more-grid backup-action-grid">
        <SurfaceCard className="more-action-card backup-action-card" variant="raised">
          <div>
            <Cloud size={20} />
            <div>
              <h3>Google Cloud</h3>
              <p>{user ? user.email ?? "已登录" : message || "未登录"}</p>
            </div>
          </div>
          {user ? (
            <button type="button" className="secondary-button" onClick={() => void signOut()} disabled={busy !== null}>
              <LogOut size={18} />
              {busy === "sign-out" ? "退出中..." : "退出登录"}
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => void signIn()} disabled={busy !== null}>
              <LogIn size={18} />
              {busy === "sign-in" ? "登录中..." : "使用 Google 登录"}
            </button>
          )}
        </SurfaceCard>

        {user ? (
          <SurfaceCard className="more-action-card backup-action-card" variant="raised">
            <div>
              <RefreshCw size={20} />
              <div>
                <h3>同步更改</h3>
                <p>{status ? `本机待同步 ${status.localPending} 项 / 云端待拉取 ${status.remotePending} 项` : "点击后检查同步状态"}</p>
              </div>
            </div>
            <CloudSyncButton className="backup-sync-button" onSignedOut={() => undefined} onRestored={onRestored} />
          </SurfaceCard>
        ) : null}

        {user ? (
          <SurfaceCard className="more-action-card backup-action-card" variant="raised">
            <div>
              <History size={20} />
              <div>
                <h3>恢复快照</h3>
                <p>{snapshots.length ? `保留 ${snapshots.length} 份恢复点` : status?.legacySnapshotAvailable ? "检测到旧版完整快照" : "尚无恢复快照"}</p>
              </div>
            </div>
            {snapshots[0] ? (
              <button type="button" className="secondary-button" onClick={() => void restore(snapshots[0])} disabled={busy !== null}>
                <CloudDownload size={18} />
                {busy === "restore" ? "恢复中..." : "恢复最新快照"}
              </button>
            ) : null}
          </SurfaceCard>
        ) : null}
      </div>

      {user && snapshots.length > 0 ? (
        <div className="more-list" aria-label="云端恢复快照">
          {snapshots.map((snapshot) => (
            <button key={snapshot.id} type="button" className="list-row more-summary-row" onClick={() => void restore(snapshot)} disabled={busy !== null}>
              <span className="list-row-content">
                <strong>{snapshot.label}</strong>
                <small>{formatDateTime(snapshot.createdAt)} · {snapshot.entityCount} 项数据 · 修订 {snapshot.revision}</small>
              </span>
              <CloudDownload size={18} />
            </button>
          ))}
        </div>
      ) : null}

      {status?.lastSyncedAt ? <p className="import-warning">上次完成同步：{formatDateTime(status.lastSyncedAt)} / 云端修订 {status.cloudRevision}</p> : null}
      {status?.lastSnapshotMaintenanceError ? (
        <p className="import-warning" role="status">
          {status.lastSnapshotMaintenanceStatus === "deferred-cost" ? "自动恢复点清理已延期" : "后台恢复点清理待重试"}{status.lastSnapshotMaintenanceFailedAt ? `（${formatDateTime(status.lastSnapshotMaintenanceFailedAt)}）` : ""}：{status.lastSnapshotMaintenanceError}
        </p>
      ) : null}
      {status?.lastSnapshotMaintenanceStatus === "deferred-cost" ? (
        <button type="button" className="subtle-button" onClick={() => void runExpensiveMaintenance()} disabled={busy !== null}>
          <Wrench size={16} />
          手动执行高成本维护
        </button>
      ) : null}
      {message ? <p className="import-warning" role="status">{message}</p> : null}
    </section>
  );
};
