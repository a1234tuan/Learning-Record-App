import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecordBlock } from "../types";
import { RecordCard } from "./RecordCard";

const record: RecordBlock = {
  id: "record-1",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  type: "record",
  date: "2026-06-01",
  order: 0,
  subject: "OS",
  title: "进程调度",
  contentHtml: "<p>内容</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
};

describe("RecordCard", () => {
  it("opens day-level AI without opening the record", () => {
    const onOpen = vi.fn();
    const onAskAi = vi.fn();

    render(<RecordCard record={record} onOpen={onOpen} onAskAi={onAskAi} />);

    fireEvent.click(screen.getByRole("button", { name: "AI问答 2026-06-01" }));

    expect(onAskAi).toHaveBeenCalledWith("2026-06-01");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
