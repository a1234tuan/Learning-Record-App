import { Capacitor, registerPlugin } from "@capacitor/core";

interface TtsRequestOptions {
  apiKey: string;
  model: string;
  voiceId: string;
  text: string;
  format: "mp3";
}

interface NativeTtsPlugin {
  synthesize(options: TtsRequestOptions): Promise<{ data: string; mimeType?: string }>;
}

const NativeTts = registerPlugin<NativeTtsPlugin>("NativeTts");

const base64ToBlob = (data: string, mimeType = "audio/mpeg"): Blob => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
};

export const synthesizeFishAudioOnHost = async (options: TtsRequestOptions, signal?: AbortSignal): Promise<Blob | undefined> => {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    if (signal?.aborted) throw new DOMException("TTS cancelled", "AbortError");
    const result = await NativeTts.synthesize(options);
    if (signal?.aborted) throw new DOMException("TTS cancelled", "AbortError");
    return base64ToBlob(result.data, result.mimeType);
  }
  const desktopTts = typeof window !== "undefined" ? window.studyJournalDesktop?.tts : undefined;
  if (desktopTts) {
    if (signal?.aborted) throw new DOMException("TTS cancelled", "AbortError");
    const result = await desktopTts.synthesize(options);
    if (signal?.aborted) throw new DOMException("TTS cancelled", "AbortError");
    return base64ToBlob(result.data, result.mimeType);
  }
  return undefined;
};
