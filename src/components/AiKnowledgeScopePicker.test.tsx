import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecordBlock } from "../types";
import { AiKnowledgeScopePicker } from "./AiKnowledgeScopePicker";

const record = (id: string, subject: string, title: string, tags: string[] = []): RecordBlock => ({
  id,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  type: "record",
  date: "2026-08-03",
  order: 0,
  subject,
  title,
  contentHtml: `<p>${title}</p>`,
  assets: [],
  formulas: [],
  mistakeRefs: [],
  tags,
});

const renderPicker = (blocks: RecordBlock[], onConfirm = vi.fn(), initialScope?: import("../types").AiKnowledgeScope) => render(
  <AiKnowledgeScopePicker
    blocks={blocks}
    assets={[]}
    includeDate
    initialScope={initialScope}
    title="选择范围"
    confirmLabel="确认范围"
    onBack={() => undefined}
    onConfirm={onConfirm}
  />,
);

describe("AiKnowledgeScopePicker", () => {
  it("explains when no formal subjects are available", () => {
    renderPicker([]);
    expect(screen.getByRole("option", { name: "没有可用学科" })).toBeInTheDocument();
    expect(screen.getByText("没有可用学科，请先保存正式日志。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认范围" })).toBeDisabled();
  });

  it("shows a saved-tag empty state instead of a blank selector", () => {
    renderPicker([record("r1", "数学", "极限")]);
    expect(screen.getByRole("option", { name: "该学科没有已保存标签" })).toBeInTheDocument();
    expect(screen.getByText("该学科没有已保存标签。")).toBeInTheDocument();
  });

  it("auto-selects the first saved tag and confirms the shared tag scope", async () => {
    const onConfirm = vi.fn();
    renderPicker([record("r1", "数学", "极限", ["重点", "错题"] )], onConfirm);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "标签" })).toHaveValue("错题"));
    fireEvent.click(screen.getByRole("button", { name: "确认范围" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ kind: "tag", subject: "数学", tag: "错题" }));
  });

  it("supports the podcast-only date scope", async () => {
    const onConfirm = vi.fn();
    renderPicker([record("r1", "数学", "极限")], onConfirm, { kind: "date", date: "2026-08-03" });
    fireEvent.click(screen.getByRole("tab", { name: "按日期" }));
    fireEvent.click(screen.getByRole("button", { name: "确认范围" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "date" })));
  });
});
