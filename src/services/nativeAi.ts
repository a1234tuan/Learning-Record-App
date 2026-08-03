import { Capacitor, registerPlugin } from "@capacitor/core";

import type { AiCompletionResult } from "../types";
import type { AiChatPayloadMessage, AiCompletionRequestOptions } from "./aiClientService";

interface NativeAiPlugin {
  chat(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    messagesJson: string;
    structuredOutput?: boolean;
    thinkingMode?: "enabled" | "disabled";
    reasoningEffort?: "low" | "high" | "max";
    timeoutMs?: number;
  }): Promise<AiCompletionResult>;
}

const NativeAi = registerPlugin<NativeAiPlugin>("NativeAi");

export const canUseNativeAi = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

export const runNativeAiChat = async (options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: AiChatPayloadMessage[];
} & Pick<AiCompletionRequestOptions, "structuredOutput" | "thinkingMode" | "reasoningEffort" | "timeoutMs" | "signal">): Promise<AiCompletionResult> => {
  const { signal, messages, ...nativeOptions } = options;
  const nativePromise = NativeAi.chat({
    ...nativeOptions,
    messagesJson: JSON.stringify(messages),
  });
  if (!signal) return nativePromise;
  if (signal.aborted) throw new DOMException("AI request cancelled", "AbortError");
  return new Promise<AiCompletionResult>((resolve, reject) => {
    const abort = () => reject(new DOMException("AI request cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    nativePromise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
};
