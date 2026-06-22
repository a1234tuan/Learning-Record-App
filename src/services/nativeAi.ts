import { Capacitor, registerPlugin } from "@capacitor/core";

interface NativeAiPlugin {
  chat(options: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    messagesJson: string;
  }): Promise<{ content: string }>;
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
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}): Promise<string> => {
  const result = await NativeAi.chat({
    ...options,
    messagesJson: JSON.stringify(options.messages),
  });
  return result.content;
};
