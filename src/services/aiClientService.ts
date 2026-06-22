import type { AiChatMessage, AiLogContextAttachment, AiProviderConfig } from "../types";
import { canUseNativeAi, runNativeAiChat } from "./nativeAi";

export type AiChatPayloadMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SYSTEM_PROMPT = [
  "你是一个学习教练，回答必须基于用户提供的本地学习日志。",
  "日志中没有的信息请明确说不知道，不要编造。",
  "你可以帮助用户自测、抽问、总结薄弱点、制定复习计划。",
  "如果用户要求出题，先出题并等待用户回答，除非用户明确要求直接给答案。",
].join("\n");

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("请先填写 AI 接口 baseURL。");
  }
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
};

export const DEFAULT_AI_MEMORY_TURNS = 12;

export const selectRecentChatContext = (
  history: AiChatMessage[],
  memoryTurns = DEFAULT_AI_MEMORY_TURNS,
): AiChatPayloadMessage[] => {
  const cleanHistory = history.filter((message) => message.role !== "system" && !message.error);
  const turns: AiChatPayloadMessage[][] = [];
  let pendingUser: AiChatPayloadMessage | null = null;

  for (const message of cleanHistory) {
    if (message.role === "user") {
      if (pendingUser) {
        turns.push([pendingUser]);
      }
      pendingUser = { role: "user", content: message.content };
      continue;
    }

    if (message.role === "assistant") {
      if (pendingUser) {
        turns.push([pendingUser, { role: "assistant", content: message.content }]);
        pendingUser = null;
      } else {
        turns.push([{ role: "assistant", content: message.content }]);
      }
    }
  }

  if (pendingUser) {
    turns.push([pendingUser]);
  }

  return turns
    .slice(-Math.max(0, memoryTurns))
    .flat();
};

export const buildAiMessages = (
  attachment: AiLogContextAttachment | undefined,
  history: AiChatMessage[],
  nextPrompt: string,
  memoryTurns = DEFAULT_AI_MEMORY_TURNS,
): AiChatPayloadMessage[] => {
  const messages: AiChatPayloadMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (attachment) {
    messages.push({
      role: "system",
      content: [
        `以下是 ${attachment.date} 的学习日志上下文。后续回答请优先依据这份日志。`,
        "",
        attachment.markdown,
      ].join("\n"),
    });
  }

  messages.push(...selectRecentChatContext(history, memoryTurns));

  messages.push({ role: "user", content: nextPrompt });
  return messages;
};

const parseOpenAiContent = (body: unknown): string => {
  const content = (body as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices?.[0]?.message?.content ??
    (body as { choices?: Array<{ text?: unknown }> }).choices?.[0]?.text;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI 接口返回为空，或不是 OpenAI 兼容格式。");
  }
  return content.trim();
};

export const sendChatCompletion = async (options: {
  config: AiProviderConfig | undefined;
  apiKey: string | undefined;
  attachment?: AiLogContextAttachment;
  history: AiChatMessage[];
  prompt: string;
}): Promise<string> => {
  const { config, apiKey, attachment, history, prompt } = options;
  if (!config) {
    throw new Error("请先在“更多 → AI 设置”里配置 AI 接口。");
  }
  if (!apiKey?.trim()) {
    throw new Error("请先在“更多 → AI 设置”里填写 API Key。");
  }
  if (!config.model.trim()) {
    throw new Error("请先填写模型名称。");
  }

  const messages = buildAiMessages(attachment, history, prompt, config.memoryTurns ?? DEFAULT_AI_MEMORY_TURNS);
  if (canUseNativeAi()) {
    return runNativeAiChat({
      baseUrl: config.baseUrl,
      apiKey,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      messages,
    });
  }

  try {
    const response = await fetch(normalizeBaseUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
    });
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!response.ok) {
      const message = (json as { error?: { message?: string }; message?: string }).error?.message ??
        (json as { message?: string }).message ??
        text;
      throw new Error(`AI 接口请求失败：${response.status} ${message}`.trim());
    }
    return parseOpenAiContent(json);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Web 端请求失败，可能被第三方接口 CORS 限制。请在 Android 端使用，或配置允许跨域的代理 baseURL。");
    }
    throw error;
  }
};
