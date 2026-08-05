import { AlertTriangle, Cloud, CloudDownload, History, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "firebase/auth";

import {
  completeGoogleRedirect,
  getCloudSyncStatus,
  listCloudRecoverySnapshots,
  listenToCloudUser,
  resolveCloudSyncConflict,
  restoreCloudRecoverySnapshot,
  signInToCloudSync,
  signOutOfCloudSync,
  synchronizeCloudChanges,
  type CloudRecoverySnapshot,
  type CloudSyncConflict,
  type CloudSyncStatus,
} from "../services/cloudSyncService";
import { SurfaceCard } from "./ui";

interface CloudSyncPanelProps {
  onRestored: () => Promise<void> | void;
}

type BusyAction = "sign-in" | "sign-out" | "sync" | "restore" | "resolve" | null;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "云同步操作失败。";

export const CloudSyncPanel = ({ onRestored }: CloudSyncPanelProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<CloudSyncStatus>();
  const [snapshots, setSnapshots] = useState<CloudRecoverySnapshot[]>([]);
  const [conflict, setConflict] = useState<CloudSyncConflict>();
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState("");

  const refresh = async (nextUser: User) => {
    const [nextStatus, nextSnapshots] = await Promise.all([
      getCloudSyncStatus(nextUser),
      listCloudRecoverySnapshots(nextUser.uid),
    ]);
    setStatus(nextStatus);
    setSnapshots(nextSnapshots);
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
        setUser(nextUser);
        setStatus(undefined);
        setSnapshots([]);
        setConflict(undefined);
        if (!nextUser) setMessage("");
      }),
    [],
  );

  const signIn = async () => {
    setBusy("sign-in");
    setMessage("");
    try {
      const signedInUser = await signInToCloudSync();
      setUser(signedInUser);
      setStatus(undefined);
      setSnapshots([]);
      setConflict(undefined);
      setMessage(`已登录 ${signedInUser.email ?? "Google 账号"}。`);
      try {
        await refresh(signedInUser);
      } catch (error) {
        setMessage(`已登录 ${signedInUser.email ?? "Google 账号"}，但暂时无法读取云端状态：${errorMessage(error)}`);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    setBusy("sign-out");
    setMessage("");
    try {
      await signOutOfCloudSync();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!user) return;
    setBusy("sync");
    setConflict(undefined);
    setMessage("正在检查本机和云端的更改。");
    try {
      const result = await synchronizeCloudChanges(user, { onProgress: (event) => setMessage(event.message) });
      if (result.kind === "conflict") {
        setConflict(result.conflict);
        setMessage("检测到本机和云端都存在未同步的数据，请选择保留哪一侧。");
      } else {
        setMessage(`同步完成：上传 ${result.uploaded} 项，下载 ${result.downloaded} 项。`);
        if (result.restored) await onRestored();
        await refresh(user);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (choice: "local" | "cloud") => {
    if (!user || !conflict) return;
    setBusy("resolve");
    setMessage(choice === "local" ? "正在以本机数据更新云端。" : "正在保存本机恢复点并恢复云端数据。");
    try {
      const result = await resolveCloudSyncConflict(user, choice, { onProgress: (event) => setMessage(event.message) });
      if (result.kind === "conflict") {
        setConflict(result.conflict);
        setMessage("云端状态已变化，请重新选择同步策略。");
        return;
      }
      setConflict(undefined);
      setMessage(`同步完成：上传 ${result.uploaded} 项，下载 ${result.downloaded} 项。`);
      if (choice === "cloud") await onRestored();
      await refresh(user);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (snapshot: CloudRecoverySnapshot) => {
    if (!user) return;
    const accepted = window.confirm(`恢复“${snapshot.label}”会覆盖当前设备上的同步数据。继续恢复？`);
    if (!accepted) return;
    setBusy("restore");
    setMessage("正在恢复云端快照。");
    try {
      await restoreCloudRecoverySnapshot(user, snapshot.id, { onProgress: (event) => setMessage(event.message) });
      await onRestored();
      setMessage("已恢复云端快照。");
      await refresh(user);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
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
            <button type="button" className="primary-button" onClick={() => void sync()} disabled={busy !== null}>
              <RefreshCw size={18} />
              {busy === "sync" ? "同步中..." : "同步更改"}
            </button>
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

      {conflict ? (
        <div className="import-warning" role="alert">
          <p><AlertTriangle size={16} /> {conflict.reason === "legacy-snapshot" ? "检测到旧版完整云端备份。" : "检测到双端并发编辑。"}</p>
          <p>本机 {conflict.localChanges} 项，云端 {conflict.remoteChanges} 项。选择前会保留恢复点。</p>
          <div className="backup-action-grid">
            <button type="button" className="primary-button" onClick={() => void resolve("local")} disabled={busy !== null}>以本机为准</button>
            <button type="button" className="secondary-button" onClick={() => void resolve("cloud")} disabled={busy !== null}>以云端为准</button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setConflict(undefined);
                setMessage("已取消，本机和云端数据均未修改。");
              }}
              disabled={busy !== null}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
      {status?.lastSyncedAt ? <p className="import-warning">上次完成同步：{formatDateTime(status.lastSyncedAt)} / 云端修订 {status.cloudRevision}</p> : null}
      {message ? <p className="import-warning" role="status">{message}</p> : null}
    </section>
  );
};
