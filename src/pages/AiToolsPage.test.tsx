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
  });

  it("keeps AI export collapsed until the user expands it", () => {
    render(<AiToolsPage settings={DEFAULT_SETTINGS} onChanged={vi.fn()} onOpenAi={vi.fn()} />);

    expect(screen.queryByLabelText("导出格式")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开" }));

    expect(screen.getByLabelText("导出格式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /导出 AI 材料/ })).toBeInTheDocument();
  });
});
