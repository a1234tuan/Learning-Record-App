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
  subject: "操作系统",
  title: "进程同步与互斥",
  contentHtml: "<p>信号量机制实现</p>",
  assets: [],
  formulas: [],
  mistakeRefs: [],
};

describe("RecordCard", () => {
  it("keeps action buttons from opening the record", () => {
    const onOpen = vi.fn();
    const onAskAi = vi.fn();

    render(<RecordCard record={record} onOpen={onOpen} onAskAi={onAskAi} />);

    const aiButton = screen.getByTitle("AI问答");
    fireEvent.click(aiButton);

    expect(onAskAi).toHaveBeenCalledWith("2026-06-01");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
