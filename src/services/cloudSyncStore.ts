import { useSyncExternalStore } from "react";
import type { CloudSyncConflict } from "./cloudSyncService";

export type BusyAction = "sign-in" | "sign-out" | "sync" | "restore" | "resolve" | null;

interface CloudSyncState {
  busy: BusyAction;
  message: string;
  conflict: CloudSyncConflict | undefined;
  /** Bumped whenever a new operation starts (or a stale one is force-cleared). Lets an in-flight
   *  async call check `isCurrent(token)` before writing results, so an interrupted/superseded sync
   *  can never clobber state set by a later one. */
  token: number;
}

/**
 * Safety net for a sync that never reaches its finally block (for example, when Android
 * suspends the WebView mid-request). A single Storage download is allowed to run for five
 * minutes on native, so this must be longer than that request timeout. Otherwise a perfectly
 * healthy, large restore is reported as a suspended app at the two-minute mark.
 */
export const CLOUD_SYNC_WATCHDOG_MS = 6 * 60_000;

let state: CloudSyncState = { busy: null, message: "", conflict: undefined, token: 0 };
const listeners = new Set<() => void>();
let watchdogTimer: number | undefined;
let backgroundedWhileBusy = false;

const notify = () => listeners.forEach((l) => l());

const clearWatchdog = () => {
  if (watchdogTimer !== undefined) {
    window.clearTimeout(watchdogTimer);
    watchdogTimer = undefined;
  }
};

const armWatchdog = (token: number) => {
  clearWatchdog();
  watchdogTimer = window.setTimeout(() => {
    if (state.token === token && state.busy !== null) {
      state = { ...state, busy: null, token: state.token + 1, message: "同步未在预期时间内完成，可能是应用被系统挂起，请重新点击同步。" };
      notify();
    }
  }, CLOUD_SYNC_WATCHDOG_MS);
};

export const cloudSyncStore = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  setBusy: (busy: BusyAction) => {
    state = { ...state, busy, token: busy !== null ? state.token + 1 : state.token };
    notify();
    if (busy !== null) armWatchdog(state.token);
    else clearWatchdog();
  },
  /** A progress message proves the operation is still alive, so give its watchdog a fresh window. */
  setMessage: (message: string) => {
    state = { ...state, message };
    if (state.busy !== null) armWatchdog(state.token);
    notify();
  },
  setConflict: (conflict: CloudSyncConflict | undefined) => { state = { ...state, conflict }; notify(); },
  /** Token for the operation just started by setBusy(). Capture right after setBusy and pass to isCurrent(). */
  currentToken: () => state.token,
  /** False once a newer operation started, or the watchdog/background guard force-cleared this one —
   *  callers should skip writing their result when this returns false. */
  isCurrent: (token: number) => state.token === token,
};

export const useCloudSyncStore = () =>
  useSyncExternalStore(cloudSyncStore.subscribe, cloudSyncStore.getSnapshot);

/** Cross-platform "app left/returned to foreground" signal (visibilitychange covers web, desktop
 *  Electron, and Android WebView). If we go to background mid-sync and come back still busy, the
 *  in-flight request most likely got suspended by the OS — clear busy immediately instead of making
 *  the user wait out the watchdog, and tell them what happened. */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (state.busy !== null) backgroundedWhileBusy = true;
      return;
    }
    if (document.visibilityState === "visible") {
      if (backgroundedWhileBusy && state.busy !== null) {
        clearWatchdog();
        state = {
          ...state,
          busy: null,
          token: state.token + 1,
          message: "应用切到后台时同步被中断，请重新点击同步。",
        };
        notify();
      }
      backgroundedWhileBusy = false;
    }
  });
}
