import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecordBlock, SubjectConfig } from "../types";
import { DayLogCard } from "./DayLogCard";

const stamp = "2026-06-21T00:00:00.000Z";

const subjects: SubjectConfig[] = [
  { id: "subject-os", createdAt: stamp, updatedAt: stamp, name: "OS", order: 0 },
  { id: "subject-math", createdAt: stamp, updatedAt: stamp, name: "数学", order: 1 },
];

const record = (id: string, subject: string): RecordBlock => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject,
  title: `${subject} 记录`,
  contentHtml: "<p>内容</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

describe("DayLogCard", () => {
  it("expands subject rows from the day log body", () => {
    render(
      <DayLogCard
        date="2026-06-21"
        records={[record("os", "OS"), record("math", "数学")]}
        subjects={subjects}
        onOpenSubject={vi.fn()}
        onAskAi={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /2026-06-21 学习日志/ }));

    expect(screen.getByRole("button", { name: /OS/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /数学/ })).toBeInTheDocument();
  });

  it("asks AI without expanding the card", () => {
    const onAskAi = vi.fn();
    render(
      <DayLogCard
        date="2026-06-21"
        records={[record("os", "OS")]}
        subjects={subjects}
        onOpenSubject={vi.fn()}
        onAskAi={onAskAi}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI问答" }));

    expect(onAskAi).toHaveBeenCalledWith("2026-06-21");
    expect(screen.queryByRole("button", { name: /OS/ })).not.toBeInTheDocument();
  });
});
