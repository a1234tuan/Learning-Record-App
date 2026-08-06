import type { AutoBackupSettings, StorageAdapter } from "../types";
import { nowISO } from "../lib/date";
import { autoBackupAdapter, type AutoBackupAdapter } from "./autoBackupAdapter";
import { storage } from "./storageAdapter";

const DEFAULT_DEBOUNCE_MS = 600_000;

let runningPromise: Promise<AutoBackupSettings> | undefined;
let dirtyTimer: number | undefined;
let dirtyGeneration = 0;
let suspended = false;

const withAutoBackupDefaults = (state: AutoBackupSettings): AutoBackupSettings => ({
  enabled: state.enabled ?? false,
  debounceMs: state.debounceMs ?? DEFAULT_DEBOUNCE_MS,
  folderName: state.folderName,
  backupFormat: state.backupFormat,
  lastBackupAt: state.lastBackupAt,
  lastBackupSize: state.lastBackupSize,
  lastBackupBytesWritten: state.lastBackupBytesWritten,
  lastBackupRepositorySize: state.lastBackupRepositorySize,
  lastBackupAssetCount: state.lastBackupAssetCount,
  lastBackupSnapshotId: state.lastBackupSnapshotId,
  lastBackupFileName: state.lastBackupFileName,
  lastBackupUri: state.lastBackupUri,
  lastBackupVerifiedAt: state.lastBackupVerifiedAt,
  lastBackupFileModifiedAt: state.lastBackupFileModifiedAt,
  lastBackupWarning: state.lastBackupWarning,
  lastError: state.lastError,
});

export const getAutoBackupSettings = (state: AutoBackupSettings): AutoBackupSettings => withAutoBackupDefaults(state);

const currentAutoBackup = (state: AutoBackupSettings): AutoBackupSettings =>
  withAutoBackupDefaults(state);

const ensureValidWriteResult = (result: { size: number }) => {
  if (!Number.isFinite(result.size) || result.size <= 0) {
    throw new Error("自动备份写入结果为空。");
  }
};

const timestampToISO = (value: number | undefined): string | undefined => {
  if (!value || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return new Date(value).toISOString();
};

export const setAutoBackupEnabled = async (
  enabled: boolean,
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<AutoBackupSettings> => {
  const state = withAutoBackupDefaults(await store.getAutoBackupState());
  if (enabled && !adapter.isAvailable()) {
    throw new Error("当前环境不支持自动备份文件夹绑定，请使用手动导出 zip。");
  }
  const next: AutoBackupSettings = {
    ...currentAutoBackup(state),
    enabled,
    lastError: enabled ? state.lastError : undefined,
  };
  await store.saveAutoBackupState(next);
  return next;
};

export const bindAutoBackupFolder = async (
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<AutoBackupSettings> => {
  if (!adapter.isAvailable()) {
    throw new Error("当前环境不支持自动备份文件夹绑定，请使用手动导出 zip。");
  }
  const bound = await adapter.bindFolder();
  const state = withAutoBackupDefaults(await store.getAutoBackupState());
  const next: AutoBackupSettings = {
    ...currentAutoBackup(state),
    enabled: state.enabled ?? false,
    folderName: bound.folderName,
    lastError: undefined,
  };
  await store.saveAutoBackupState(next);
  return next;
};

export const flushAutoBackupNow = async (
  reason = "manual",
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<AutoBackupSettings> => {
  void reason;
  if (suspended) {
    return withAutoBackupDefaults(await store.getAutoBackupState());
  }
  if (runningPromise) {
    return runningPromise;
  }

  runningPromise = (async () => {
    const state = withAutoBackupDefaults(await store.getAutoBackupState());
    if (!state.enabled) {
      return state;
    }

    const bound = await adapter.isBound();
    if (!bound.bound) {
      const next: AutoBackupSettings = {
        ...currentAutoBackup(state),
        lastError: "尚未绑定自动备份文件夹。",
      };
      await store.saveAutoBackupState(next);
      return next;
    }

    try {
      const result = await adapter.writeLatest(store);
      ensureValidWriteResult(result);
      const next: AutoBackupSettings = {
        ...currentAutoBackup(state),
        enabled: true,
        folderName: result.folderName ?? bound.folderName ?? state.folderName,
        backupFormat: result.format ?? "zip-latest",
        lastBackupAt: nowISO(),
        lastBackupSize: result.size,
        lastBackupBytesWritten: result.bytesWritten,
        lastBackupRepositorySize: result.repositorySize,
        lastBackupAssetCount: result.assetCount,
        lastBackupSnapshotId: result.snapshotId,
        lastBackupFileName: result.displayName ?? "study-journal-latest.zip",
        lastBackupUri: result.uri,
        lastBackupVerifiedAt: timestampToISO(result.verifiedAt) ?? nowISO(),
        lastBackupFileModifiedAt: timestampToISO(result.lastModified),
        lastBackupWarning: result.warning,
        lastError: undefined,
      };
      await store.saveAutoBackupState(next);
      return next;
    } catch (error) {
      const next: AutoBackupSettings = {
        ...currentAutoBackup(state),
        lastError: error instanceof Error ? error.message : "自动备份失败。",
      };
      await store.saveAutoBackupState(next);
      return next;
    }
  })();

  try {
    return await runningPromise;
  } finally {
    runningPromise = undefined;
  }
};

export const markAutoBackupDirty = async (
  reason = "change",
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<void> => {
  void reason;
  if (suspended) {
    return;
  }
  if (typeof store.getAutoBackupState !== "function") {
    return;
  }
  const state = withAutoBackupDefaults(await store.getAutoBackupState());
  if (!state.enabled) {
    return;
  }
  dirtyGeneration += 1;
  const generation = dirtyGeneration;
  if (dirtyTimer !== undefined) {
    window.clearTimeout(dirtyTimer);
  }
  dirtyTimer = window.setTimeout(() => {
    dirtyTimer = undefined;
    if (!suspended && generation === dirtyGeneration) {
      void flushAutoBackupNow("dirty", adapter, store);
    }
  }, Math.max(1_000, state.debounceMs ?? DEFAULT_DEBOUNCE_MS));
};

export const setAutoBackupSuspended = (value: boolean): void => {
  suspended = value;
  if (value && dirtyTimer !== undefined) {
    window.clearTimeout(dirtyTimer);
    dirtyTimer = undefined;
  }
};

export const onAppBackgroundAutoBackup = async (
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<void> => {
  if (!suspended) {
    await flushAutoBackupNow("background", adapter, store);
  }
};
