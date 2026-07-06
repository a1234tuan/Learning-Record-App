import { describe, expect, it, vi } from "vitest";

import type { AiChatSession, AiContextPack } from "../types";
import { createAiSessionForDate, titleFromFirstPrompt } from "./aiSessionService";

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
});
