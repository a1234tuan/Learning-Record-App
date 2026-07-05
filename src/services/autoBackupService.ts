import type { AppSettings, StorageAdapter } from "../types";
import { nowISO } from "../lib/date";
import { autoBackupAdapter, type AutoBackupAdapter } from "./autoBackupAdapter";
import { storage } from "./storageAdapter";

const DEFAULT_DEBOUNCE_MS = 45_000;

let timer: number | undefined;
let runningPromise: Promise<AppSettings> | undefined;
let dirty = false;

const withAutoBackupDefaults = (settings: AppSettings): AppSettings => ({
  ...settings,
  autoBackup: {
    enabled: settings.autoBackup?.enabled ?? false,
    debounceMs: settings.autoBackup?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    folderName: settings.autoBackup?.folderName,
    lastBackupAt: settings.autoBackup?.lastBackupAt,
    lastBackupSize: settings.autoBackup?.lastBackupSize,
    lastBackupFileName: settings.autoBackup?.lastBackupFileName,
    lastBackupUri: settings.autoBackup?.lastBackupUri,
    lastBackupVerifiedAt: settings.autoBackup?.lastBackupVerifiedAt,
    lastBackupFileModifiedAt: settings.autoBackup?.lastBackupFileModifiedAt,
    lastBackupWarning: settings.autoBackup?.lastBackupWarning,
    lastError: settings.autoBackup?.lastError,
  },
});

export const getAutoBackupSettings = (settings: AppSettings) => withAutoBackupDefaults(settings).autoBackup;

const currentAutoBackup = (settings: AppSettings) =>
  withAutoBackupDefaults(settings).autoBackup ?? { enabled: false, debounceMs: DEFAULT_DEBOUNCE_MS };

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
): Promise<AppSettings> => {
  const settings = withAutoBackupDefaults(await store.getSettings());
  if (enabled && !adapter.isAvailable()) {
    throw new Error("当前环境不支持自动备份文件夹绑定，请使用手动导出 zip。");
  }
  const nextSettings: AppSettings = {
    ...settings,
    autoBackup: {
      ...currentAutoBackup(settings),
      enabled,
      lastError: enabled ? settings.autoBackup?.lastError : undefined,
    },
  };
  await store.saveSettings(nextSettings);
  return nextSettings;
};

export const bindAutoBackupFolder = async (
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<AppSettings> => {
  if (!adapter.isAvailable()) {
    throw new Error("当前环境不支持自动备份文件夹绑定，请使用手动导出 zip。");
  }
  const bound = await adapter.bindFolder();
  const settings = withAutoBackupDefaults(await store.getSettings());
  const nextSettings: AppSettings = {
    ...settings,
    autoBackup: {
      ...currentAutoBackup(settings),
      enabled: true,
      folderName: bound.folderName,
      lastError: undefined,
    },
  };
  await store.saveSettings(nextSettings);
  return nextSettings;
};

export const flushAutoBackupNow = async (
  reason = "manual",
  adapter: AutoBackupAdapter = autoBackupAdapter,
  store: StorageAdapter = storage,
): Promise<AppSettings> => {
  void reason;
  if (timer) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  if (runningPromise) {
    return runningPromise;
  }

  runningPromise = (async () => {
    const settings = withAutoBackupDefaults(await store.getSettings());
    if (!settings.autoBackup?.enabled) {
      return settings;
    }

    const bound = await adapter.isBound();
    if (!bound.bound) {
      const nextSettings: AppSettings = {
        ...settings,
        autoBackup: {
          ...currentAutoBackup(settings),
          lastError: "尚未绑定自动备份文件夹。",
        },
      };
      await store.saveSettings(nextSettings);
      return nextSettings;
    }

    try {
      const result = await adapter.writeLatest(store);
      ensureValidWriteResult(result);
      dirty = false;
      const nextSettings: AppSettings = {
        ...settings,
        autoBackup: {
          ...currentAutoBackup(settings),
          enabled: true,
          folderName: result.folderName ?? bound.folderName ?? settings.autoBackup.folderName,
          lastBackupAt: nowISO(),
          lastBackupSize: result.size,
          lastBackupFileName: result.displayName ?? "study-journal-latest.zip",
          lastBackupUri: result.uri,
          lastBackupVerifiedAt: timestampToISO(result.verifiedAt) ?? nowISO(),
          lastBackupFileModifiedAt: timestampToISO(result.lastModified),
          lastBackupWarning: result.warning,
          lastError: undefined,
        },
      };
      await store.saveSettings(nextSettings);
      return nextSettings;
    } catch (error) {
      const nextSettings: AppSettings = {
        ...settings,
        autoBackup: {
          ...currentAutoBackup(settings),
          lastError: error instanceof Error ? error.message : "自动备份失败。",
        },
      };
      await store.saveSettings(nextSettings);
      return nextSettings;
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
  dirty = true;
  let settings;
  try {
    settings = getAutoBackupSettings(await store.getSettings());
  } catch {
    return;
  }
  if (!settings?.enabled) {
    return;
  }
  if (timer) {
    window.clearTimeout(timer);
  }
  timer = window.setTimeout(() => {
    timer = undefined;
    if (dirty) {
      void flushAutoBackupNow("debounced", adapter, store);
    }
  }, settings.debounceMs ?? DEFAULT_DEBOUNCE_MS);
};

export const onAppBackgroundAutoBackup = async (): Promise<void> => {
  if (dirty) {
    await flushAutoBackupNow("background");
  }
};
