import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../db/defaults";
import { copyTextToClipboard } from "../lib/clipboard";
import { storage } from "../services/storageAdapter";
import type { AiChatMessage, AiChatSession, AiContextPack } from "../types";
import { AiChatPage } from "./AiChatPage";

vi.mock("../lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(),
}));

const stamp = "2026-06-22T00:00:00.000Z";

const session: AiChatSession = {
  id: "session-1",
  createdAt: stamp,
  updatedAt: stamp,
  title: "公式问答",
};

const assistantMessage: AiChatMessage = {
  id: "message-1",
  sessionId: session.id,
  createdAt: stamp,
  updatedAt: stamp,
  role: "assistant",
  content: "公式：$a^2+b^2=c^2$",
};

const contextAttachment: AiContextPack = {
  date: "2026-06-22",
  scopeTitle: "数学 / #专项突破",
  recordIds: ["record-1"],
  markdown: "# 数学",
  summary: "学习摘要",
  selectedChunks: [],
  allChunks: [],
  totalChunks: 0,
  estimatedChars: 0,
  contextHash: "context",
  warnings: [],
  skippedAssets: [],
  missingOcrAssetIds: [],
};

const renderAiChatPage = () => {
  vi.spyOn(storage, "listAiSessions").mockResolvedValue([session]);
  vi.spyOn(storage, "getAiSession").mockResolvedValue(session);
  vi.spyOn(storage, "listAiMessages").mockResolvedValue([assistantMessage]);
  vi.spyOn(storage, "listAiAttachments").mockResolvedValue([]);

  return render(
    <AiChatPage
      sessionId={session.id}
      settings={DEFAULT_SETTINGS}
      blocks={[]}
      assets={[]}
      onOpenSession={vi.fn()}
      onDeletedSession={vi.fn()}
      onOpenSettings={vi.fn()}
    />,
  );
};

describe("AiChatPage", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(copyTextToClipboard).mockReset();
  });

  it("copies the original Markdown message and shows success status", async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(true);
    renderAiChatPage();

    const copyButton = await screen.findByRole("button", { name: "复制" });
    fireEvent.click(copyButton);

    await waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith(assistantMessage.content));
    expect(await screen.findByText("已复制。")).toBeInTheDocument();
  });

  it("shows a manual-copy hint when clipboard fallback fails", async () => {
    vi.mocked(copyTextToClipboard).mockResolvedValue(false);
    renderAiChatPage();

    const copyButton = await screen.findByRole("button", { name: "复制" });
    fireEvent.click(copyButton);

    expect(await screen.findByText("复制失败，请长按选择文本后手动复制。")).toBeInTheDocument();
  });

  it("offers a recent knowledge-range picker when no session is selected", async () => {
    vi.spyOn(storage, "listAiSessions").mockResolvedValue([]);
    render(
      <AiChatPage
        sessionId={null}
        settings={DEFAULT_SETTINGS}
        blocks={[]}
        assets={[]}
        onOpenSession={vi.fn()}
        onDeletedSession={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "新建知识库问答" })[0]);
    expect(await screen.findByRole("dialog", { name: "新建知识库问答" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "近期学习" }));
    fireEvent.click(screen.getByRole("tab", { name: "14 天" }));

    expect(screen.getByText(/最近 14 天/)).toBeInTheDocument();
  });

  it("labels the automatic focused retrieval budget in the context strip", async () => {
    const scopedSession: AiChatSession = { ...session, attachment: contextAttachment };
    vi.spyOn(storage, "listAiSessions").mockResolvedValue([scopedSession]);
    vi.spyOn(storage, "getAiSession").mockResolvedValue(scopedSession);
    vi.spyOn(storage, "listAiMessages").mockResolvedValue([]);
    vi.spyOn(storage, "listAiAttachments").mockResolvedValue([]);
    render(
      <AiChatPage
        sessionId={scopedSession.id}
        settings={DEFAULT_SETTINGS}
        blocks={[]}
        assets={[]}
        onOpenSession={vi.fn()}
        onDeletedSession={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(await screen.findByText("聚焦检索 16K")).toBeInTheDocument();
  });
});
