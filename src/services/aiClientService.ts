import type { AiChatAttachment, AiChatMessage, AiContextPack, AiProviderProfile } from "../types";
import { DEFAULT_AI_MEMORY_TURNS } from "../lib/aiProviders";
import { blobToBase64 } from "./backup";
import { canUseNativeAi, runNativeAiChat } from "./nativeAi";

export type AiChatPayloadContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type AiChatPayloadMessage = {
  role: "system" | "user" | "assistant";
  content: string | AiChatPayloadContentPart[];
};

const SYSTEM_PROMPT = [
  "你是一个严格、耐心的学习教练，回答必须优先基于用户提供的本地学习日志。",
  "日志中没有的信息请明确说“不确定”或“日志里没有”，不要编造。",
  "回答具体知识问题时，请尽量在结尾列出“依据来源”，引用日志片段的来源标签。",
  "如果用户要求出题、抽问、白纸复述、盲区挖掘或费曼讲解，先出题或追问并等待用户回答，除非用户明确要求直接给答案。",
  "批改时要指出正确、错误、不完整和遗漏点，不要只做泛泛鼓励。",
].join("\n");

export const normalizeAiChatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("请先填写 AI 接口 Base URL。");
  }
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
};

const MEMORY_SUMMARY_TURNS = 12;

const plainTextForMemory = (message: AiChatMessage): string => {
  const attachmentNote = message.attachmentIds?.length ? `\n[用户上传了 ${message.attachmentIds.length} 张图片]` : "";
  return `${message.content}${attachmentNote}`.trim();
};

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
      pendingUser = { role: "user", content: plainTextForMemory(message) };
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
  attachment: AiContextPack | undefined,
  history: AiChatMessage[],
  nextPrompt: string,
  memoryTurns = DEFAULT_AI_MEMORY_TURNS,
  memorySummary?: string,
  nextContent?: string | AiChatPayloadContentPart[],
): AiChatPayloadMessage[] => {
  const messages: AiChatPayloadMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (attachment) {
    const selectedChunks = attachment.selectedChunks?.length ? attachment.selectedChunks : attachment.allChunks ?? [];
    const sourceLines = selectedChunks.map((chunk, index) => [
      `[[S${index + 1}]] ${chunk.sourceLabel}`,
      chunk.content,
    ].join("\n"));
    messages.push({
      role: "system",
      content: [
        `以下是 ${attachment.date} 的学习日志上下文。后续回答请优先依据这些内容。`,
        "",
        "## 当天摘要",
        attachment.summary || "无摘要。",
        "",
        "## 可引用日志片段",
        sourceLines.length > 0 ? sourceLines.join("\n\n") : "没有可用日志片段。",
        "",
        "## 上下文提示",
        `记录数：${attachment.recordIds.length}`,
        `命中片段：${selectedChunks.length}/${attachment.totalChunks ?? selectedChunks.length}`,
        `图片 OCR：${attachment.ocrSummary?.includedImages ?? 0}/${(attachment.ocrSummary?.includedImages ?? 0) + (attachment.ocrSummary?.skippedImages ?? 0)}`,
        attachment.warnings.length ? attachment.warnings.map((warning) => `- ${warning}`).join("\n") : "- 无额外警告。",
        "",
        "回答要求：如果使用了日志内容，请在回答末尾写“依据来源：[[S1]] 来源标签、[[S2]] 来源标签”。如果日志证据不足，请明确说明。",
        "",
      ].join("\n"),
    });
  }

  if (memorySummary?.trim()) {
    messages.push({
      role: "system",
      content: [
        "以下是较早聊天的滚动记忆摘要，用于保持连续问答背景；如果它和最新日志片段冲突，以日志片段和最近对话为准。",
        "",
        memorySummary.trim(),
      ].join("\n"),
    });
  }

  messages.push(...selectRecentChatContext(history, memoryTurns));
  messages.push({ role: "user", content: nextContent ?? nextPrompt });
  return messages;
};

export const buildSessionMemorySummary = (
  history: AiChatMessage[],
  memoryTurns = DEFAULT_AI_MEMORY_TURNS,
): string | undefined => {
  const cleanHistory = history.filter((message) => message.role !== "system" && !message.error);
  const recent = selectRecentChatContext(cleanHistory, memoryTurns);
  const recentKeys = new Set(recent.map((message) => `${message.role}:${message.content}`));
  const older = cleanHistory.filter((message) => !recentKeys.has(`${message.role}:${message.content}`));
  if (older.length < MEMORY_SUMMARY_TURNS) {
    return undefined;
  }
  const lines = older
    .slice(-MEMORY_SUMMARY_TURNS * 2)
    .map((message) => `${message.role === "user" ? "用户" : "AI"}：${message.content}`)
    .join("\n");
  return [
    "较早对话要点：",
    lines.length > 1800 ? `${lines.slice(0, 1800)}...` : lines,
  ].join("\n");
};

