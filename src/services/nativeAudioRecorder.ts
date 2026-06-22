import { Capacitor, registerPlugin } from "@capacitor/core";

import { base64ToBlob } from "./backup";

interface NativeAudioRecorderPlugin {
  start(): Promise<void>;
  stop(): Promise<{ data: string; fileName: string; mimeType: string }>;
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
