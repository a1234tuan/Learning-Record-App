import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Block, SubjectConfig } from "../types";
import { JournalPage } from "./JournalPage";

const stamp = "2026-06-21T00:00:00.000Z";

const subjects: SubjectConfig[] = [
  {
    id: "subject-os",
    createdAt: stamp,
    updatedAt: stamp,
    name: "OS",
    order: 0,
  },
];

const record = (id: string, date: string): Block => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date,
  order: 0,
  subject: "OS",
  title: `${date} 记录`,
  contentHtml: "<p>内容</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

describe("JournalPage", () => {
  it("opens full-text search from the compact header action", () => {
    const onOpenSearch = vi.fn();

    render(
      <JournalPage
        blocks={[]}
        subjects={subjects}
        month={new Date("2026-06-01")}
        onMonthChange={vi.fn()}
        onSelectedDateChange={vi.fn()}
        onSelectedSubjectChange={vi.fn()}
        onOpenRecord={vi.fn()}
        onOpenSearch={onOpenSearch}
        onAskAi={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );

    expect(screen.queryByText("学科分类")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全局搜索" }));

    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("shows every record date in the active month and opens AI for older dates", () => {
    const onAskAi = vi.fn();
    const blocks: Block[] = [
      record("r1", "2026-06-21"),
      record("r2", "2026-06-20"),
      record("r3", "2026-06-19"),
      record("r4", "2026-06-18"),
      record("r5", "2026-06-17"),
      record("r6", "2026-06-01"),
      record("may", "2026-05-31"),
      record("july", "2026-07-01"),
    ];

    render(
      <JournalPage
        blocks={blocks}
        subjects={subjects}
        month={new Date("2026-06-01")}
        onMonthChange={vi.fn()}
        onSelectedDateChange={vi.fn()}
        onSelectedSubjectChange={vi.fn()}
        onOpenRecord={vi.fn()}
        onOpenSearch={vi.fn()}
        onAskAi={onAskAi}
        onToggleFavorite={vi.fn()}
      />,
    );

    expect(screen.getByText("本月有记录日期")).toBeInTheDocument();
    expect(screen.getByText("2026-06-01 学习日志")).toBeInTheDocument();
    expect(screen.queryByText("2026-05-31 学习日志")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-07-01 学习日志")).not.toBeInTheDocument();

    const oldCard = screen.getByText("2026-06-01 学习日志").closest("article");
    expect(oldCard).not.toBeNull();
    fireEvent.click(within(oldCard as HTMLElement).getByRole("button", { name: "AI问答" }));

    expect(onAskAi).toHaveBeenCalledWith("2026-06-01");
  });
});
