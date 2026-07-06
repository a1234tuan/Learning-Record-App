import { Capacitor, registerPlugin } from "@capacitor/core";

import { base64ToBlob } from "./backup";

export interface NativeAudioRecordingStatus {
  recording: boolean;
  startedAt?: number;
}

interface NativeAudioRecorderPlugin {
  start(): Promise<void>;
  stop(): Promise<{ data: string; fileName: string; mimeType: string }>;
  status(): Promise<NativeAudioRecordingStatus>;
}

const NativeAudioRecorder = registerPlugin<NativeAudioRecorderPlugin>("NativeAudioRecorder");

export const canUseNativeAudioRecorder = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const startNativeAudioRecording = async (): Promise<void> => {
  await NativeAudioRecorder.start();
};

export const stopNativeAudioRecording = async (): Promise<File> => {
  const result = await NativeAudioRecorder.stop();
  const blob = base64ToBlob(result.data, result.mimeType || "audio/mp4");
  return new File([blob], result.fileName || `recording-${Date.now()}.m4a`, {
    type: result.mimeType || "audio/mp4",
  });
};

export const getNativeAudioRecordingStatus = async (): Promise<NativeAudioRecordingStatus> => {
  if (!canUseNativeAudioRecorder()) {
    return { recording: false };
  }
  return NativeAudioRecorder.status();
};
