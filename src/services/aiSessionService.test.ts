import { describe, expect, it, vi } from "vitest";

import type { AiChatSession, AiContextPack } from "../types";
import { createAiSessionForDate, createAiSessionForScope, titleFromFirstPrompt } from "./aiSessionService";

const attachment: AiContextPack = {
  date: "2026-06-22",
  recordIds: ["record-1"],
  markdown: "# 日志",
  summary: "摘要",
  selectedChunks: [],
  allChunks: [],
  totalChunks: 0,
  estimatedChars: 0,
  contextHash: "hash",
  warnings: [],
  skippedAssets: [],
  missingOcrAssetIds: [],
};

describe("aiSessionService", () => {
  it("creates a new session every time for the same log date", async () => {
    const saved: AiChatSession[] = [];
    const store = {
      saveAiSession: vi.fn(async (session: AiChatSession) => {
        saved.push(session);
        return session;
      }),
    };

    const first = await createAiSessionForDate("2026-06-22", attachment, store);
    const second = await createAiSessionForDate("2026-06-22", attachment, store);

    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
    expect(saved).toHaveLength(2);
    expect(saved.every((session) => session.sourceDate === "2026-06-22")).toBe(true);
    expect(saved.every((session) => session.lastContextHash === "hash")).toBe(true);
  });

  it("creates readable titles from first prompt", () => {
    expect(titleFromFirstPrompt("  请用苏格拉底式方法问我今天的知识点，并逐步追问  ")).toBe("请用苏格拉底式方法问我今天的知识点，并逐...");
    expect(titleFromFirstPrompt("随机抽问")).toBe("随机抽问");
  });

  it("persists a tag scope while omitting the full local retrieval index", async () => {
    const saved: AiChatSession[] = [];
    const store = {
      saveAiSession: vi.fn(async (session: AiChatSession) => {
        saved.push(session);
        return session;
      }),
    };
    const scopedAttachment: AiContextPack = {
      ...attachment,
      scope: { kind: "tag", subject: "数学", tag: "专项突破" },
      scopeTitle: "数学 / #专项突破",
      allChunks: [{
        chunkId: "chunk",
        recordId: "record-1",
        date: "2026-06-22",
        subject: "数学",
        title: "极限",
        kind: "text",
        content: "极限定义",
        sourceLabel: "数学 / 极限 / 正文",
        order: 0,
      }],
    };

    await createAiSessionForScope({ kind: "tag", subject: "数学", tag: "专项突破" }, scopedAttachment, store);

    expect(saved[0]).toMatchObject({
      scope: { kind: "tag", subject: "数学", tag: "专项突破" },
      scopeTitle: "数学 / #专项突破",
      sourceDate: undefined,
    });
    expect(saved[0].attachment?.allChunks).toEqual([]);
  });

  it("persists a selected-record scope without assigning a source date", async () => {
    const saved: AiChatSession[] = [];
    const store = {
      saveAiSession: vi.fn(async (session: AiChatSession) => {
        saved.push(session);
        return session;
      }),
    };
    const scope = { kind: "records" as const, recordIds: ["record-1", "record-2"] };
    const scopedAttachment: AiContextPack = {
      ...attachment,
      scope,
      scopeTitle: "已选 2 条日志",
      recordIds: scope.recordIds,
    };

    await createAiSessionForScope(scope, scopedAttachment, store);

    expect(saved[0]).toMatchObject({
      scope,
      scopeTitle: "已选 2 条日志",
      sourceDate: undefined,
    });
  });
});
