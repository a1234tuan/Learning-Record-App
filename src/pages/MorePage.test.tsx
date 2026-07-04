import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../db/defaults";
import { MorePage } from "./MorePage";

const renderMorePage = (settings = DEFAULT_SETTINGS) => {
  const props = {
    onOpenBackup: vi.fn(),
    onOpenAiTools: vi.fn(),
    onOpenOcrSettings: vi.fn(),
    onOpenStats: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenTrash: vi.fn(),
    settings,
  };

  render(<MorePage {...props} />);
  return props;
};

describe("MorePage", () => {
  it("renders compact tool and app entries without expanded heavy panels", () => {
    renderMorePage();

    expect(screen.getByText("备份与恢复")).toBeInTheDocument();
    expect(screen.getByText("AI 工具")).toBeInTheDocument();
    expect(screen.getByText("OCR 设置")).toBeInTheDocument();
    expect(screen.getByText("回收站")).toBeInTheDocument();
    expect(screen.getByText("统计")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "完整备份" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "导入恢复" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "自动备份" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI 材料导出" })).not.toBeInTheDocument();
    expect(screen.queryByText("AI 聊天记录")).not.toBeInTheDocument();
  });

  it("opens backup, AI tool and OCR settings subpages from the root entries", () => {
    const props = renderMorePage();

    fireEvent.click(screen.getByRole("button", { name: /备份与恢复/ }));
    fireEvent.click(screen.getByRole("button", { name: /AI 工具/ }));
    fireEvent.click(screen.getByRole("button", { name: /OCR 设置/ }));

    expect(props.onOpenBackup).toHaveBeenCalledTimes(1);
    expect(props.onOpenAiTools).toHaveBeenCalledTimes(1);
    expect(props.onOpenOcrSettings).toHaveBeenCalledTimes(1);
  });

  it("places a long AI model summary below the AI tools title", () => {
    const ai = DEFAULT_SETTINGS.ai!;
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ai: {
        ...ai,
        providers: ai.providers.map((provider) => ({
          ...provider,
          providerName: "阿里云百炼",
          model: "qwen3.7-plus-2026-05-26",
        })),
      },
    };

    renderMorePage(settings);

    const row = screen.getByRole("button", { name: /AI 工具/ });
    expect(row).toHaveClass("more-summary-row");
    expect(screen.getByText("阿里云百炼 · qwen3.7-plus-2026-05-26")).toBeInTheDocument();
  });
});
