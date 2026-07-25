import type { AiChatSession, AiContextPack, AiKnowledgeScope, StorageAdapter } from "../types";
import { createBaseEntity } from "../lib/entity";
import { storage as defaultStorage } from "./storageAdapter";
import { aiKnowledgeScopeTitle, compactAiContextPack } from "./aiContextService";

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
  attachment: AiContextPack,
  store: Pick<StorageAdapter, "saveAiSession"> = defaultStorage,
): Promise<AiChatSession | undefined> =>
  createAiSessionForScope({ kind: "date", date }, attachment, store);

export const createAiSessionForScope = async (
  scope: AiKnowledgeScope,
  attachment: AiContextPack,
  store: Pick<StorageAdapter, "saveAiSession"> = defaultStorage,
): Promise<AiChatSession | undefined> =>
  store.saveAiSession?.({
    ...createBaseEntity(),
    title: createAiSessionTitle(attachment.scopeTitle ?? aiKnowledgeScopeTitle(scope)),
    sourceDate: scope.kind === "date" ? scope.date : undefined,
    scope,
    scopeTitle: attachment.scopeTitle ?? aiKnowledgeScopeTitle(scope),
    attachment: compactAiContextPack(attachment),
    lastContextHash: attachment.contextHash,
  });

export const createAiSessionFromExistingAttachment = async (
  session: AiChatSession,
  store: Pick<StorageAdapter, "saveAiSession"> = defaultStorage,
): Promise<AiChatSession | undefined> => {
  if (!session.attachment) {
    return undefined;
  }
  const scope = session.scope ?? session.attachment.scope ?? { kind: "date" as const, date: session.sourceDate ?? session.attachment.date };
  return createAiSessionForScope(scope, session.attachment, store);
};
