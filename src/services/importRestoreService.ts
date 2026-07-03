import type { ImportOptions, ImportSummary, StorageAdapter, SyncAdapter } from "../types";
import { summarizeSnapshot } from "./backup";
import { flushAutoBackupNow } from "./autoBackupService";
import { storage } from "./storageAdapter";

interface ImportAndRestoreOptions extends ImportOptions {
  adapter: SyncAdapter;
  onRestored: () => Promise<void> | void;
  onSummary?: (summary: ImportSummary) => void;
  onAutoBackupError?: (detail: string) => void;
}

export const restoreImportedSnapshot = async (
  store: StorageAdapter,
  adapter: SyncAdapter,
  options: ImportOptions = {},
): Promise<ImportSummary | undefined> => {
  if (adapter.importAndRestoreSnapshot) {
    return adapter.importAndRestoreSnapshot(store, options);
  }
  const snapshot = await adapter.importSnapshot?.(options);
  if (!snapshot) {
    return undefined;
  }
  const summary = summarizeSnapshot(snapshot);
  options.onProgress?.({ stage: "restoring", message: "备份已通过校验，正在覆盖当前本地数据。" });
  await store.restoreSnapshot(snapshot);
  return summary;
};

export const importAndRestoreSnapshot = async ({
  adapter,
  onRestored,
  onSummary,
  onAutoBackupError,
  ...options
}: ImportAndRestoreOptions): Promise<ImportSummary | undefined> => {
  const summary = await restoreImportedSnapshot(storage, adapter, options);
  if (!summary) {
    return undefined;
  }
  onSummary?.(summary);
  await onRestored();
  void flushAutoBackupNow("restore").catch((error: unknown) => {
    onAutoBackupError?.(error instanceof Error ? error.message : String(error));
  });
  return summary;
};
