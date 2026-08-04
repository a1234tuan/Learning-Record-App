import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../db/defaults";
import { AiToolsPage } from "./AiToolsPage";

describe("AiToolsPage", () => {
  it("opens AI chat records and uses a single-layer AI settings toggle", () => {
    const onOpenAi = vi.fn();

    render(<AiToolsPage settings={DEFAULT_SETTINGS} onChanged={vi.fn()} onOpenAi={onOpenAi} />);

    fireEvent.click(screen.getByRole("button", { name: /AI 问答与聊天记录/ }));
    expect(onOpenAi).toHaveBeenCalledTimes(1);

    const settingsToggle = screen.getByRole("button", { name: /AI 设置/ });
    expect(settingsToggle).toHaveClass("ai-settings-toggle");
    expect(settingsToggle).not.toHaveClass("more-link-card");

    fireEvent.click(settingsToggle);
    expect(screen.queryByLabelText("PaddleOCR Token")).not.toBeInTheDocument();
  });

  it("keeps AI export collapsed until the user expands it", () => {
    render(<AiToolsPage settings={DEFAULT_SETTINGS} onChanged={vi.fn()} onOpenAi={vi.fn()} />);

    expect(screen.queryByLabelText("导出格式")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开" }));

    expect(screen.getByLabelText("导出格式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /导出 AI 材料/ })).toBeInTheDocument();
  });

  it("renders the advanced podcast template workbench with variables and a preview", () => {
    render(<AiToolsPage settings={{
      ...DEFAULT_SETTINGS,
      knowledgePodcastModeTemplates: [{
        id: "mode-1",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        title: "错题抽测",
        prompt: "你是一位 {{讲述角色}}。重点讲 {{必须覆盖}}。",
        order: 0,
      }],
    }} onChanged={vi.fn()} onOpenAi={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "知识播客高级模板工作台" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("你是一位 {{讲述角色}}。重点讲 {{必须覆盖}}。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入 完整策划摘要" })).toBeInTheDocument();
    expect(screen.getByText("查看示例合并预览")).toBeInTheDocument();
  });
});
