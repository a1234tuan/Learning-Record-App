import type { AiChatSession, AiLogContextAttachment, StorageAdapter } from "../types";
import { createBaseEntity } from "../lib/entity";
import { storage as defaultStorage } from "./storageAdapter";

export const createAiSessionTitle = (date: string, now = new Date()): string => {
  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return `${date} AI 问答 ${time}`;
};

export const titleFromFirstPrompt = (prompt: string): string => {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 20 ? `${compact.slice(0, 20)}...` : compact;
};

export const createAiSessionForDate = async (
  date: string,
  attachment: AiLogContextAttachment,
  store: Pick<StorageAdapter, "saveAiSession"> = defaultStorage,
): Promise<AiChatSession | undefined> =>
  store.saveAiSession?.({
    ...createBaseEntity(),
    title: createAiSessionTitle(date),
    sourceDate: date,
    attachment,
  });

export const createAiSessionFromExistingAttachment = async (
  session: AiChatSession,
  store: Pick<StorageAdapter, "saveAiSession"> = defaultStorage,
): Promise<AiChatSession | undefined> => {
  if (!session.attachment) {
    return undefined;
  }
  return createAiSessionForDate(session.attachment.date, session.attachment, store);
};
