import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type PlaybackMode = "order" | "single" | "shuffle";

export interface NativePlaybackQueueItem {
  assetId: string;
  uri: string;
  title: string;
  subtitle: string;
  mimeType: string;
  queueId: string;
  durationSeconds?: number;
}

export interface NativePlaybackState {
  status: "idle" | "paused" | "playing" | "ended";
  queueId?: string;
  itemId?: string;
  index: number;
  positionSeconds: number;
  durationSeconds: number;
  speed: number;
  mode: PlaybackMode;
  error?: string;
}

interface NativeMediaPlaybackPlugin {
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  prepareAndPlay(options: {
    items: NativePlaybackQueueItem[];
    initialIndex: number;
    positionSeconds: number;
    speed: number;
    mode: PlaybackMode;
  }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seekBy(options: { offsetSeconds: number }): Promise<void>;
  seekTo(options: { positionSeconds: number }): Promise<void>;
  setSpeed(options: { speed: number }): Promise<void>;
  setMode(options: { mode: PlaybackMode }): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<{ state?: NativePlaybackState }>;
  getAvailableBytes(): Promise<{ availableBytes: number }>;
  addListener(eventName: "stateChanged", listenerFunc: (state: NativePlaybackState) => void): Promise<PluginListenerHandle>;
}

const NativeMediaPlayback = registerPlugin<NativeMediaPlaybackPlugin>("NativeMediaPlayback");

export const canUseNativeMediaPlayback = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const requestNativeMediaNotificationPermission = async (): Promise<boolean> => {
  if (!canUseNativeMediaPlayback()) return true;
  return (await NativeMediaPlayback.requestNotificationPermission()).granted;
};

export const prepareNativeMediaPlayback = async (options: Parameters<NativeMediaPlaybackPlugin["prepareAndPlay"]>[0]): Promise<void> => {
  await NativeMediaPlayback.prepareAndPlay(options);
};

export const playNativeMedia = async (): Promise<void> => { await NativeMediaPlayback.play(); };
export const pauseNativeMedia = async (): Promise<void> => { await NativeMediaPlayback.pause(); };
export const nextNativeMedia = async (): Promise<void> => { await NativeMediaPlayback.next(); };
export const previousNativeMedia = async (): Promise<void> => { await NativeMediaPlayback.previous(); };
export const seekNativeMediaBy = async (offsetSeconds: number): Promise<void> => { await NativeMediaPlayback.seekBy({ offsetSeconds }); };
export const seekNativeMediaTo = async (positionSeconds: number): Promise<void> => { await NativeMediaPlayback.seekTo({ positionSeconds }); };
export const setNativeMediaSpeed = async (speed: number): Promise<void> => { await NativeMediaPlayback.setSpeed({ speed }); };
export const setNativeMediaMode = async (mode: PlaybackMode): Promise<void> => { await NativeMediaPlayback.setMode({ mode }); };
export const stopNativeMedia = async (): Promise<void> => { await NativeMediaPlayback.stop(); };

export const getNativeMediaState = async (): Promise<NativePlaybackState | undefined> => {
  if (!canUseNativeMediaPlayback()) return undefined;
  return (await NativeMediaPlayback.getState()).state;
};

export const getNativeMediaAvailableBytes = async (): Promise<number | undefined> => {
  if (!canUseNativeMediaPlayback()) return undefined;
  return (await NativeMediaPlayback.getAvailableBytes()).availableBytes;
};

export const addNativeMediaStateListener = async (listener: (state: NativePlaybackState) => void): Promise<PluginListenerHandle | undefined> => {
  if (!canUseNativeMediaPlayback()) return undefined;
  return NativeMediaPlayback.addListener("stateChanged", listener);
};
