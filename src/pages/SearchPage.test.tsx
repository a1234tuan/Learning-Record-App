import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Block, RecordBlock } from "../types";
import { isDesktopPlatform } from "../lib/platform";
import { SearchPage } from "./SearchPage";

vi.mock("../lib/platform", () => ({
  isDesktopPlatform: vi.fn(() => false),
}));

const stamp = "2026-06-21T00:00:00.000Z";

const record = (id: string, title: string, content = "目标关键词"): RecordBlock => ({
  id,
  createdAt: stamp,
  updatedAt: stamp,
  type: "record",
  date: "2026-06-21",
  order: 0,
  subject: "数学",
  title,
  contentHtml: `<p>${content}</p>`,
  assets: [],
  formulas: [],
  mistakeRefs: [],
});

const SearchHarness = ({ blocks }: { blocks: Block[] }) => {
  const [query, setQuery] = useState("");
  return (
    <SearchPage
      entries={[]}
      blocks={blocks}
      assets={[]}
      query={query}
      onQueryChange={setQuery}
    />
  );
};

describe("SearchPage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces search execution by 300ms", async () => {
    vi.useFakeTimers();
    render(<SearchHarness blocks={[record("r1", "目标记录")]} />);

    fireEvent.change(screen.getByPlaceholderText(/搜索/), { target: { value: "目标" } });

    expect(screen.queryByText("目标记录")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(screen.queryByText("目标记录")).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByText("目标记录")).toBeInTheDocument();
  });

  it("caps rendered results at 200 and asks the user to narrow the keyword", async () => {
    const blocks = Array.from({ length: 205 }, (_, index) =>
      record(`r${index}`, `结果 ${index + 1}`, "同一个关键词"),
    );

    render(
      <SearchPage
        entries={[]}
        blocks={blocks}
        assets={[]}
        query="同一个关键词"
        onQueryChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("结果较多，仅显示前 200 条，请缩小关键词。")).toBeInTheDocument());
    expect(screen.getByText("结果 200")).toBeInTheDocument();
    expect(document.querySelectorAll(".search-result")).toHaveLength(200);
  });

  it("does not push desktop IME composition text into the global search state", () => {
    const onQueryChange = vi.fn();
    vi.mocked(isDesktopPlatform).mockReturnValue(true);
    try {
      render(<SearchPage entries={[]} blocks={[]} assets={[]} query="" onQueryChange={onQueryChange} />);
      const input = screen.getByPlaceholderText(/搜索/);

      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "zhong" } });
      expect(onQueryChange).not.toHaveBeenCalled();

      fireEvent.compositionEnd(input, { data: "中", target: { value: "中" } });
      expect(onQueryChange).toHaveBeenCalledTimes(1);
      expect(onQueryChange).toHaveBeenLastCalledWith("中");
    } finally {
      vi.mocked(isDesktopPlatform).mockReturnValue(false);
    }
  });
});
