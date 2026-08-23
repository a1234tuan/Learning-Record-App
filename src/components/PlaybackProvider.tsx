import { App as CapacitorApp } from "@capacitor/app";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  PlaybackPreparationCancelledError,
  preparePlaybackSession,
  removePreparedPlaybackSession,
  removeStalePlaybackSessions,
  type PlaybackQueueRequest,
  type PreparedPlaybackSession,
} from "../services/mediaPlaybackService";
import {
  addNativeMediaStateListener,
  canUseNativeMediaPlayback,
  getNativeMediaState,
  nextNativeMedia,
  pauseNativeMedia,
  playNativeMedia,
  prepareNativeMediaPlayback,
  previousNativeMedia,
  requestNativeMediaNotificationPermission,
  seekNativeMediaBy,
  seekNativeMediaTo,
  setNativeMediaMode,
  setNativeMediaSpeed,
  stopNativeMedia,
  type NativePlaybackState,
  type PlaybackMode,
} from "../services/nativeMediaPlayback";

const EMPTY_STATE: NativePlaybackState = {
  status: "idle",
  index: 0,
  positionSeconds: 0,
  durationSeconds: 0,
  speed: 1,
  mode: "order",
};

export interface PlaybackPreparationState {
  active: boolean;
  writtenBytes: number;
  totalBytes: number;
}

interface PlaybackContextValue {
  nativeAvailable: boolean;
  nativeEnabled: boolean;
  state: NativePlaybackState;
  preparing: PlaybackPreparationState;
  notificationUnavailable: boolean;
  startQueue: (request: PlaybackQueueRequest) => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seekBy: (offsetSeconds: number) => Promise<void>;
  seekTo: (positionSeconds: number) => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  setMode: (mode: PlaybackMode) => Promise<void>;
}

const unavailablePlayback: PlaybackContextValue = {
  nativeAvailable: false,
  nativeEnabled: false,
  state: EMPTY_STATE,
  preparing: { active: false, writtenBytes: 0, totalBytes: 0 },
  notificationUnavailable: false,
  startQueue: async () => { throw new Error("当前平台不支持后台媒体播放。"); },
  play: async () => undefined,
  pause: async () => undefined,
  stop: async () => undefined,
  next: async () => undefined,
  previous: async () => undefined,
  seekBy: async () => undefined,
  seekTo: async () => undefined,
  setSpeed: async () => undefined,
  setMode: async () => undefined,
};

const PlaybackContext = createContext<PlaybackContextValue>(unavailablePlayback);

