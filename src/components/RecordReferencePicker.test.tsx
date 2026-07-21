import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { RecordBlock, SubjectConfig } from "../types";
import { RecordReferencePicker } from "./RecordReferencePicker";

const stamp = "2026-07-21T00:00:00.000Z";

const record = (id: string, title: string, subject: string, date: string): RecordBlock => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date,
  order: 0,
  subject,
  title,
  contentHtml: "<p></p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

const subjects: SubjectConfig[] = [
  { id: "math", createdAt: stamp, updatedAt: stamp, name: "数学", order: 0 },
  { id: "english", createdAt: stamp, updatedAt: stamp, name: "英语", order: 1, archivedAt: stamp },
];

describe("RecordReferencePicker", () => {
  it("excludes the current record and browses active or archived subjects by month", () => {
    const source = record("source", "来源日志", "数学", "2026-07-21");
    const july = record("july", "七月积分", "数学", "2026-07-12");
    const august = record("august", "八月极限", "数学", "2026-08-02");
    const archived = record("english", "已归档语法", "英语", "2026-06-03");
    const onSelect = vi.fn();

    render(
      <RecordReferencePicker
        currentRecordId={source.id}
        records={[source, july, august, archived]}
        subjects={subjects}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /来源日志/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "数学" }));
    fireEvent.click(screen.getByRole("button", { name: /2026年08月/ }));
    fireEvent.click(screen.getByRole("button", { name: /八月极限/ }));
    expect(onSelect).toHaveBeenCalledWith(august);

    fireEvent.click(screen.getByRole("button", { name: /英语（已归档）/ }));
    fireEvent.click(screen.getByRole("button", { name: /2026年06月/ }));
    expect(screen.getByRole("button", { name: /已归档语法/ })).toBeInTheDocument();
  });
});