const parseOpenAiContent = (body: unknown): string => {
  const content = (body as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> }).choices?.[0]?.message?.content ??
    (body as { choices?: Array<{ text?: unknown }> }).choices?.[0]?.text;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI 接口返回为空，或不是 OpenAI 兼容格式。");
  }
  return content.trim();
};

const extractErrorMessage = (body: unknown, fallback: string): string => {
  const errorMessage = (body as { error?: { message?: unknown }; message?: unknown }).error?.message ??
    (body as { message?: unknown }).message;
  return typeof errorMessage === "string" && errorMessage.trim() ? errorMessage : fallback;
};

const imageAttachmentToContentPart = async (attachment: AiChatAttachment): Promise<AiChatPayloadContentPart> => {
  const base64 = await blobToBase64(attachment.data);
  return {
    type: "image_url",
    image_url: {
      url: `data:${attachment.mimeType || "image/jpeg"};base64,${base64}`,
      detail: "auto",
    },
  };
};

const buildOcrMarkdownPrompt = (prompt: string, attachments: AiChatAttachment[]): string => {
  const imageBlocks = attachments.map((attachment, index) => [
    `### 用户上传图片 ${index + 1}：${attachment.fileName}`,
    "",
    "以下是本地 PaddleOCR 识别出的图片文字，请基于它进行批改或回答：",
    "",
    "```text",
    attachment.ocrText?.trim() || "（没有可用 OCR 文本）",
    "```",
  ].join("\n"));
  return [
    prompt.trim() || "请根据我上传的图片内容进行回答或批改。",
    "",
    "## 本轮图片 OCR 内容",
    imageBlocks.join("\n\n"),
  ].join("\n").trim();
};

export const buildUserPromptWithImages = async (options: {
  prompt: string;
  imageInputMode?: "vision" | "local-ocr" | "disabled";
  imageAttachments?: AiChatAttachment[];
}): Promise<string | AiChatPayloadContentPart[]> => {
  const attachments = options.imageAttachments ?? [];
  const prompt = options.prompt.trim();
  const mode = options.imageInputMode ?? "local-ocr";
  if (attachments.length === 0) {
    return prompt;
  }
  if (mode === "disabled") {
    throw new Error("AI 图片发送已关闭，请在 AI 设置中开启图片问答方式。");
  }
  if (mode === "local-ocr") {
    const failed = attachments.find((attachment) => attachment.ocrStatus !== "done" || !attachment.ocrText?.trim());
    if (failed) {
      throw new Error(`${failed.fileName} 没有可用 OCR 文本，请重新 OCR 后再发送。`);
    }
    return buildOcrMarkdownPrompt(prompt, attachments);
  }
  const content: AiChatPayloadContentPart[] = [
    { type: "text", text: prompt || "请根据我上传的图片内容进行回答或批改。" },
  ];
  content.push(...await Promise.all(attachments.map(imageAttachmentToContentPart)));
  return content;
};

export const sendChatCompletion = async (options: {
  provider: AiProviderProfile | undefined;
  apiKey: string | undefined;
  attachment?: AiContextPack;
  history: AiChatMessage[];
  prompt: string;
  memorySummary?: string;
  imageInputMode?: "vision" | "local-ocr" | "disabled";
  imageAttachments?: AiChatAttachment[];
}): Promise<string> => {
  const { provider, apiKey, attachment, history, prompt, memorySummary, imageInputMode, imageAttachments } = options;
  if (!provider) {
    throw new Error("请先在“更多 → AI 设置”里配置 AI 供应商。");
  }
  if (!apiKey?.trim()) {
    throw new Error(`请先在“更多 → AI 设置”里填写 ${provider.providerName} 的 API Key。`);
  }
  if (!provider.model.trim()) {
    throw new Error(`请先填写 ${provider.providerName} 的模型名称。`);
  }

  const userContent = await buildUserPromptWithImages({
    prompt,
    imageInputMode,
    imageAttachments,
  });
  const messages = buildAiMessages(
    attachment,
    history,
    prompt,
    provider.memoryTurns ?? DEFAULT_AI_MEMORY_TURNS,
    memorySummary,
    userContent,
  );
  if (canUseNativeAi()) {
    return runNativeAiChat({
      baseUrl: provider.baseUrl,
      apiKey,
      model: provider.model,
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
      messages,
    });
  }

  try {
    const response = await fetch(normalizeAiChatCompletionsUrl(provider.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: provider.temperature,
        max_tokens: provider.maxTokens,
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
      throw new Error(`${provider.providerName} AI 接口请求失败：${response.status} ${extractErrorMessage(json, text)}`.trim());
    }
    return parseOpenAiContent(json);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Web 端请求失败，可能被第三方接口 CORS 限制。请在 Android 端使用，或配置允许跨域的代理 Base URL。");
    }
    throw error;
  }
};