export const PlaybackProvider = ({ children }: { children: ReactNode }) => {
  const nativeAvailable = canUseNativeMediaPlayback();
  const [nativeEnabled, setNativeEnabled] = useState(nativeAvailable);
  const [state, setState] = useState<NativePlaybackState>(EMPTY_STATE);
  const [preparing, setPreparing] = useState<PlaybackPreparationState>({ active: false, writtenBytes: 0, totalBytes: 0 });
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  const activeSessionRef = useRef<PreparedPlaybackSession>();
  const requestTokenRef = useRef(0);

  const syncState = useCallback(async () => {
    if (!nativeAvailable) return;
    const next = await getNativeMediaState().catch(() => undefined);
    if (next) setState(next);
  }, [nativeAvailable]);

  useEffect(() => {
    if (!nativeAvailable) return undefined;
    let disposed = false;
    let nativeHandle: { remove: () => Promise<void> } | undefined;
    let appHandle: { remove: () => Promise<void> } | undefined;
    void addNativeMediaStateListener((next) => {
      if (!disposed) {
        setState(next);
        const active = activeSessionRef.current;
        if (next.status === "ended" && active?.queueId === next.queueId) {
          activeSessionRef.current = undefined;
          void stopNativeMedia().finally(() => void removePreparedPlaybackSession(active));
        }
      }
    }).then((handle) => { nativeHandle = handle; });
    void CapacitorApp.addListener("resume", () => { void syncState(); }).then((handle) => { appHandle = handle; });
    void syncState();
    void removeStalePlaybackSessions();
    return () => {
      disposed = true;
      void nativeHandle?.remove();
      void appHandle?.remove();
    };
  }, [nativeAvailable, syncState]);

  useEffect(() => {
    setNativeEnabled(nativeAvailable);
  }, [nativeAvailable]);

  const startQueue = useCallback(async (request: PlaybackQueueRequest) => {
    if (!nativeAvailable || !nativeEnabled) {
      throw new Error("当前平台不支持后台媒体播放。");
    }
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    setPreparing({ active: true, writtenBytes: 0, totalBytes: request.items.reduce((total, item) => total + item.asset.size, 0) });
    let session: PreparedPlaybackSession | undefined;
    try {
      session = await preparePlaybackSession(
        request,
        () => requestTokenRef.current !== token,
        (writtenBytes, totalBytes) => {
          if (requestTokenRef.current === token) setPreparing({ active: true, writtenBytes, totalBytes });
        },
      );
      if (requestTokenRef.current !== token) throw new PlaybackPreparationCancelledError();
      const notificationGranted = await requestNativeMediaNotificationPermission();
      if (requestTokenRef.current === token) setNotificationUnavailable(!notificationGranted);
      try {
        await prepareNativeMediaPlayback({
          items: session.items,
          initialIndex: session.initialIndex,
          positionSeconds: request.positionSeconds ?? 0,
          speed: request.speed ?? 1,
          mode: request.mode ?? "order",
        });
      } catch (error) {
        // A decoder failure belongs to this queue/item. Keep the native service
        // available so the next valid queue can still use MediaSession controls.
        setState(EMPTY_STATE);
        await stopNativeMedia().catch(() => undefined);
        const detail = error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message ?? "未知错误")
            : String(error ?? "未知错误");
        throw new Error(`Android 后台播放器不可用，已切换为普通播放：${detail}`);
      }
      const previousSession = activeSessionRef.current;
      activeSessionRef.current = session;
      session = undefined;
      await removePreparedPlaybackSession(previousSession);
    } finally {
      if (session) await removePreparedPlaybackSession(session);
      if (requestTokenRef.current === token) setPreparing({ active: false, writtenBytes: 0, totalBytes: 0 });
    }
  }, [nativeAvailable, nativeEnabled]);

  const stop = useCallback(async () => {
    requestTokenRef.current += 1;
    if (nativeAvailable) await stopNativeMedia();
    await removePreparedPlaybackSession(activeSessionRef.current);
    activeSessionRef.current = undefined;
    setState(EMPTY_STATE);
    setPreparing({ active: false, writtenBytes: 0, totalBytes: 0 });
    setNotificationUnavailable(false);
  }, [nativeAvailable]);

  const value = useMemo<PlaybackContextValue>(() => ({
    nativeAvailable,
    nativeEnabled,
    state,
    preparing,
    notificationUnavailable,
    startQueue,
    play: async () => { if (nativeAvailable && nativeEnabled) await playNativeMedia(); },
    pause: async () => { if (nativeAvailable && nativeEnabled) await pauseNativeMedia(); },
    stop,
    next: async () => { if (nativeAvailable && nativeEnabled) await nextNativeMedia(); },
    previous: async () => { if (nativeAvailable && nativeEnabled) await previousNativeMedia(); },
    seekBy: async (offsetSeconds) => { if (nativeAvailable && nativeEnabled) await seekNativeMediaBy(offsetSeconds); },
    seekTo: async (positionSeconds) => { if (nativeAvailable && nativeEnabled) await seekNativeMediaTo(positionSeconds); },
    setSpeed: async (speed) => { if (nativeAvailable && nativeEnabled) await setNativeMediaSpeed(speed); },
    setMode: async (mode) => { if (nativeAvailable && nativeEnabled) await setNativeMediaMode(mode); },
  }), [nativeAvailable, nativeEnabled, notificationUnavailable, preparing, startQueue, state, stop]);

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
};

export const usePlayback = (): PlaybackContextValue => {
  return useContext(PlaybackContext);
};
