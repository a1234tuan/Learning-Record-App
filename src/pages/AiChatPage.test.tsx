import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../db/defaults";
import { copyTextToClipboard } from "../lib/clipboard";
import { storage } from "../services/storageAdapter";
import type { AiChatMessage, AiChatSession } from "../types";
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
});
