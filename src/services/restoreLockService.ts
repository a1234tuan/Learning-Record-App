import { useSyncExternalStore } from "react";

import { setAutoBackupSuspended } from "./autoBackupService";

type RestoreLockListener = () => void;

let restoreInProgress = false;
const listeners = new Set<RestoreLockListener>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const isRestoreInProgress = (): boolean => restoreInProgress;

export const subscribeRestoreLock = (listener: RestoreLockListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setRestoreInProgress = (value: boolean): void => {
  if (restoreInProgress === value) {
    return;
  }
  restoreInProgress = value;
  setAutoBackupSuspended(value);
  notify();
};

export const withRestoreLock = async <T>(task: () => Promise<T>): Promise<T> => {
  if (restoreInProgress) {
    throw new Error("已有恢复任务正在进行，请稍候再试。");
  }
  setRestoreInProgress(true);
  try {
    return await task();
  } finally {
    setRestoreInProgress(false);
  }
};

export const useRestoreInProgress = (): boolean =>
  useSyncExternalStore(subscribeRestoreLock, isRestoreInProgress, isRestoreInProgress);
