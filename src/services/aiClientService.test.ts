import { describe, expect, it } from "vitest";

import type { AiChatMessage, AiLogContextAttachment } from "../types";
import { buildAiMessages, selectRecentChatContext } from "./aiClientService";

const stamp = "2026-06-22T00:00:00.000Z";

const message = (role: AiChatMessage["role"], content: string, error?: string): AiChatMessage => ({
  id: `${role}-${content}`,
  sessionId: "session",
  createdAt: stamp,
  updatedAt: stamp,
  role,
  content,
  error,
});

const attachment: AiLogContextAttachment = {
  date: "2026-06-22",
  recordIds: ["record-1"],
  markdown: "# 2026-06-22 学习日志\n\n今天学习了 B 树。",
  warnings: [],
  skippedAssets: [],
  missingOcrAssetIds: [],
};

describe("buildAiMessages", () => {
  it("builds OpenAI-compatible messages with log context and history", () => {
    const messages = buildAiMessages(
      attachment,
      [
        message("user", "先问我一个问题"),
        message("assistant", "B 树的阶是什么意思？"),
        message("assistant", "网络错误", "网络错误"),
      ],
      "继续追问",
    );

    expect(messages[0]).toEqual(expect.objectContaining({ role: "system" }));
    expect(messages[1]).toEqual(expect.objectContaining({
      role: "system",
      content: expect.stringContaining("今天学习了 B 树"),
    }));
    expect(messages.map((item) => item.content)).toEqual(
      expect.arrayContaining(["先问我一个问题", "B 树的阶是什么意思？", "继续追问"]),
    );
    expect(messages.map((item) => item.content)).not.toContain("网络错误");
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "继续追问" });
  });

  it("keeps only the latest memory turns and skips failed messages", () => {
    const history: AiChatMessage[] = [];
    for (let index = 1; index <= 14; index += 1) {
      history.push(message("user", `问题 ${index}`));
      history.push(message("assistant", `回答 ${index}`));
    }
    history.splice(6, 0, message("assistant", "失败回答", "失败回答"));

    const context = selectRecentChatContext(history, 12);

    expect(context[0]).toEqual({ role: "user", content: "问题 3" });
    expect(context[1]).toEqual({ role: "assistant", content: "回答 3" });
    expect(context.at(-2)).toEqual({ role: "user", content: "问题 14" });
    expect(context.at(-1)).toEqual({ role: "assistant", content: "回答 14" });
    expect(context.map((item) => item.content)).not.toContain("失败回答");
    expect(context).toHaveLength(24);
  });

  it("passes only the selected memory window to the OpenAI messages", () => {
    const history = [
      message("user", "旧问题"),
      message("assistant", "旧回答"),
      message("user", "新问题"),
      message("assistant", "新回答"),
    ];

    const messages = buildAiMessages(attachment, history, "继续", 1);

    expect(messages.map((item) => item.content)).not.toContain("旧问题");
    expect(messages.map((item) => item.content)).toEqual(expect.arrayContaining(["新问题", "新回答", "继续"]));
  });
});
