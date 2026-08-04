import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../db/defaults";
import { AiToolsPage } from "./AiToolsPage";
import { PodcastTemplatesPage } from "./PodcastTemplatesPage";

describe("AiToolsPage", () => {
  it("renders AI settings panel and back button", () => {
    render(<AiToolsPage settings={DEFAULT_SETTINGS} onChanged={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: /返回/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AI 问答与聊天记录/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("导出格式")).not.toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", () => {
    const onBack = vi.fn();
    render(<AiToolsPage settings={DEFAULT_SETTINGS} onChanged={vi.fn()} onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: /返回/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the advanced podcast template workbench from its dedicated page", () => {
    render(<PodcastTemplatesPage settings={{
      ...DEFAULT_SETTINGS,
      knowledgePodcastModeTemplates: [{
        id: "mode-1",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        title: "错题抽测",
        prompt: "你是一位 {{讲述角色}}。重点讲 {{必须覆盖}}。",
        order: 0,
      }],
    }} onChanged={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "播客高级模板" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("你是一位 {{讲述角色}}。重点讲 {{必须覆盖}}。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入 完整策划摘要" })).toBeInTheDocument();
    expect(screen.getByText("查看示例合并预览")).toBeInTheDocument();
  });
});
