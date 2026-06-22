import type { AppSettings, StorageAdapter } from "../types";
import { nowISO } from "../lib/date";
import { autoBackupAdapter, type AutoBackupAdapter } from "./autoBackupAdapter";
import { storage } from "./storageAdapter";

const DEFAULT_DEBOUNCE_MS = 45_000;

let timer: number | undefined;
let running = false;
let dirty = false;

const withAutoBackupDefaults = (settings: AppSettings): AppSettings => ({
  ...settings,
  autoBackup: {
    enabled: settings.autoBackup?.enabled ?? false,
    debounceMs: settings.autoBackup?.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    folderName: settings.autoBackup?.folderName,
    lastBackupAt: settings.autoBackup?.lastBackupAt,
    lastBackupSize: settings.autoBackup?.lastBackupSize,
    lastError: settings.autoBackup?.lastError,
  },
});

export const getAutoBackupSettings = (settings: AppSettings) => withAutoBackupDefaults(settings).autoBackup;

const currentAutoBackup = (settings: AppSettings) =>
  withAutoBackupDefaults(settings).autoBackup ?? { enabled: false, debounceMs: DEFAULT_DEBOUNCE_MS };

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
  if (running) {
    return withAutoBackupDefaults(await store.getSettings());
  }

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

  running = true;
  try {
    const result = await adapter.writeLatest(await store.createSnapshot());
    dirty = false;
    const nextSettings: AppSettings = {
      ...settings,
      autoBackup: {
        ...currentAutoBackup(settings),
        enabled: true,
        folderName: result.folderName ?? bound.folderName ?? settings.autoBackup.folderName,
        lastBackupAt: nowISO(),
        lastBackupSize: result.size,
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
  } finally {
    running = false;
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
